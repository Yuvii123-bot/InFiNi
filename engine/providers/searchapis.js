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
    const body = { query, search_depth: 'basic', max_results: Math.min(ctx.limit || 8, 20), include_answer: false, include_raw_content: false, include_images: false };
    if (ctx.fresh) { body.time_range = ctx.fresh; if (ctx.fresh === 'day' || ctx.fresh === 'week') body.topic = 'news'; }
    let res;
    try { res = await ctx.http.postJSON('https://api.tavily.com/search', body, request(ctx, { headers: { Authorization: `Bearer ${keyOf(ctx, 'tavily')}` } })); }
    catch (e) {
      if (e.status === 401 || e.status === 403) throw new ProviderError('Tavily did not accept the key', 'refused');
      // 432 / 433: the plan's allowance is spent. Rest for hours instead of asking again every few minutes; the next provider takes over.
      if (e.status === 432 || e.status === 433) throw Object.assign(new ProviderError('Tavily’s allowance for this key is used up — the other search providers take over', 'rate_limited'), { retryAfterMs: 6 * 3600000 });
      throw e;
    }
    return ((res.json && res.json.results) || []).filter((r) => r && isWebUrl(r.url)).map((r) => lead('tavily', r.title, r.url, r.content, r.published_date));
  },
};

// LangSearch (https://docs.langsearch.com): a free web search API. Its allowance is counted in tokens of the text it
// returns and renews every day at 00:00 UTC. Only links and a short piece of each page's text are requested — as much as
// the screening of a lead reads (see lead()). The pages themselves are read by INFINI AI's own reader, which honours
// robots.txt and a page's opt-out from excerpts; text from the index is never quoted. Asking for 320 characters of text
// costs about a fifth of the default snippets (measured: 893 against 4,664 tokens for the same 12 results).
// Its "datePublished" is mostly the date a page was last changed (7 of 9 pages checked against their own metadata), so it
// is not passed on as a publication date.
const LS_TEXT = 320;
const lsState = { day: '', requests: 0, tokens: 0, strikes: 0 };
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const lsCount = (tokens) => { const day = utcDay(); if (lsState.day !== day) { lsState.day = day; lsState.requests = 0; lsState.tokens = 0; } lsState.requests++; lsState.tokens += tokens; };
/** What this process has used of the LangSearch allowance since 00:00 UTC. (The allowance itself is shown only in the LangSearch dashboard.) */
export const langsearchUsage = () => (lsState.day === utcDay() ? { day: lsState.day, requests: lsState.requests, tokens: lsState.tokens } : { day: utcDay(), requests: 0, tokens: 0 });

export const langsearch = {
  id: 'langsearch', label: 'LangSearch', kind: 'web', keyless: false, documented: true, defaultOn: true, cooldownMs: 60_000,
  note: 'Needs LANGSEARCH_API_KEY — a free key without a payment method (a daily allowance counted in tokens of returned text). Only result links and a short piece of text for screening are requested; the pages are read by INFINI AI itself.',
  available: (cfg) => !!(cfg.keys && cfg.keys.langsearch),
  async search(query, ctx) {
    const body = { query, count: Math.max(1, Math.min(Math.round(ctx.limit || 10), 50)), contents: { text: { maxCharacters: LS_TEXT } } };
    const fresh = { day: 'oneDay', week: 'oneWeek', month: 'oneMonth', year: 'oneYear' }[ctx.fresh];
    if (fresh) body.freshness = fresh;
    let res;
    try { res = await ctx.http.postJSON('https://api.langsearch.com/v1/web-search', body, request(ctx, { headers: { Authorization: `Bearer ${keyOf(ctx, 'langsearch')}` } })); }
    catch (e) {
      if (e.status === 401 || e.status === 403) throw new ProviderError('LangSearch did not accept the key', 'refused');
      if (e.status === 429) {
        // one status for four limits (requests per second, requests at a time, tokens per minute, tokens per day); the body says which.
        // A spent daily allowance rests until the reset; anything else rests a minute, and longer each time it happens again.
        const daily = /\b(?:daily|per day|tpd|day'?s? (?:token|quota|allowance|limit))\b/i.test(String(e.bodyText || ''));
        lsState.strikes++;
        const now = ctx.now || Date.now(), d = new Date(now);
        const untilReset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now + 60_000;
        const pause = daily ? untilReset : Math.min(3600_000, Math.max((Number(e.retryAfter) || 0) * 1000, 60_000 * 2 ** Math.min(lsState.strikes - 1, 6)));
        throw Object.assign(new ProviderError(daily ? 'LangSearch’s daily allowance for this key is used up (it renews at 00:00 UTC) — the other search providers take over' : 'LangSearch asked for a pause (its rate or per-minute allowance) — the other search providers take over', 'rate_limited'), { retryAfterMs: pause });
      }
      throw e;
    }
    const j = res.json || {};
    const list = j.data && j.data.webPages && Array.isArray(j.data.webPages.value) ? j.data.webPages.value : null;
    if (!list) throw new ProviderError(`LangSearch answered without a result list (code ${String(j.code == null ? 'none' : j.code).replace(/[^\w-]/g, '').slice(0, 12)})`, 'bad_response');
    lsState.strikes = 0;
    if (!res.fromCache) lsCount((Number(j.usage && j.usage.input_tokens) || 0) + (Number(j.usage && j.usage.output_tokens) || 0));
    return list.filter((r) => r && isWebUrl(r.url)).map((r) => lead('langsearch', r.name, r.url, r.text || r.snippet || r.summary, ''));
  },
};
