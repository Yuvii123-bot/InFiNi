// INFINI AI — provider registry, routing, fallback and rank fusion.

import wikipedia from './wikipedia.js';
import ddg from './ddg_html.js';
import { mwmbl, marginalia, wiby, brave, searxng } from './openweb.js';
import { stackexchange, mdn, arxiv, hackernews, gdelt } from './verticals.js';
import ddgInstant from './ddg_instant.js';
import feeds from './feeds.js';
import { firecrawl, tavily } from './searchapis.js';
import { canonicalUrl, domainOf } from '../util/text.js';

export const PROVIDERS = { wikipedia, ddg_instant: ddgInstant, searxng, tavily, brave, ddg_html: ddg, firecrawl, mwmbl, marginalia, wiby, stackexchange, mdn, arxiv, hackernews, feeds, gdelt };

// Order of preference for general web search. The first provider that returns enough results wins;
// if it fails (error, rate limit, human check) the next one is tried.
// What the operator configured comes first (own SearXNG, then keyed APIs); the keyless services follow.
// Firecrawl is asked before DuckDuckGo's HTML page once a key is set (see webSearch).
export const WEB_CHAIN = ['searxng', 'tavily', 'brave', 'ddg_html', 'firecrawl', 'mwmbl', 'marginalia', 'wiby'];

export function listProviders(cfg, disabled = new Set()) {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id, label: p.label, kind: p.kind, keyless: p.keyless, documented: p.documented, note: p.note,
    configured: p.available(cfg), enabled: p.available(cfg) && !cfg.disabled.has(p.id) && !disabled.has(p.id),
  }));
}
export function isEnabled(id, cfg, off) {
  const p = PROVIDERS[id];
  return !!p && p.available(cfg) && !cfg.disabled.has(id) && !(off && off.has(id));
}

const cooling = new Map();     // provider id -> {until, reason}
export function providerCooling(id) { const c = cooling.get(id); return c && c.until > Date.now() ? c : null; }
export function resetCooling() { cooling.clear(); }

/** Run one provider for one query, recording what really happened for the research log. */
export async function runProvider(id, query, ctx, log) {
  const p = PROVIDERS[id];
  const t0 = Date.now();
  const entry = { provider: id, label: p.label, query, results: 0, ms: 0, ok: false, error: '' };
  const cool = providerCooling(id);
  if (cool) {                                   // do not keep poking a service that asked us to stop
    entry.error = `skipped — ${cool.reason} (${Math.ceil((cool.until - Date.now()) / 60000)} min left)`; entry.code = 'cooling';
    if (log) log(entry);
    return null;
  }
  try {
    const results = await p.search(query, ctx);
    entry.results = results.length; entry.ok = true;
    return results;
  } catch (e) {
    entry.error = e && e.code === 'aborted' ? 'stopped' : (e && e.message) || 'failed';
    entry.code = (e && e.code) || 'error';
    if (entry.code === 'challenged') cooling.set(id, { until: Date.now() + 10 * 60000, reason: 'it asked for a human check' });
    else if (entry.code === 'http_429' || entry.code === 'rate_limited') cooling.set(id, { until: Date.now() + Math.min(6 * 3600000, Math.max(p.cooldownMs || 2 * 60000, (e && e.retryAfterMs) || 0)), reason: 'it rate-limited this address' });
    else if (entry.code === 'refused' || /^http_(401|402|403)$/.test(entry.code)) cooling.set(id, { until: Date.now() + 15 * 60000, reason: 'it refused this address or key' });
    return null;
  } finally {
    entry.ms = Date.now() - t0;
    if (log) log(entry);
  }
}

/** General web search with provider fallback. Returns the results of the first provider that delivers. */
export async function webSearch(query, ctx, log, { off, min = 3, weights = {} } = {}) {
  const order = (id) => (id === 'firecrawl' && ctx.cfg.keys && ctx.cfg.keys.firecrawl ? WEB_CHAIN.indexOf('tavily') + 0.5 : WEB_CHAIN.indexOf(id));
  const chain = WEB_CHAIN.filter((id) => isEnabled(id, ctx.cfg, off)).sort((a, b) => (weights[b] || 0) - (weights[a] || 0) || order(a) - order(b));
  let best = [];
  for (const id of chain) {
    if (ctx.signal && ctx.signal.aborted) break;
    const res = await runProvider(id, query, ctx, log);
    if (res && res.length >= min) return res;
    if (res && res.length > best.length) best = res;
  }
  return best;
}

/**
 * Reciprocal-rank fusion of several ranked lists. Each list = {results, weight}.
 * Duplicate URLs are merged (their evidence of relevance adds up) and domains are capped for diversity.
 */
export function fuse(lists, { k = 20, perDomain = 3, limit = 30 } = {}) {
  const map = new Map();
  for (const { results, weight = 1 } of lists) {
    if (!results) continue;
    results.forEach((r, rank) => {
      if (!r || !r.url) return;
      const key = canonicalUrl(r.url);
      const score = weight / (k + rank);
      const cur = map.get(key);
      if (cur) {
        cur.score += score;
        if (!cur.providers.includes(r.provider)) cur.providers.push(r.provider);
        if (!cur.snippet && r.snippet) cur.snippet = r.snippet;
        if (!cur.content && r.content) cur.content = r.content;
        if (!cur.date && r.date) cur.date = r.date;
        if (r.query && !cur.queries.includes(r.query)) cur.queries.push(r.query);
      } else map.set(key, { ...r, key, score, providers: [r.provider], queries: r.query ? [r.query] : [] });
    });
  }
  const ranked = [...map.values()].sort((a, b) => b.score - a.score);
  const perDom = new Map(), out = [];
  for (const r of ranked) {
    const d = domainOf(r.url);
    const n = perDom.get(d) || 0;
    if (n >= (d === 'wikipedia.org' ? perDomain + 1 : perDomain)) continue;
    perDom.set(d, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
