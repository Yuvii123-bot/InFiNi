// INFINI AI — research frontier: every lead found for a question (search results, references, links inside pages
// already read), screened by rule and kept in priority order. Only leads that pass the screen are ever fetched.
//
// A lead is scored from what is known before reading it: how much of the question its title, snippet, link text and
// address contain, whether it names the topic, how its publisher is classified, how highly search services ranked it and
// how many of them found it. Per-site limits keep one publisher from dominating and keep the load on any site small.

import { canonicalUrl, domainOf, hostOf, squash } from '../util/text.js';
import { lexicalOverlap, stemsOf } from '../rank/rank.js';
import { classifySource } from '../evidence/evidence.js';

const JUNK_LINK = /\/(?:tag|tags|category|categories|author|authors|topic|topics|search|login|signin|sign-in|signup|register|subscribe|share|cart|account|contact|about|privacy|terms|cookies?|advertis\w*|feed|rss|print|email|donate|newsletter)(?:[/?#.]|$)|[?&](?:share|utm_|replytocom|print)=|^mailto:|\/(?:wp-login|wp-admin)\b/i;
const slugWords = (url) => { try { const u = new URL(url); return decodeURIComponent(u.pathname).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_/+.]+/g, ' ').replace(/\b[0-9a-f]{8,}\b/gi, ' ').trim().slice(0, 200); } catch { return ''; } };

/**
 * opts: { terms: Map(stem → weight) of the question, focus: Set(stems of the topic), skip(url) → true when a URL must never
 *         be fetched, perDomain: pages allowed per site, learned: {domain: {good, bad}}, minOverlap }
 */
export function createFrontier(opts) {
  const { terms, focus = new Set(), skip = () => false, learned = null } = opts;
  let perDomain = opts.perDomain || 6;
  const minOverlap = opts.minOverlap ?? 0.3;
  const byKey = new Map();          // canonical URL → lead
  const queue = [];                 // leads waiting to be read (unsorted; sorted lazily)
  const taken = new Map();          // domain → pages handed out
  const stats = { screened: 0, accepted: 0, rejected: 0, duplicates: 0, fromLinks: 0, fromSearch: 0, fromReferences: 0, handedOut: 0 };
  let dirty = false;
  let aspectMaps = [];              // one weighted vocabulary per sub-topic being researched (topic + sub-topic terms), added as the run goes on
  // Wikipedia and Europe PMC are read through their APIs, within those APIs' own budgets. An open-access article on a
  // publisher's or repository's site is a work of its own, not one more page of the same site: such sites get twice the allowance.
  const capFor = (domain, lead) => (domain === 'wikipedia.org' ? perDomain * 4 : domain === 'europepmc.org' ? 100000 : lead && lead.kind === 'academic' ? perDomain * 2 : perDomain);

  const focusShare = (text) => { if (!focus.size) return 1; const st = new Set(stemsOf(text)); let n = 0; for (const f of focus) if (st.has(f)) n++; return n / focus.size; };
  const overlapOf = (title, snippet) => {
    let ov = lexicalOverlap(title, snippet, terms);
    for (const m of aspectMaps) { const o = 0.8 * lexicalOverlap(title, snippet, m); if (o > ov) ov = o; }
    return ov;
  };

  /** Score one lead. Returns null when it does not pass the screen. */
  function score(lead) {
    const slug = slugWords(lead.url);
    const title = squash(`${lead.title || ''} ${lead.anchor || ''}`);
    let ov = Math.max(overlapOf(title, lead.snippet || ''), 0.85 * overlapOf(`${title} ${slug}`, ''));
    let fs = focusShare(`${title} ${lead.snippet || ''} ${slug}`);
    // a link inside a page: the sentence it stands in says what it is cited for — weaker than a title, but often all there is ("a 2024 study found …")
    if (lead.context) { const cov = overlapOf('', lead.context); if (0.6 * cov > ov) { ov = 0.6 * cov; fs = Math.max(fs, 0.75 * focusShare(lead.context)); } }
    const trusted = lead.rank != null && lead.rank < 5 && lead.trust;                 // a full web index put it near the top for a query that named the topic
    if (focus.size && fs === 0 && !trusted) return null;                              // nothing known about the lead names the topic
    if (!(ov >= minOverlap || (fs >= 1 && ov >= 0.15) || (trusted && ov >= 0.12))) return null;
    const cls = classifySource(lead.url, {}, learned);
    let s = (0.2 + ov) * (0.3 + 0.7 * Math.max(fs, trusted ? 0.5 : 0)) * (0.6 + cls.quality) * (1 + 6 * (lead.rr || 0));
    if (lead.parentRel != null) s *= 0.75 * (0.5 + lead.parentRel);                    // a link inside a page: worth as much as the page it came from
    if (lead.content) s *= 1.1;                                                        // text already delivered by an API
    return { s, ov, fs, quality: cls.quality };
  }

  function push(lead) {
    stats.screened++;
    if (!lead || !/^https?:\/\//i.test(lead.url || '') || lead.url.length > 600 || skip(lead.url)) { stats.rejected++; return null; }
    const key = canonicalUrl(lead.url);
    const cur = byKey.get(key);
    if (cur) {
      stats.duplicates++;
      cur.rr = (cur.rr || 0) + (lead.rr || 0);
      if (lead.provider && !cur.providers.includes(lead.provider)) cur.providers.push(lead.provider);
      if (!cur.snippet && lead.snippet) cur.snippet = lead.snippet;
      if (lead.aspect != null && !cur.aspects.includes(lead.aspect)) cur.aspects.push(lead.aspect);
      if (!cur.done && cur.queued) { const sc = score(cur); if (sc) { cur.score = sc.s; dirty = true; } }
      return cur;
    }
    const full = { ...lead, key, domain: domainOf(lead.url), host: hostOf(lead.url), providers: lead.provider ? [lead.provider] : [], aspects: lead.aspect != null ? [lead.aspect] : [], done: false, queued: false };
    const sc = score(full);
    byKey.set(key, full);
    if (!sc) { stats.rejected++; full.rejected = true; return full; }
    Object.assign(full, { score: sc.s, overlap: sc.ov, focusShare: sc.fs, quality: sc.quality, queued: true });
    queue.push(full);
    stats.accepted++;
    dirty = true;
    return full;
  }

  return {
    /** A ranked result list from one search (reciprocal-rank credit; several services finding the same page adds up). */
    addResults(results, { weight = 1, aspect = null, trust = false, source = 'search' } = {}) {
      let n = 0;
      (results || []).forEach((r, rank) => {
        if (!r || !r.url) return;
        const lead = push({ url: r.url, title: r.title, snippet: r.snippet, provider: r.provider, kind: r.kind, date: r.date, meta: r.meta, content: r.content || null, rank, rr: weight / (20 + rank), aspect, trust, via: source });
        if (lead && lead.queued && !lead.done) n++;
      });
      stats[source === 'references' ? 'fromReferences' : 'fromSearch'] += n;
      return n;
    },
    /** Links found inside the text of a page that was read and judged relevant. */
    addLinks(parent, links, { depth = 1, max = 40 } = {}) {
      let n = 0, sameSite = 0;
      for (const l of (links || []).slice(0, 250)) {
        if (n >= max) break;
        if (!l || !l.url) continue;
        const same = domainOf(l.url) === parent.domain;
        if (same && sameSite >= max / 4) continue;                                     // mostly follow links that lead away from the site
        if (JUNK_LINK.test(l.url) || /^https?:\/\/[^/]+\/?(?:[?#].*)?$/.test(l.url)) continue;       // front pages, tag and author listings, share and login links
        const lead = push({ url: l.url, anchor: l.text, title: '', context: l.ctx || '', provider: 'link', kind: 'web', parentRel: parent.rel || 0, parent: parent.key, depth, via: 'link' });
        if (lead && lead.queued && !lead.done && lead.parent === parent.key) { n++; if (same) sameSite++; }
      }
      stats.fromLinks += n;
      return n;
    },
    /** Vocabulary of the sub-topics found so far: leads about them pass the screen even when they do not repeat the question. */
    setAspects(maps) { aspectMaps = maps || []; },
    setPerDomain(n) { perDomain = n; },
    /** The best lead that may be read now (busy(host) → true while that host already has enough requests in flight). */
    next(busy = () => false) {
      if (dirty) { queue.sort((a, b) => a.score - b.score); dirty = false; }               // ascending: best at the end
      let best = -1, bestVal = 0, looked = 0;
      for (let i = queue.length - 1; i >= 0 && looked < 32; i--) {
        const c = queue[i];
        const used = taken.get(c.domain) || 0;
        if (used >= capFor(c.domain, c)) { queue.splice(i, 1); if (best > i) best--; c.queued = false; c.capped = true; continue; }
        looked++;
        if (busy(c.host)) continue;
        const val = c.score / (1 + 0.3 * used);                                          // each further page from the same site is worth less
        if (val > bestVal) { bestVal = val; best = i; }
      }
      if (best < 0) return null;
      const c = queue.splice(best, 1)[0];
      c.queued = false; c.done = true;
      taken.set(c.domain, (taken.get(c.domain) || 0) + 1);
      stats.handedOut++;
      return c;
    },
    /** Give a lead back (for example when its host was down) so that its slot on the site is not wasted. */
    release(c) { taken.set(c.domain, Math.max(0, (taken.get(c.domain) || 1) - 1)); },
    has(url) { return byKey.has(canonicalUrl(url)); },
    get(url) { return byKey.get(canonicalUrl(url)) || null; },
    /** Mark a URL as already handled (read during the first, quick round). */
    seen(url, { count = true } = {}) {
      const key = canonicalUrl(url);
      const cur = byKey.get(key);
      if (!cur) byKey.set(key, { url, key, domain: domainOf(url), host: hostOf(url), done: true, queued: false, providers: [], aspects: [] });
      else { if (cur.queued) { const i = queue.indexOf(cur); if (i >= 0) queue.splice(i, 1); cur.queued = false; } cur.done = true; }
      if (count) { const d = domainOf(url); taken.set(d, (taken.get(d) || 0) + 1); }
    },
    get size() { return queue.length; },
    /** Best score still waiting (0 when empty). */
    peekScore() { if (dirty) { queue.sort((a, b) => a.score - b.score); dirty = false; } return queue.length ? queue[queue.length - 1].score : 0; },
    stats: () => ({ ...stats, waiting: queue.length, unique: byKey.size }),
    leads: () => byKey,
  };
}
