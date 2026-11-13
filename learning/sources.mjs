// INFINITY LLM — learning: data discovery and acquisition.
//
// "web" sources: topics → the existing search engine (engine.discover) → pages read through the existing guarded fetch
// path (engine.acquire: robots.txt, rate limits, size limits, SSRF guard) → licence read from the page.
// "github" sources: collections of openly licensed text kept in public repositories, read through GitHub's REST API with
// the same HTTP client; the licence is read from the repository and from the document's own metadata.
// Nothing here decides whether a document is trained on; it only fetches and records where everything came from.

import { detectLicence, licenceFromUrl } from './licence.mjs';
import { nowISO } from './store.mjs';

const GH = 'https://api.github.com';
const decodeEntities = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');
const stripTags = (s) => decodeEntities(String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();

// ---------- document formats ----------
/** CIA World Factbook country profile (JSON) → headings and paragraphs. */
export function parseFactbook(text) {
  const d = JSON.parse(text);
  const leaf = (o) => (o && typeof o === 'object' && typeof o.text === 'string' ? stripTags(o.text) : '');
  const g = d.Government && d.Government['Country name'];
  const name = (g && (leaf(g['conventional short form']) || leaf(g['conventional long form']))) || '';
  if (!name || /^none$/i.test(name)) return null;
  const the = /^(United|Bahamas|Gambia|Netherlands|Philippines|Maldives|Comoros|Seychelles|Solomon|Marshall|Czech|Dominican|Central African|Democratic|Republic|Federated)/.test(name) && !/^the /i.test(name) ? 'the ' + name : name;
  const blocks = [];
  for (const [section, body] of Object.entries(d)) {
    if (!body || typeof body !== 'object') continue;
    blocks.push({ type: 'heading', text: section });
    const lines = [];
    const walk = (o, trail) => {
      for (const [k, v] of Object.entries(o)) {
        if (!v || typeof v !== 'object') continue;
        const key = k.trim();
        const t = leaf(v);
        if (t) {
          if (key === 'note' || /^(note|definition)$/i.test(key)) continue;
          const label = [...trail, key].join(', ').replace(/\s+-\s+/g, ' ');
          if (key === 'Background') { for (const para of t.split(/\n+/)) if (para.trim()) blocks.push({ type: 'p', text: para.trim() }); }
          else if (t.length <= 400 && !/^(NA|none|n\/a)$/i.test(t)) { const v = (t.toLowerCase().startsWith(key.toLowerCase() + ':') ? t.slice(key.length + 1).trim() : t).replace(/\s*\n+\s*/g, '; '); if (v) lines.push(`${label} of ${the}: ${v}${/[.!?]$/.test(v) ? '' : '.'}`); }
        } else walk(v, [...trail, key]);
      }
    };
    walk(body, []);
    for (let i = 0; i < lines.length; i += 6) blocks.push({ type: 'p', text: lines.slice(i, i + 6).join(' ') });
  }
  return { title: name, blocks, lang: 'en' };
}
/** OpenStax / Connexions CNXML module → headings and paragraphs. Formulas, figures, tables and exercises are left out. */
export function parseCnxml(xml) {
  const title = stripTags((/<title>([\s\S]*?)<\/title>/.exec(xml) || [])[1] || '');
  const licence = (/<md:license[^>]*url="([^"]+)"/.exec(xml) || [])[1] || '';
  let body = (/<content>([\s\S]*)<\/content>/.exec(xml) || [])[1] || '';
  body = body.replace(/<(figure|table|exercise|equation|media|example|glossary|list)\b[\s\S]*?<\/\1>/g, ' ').replace(/<note\b[^>]*class="[^"]*(interactive|try|worked|check|snap|fun|links|boundless|virtual)[^"]*"[\s\S]*?<\/note>/g, ' ').replace(/<m:math\b[\s\S]*?<\/m:math>/g, '⟨math⟩');
  const blocks = [];
  const re = /<title>([\s\S]*?)<\/title>|<para\b[^>]*>([\s\S]*?)<\/para>/g;
  let m;
  while ((m = re.exec(body))) { if (m[1] !== undefined) blocks.push({ type: 'heading', text: stripTags(m[1]) }); else { const t = stripTags(m[2]).replace(/\s+/g, ' '); if (t) blocks.push({ type: 'p', text: t }); } }
  return { title, blocks, lang: 'en', licenceUrl: licence };
}
/** Markdown or plain text → headings and paragraphs. */
export function parseMarkdown(text) {
  const blocks = [];
  let title = '';
  const src = text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  for (const chunk of src.split(/\n{2,}/)) {
    const t = chunk.trim();
    if (!t) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(t.split('\n')[0]);
    if (h) { const ht = stripTags(h[2]).replace(/[*_`]/g, ''); if (!title && h[1].length === 1) title = ht; blocks.push({ type: 'heading', text: ht }); const rest = t.split('\n').slice(1).join(' ').trim(); if (!rest) continue; blocks.push({ type: 'p', text: mdInline(rest) }); continue; }
    if (/^\s*([|>]|[-*+]\s|\d+\.\s|!\[)/.test(t)) continue;
    blocks.push({ type: 'p', text: mdInline(t.replace(/\n/g, ' ')) });
  }
  return { title, blocks, lang: '' };
}
const mdInline = (s) => stripTags(s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]{1,3}/g, ''));
const FORMATS = { factbook: parseFactbook, cnxml: parseCnxml, markdown: parseMarkdown, text: parseMarkdown };

// ---------- GitHub-hosted collections ----------
function ghHeaders(env, raw) { const h = { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; const tok = env.GITHUB_TOKEN || env.GH_TOKEN; if (tok) h.Authorization = `Bearer ${tok}`; return h; }

export async function collectGithub(engine, src, st, budget, { env = process.env, signal = null, note = () => {} } = {}) {
  const http = engine.http, out = [];
  const meta = (await http.getJSON(`${GH}/repos/${src.repo}`, { headers: ghHeaders(env), signal, timeoutMs: 12000, ttlMs: 0 })).json;
  const ref = src.ref || meta.default_branch || 'main';
  let licence = { id: meta.license && meta.license.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : '', url: `https://github.com/${src.repo}`, basis: 'repository' };
  if (src.licenceFrom) {                        // the collection's own declaration outranks the repository's LICENSE file
    const res = await http.getText(`${GH}/repos/${src.repo}/contents/${src.licenceFrom}?ref=${encodeURIComponent(ref)}`, { accept: 'any', headers: ghHeaders(env, true), signal, timeoutMs: 12000, ttlMs: 0 });
    const url = (/<md:license[^>]*url="([^"]+)"/.exec(res.text) || /licen[sc]e[^\n]{0,80}(https?:\/\/creativecommons\.org\/\S+)/i.exec(res.text) || [])[1] || '';
    licence = { id: licenceFromUrl(url), url, basis: 'declared' };
  }
  const tree = (await http.getJSON(`${GH}/repos/${src.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { headers: ghHeaders(env), signal, timeoutMs: 20000, maxBytes: 8_000_000, ttlMs: 0 })).json;
  const include = new RegExp(src.include || '.');
  const files = (tree.tree || []).filter((f) => f.type === 'blob' && include.test(f.path) && (f.size || 0) <= 900_000).sort((a, b) => (a.path < b.path ? -1 : 1));
  const pageUrl = (p) => `https://github.com/${src.repo}/blob/${ref}/${p}`;
  const fresh = files.filter((f) => { const s = st.urls[pageUrl(f.path)]; return !s || s.sha !== f.sha; });
  note(`${src.id}: ${files.length} documents in the collection, ${fresh.length} not yet collected, licence ${licence.id || 'not stated'}`);
  // spread the picks over the collection so each cycle sees a varied sample, in a fixed order
  const step = Math.max(1, Math.floor(fresh.length / Math.max(1, budget)));
  const picks = [];
  for (let i = 0; i < fresh.length && picks.length < budget; i += step) picks.push(fresh[i]);
  for (const f of picks) {
    if (signal && signal.aborted) break;
    const url = pageUrl(f.path);
    const rec = { url, source: src.id, sourceType: 'github', publisher: src.publisher || src.repo, publisherUrl: `https://github.com/${src.repo}`, trusted: !!src.trusted, sourceQuality: typeof src.quality === 'number' ? src.quality : undefined, collectedAt: nowISO(), sha: f.sha, licence: { ...licence }, extraction: { via: 'github-api', format: src.format || 'text', bytes: f.size || 0, ref } };
    try {
      const res = await http.getText(`${GH}/repos/${src.repo}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, { accept: 'any', headers: ghHeaders(env, true), signal, timeoutMs: 15000, maxBytes: 1_000_000, ttlMs: 0 });
      const parsed = (FORMATS[src.format] || parseMarkdown)(res.text);
      if (!parsed) { out.push({ ...rec, error: 'not a document' }); continue; }
      if (parsed.licenceUrl) { const id = licenceFromUrl(parsed.licenceUrl); if (id) rec.licence = { id, url: parsed.licenceUrl, basis: 'declared' }; }
      rec.modified = String((res.headers && res.headers['last-modified']) || '');
      out.push({ ...rec, title: parsed.title || f.path, lang: parsed.lang || '', blocks: parsed.blocks });
    } catch (e) { out.push({ ...rec, error: String(e && e.message).slice(0, 160) }); }
  }
  return out;
}

// ---------- the open web, through the existing search engine ----------
export async function collectWeb(engine, src, st, budget, { signal = null, note = () => {} } = {}) {
  const out = [];
  const topics = [...(src.topics || []), ...(st.frontier || [])];
  if (!topics.length) return out;
  let cursor = (st.cursors[src.id] || 0) % topics.length;
  let searched = 0, failures = 0;
  while (out.length < budget && searched < Math.min(topics.length, Math.max(4, Math.ceil(budget / 3)))) {
    if (signal && signal.aborted) break;
    const topic = topics[cursor];
    cursor = (cursor + 1) % topics.length; searched++;
    let found;
    try { found = await engine.discover(topic, { signal, limit: 6 }); } catch (e) { found = { results: [], log: [{ error: String(e && e.message) }] }; }
    if (!found.results.length) { failures++; if (failures >= 3 && !out.length) { note(`${src.id}: the search engine returned nothing for ${failures} topics in a row (${(found.log.find((l) => l.error) || {}).error || 'no results'}); stopping web discovery for this cycle`); break; } continue; }
    for (const r of found.results) {
      if (out.length >= budget) break;
      if (st.urls[r.url]) continue;
      const rec = { url: r.url, source: src.id, sourceType: 'web', discoveredBy: r.provider, query: topic, collectedAt: nowISO(), trusted: false };
      try {
        const got = await engine.acquire(r.url, { signal });
        const licence = detectLicence({ html: got.html, url: got.url, headers: got.headers, robotsMeta: got.page.robots });
        out.push({ ...rec, url: got.url, title: got.page.title || r.title, lang: got.page.lang || '', author: got.page.author || '', published: got.page.published || '', modified: got.page.modified || '', publisher: got.page.site || '', licence: { id: licence.id, url: licence.url, basis: licence.basis }, optOut: licence.optOut, blocks: got.page.blocks, extraction: { via: got.via, format: 'html', bytes: got.html ? got.html.length : 0, ...(got.page.quality || {}) } });
      } catch (e) { out.push({ ...rec, error: String(e && e.message).slice(0, 160), code: e && e.code }); }      // includes "blocked by robots.txt"
    }
  }
  st.cursors[src.id] = cursor;
  return out;
}

// ---------- openly licensed wikis, through their own API (random articles: breadth that no topic list gives) ----------
export async function collectMediawiki(engine, src, st, budget, { signal = null, note = () => {} } = {}) {
  const out = [];
  const site = String(src.site || '').replace(/\/+$/, '');
  if (!site) return out;
  const minBytes = src.minBytes || 2500;                               // stubs are not worth a request
  let calls = 0, skipped = 0;
  while (out.length < budget && calls < (src.maxCalls || 4)) {
    if (signal && signal.aborted) break;
    calls++;
    const api = `${site}/w/api.php?action=query&format=json&generator=random&grnnamespace=0&grnlimit=20&prop=info&inprop=url`;
    const j = (await engine.http.getJSON(api, { signal, timeoutMs: 12000, ttlMs: 0 })).json;
    const pages = Object.values((j && j.query && j.query.pages) || {});
    if (!pages.length) break;
    for (const p of pages) {
      if (out.length >= budget) break;
      const url = p.fullurl || p.canonicalurl;
      if (!url || st.urls[url]) continue;
      if ((p.length || 0) < minBytes) { skipped++; st.urls[url] = { t: nowISO(), status: 'skipped:stub', sha: '' }; continue; }
      const rec = { url, source: src.id, sourceType: 'web', discoveredBy: 'mediawiki-random', query: '', collectedAt: nowISO(), trusted: false };
      try {
        const got = await engine.acquire(url, { signal });
        const licence = detectLicence({ html: got.html, url: got.url, headers: got.headers, robotsMeta: got.page.robots });
        out.push({ ...rec, url: got.url, title: got.page.title || p.title, lang: got.page.lang || '', author: got.page.author || '', published: got.page.published || '', modified: got.page.modified || '', publisher: got.page.site || src.publisher || '', licence: { id: licence.id, url: licence.url, basis: licence.basis }, optOut: licence.optOut, blocks: got.page.blocks, extraction: { via: got.via, format: 'html', bytes: got.html ? got.html.length : 0, ...(got.page.quality || {}) } });
      } catch (e) { out.push({ ...rec, error: String(e && e.message).slice(0, 160), code: e && e.code }); }
    }
  }
  note(`${src.id}: ${out.length} articles read from ${site} (${skipped} stubs skipped)`);
  return out;
}

const COLLECTORS = { github: collectGithub, web: collectWeb, mediawiki: collectMediawiki };
export async function collect(engine, src, st, budget, opts) { return (COLLECTORS[src.type] || collectWeb)(engine, src, st, budget, opts); }
