// INFINI AI — hosted web-search APIs that can be used without a payment method.
//   firecrawl : documented keyless access (daily allowance per network address) or a free key (FIRECRAWL_API_KEY)
//   tavily    : free key, no card (TAVILY_API_KEY)
// Keys are read from the server environment only and are sent to nothing but the provider's fixed API host.
// From every response only titles, links and descriptions are used, as *leads*: INFINI AI still fetches and reads each
// page itself before quoting anything, and never requests a generated answer or summary from these services.

import { ProviderError } from './base.js';
import { squash } from '../util/text.js';

const keyOf = (ctx, name) => (ctx.cfg && ctx.cfg.keys && ctx.cfg.keys[name]) || '';
const isWebUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const lead = (provider, title, url, snippet, date) => ({ title: squash(String(title || '')), url, snippet: squash(String(snippet || '')).slice(0, 320), date: date || '', provider, kind: 'web' });
const request = (ctx, extra) => ({ signal: ctx.signal, timeoutMs: ctx.timeoutMs || 7000, fresh: ctx.noCache, ttlMs: ctx.fresh ? 5 * 60000 : 15 * 60000, ...extra });

export const firecrawl = {
  id: 'firecrawl', label: 'Firecrawl Search', kind: 'web', keyless: true, documented: true, defaultOn: true, cooldownMs: 10 * 60000,
  note: 'Works without a key inside a daily allowance per network address; some networks are refused. A free key (FIRECRAWL_API_KEY, no payment method) lifts both limits.',
  available: () => true,
  async search(query, ctx) {
    const key = keyOf(ctx, 'firecrawl');
    const body = { query, limit: Math.min(ctx.limit || 8, 10) };
    const tbs = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' }[ctx.fresh];
    if (tbs) body.tbs = tbs;
    let res;
    try {
      res = await ctx.http.postJSON('https://api.firecrawl.dev/v2/search', body, request(ctx, { headers: key ? { Authorization: `Bearer ${key}` } : {}, cacheTag: key ? 'key' : 'keyless' }));
    } catch (e) {
      if ([401, 402, 403].includes(e.status)) throw new ProviderError(key ? 'Firecrawl did not accept the key (invalid, or its credits are used up)' : 'Firecrawl refuses keyless requests from this network address — a free key solves that', 'refused');
      if (e.status === 429) {
        const wait = e.retryAfter || 0;                                    // seconds until the allowance is available again, when the service says so
        const when = wait >= 5400 ? ` (about ${Math.round(wait / 3600)} h until it resets)` : wait >= 120 ? ` (about ${Math.round(wait / 60)} min until it resets)` : '';
        throw Object.assign(new ProviderError(key ? `Firecrawl rate limit reached${when}` : `Firecrawl’s keyless allowance for this network address is used up${when} — a free key adds its own quota`, 'rate_limited'), { retryAfterMs: wait * 1000 });
      }
      throw e;
    }
    const data = res.json && res.json.data;
    const web = Array.isArray(data) ? data : (data && data.web) || [];
    return web.filter((r) => r && isWebUrl(r.url)).map((r) => lead('firecrawl', r.title, r.url, r.description || r.snippet));
  },
};

export const tavily = {
  id: 'tavily', label: 'Tavily Search', kind: 'web', keyless: false, documented: true, defaultOn: true, cooldownMs: 5 * 60000,
  note: 'Needs TAVILY_API_KEY — a free key without a payment method (about 1,000 searches a month). Only result links are requested, never a generated answer.',
  available: (cfg) => !!(cfg.keys && cfg.keys.tavily),
  async search(query, ctx) {
    const body = { query, search_depth: 'basic', max_results: Math.min(ctx.limit || 8, 10), include_answer: false, include_raw_content: false, include_images: false };
    if (ctx.fresh) { body.time_range = ctx.fresh; if (ctx.fresh === 'day' || ctx.fresh === 'week') body.topic = 'news'; }
    let res;
    try { res = await ctx.http.postJSON('https://api.tavily.com/search', body, request(ctx, { headers: { Authorization: `Bearer ${keyOf(ctx, 'tavily')}` } })); }
    catch (e) {
      if ([401, 403, 432, 433].includes(e.status)) throw new ProviderError(e.status === 401 || e.status === 403 ? 'Tavily did not accept the key' : 'Tavily plan limit reached', 'refused');
      throw e;
    }
    return ((res.json && res.json.results) || []).filter((r) => r && isWebUrl(r.url)).map((r) => lead('tavily', r.title, r.url, r.content, r.published_date));
  },
};
