// Wikipedia — MediaWiki Action API (documented, keyless, CC BY-SA).
// Acts as both a search provider and a content provider (clean plain-text extracts instead of HTML scraping).

import { enc, ProviderError } from './base.js';
import { extractPage } from '../extract/readable.js';
import { MONTH_NAMES } from '../util/dates.js';

const SKIP_SECTIONS = /^(see also|references|external links|further reading|notes|bibliography|citations|sources|footnotes|works cited|explanatory notes|gallery|notes and references)$/i;
const api = (lang) => `https://${/^[a-z]{2,3}(-[a-z]+)?$|^simple$/.test(lang) ? lang : 'en'}.wikipedia.org/w/api.php`;
const COMMON = 'action=query&format=json&formatversion=2&redirects=1&inprop=url&ppprop=disambiguation%7Cwikibase_item';

/** Convert a TextExtracts plain-text extract ("== Heading ==" markers) into structured blocks. */
export function extractToBlocks(extract) {
  const blocks = [];
  const path = [];
  let skip = false;
  for (const raw of String(extract || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^(={2,6})\s*(.+?)\s*\1$/);
    if (h) {
      const level = h[1].length - 1;                        // "==" → level 1 within the article
      path.length = level - 1;
      path[level - 1] = h[2];
      skip = path.some((p) => p && SKIP_SECTIONS.test(p));
      if (!skip) blocks.push({ type: 'heading', level: level + 1, text: h[2], heading: path.slice(0, level - 1).filter(Boolean).join(' › ') });
      continue;
    }
    if (!skip && line.length > 1) blocks.push({ type: 'p', text: line, heading: path.filter(Boolean).join(' › ') });
  }
  return blocks;
}

function toResult(p, lang, full) {
  const site = lang === 'simple' ? 'Simple English Wikipedia' : 'Wikipedia';
  const disambiguation = !!(p.pageprops && 'disambiguation' in p.pageprops);
  return {
    title: p.title, url: p.canonicalurl || p.fullurl, snippet: String(p.extract || '').replace(/\s+/g, ' ').slice(0, 320),
    provider: 'wikipedia', kind: 'encyclopedia', date: p.touched || '', disambiguation, wikibase: p.pageprops ? p.pageprops.wikibase_item || '' : '',
    content: { title: p.title, site, lang, modified: p.touched || '', blocks: extractToBlocks(p.extract), partial: !full, pageType: 'reference', via: 'api' },
  };
}

export default {
  id: 'wikipedia', label: 'Wikipedia', kind: 'encyclopedia', keyless: true, documented: true, defaultOn: true,
  note: 'MediaWiki Action API (search + plain-text extracts).',
  available: () => true,

  /** Full-text search; returns the lead section of each hit in the same request. */
  async search(query, ctx) {
    const lang = ctx.lang || 'en';
    const url = `${api(lang)}?${COMMON}&generator=search&gsrsearch=${enc(query)}&gsrlimit=${Math.min(ctx.limit || 5, 10)}&gsrnamespace=0&prop=extracts%7Cinfo%7Cpageprops&exintro=1&explaintext=1&exlimit=max`;
    const { json } = await ctx.http.getJSON(url, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 6000, hostLimit: 3, fresh: ctx.noCache, ttlMs: 30 * 60000 });
    if (json.error) throw new ProviderError(json.error.info || 'Wikipedia API error', 'api_error');
    const pages = ((json.query && json.query.pages) || []).filter((p) => !p.missing).sort((a, b) => (a.index || 0) - (b.index || 0));
    return pages.map((p) => toResult(p, lang, false));
  },

  /** Exact-title lookup with redirect resolution — Wikipedia's redirect table doubles as an entity linker. */
  async lookup(titles, ctx) {
    const lang = ctx.lang || 'en';
    const list = titles.filter(Boolean).slice(0, 8);
    if (!list.length) return [];
    const url = `${api(lang)}?${COMMON}&titles=${enc(list.join('|'))}&prop=extracts%7Cinfo%7Cpageprops&exintro=1&explaintext=1&exlimit=max`;
    const { json } = await ctx.http.getJSON(url, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 6000, hostLimit: 3, fresh: ctx.noCache, ttlMs: 30 * 60000 });
    const pages = ((json.query && json.query.pages) || []).filter((p) => !p.missing && !p.invalid && p.extract !== undefined);
    const redirects = new Map(((json.query && json.query.redirects) || []).map((r) => [r.to, r.from]));
    const normalized = new Map(((json.query && json.query.normalized) || []).map((r) => [r.to, r.from]));
    return pages.map((p) => {
      const r = toResult(p, lang, false);
      const from = redirects.get(p.title) || p.title;
      r.requested = normalized.get(from) || from;
      return r;
    });
  },

  handles(url) {
    try { const u = new URL(url); return /^([a-z-]+)\.(m\.)?wikipedia\.org$/.test(u.hostname) && u.pathname.startsWith('/wiki/') && !/^\/wiki\/(Special|Talk|User|File|Category|Help|Template|Wikipedia):/i.test(u.pathname); } catch { return false; }
  },

  /** Full article text through the API. */
  async fetch(url, ctx) {
    const u = new URL(url);
    const lang = u.hostname.split('.')[0];
    const title = decodeURIComponent(u.pathname.slice(6)).replace(/_/g, ' ');
    if (/^Portal:/i.test(title)) return this.fetchRendered(title, lang, ctx);
    const q = `${api(lang)}?${COMMON}&titles=${enc(title)}&prop=extracts%7Cinfo%7Cpageprops&explaintext=1&exsectionformat=wiki`;
    let res;
    if (ctx.http.remaining && ctx.http.remaining('wikimedia-api') <= (ctx.wikiReserve ?? 3)) return this.fetchHtml(url, lang, ctx);   // keep the API budget for searches
    try { res = await ctx.http.getJSON(q, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 7000, hostLimit: 3, maxBytes: 3_000_000, fresh: ctx.noCache, ttlMs: 60 * 60000 }); }
    catch (e) {
      if (e.code !== 'rate_budget' && e.code !== 'rate_limited' && e.status !== 429) throw e;
      return this.fetchHtml(url, lang, ctx);                     // API budget used up → read the article page like a browser would
    }
    const p = ((res.json.query && res.json.query.pages) || [])[0];
    if (!p || p.missing || p.extract === undefined) throw new ProviderError('Wikipedia page not found', 'not_found');
    const r = toResult(p, lang, true);
    return { ...r.content, url: r.url, bytes: res.bytes, ms: res.ms, fromCache: res.fromCache, disambiguation: r.disambiguation, wikibase: r.wikibase };
  },

  /** Fallback: the ordinary article page, parsed by the engine's own extractor (no API request). */
  async fetchHtml(url, lang, ctx) {
    const res = await ctx.http.getText(url, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 8000, hostLimit: 2, maxBytes: 2_500_000, fresh: ctx.noCache, ttlMs: 60 * 60000, robots: true });
    const page = extractPage(res.text, res.url, { lastModified: res.headers['last-modified'] });
    const blocks = page.blocks.filter((b) => !(b.heading && b.heading.split(' › ').some((h) => SKIP_SECTIONS.test(h))) && !(b.type === 'heading' && SKIP_SECTIONS.test(b.text)) && b.type !== 'table');
    return { title: page.title.replace(/ - (Simple English )?Wikipedia$/, ''), site: lang === 'simple' ? 'Simple English Wikipedia' : 'Wikipedia', lang, modified: page.modified, blocks, pageType: 'reference', via: 'html', url: res.url, bytes: res.bytes, ms: res.ms, fromCache: res.fromCache };
  },

  /** Pages whose value is in their rendered structure (e.g. the Current events portal). */
  async fetchRendered(title, lang, ctx) {
    const q = `${api(lang)}?action=parse&format=json&formatversion=2&prop=text&disablelimitreport=1&disableeditsection=1&page=${enc(title)}`;
    const res = await ctx.http.getJSON(q, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 7000, hostLimit: 3, maxBytes: 3_000_000, fresh: ctx.noCache, ttlMs: 5 * 60000 });
    if (!res.json.parse) throw new ProviderError('Wikipedia page not found', 'not_found');
    const url = `https://${lang}.wikipedia.org/wiki/${encodeURI(title.replace(/ /g, '_'))}`;
    const page = extractPage(`<html><body><article>${res.json.parse.text}</article></body></html>`, url);
    return { title: res.json.parse.title, site: 'Wikipedia', lang, blocks: page.blocks, pageType: 'reference', via: 'api', url, bytes: res.bytes, ms: res.ms, fromCache: res.fromCache };
  },

  /** Titles of the "Current events" portal pages for the days leading up to `now`. */
  currentEventsTitles(now, days = 2) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(now - i * 86400000);
      out.push({ title: `Portal:Current events/${d.getUTCFullYear()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`, iso: d.toISOString().slice(0, 10) });
    }
    return out;
  },
};
