// Independent open-web indexes with free, documented JSON APIs: Mwmbl, Marginalia, Wiby.
// Smaller than commercial indexes, but open — used as fallbacks and for source diversity.

import { enc, ProviderError } from './base.js';
import { decodeEntities, stripTags } from '../extract/html.js';
import { squash } from '../util/text.js';

export const mwmbl = {
  id: 'mwmbl', label: 'Mwmbl', kind: 'web', keyless: true, documented: true, defaultOn: true,
  note: 'Non-profit open-source index (api.mwmbl.org).',
  available: () => true,
  async search(query, ctx) {
    const { json } = await ctx.http.getJSON(`https://api.mwmbl.org/search?s=${enc(query)}`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 5000, fresh: ctx.noCache });
    if (!Array.isArray(json)) throw new ProviderError('Unexpected Mwmbl response', 'bad_response');
    const join = (parts) => squash([].concat(parts || []).map((p) => (p && p.value) || '').join(''));
    return json.slice(0, ctx.limit || 10).filter((r) => r && /^https?:/.test(r.url)).map((r) => ({ title: join(r.title), url: r.url, snippet: join(r.extract), provider: 'mwmbl', kind: 'web' }));
  },
};

export const marginalia = {
  id: 'marginalia', label: 'Marginalia', kind: 'web', keyless: true, documented: true, defaultOn: true,
  note: 'Independent index (public shared key is heavily rate-limited; set MARGINALIA_API_KEY for a personal key).',
  available: () => true,
  async search(query, ctx) {
    const key = (ctx.cfg && ctx.cfg.keys && ctx.cfg.keys.marginalia) || 'public';
    const { json } = await ctx.http.getJSON(`https://api2.marginalia-search.com/search?query=${enc(query)}&count=${ctx.limit || 10}`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 5000, headers: { 'API-Key': key }, fresh: ctx.noCache });
    return (json.results || []).filter((r) => /^https?:/.test(r.url)).map((r) => ({ title: squash(r.title), url: r.url, snippet: squash(r.description), provider: 'marginalia', kind: 'web' }));
  },
};

export const wiby = {
  id: 'wiby', label: 'Wiby', kind: 'web', keyless: true, documented: true, defaultOn: true,
  note: 'Index of small, classic web pages (wiby.me JSON API). Last-resort fallback.',
  available: () => true,
  async search(query, ctx) {
    const { json } = await ctx.http.getJSON(`https://wiby.me/json/?q=${enc(query)}`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 5000, fresh: ctx.noCache });
    if (!Array.isArray(json)) throw new ProviderError('Unexpected Wiby response', 'bad_response');
    return json.slice(0, ctx.limit || 8).filter((r) => r && /^https?:/.test(r.URL)).map((r) => ({ title: squash(decodeEntities(r.Title || '')), url: r.URL, snippet: squash(stripTags(decodeEntities(r.Snippet || ''))).slice(0, 320), provider: 'wiby', kind: 'web' }));
  },
};

// ---- optional, operator-configured providers (recommended for production) -----------------------
export const brave = {
  id: 'brave', label: 'Brave Search API', kind: 'web', keyless: false, documented: true, defaultOn: true,
  note: 'Requires BRAVE_API_KEY (free tier available). Key stays on the server.',
  available: (cfg) => !!(cfg.keys && cfg.keys.brave),
  async search(query, ctx) {
    const fresh = { day: 'pd', week: 'pw', month: 'pm', year: 'py' }[ctx.fresh];
    const url = `https://api.search.brave.com/res/v1/web/search?q=${enc(query)}&count=${ctx.limit || 10}${fresh ? '&freshness=' + fresh : ''}`;
    const { json } = await ctx.http.getJSON(url, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 6000, headers: { 'X-Subscription-Token': ctx.cfg.keys.brave }, fresh: ctx.noCache });
    return ((json.web && json.web.results) || []).map((r) => ({ title: squash(stripTags(r.title)), url: r.url, snippet: squash(stripTags(r.description || '')), date: r.page_age || '', provider: 'brave', kind: 'web' }));
  },
};

export const searxng = {
  id: 'searxng', label: 'SearXNG', kind: 'web', keyless: false, documented: true, defaultOn: true,
  note: 'Requires SEARXNG_URL pointing at your own instance with the JSON format enabled.',
  available: (cfg) => !!cfg.searxngUrl,
  async search(query, ctx) {
    const range = { day: 'day', week: 'week', month: 'month', year: 'year' }[ctx.fresh];
    const url = `${ctx.cfg.searxngUrl.replace(/\/+$/, '')}/search?q=${enc(query)}&format=json${range ? '&time_range=' + range : ''}`;
    const { json } = await ctx.http.getJSON(url, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 7000, fresh: ctx.noCache });
    return (json.results || []).slice(0, ctx.limit || 10).filter((r) => /^https?:/.test(r.url)).map((r) => ({ title: squash(r.title), url: r.url, snippet: squash(r.content || ''), date: r.publishedDate || '', provider: 'searxng', kind: 'web' }));
  },
};
