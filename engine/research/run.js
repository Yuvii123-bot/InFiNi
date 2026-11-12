// INFINI AI — the research loop (depths "deep" and "research", and automatic widening when the first round is thin).
//
//   expand  → more searches: every available search service in parallel, wide Wikipedia title search, the reference
//             lists of the encyclopedia articles on the topic, open scholarly indexes, and one search per sub-topic
//   read    → a pool of workers reads the best leads (per-site limits, robots.txt and the address guard all apply);
//             each page is reduced to the blocks that bear on the question, and links inside relevant pages become leads
//   compare → everything is ranked again, sub-topics are derived from the material, a draft answer is sent
// …and again, until the page or time budget is used up, nothing relevant is left to read, or reading stops paying off.
// Every number reported from here is a count of operations that really ran.

import { createFrontier } from './frontier.js';
import { digestDoc, digestModel } from './digest.js';
import { keyPhrases, sharedHeadings, articleSections, mergeAspects } from './aspects.js';
import { runProvider, isEnabled, providerCooling, PROVIDERS } from '../providers/index.js';
import wikipedia from '../providers/wikipedia.js';
import { openalex } from '../providers/scholar.js';
import { stemsOf } from '../rank/rank.js';
import { canonicalUrl, domainOf, uniq, squash, capitalize } from '../util/text.js';

export const RESEARCH_BUDGET = {
  // widen: used by "auto" when the first round left a part of the question without direct evidence
  widen: { maxPages: 36, maxMs: 30000, concurrency: 14, perDomain: 3, rounds: 2, queries: 4, aspects: 0, refArticles: 1, related: 0, abstracts: 30, fullTexts: 2, oaPages: 3, linkDepth: 1, batchPages: 30, batchMs: 11000, sections: 0, perSection: 0, keep: 8 },
  deep: { maxPages: 70, maxMs: 45000, concurrency: 18, perDomain: 4, rounds: 3, queries: 6, aspects: 5, refArticles: 1, related: 0, abstracts: 60, fullTexts: 12, oaPages: 8, linkDepth: 1, batchPages: 40, batchMs: 13000, sections: 3, perSection: 2, keep: 8 },
  research: { maxPages: 1500, maxMs: 170000, concurrency: 40, perDomain: 12, rounds: 12, queries: 10, aspects: 8, refArticles: 3, related: 2, abstracts: 800, fullTexts: 240, oaPages: 300, linkDepth: 2, batchPages: 170, batchMs: 20000, firstBatchMs: 8000, sections: 6, perSection: 3, keep: 7 },
};
// How many times one question may call each search service during the loop (on top of the first round).
const CALLS = {
  widen: { tavily: 1, firecrawl: 2, ddg_html: 1, mwmbl: 3, marginalia: 1, searxng: 4, brave: 2, wikipedia: 4, openalex: 1, europepmc: 1, hackernews: 1 },
  deep: { tavily: 2, firecrawl: 3, ddg_html: 2, mwmbl: 5, marginalia: 2, searxng: 6, brave: 4, wikipedia: 8, openalex: 2, europepmc: 1, hackernews: 2 },
  research: { tavily: 5, firecrawl: 8, ddg_html: 4, mwmbl: 16, marginalia: 4, searxng: 20, brave: 10, wikipedia: 30, openalex: 14, europepmc: 10, hackernews: 4 },
};
const ADJECTIVE = /(?:ive|ory|ic|ous|ular|[a-z]{5}al|[a-z]{4}ary)$|^(?:immune|acute|severe|adverse|renal|fetal|foetal|neural|dental|mental|viral|fatal|social|legal|moral|rural|urban|human)$/;
const NOUN_AL = new Set('chemical material animal metal potential individual hospital capital removal survival disposal proposal approval arrival journal signal mineral criminal professional official festival cereal terminal tribunal interval manual trial denial burial mammal portal crystal withdrawal renewal refusal rehearsal appraisal dismissal plastic traffic music logic topic magic fabric clinic critic public republic statistic characteristic antibiotic probiotic pandemic epidemic mechanic arsenic garlic panic picnic relic tonic tunic directive objective perspective initiative alternative representative executive incentive narrative adjective detective memory history theory category territory factory laboratory inventory victory summary library boundary dictionary glossary salary anniversary'.split(' '));
const API_HOST = /(^|\.)(wikipedia\.org|europepmc\.org)$/;       // read through documented APIs with their own request budgets
const FULL_INDEX = new Set(['tavily', 'firecrawl', 'ddg_html', 'searxng', 'brave']);          // services backed by a full web index: their top results are trusted leads
const WEB = ['searxng', 'tavily', 'brave', 'firecrawl', 'ddg_html', 'mwmbl', 'marginalia'];
const BIOMED = /\b(health|disease|diseases|medical|medicine|clinical|patients?|symptoms?|treatments?|therap(y|ies)|drugs?|vaccines?|cancer|diabetes|diet|nutrition|obesity|exercise|sleep|mental|depression|anxiety|brain|heart|blood|infection|virus|bacteria|immune|genetic|genes?|protein|cells?|toxic|toxicity|exposure|pregnan\w+|mortality|epidemi\w+|pandemic|covid|fasting|supplements?|vitamins?|alcohol|smoking|pollution|microplastics?|antibiotics?|surgery|pain|aging|ageing|longevity|fertility|hormones?|inflammation|allerg\w+|asthma|stroke|dementia|alzheimer\w*|autism|adhd)\b/i;
const TECHY = /\b(ai|artificial intelligence|software|programming|developer|startup|llm|machine learning|open source|linux|javascript|python|rust|database|cloud|chip|gpu|semiconductor|crypto|bitcoin|blockchain|cyber|security|hack|browser|api|framework|kubernetes|docker|quantum|robot\w*|agents?)\b/i;
// Angles tried for a topic when the material itself suggests too few sub-topics (queries only — a report section needs evidence of its own).
const ANGLES = ['overview', 'research review', 'evidence', 'statistics', 'causes', 'effects', 'risks', 'benefits', 'criticism', 'history', 'regulation', 'solutions', 'future outlook', 'explained'];

/**
 * x: { cfg, http, off, signal, aborted(), emit(ev), now, t0, analysis, mode: 'widen'|'deep'|'research', budget, docs, addDoc(d) → index,
 *      fetchLog, searchLog, logSearch(entry), entityDocs: Map, senses, learned, candidateLists, pctx, skipUrl(url), readLead(lead, model, opts) → {ok, rel, di, links},
 *      recompare(round) → ranks, weakPart(i), draft(round) }
 * Returns a summary { rounds, aspects, frontier: stats, pages, abstracts, stopped: reason, ms }.
 */
export async function runResearch(x) {
  const B = x.budget, mode = x.mode;
  const started = Date.now();
  const deadline = x.t0 + B.maxMs;
  const parts = x.analysis.parts;
  const whole = parts.map((p) => p.text).join(' ');
  const calls = { ...CALLS[mode] };
  const main = parts[0];
  const focus = squash(main.focus || main.keywords.slice(0, 4).join(' '));
  const qStems = new Set(parts.flatMap((p) => p.terms.map((t) => t.stem)));
  const attributeStems = new Set(stemsOf(main.attribute || ''));
  let model = digestModel(parts);
  const frontier = createFrontier({ terms: new Map([...model.terms].filter(([st]) => model.core.has(st))), focus: model.focus, skip: x.skipUrl, perDomain: B.perDomain, learned: x.learned.domains });
  const summary = { mode, rounds: 0, aspects: [], abstracts: 0, abstractsScreened: 0, fullTexts: 0, queries: [], stopped: '', linksFollowed: 0, references: 0, searchMs: 0, readMs: 0, oaLeads: 0 };
  let aspects = [];
  const searched = new Set();                 // queries already run in this loop
  const ticker = { last: 0, latest: [] };
  const okPages = () => x.fetchLog.reduce((n, f) => n + (f.ok ? 1 : 0), 0);
  const timeLeft = () => deadline - Date.now();
  let lastCompareMs = 400;

  const progress = (force) => {
    const t = Date.now();
    if (!force && t - ticker.last < 650) return;
    ticker.last = t;
    const fs = frontier.stats();
    let ok = 0, failed = 0, relevant = 0, bytes = 0;
    for (const f of x.fetchLog) { if (f.ok) { ok++; if (f.rel == null || f.rel >= 0.34) relevant++; } else failed++; bytes += f.bytes || 0; }
    x.emit({ type: 'progress', stage: 'reading', mode, round: summary.rounds, read: ok, relevant, failed, abstracts: summary.abstracts, screened: fs.screened + summary.abstractsScreened, waiting: fs.waiting, searches: x.searchLog.length, bytes, elapsedMs: t - x.t0, budget: { pages: B.maxPages, ms: B.maxMs }, subtopics: aspects.slice(0, 10).map((a) => ({ label: a.label, searched: !!a.searched })), latest: ticker.latest.slice(-4) });
  };

  // ---------- leads already in hand from the first round ----------
  for (const f of x.fetchLog) frontier.seen(f.url);
  for (const d of x.docs) if (!d.partial && d.url) frontier.seen(d.url);
  for (const l of x.candidateLists) frontier.addResults((l.results || []).filter((r) => !r.content), { weight: l.weight || 1, trust: (l.results || []).some((r) => FULL_INDEX.has(r.provider)) });

  /** Abstracts delivered by a scholarly index: kept as documents when they bear on the question (no page fetch needed). */
  const takeAbstracts = (results, aspect = null) => {
    let kept = 0;
    for (const r of results || []) {
      if (!r) continue;
      if (!r.content) {
        // a record without an abstract whose full text the API can deliver: screened by its title like any other lead
        if (r.meta && r.meta.pmcid && summary.fullTexts < B.fullTexts && !frontier.has(r.url) && frontier.addResults([r], { weight: 1.2, aspect })) summary.fullTexts++;
        continue;
      }
      summary.abstractsScreened++;
      const known = frontier.get(r.url);
      if (known && known.done) continue;
      const d = { url: r.url, title: r.content.title || r.title, site: r.content.site, author: r.content.author, published: r.content.published || '', blocks: r.content.blocks, partial: true, via: 'api', lang: r.content.lang, pageType: 'scholarly', evidenceLevel: 'api', kind: 'academic', provider: r.provider, scholar: r.meta || null, work: r.meta && r.meta.work };
      const dg = digestDoc(d, model, { keep: 2, lead: 1 });
      if (dg.offTopic) continue;
      // the abstract is kept while the allowance for abstracts lasts; a readable full text is queued either way
      if (summary.abstracts < B.abstracts) { x.addDoc({ ...d, rel: dg.rel, stats: dg.stats, digest: true, aspects: aspect != null ? [aspect] : [] }); kept++; summary.abstracts++; }
      // an open-access full text can be read through the Europe PMC API: the abstract is then replaced by the article
      const full = r.meta && r.meta.pmcid ? `https://europepmc.org/article/PMC/${r.meta.pmcid}` : '';
      if (full && summary.fullTexts < B.fullTexts && dg.rel >= 0.5 && !(frontier.get(full) && frontier.get(full).done)) { if (frontier.addResults([{ url: full, title: r.title, snippet: r.snippet, provider: 'europepmc', kind: 'academic', date: r.date, meta: r.meta }], { weight: 1.3, aspect })) summary.fullTexts++; }
      // an open-access copy on the publisher's or a repository's site: the article itself can be read there
      const oa = !full && r.meta && r.meta.oa && r.meta.oaUrl && !/\.pdf(?:[?#]|$)|\/pdf(?:\/|$|\?)|download/i.test(r.meta.oaUrl) && !x.skipUrl(r.meta.oaUrl) ? r.meta.oaUrl : '';
      if (oa && summary.oaLeads < (B.oaPages || 0) && dg.rel >= 0.55 && !frontier.has(oa)) { if (frontier.addResults([{ url: oa, title: r.title, snippet: r.snippet, provider: r.provider, kind: 'academic', date: r.date, meta: r.meta }], { weight: 1.0, aspect })) summary.oaLeads++; }
      if (canonicalUrl(r.url) !== canonicalUrl(full)) frontier.seen(r.url, { count: false });
    }
    return kept;
  };

  const logged = async (provider, label, query, fn) => {
    const s = Date.now();
    const entry = { provider, label, query, results: 0, ms: 0, ok: false, error: '' };
    try { const res = await fn(); entry.results = Array.isArray(res) ? res.length : (res && res.count) || 0; entry.ok = true; return res; }
    catch (e) { entry.error = e && e.code === 'aborted' ? 'stopped' : (e && e.message) || 'failed'; entry.code = (e && e.code) || 'error'; return null; }
    finally { entry.ms = Date.now() - s; x.logSearch(entry); }
  };
  const can = (id) => (calls[id] || 0) > 0 && isEnabled(id, x.cfg, x.off) && !providerCooling(id);
  const spend = (id) => { calls[id]--; };
  const ctxFor = (extra) => ({ ...x.pctx, ...extra });

  /** One query on every search service that still has budget, all in parallel. */
  async function searchEverywhere(query, { aspect = null, scholarly = true, wiki = true, fresh = null } = {}) {
    const key = query.toLowerCase();
    if (searched.has(key) || x.aborted()) return 0;
    searched.add(key);
    summary.queries.push(query);
    const jobs = [];
    for (const id of WEB) {
      if (!can(id)) continue;
      spend(id);
      jobs.push(runProvider(id, query, ctxFor({ limit: id === 'mwmbl' ? 30 : 20, fresh, timeoutMs: 8000 }), x.logSearch).then((res) => (res ? frontier.addResults(res, { weight: FULL_INDEX.has(id) ? 1.15 : 0.8, aspect, trust: FULL_INDEX.has(id) }) : 0)));
    }
    if (wiki && can('wikipedia') && x.http.remaining('wikimedia-api') > 12) {
      spend('wikipedia');
      jobs.push(logged('wikipedia', 'Wikipedia (wide title search)', query, () => wikipedia.searchTitles(query, ctxFor({ limit: 50 }))).then((res) => (res ? frontier.addResults(res, { weight: 0.9, aspect }) : 0)));
    }
    if (scholarly && can('openalex')) {
      spend('openalex');
      jobs.push(runProvider('openalex', query, ctxFor({ limit: mode === 'research' ? 100 : 40, timeoutMs: 9000 }), x.logSearch).then((res) => (res ? takeAbstracts(res, aspect) : 0)));
    }
    if (scholarly && BIOMED.test(whole) && can('europepmc')) {
      spend('europepmc');
      // the abstracts of the wider literature come from OpenAlex; Europe PMC is asked for articles whose full text it can deliver
      jobs.push(runProvider('europepmc', query, ctxFor({ limit: mode === 'research' ? 100 : 40, timeoutMs: 10000, openAccess: mode !== 'widen' }), x.logSearch).then((res) => (res ? takeAbstracts(res, aspect) : 0)));
    }
    if (TECHY.test(whole) && can('hackernews')) {
      spend('hackernews');
      jobs.push(runProvider('hackernews', query, ctxFor({ limit: 30 }), x.logSearch).then((res) => (res ? frontier.addResults(res, { weight: 0.7, aspect }) : 0)));
    }
    const got = await Promise.all(jobs.map((j) => j.catch(() => 0)));
    return got.reduce((a, b) => a + (b || 0), 0);
  }

  /** The sources cited by the encyclopedia articles on the topic: pages become leads, DOIs become abstracts. */
  async function harvestReferences(limit) {
    const titles = uniq([...x.senses.map((s) => s.title), ...[...x.entityDocs.values()].map((di) => x.docs[di]).filter((d) => d && d.provider === 'wikipedia' && !d.wrongSense && !d.news).map((d) => d.title)].filter(Boolean), (t) => t.toLowerCase()).slice(0, limit);
    await Promise.all(titles.map(async (title) => {
      if (x.http.remaining('wikimedia-api') < 10 || x.aborted()) return;
      const res = await logged('wikipedia', 'Wikipedia (sources cited by the article)', title, async () => { const r = await wikipedia.references(title, ctxFor({})); return Object.assign(r.references, { count: r.references.length }); });
      if (!res) return;
      summary.references += res.length;
      frontier.addResults(res.filter((r) => r.hasPage).map((r) => ({ url: r.url, title: r.title, snippet: '', provider: 'wikipedia-reference', kind: r.type === 'news' ? 'news' : r.type === 'journal' ? 'academic' : 'web', date: r.year })), { weight: 0.75, source: 'references' });
      // references that carry a DOI: fetch their abstracts in batches, the most promising titles first
      if (isEnabled('openalex', x.cfg, x.off) && !providerCooling('openalex')) {
        const terms = new Map([...model.terms].filter(([st]) => model.core.has(st)));
        const scoreTitle = (t) => { const st = new Set(stemsOf(t)); let got = 0, tot = 0; for (const [k, w] of terms) { tot += w; if (st.has(k)) got += w; } return tot ? got / tot : 0; };
        const dois = res.filter((r) => r.doi).map((r) => ({ doi: r.doi, s: scoreTitle(r.title) })).filter((r) => r.s >= 0.3).sort((a, b) => b.s - a.s).slice(0, mode === 'research' ? 150 : 50).map((r) => r.doi);
        for (let i = 0; i < dois.length && summary.abstracts < B.abstracts; i += 50) {
          const batch = dois.slice(i, i + 50);
          const works = await logged('openalex', 'OpenAlex (abstracts of cited works)', `${batch.length} DOIs cited by “${title}”`, () => openalex.byDoi(batch, ctxFor({ timeoutMs: 9000 })));
          if (works) takeAbstracts(works);
        }
      }
    }));
  }

  /** Read leads with a pool of workers until the batch limits are reached. Resolves with the reason for stopping. */
  function crawl({ maxNew, untilMs }) {
    return new Promise((resolve) => {
      let active = 0, launched = 0, settled = false, reason = '';
      const busy = new Map();
      const notBefore = new Map();            // host → time before which it must not be asked again (its robots.txt Crawl-delay)
      const hostBusy = (host) => {
        // a site that keeps failing is left alone; its leads stay in the queue as unread (Europe PMC articles are fetched from the EBI API host)
        if (x.http.hostDown(host) || (host.endsWith('europepmc.org') && x.http.hostDown('www.ebi.ac.uk'))) return true;
        const n = busy.get(host) || 0;
        if (API_HOST.test(host)) return n >= (host.endsWith('europepmc.org') ? 3 : 5);
        const delay = x.http.crawlDelay ? x.http.crawlDelay(host) : 0;
        if (delay > 0) return n >= 1 || Date.now() < (notBefore.get(host) || 0);
        return n >= 2;
      };
      const recent = [];                      // 1 = a relevant page was read, 0 = failure or off-topic page
      const lowYield = () => recent.length >= 40 && recent.slice(-40).reduce((a, b) => a + b, 0) < 4;
      const finish = () => { if (!settled && active === 0) { settled = true; resolve(reason || 'batch complete'); } };
      const pump = () => {
        if (settled) return;
        while (active < B.concurrency) {
          if (x.aborted()) { reason = 'stopped'; break; }
          if (Date.now() >= untilMs) { reason = 'time'; break; }
          if (okPages() + active >= B.maxPages) { reason = 'page budget'; break; }
          if (launched >= maxNew) { reason = 'batch complete'; break; }
          if (lowYield()) { reason = 'low yield'; break; }
          const lead = frontier.next(hostBusy);
          if (!lead) { if (!frontier.size) reason = 'no leads left'; break; }
          active++; launched++;
          busy.set(lead.host, (busy.get(lead.host) || 0) + 1);
          x.readLead(lead, model, { keep: B.keep, timeoutMs: Math.max(2500, Math.min(6000, untilMs - Date.now() + 2500)) }).then((r) => {
            const good = r.ok && r.rel >= 0.45;
            recent.push(good ? 1 : 0);
            if (r.ok) ticker.latest.push(lead.domain);
            if (good && r.links && (lead.depth || 0) < B.linkDepth) summary.linksFollowed += frontier.addLinks({ key: lead.key, domain: lead.domain, rel: r.rel }, r.links, { depth: (lead.depth || 0) + 1, max: mode === 'research' ? 30 : 12 });
          }).catch(() => { recent.push(0); }).finally(() => {
            active--;
            const delay = x.http.crawlDelay ? x.http.crawlDelay(lead.host) : 0;
            if (delay > 0) { notBefore.set(lead.host, Date.now() + delay * 1000); if (delay <= 20) setTimeout(pump, delay * 1000 + 20).unref?.(); }
            const n = (busy.get(lead.host) || 1) - 1;
            if (n > 0) busy.set(lead.host, n); else busy.delete(lead.host);
            progress(false);
            pump();
            finish();
          });
        }
        finish();
      };
      pump();
    });
  }

  const findAspects = (ranks) => {
    if (!B.aspects) return;
    const ranked = ranks[0] && ranks[0].ranked;
    if (!ranked || !ranked.sentences.length) return;
    const top = ranked.sentences[0].score;
    const best = ranked.sentences.filter((s) => s.score >= top * 0.3 && !/\?\s*$/.test(s.text) && !s.proc && !s.gapOnly).slice(0, 260);
    const keys = ranked.salience || null;                // the vocabulary of the best-matching sentences (see salience.js)
    const entityDi = x.entityDocs.get((main.focus || '').toLowerCase());
    const entityDoc = entityDi != null ? x.docs[entityDi] : null;
    const independent = new Set(x.docs.filter((d) => !d.offTopic).map((d) => d.origin)).size;
    // an encyclopedia article devoted to exactly what was asked ("Microplastics and human health") outlines the answer better than
    // one section of the general article: its title must cover more of the question than the general article's does
    const cover = (d) => { const st = new Set(stemsOf(d.title || '')); let got = 0, tot = 0; for (const t of main.terms) { if (t.weight < 0.5) continue; tot += t.weight; if (st.has(t.stem)) got += t.weight; } return tot ? got / tot - 0.07 * [...st].filter((k) => !qStems.has(k)).length : 0; };
    const focusStems = stemsOf(main.focus || '');
    const dedicated = x.docs.filter((d) => d.provider === 'wikipedia' && !d.partial && !d.wrongSense && !d.news && !d.offTopic && d !== entityDoc && (d.fullOutline || d.blocks.some((b) => b.type === 'heading')) && focusStems.length && focusStems.every((f) => stemsOf(d.title || '').includes(f)))
      .map((d) => ({ d, c: cover(d) })).filter((y) => y.c >= (entityDoc ? cover(entityDoc) + 0.2 : 0.5)).sort((a, b) => b.c - a.c)[0];
    // does the question ask something about the topic, beyond naming it? Then a section must earn its place with evidence.
    const predicate = main.terms.some((t) => t.weight >= 0.5 && !focusStems.includes(t.stem));
    const evidenceIn = (doc) => {
      if (!predicate) return null;
      const di = x.docs.indexOf(doc), m = new Map();
      for (const s of ranked.sentences.slice(0, 600)) { if (s.di !== di || s.score < top * 0.4 || s.predCov < 0.5 || s.directCov < 0.5) continue; for (const h of String(s.heading || '').split(' › ')) if (h) m.set(h, (m.get(h) || 0) + 1); }
      return m;
    };
    // sub-topics from the answers' vocabulary: recurring phrases, and — for "effects / causes / risks / uses of X" — single
    // terms that many sources name where the answer stands ("Inflammation", "Cancer"). Ranked together; a phrase goes before the term it contains.
    let phrases = keyPhrases(best, x.docs, qStems, { max: B.aspects * 2, minOrigins: independent >= 60 ? 4 : independent >= 15 ? 3 : 2, keys: keys ? keys.terms : null });
    if (keys && keys.sided) {
      // "effects / causes / uses of X": a phrase is a sub-topic when its head word mostly stands where the answers stand
      // ("oxidative stress"), not when it describes the topic or its setting ("microplastic pollution", "plastic particles")
      const side = new Map(keys.list.map((k) => [k.stem, k.origins ? k.obj / k.origins : 0]));
      phrases = phrases.filter((ph) => {
        const words = stemsOf(ph.label);
        const r = side.get(words[words.length - 1]);
        return r == null ? !words.some((st) => qStems.has(st)) : r >= 0.5;
      });
    }
    let fromVocabulary = phrases;
    // "reproductive" → "Reproductive effects": a describing word is completed with the relation the question itself asks about
    const relNoun = (String(main.attribute || '').toLowerCase().match(/\b(effects?|impacts?|consequences|causes|reasons|risks|dangers|hazards|benefits|advantages|disadvantages|symptoms|signs|uses|applications|treatments|complications|problems|challenges|factors)\b/) || [])[1] || '';
    if (keys && keys.sided) {
      const singles = keys.list.filter((k) => k.obj >= Math.max(3, Math.ceil(independent * 0.04)) && k.obj / k.origins >= 0.5 && k.weight >= 0.3 && k.word.length >= 5 && !qStems.has(k.stem)).slice(0, B.aspects * 2)
        .map((k) => ({ label: capitalize(ADJECTIVE.test(k.word) && !NOUN_AL.has(k.word) && relNoun ? `${k.word} ${relNoun}` : k.word), stems: [k.stem], source: 'recurring term', support: k.obj, common: k.weight }));
      for (const ph of phrases) ph.common = 1.15 * Math.max(0, ...ph.stems.map((st) => keys.terms.get(st) || 0));
      fromVocabulary = [...phrases, ...singles].sort((a, b) => b.common - a.common);
    }
    const found = mergeAspects([
      aspects.filter((a) => a.searched),                                                         // sub-topics already researched keep their place
      dedicated ? articleSections(dedicated.d, qStems, new Set(), { max: B.aspects, evidence: evidenceIn(dedicated.d) }) : [],
      articleSections(entityDoc && !entityDoc.wrongSense ? entityDoc : null, qStems, attributeStems, { max: B.aspects, evidence: attributeStems.size ? null : evidenceIn(entityDoc) }),
      sharedHeadings(x.docs, qStems, { max: B.aspects, minOrigins: independent >= 40 ? 3 : 2, keys: keys ? keys.terms : null }),
      fromVocabulary,
    ], { max: B.aspects });
    aspects = found.map((a) => { const old = aspects.find((o) => o.label === a.label); return old || { ...a, searched: false }; });
    // leads about a sub-topic pass the screen even when they do not repeat the whole question
    const extra = new Map();
    for (const a of aspects) for (const st of a.stems) extra.set(st, 0.5);
    if (keys) for (const k of keys.list.slice(0, 24)) if (!extra.has(k.stem)) extra.set(k.stem, 0.3 + 0.4 * k.weight);      // pages are digested for the answers' vocabulary too
    model = digestModel(parts, extra);
    frontier.setAspects(aspects.map((a) => { const m = new Map([...model.focus].map((st) => [st, 1.2])); for (const st of a.stems) m.set(st, 1); return m; }));
  };

  /**
   * The searches the next round would run: sub-topics not yet searched; then, in a research run, the answers' own
   * vocabulary ("microplastics inflammation") and a few standard angles on the topic. Empty when nothing new is left to ask.
   */
  const nextQueries = (ranks) => {
    const out = [];
    const has = (t) => searched.has(t.toLowerCase()) || out.some((o) => o.text.toLowerCase() === t.toLowerCase());
    for (const a of aspects.filter((a) => !a.searched).slice(0, B.queries)) {
      const text = squash(`${focus} ${a.label}`.replace(/[“”"]/g, '')).slice(0, 120);
      if (!has(text)) out.push({ text, aspect: a }); else a.searched = true;
    }
    if (mode !== 'research' || !focus) return out;
    const K = ranks && ranks[0] && ranks[0].ranked.salience;
    if (K) {
      let n = 0;
      const room = Math.max(3, B.queries - out.length - 2);
      for (const k of K.list) {
        if (n >= room) break;
        const text = `${focus} ${k.word}`;
        if (has(text) || aspects.some((a) => a.stems.includes(k.stem)) || focus.toLowerCase().includes(k.word)) continue;
        n++;
        out.push({ text });
      }
    }
    for (const angle of ANGLES) {
      if (out.length >= B.queries) break;
      const text = `${focus} ${angle}`;
      if (!has(text)) out.push({ text, scholarly: /research|evidence|review|stud/.test(angle) });
    }
    return out.slice(0, B.queries);
  };

  // ---------------------------------- the loop ----------------------------------
  let ranks = null, stop = '', thin = 0;
  for (let round = 1; round <= B.rounds && !stop; round++) {
    summary.rounds = round;
    if (x.aborted()) { stop = 'stopped'; break; }
    if (timeLeft() < 3500 + lastCompareMs * 2) { stop = 'time budget used'; break; }

    // ---- expand ----
    const s0 = Date.now();
    x.emit({ type: 'stage', stage: 'searching', status: 'start', round: round + 1 });
    const before = frontier.stats();
    const jobs = [];
    if (round === 1) {
      for (const p of parts.slice(0, 3)) {
        const natural = squash((p.core || p.text).replace(/[?]+$/, '')).slice(0, 140);
        if (natural.length > 3) jobs.push(searchEverywhere(natural, { fresh: p.temporal.freshness }));
        const kw = p.keywords.slice(0, 7).join(' ');
        if (mode !== 'widen' && kw && kw.toLowerCase() !== natural.toLowerCase() && p.keywords.length >= 2) jobs.push(searchEverywhere(kw, { fresh: p.temporal.freshness }));
      }
      if (B.refArticles) jobs.push(harvestReferences(B.refArticles));
      if (B.related && focus && can('wikipedia')) {
        const entityDi = x.entityDocs.get((main.focus || '').toLowerCase());
        const title = entityDi != null && x.docs[entityDi] && x.docs[entityDi].provider === 'wikipedia' ? x.docs[entityDi].title : '';
        if (title) { spend('wikipedia'); jobs.push(logged('wikipedia', 'Wikipedia (articles on neighbouring topics)', title, () => wikipedia.related(title, ctxFor({ limit: 50 }))).then((res) => (res ? frontier.addResults(res, { weight: 0.6 }) : 0))); }
      }
    } else {
      for (const q of nextQueries(ranks)) {
        if (q.aspect) q.aspect.searched = true;
        jobs.push(searchEverywhere(q.text, q.aspect ? { aspect: aspects.indexOf(q.aspect) } : { scholarly: q.scholarly !== false }));
      }
    }
    // A slow search service must not hold up the reading: after a short wait the round goes on with the leads in hand,
    // and the answers that arrive later join the queue while the pages are being read.
    let searchesDone = false;
    const allSearches = Promise.all(jobs.map((j) => j.catch(() => 0))).then(() => { searchesDone = true; });
    const pause = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
    await Promise.race([allSearches, pause(B.searchWaitMs || 3500)]);
    while (!searchesDone && !frontier.size && !x.aborted()) await Promise.race([allSearches, pause(400)]);
    const after = frontier.stats();
    summary.searchMs += Date.now() - s0;
    x.emit({ type: 'stage', stage: 'searching', status: 'done', ms: Date.now() - s0, round: round + 1, detail: { queries: x.searchLog.length, ok: x.searchLog.filter((s) => s.ok).length, failed: x.searchLog.filter((s) => !s.ok).length, results: x.searchLog.reduce((a, s) => a + s.results, 0), newLeads: after.accepted - before.accepted, waiting: after.waiting } });
    progress(true);
    if (x.aborted()) { stop = 'stopped'; break; }

    // ---- read ----
    const r0 = Date.now(), pagesBefore = okPages();
    x.emit({ type: 'stage', stage: 'reading', status: 'start', round: round + 1 });
    const reserve = 2500 + lastCompareMs * 2.2;
    // the first batch is short, so that the first fuller draft comes early; later batches read longer
    const batch = () => crawl({ maxNew: Math.round(B.batchPages * 1.9), untilMs: Math.min(deadline - reserve, Date.now() + (round === 1 && B.firstBatchMs ? B.firstBatchMs : B.batchMs)) });
    let why = frontier.size ? await batch() : 'no leads left';
    if (!searchesDone) {
      await allSearches;                                         // bounded by the searches' own timeouts
      if (why === 'no leads left' && frontier.size && !x.aborted() && timeLeft() > reserve + 3000) why = await batch();
    }
    const ok = okPages();
    summary.readMs += Date.now() - r0;
    x.emit({ type: 'stage', stage: 'reading', status: 'done', ms: Date.now() - r0, round: round + 1, detail: { pages: ok, failed: x.fetchLog.length - ok, bytes: x.fetchLog.reduce((a, f) => a + (f.bytes || 0), 0), documents: x.docs.length, abstracts: summary.abstracts } });
    progress(true);
    if (x.aborted()) { stop = 'stopped'; break; }

    // ---- compare, derive sub-topics, draft ----
    const c0 = Date.now();
    ranks = await x.recompare(round + 1);
    lastCompareMs = Date.now() - c0;
    findAspects(ranks);
    summary.aspects = aspects;
    await x.draft(round, aspects);
    lastCompareMs = Math.max(lastCompareMs, Date.now() - c0);

    const gained = ok - pagesBefore;
    const more = nextQueries(ranks).length;                    // searches that could still be made
    thin = gained < Math.max(6, 0.03 * ok) ? thin + 1 : 0;      // rounds in a row that added almost nothing
    if (ok >= B.maxPages) stop = 'page budget used';
    else if (why === 'time' && timeLeft() < 4000 + lastCompareMs * 2) stop = 'time budget used';
    else if (why === 'low yield' && !more) stop = 'the remaining leads were no longer relevant';
    else if (mode === 'research') {
      // a research run goes on while new searches still bring pages worth reading
      if (!more && !frontier.size) stop = 'every relevant lead was read';
      else if (thin >= 2 && round >= 3) stop = 'new searches were no longer bringing new material';
    }
    else if (why === 'no leads left' && !more) stop = 'every relevant lead was read';
    else if (mode === 'widen' && !parts.some((_, i) => x.weakPart(i))) stop = 'direct evidence found';
    else if (gained === 0 && round >= 2 && !more) stop = 'nothing new to read';
  }
  summary.stopped = stop || 'round limit reached';
  summary.frontier = frontier.stats();
  summary.ms = Date.now() - started;
  summary.pages = okPages();
  // which leads were found but never read (shown in the explorer as "found, not read")
  summary.unread = [...frontier.leads().values()].filter((l) => l.queued && !l.done).sort((a, b) => b.score - a.score).slice(0, 60).map((l) => ({ url: l.url, title: squash(l.title || l.anchor || '').slice(0, 140), domain: l.domain }));
  progress(true);
  return summary;
}

export { BIOMED, PROVIDERS, domainOf };
