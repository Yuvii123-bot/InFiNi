// INFINI AI — hardened HTTP client.
// DNS-pinned (anti-rebinding), redirect-validating, size/time bounded, robots-aware, cached.
// Pages are only ever fetched with GET. The single exception is postJSON(): a small JSON POST that search-provider
// adapters send to their fixed API host (same address guard, no redirects followed, keys never leave that origin).
// Built on node:http/https so the validated IP address is the one actually connected to.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import zlib from 'node:zlib';
import { validateUrl, isBlockedAddress, ipFamily, BlockedError } from './guard.js';
import { hash } from '../util/text.js';

export class HttpError extends Error {
  constructor(message, code = 'network', status = 0) { super(message); this.name = 'HttpError'; this.code = code; this.status = status; }
}

class LRU {
  constructor(maxBytes, ttlMs) { this.max = maxBytes; this.ttl = ttlMs; this.map = new Map(); this.bytes = 0; this.hits = 0; this.misses = 0; }
  get(key) {
    const e = this.map.get(key);
    if (!e || Date.now() - e.ts > (e.ttl || this.ttl)) { if (e) this.delete(key); this.misses++; return null; }
    this.map.delete(key); this.map.set(key, e); this.hits++;
    return e.val;
  }
  set(key, val, bytes, ttl) {
    if (bytes > this.max / 4) return;
    this.delete(key);
    this.map.set(key, { val, bytes, ts: Date.now(), ttl });
    this.bytes += bytes;
    while (this.bytes > this.max && this.map.size) this.delete(this.map.keys().next().value);
  }
  delete(key) { const e = this.map.get(key); if (e) { this.bytes -= e.bytes; this.map.delete(key); } }
  clear() { this.map.clear(); this.bytes = 0; }
}

class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  acquire() { if (this.n > 0) { this.n--; return Promise.resolve(); } return new Promise((r) => this.q.push(r)); }
  release() { const next = this.q.shift(); if (next) next(); else this.n++; }
}

// ---- robots.txt (RFC 9309) -------------------------------------------------------------------
export function parseRobots(text, token = 'infiniai') {
  const groups = [];
  let cur = null, lastUA = false;
  for (let line of String(text).split(/\r?\n/).slice(0, 5000)) {
    line = line.replace(/#.*$/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase(), val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastUA = true;
    } else {
      lastUA = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val.slice(0, 300) });
      else if (cur && key === 'crawl-delay') { const d = Number(val); if (Number.isFinite(d) && d > 0) cur.delay = Math.min(d, 3600); }
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && a.length > 2 && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  // Crawl-delay is not part of RFC 9309, but many sites state one: seconds to leave between two requests (honoured when several pages of a site are read)
  rules.crawlDelay = chosen.reduce((a, g) => Math.max(a, g.delay || 0), 0);
  return rules;
}
export function robotsPathAllowed(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;                                   // empty Disallow means "allow everything"
    let p = r.path.replace(/\*+/g, '*');
    const anchored = p.endsWith('$');
    if (anchored) p = p.slice(0, -1);
    const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : ''));
    if (re.test(path)) {
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
    }
  }
  return best ? best.allow : true;
}

const ACCEPT = {
  html: { header: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5', re: /^(text\/html|application\/xhtml\+xml|text\/plain)/ },
  json: { header: 'application/json,text/javascript;q=0.5,*/*;q=0.1', re: /^(application\/(json|[\w.+-]+\+json|x-javascript|javascript)|text\/(json|javascript|plain))/ },
  xml: { header: 'application/atom+xml,application/rss+xml,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.1', re: /^(application\/([\w.+-]+\+)?xml|text\/(xml|html|plain))/ },
  any: { header: '*/*', re: /./ },
};

/**
 * Headers for one hop. Caller-supplied headers (API keys) go only to the origin the request was addressed to —
 * a redirect to any other origin never receives them.
 */
export function requestHeaders({ url, firstOrigin, userAgent, accept, lang, extra, postLength = null }) {
  return {
    'User-Agent': userAgent, Accept: accept, 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': lang || 'en;q=0.9,*;q=0.4',
    ...(url.origin === firstOrigin ? extra || {} : {}),
    ...(postLength != null ? { 'Content-Type': 'application/json', 'Content-Length': String(postLength) } : {}),
  };
}

export function createHttpClient(cfg = {}) {
  const conf = {
    userAgent: 'Mozilla/5.0 (compatible; InfiniAI/1.0; retrieval-native assistant; user-initiated requests)',
    timeoutMs: 7000, maxBytes: 1_500_000, maxRedirects: 5,
    cacheBytes: 24 * 1024 * 1024, cacheTtlMs: 15 * 60 * 1000,
    perHost: 3, global: 12, respectRobots: true, allowPorts: [80, 443],
    lookup: null,                       // test hook: async (hostname) => [{address, family}]
    transport: null,                    // test hook: async (URL, request, send) => {status, headers, body: Buffer, truncated} — send() performs the real request
    trustedOrigins: [],                 // operator-configured origins (never user input) exempt from the public-address rule
    rateClasses: [],                    // [{id, label, perMin, test(URL)}] — client-side politeness budgets
    ...cfg,
  };
  const cache = new LRU(conf.cacheBytes, conf.cacheTtlMs);
  const robotsCache = new Map();        // origin -> {rules|null, deny, ts}
  const dnsCache = new Map();
  const hostSems = new Map();
  const globalSem = new Semaphore(conf.global);
  const failures = new Map();           // host -> {n, ts}
  // Idle keep-alive sockets are closed after a few seconds and capped in number: a research run touches hundreds of hosts,
  // and serverless platforms allow only about a thousand open descriptors per instance.
  const agentOpts = { keepAlive: true, maxSockets: 6, keepAliveMsecs: 5000, maxFreeSockets: 3, timeout: 6000, scheduling: 'lifo', maxTotalSockets: Math.max(64, conf.global * 3) };
  const agents = { 'http:': new http.Agent(agentOpts), 'https:': new https.Agent(agentOpts) };
  const stats = { requests: 0, bytes: 0, blocked: 0, errors: 0, robotsDenied: 0 };
  const windows = new Map();            // rate class id -> timestamps of recent requests
  const backoff = new Map();            // rate class id or host -> epoch ms until which the server asked us to wait

  const rateKey = (u) => { for (const rc of conf.rateClasses) if (rc.test(u)) return rc; return null; };
  /** Throws if the server told us to wait, or if our own per-minute budget for this API is used up. */
  function admit(u) {
    const rc = rateKey(u);
    const key = rc ? rc.id : u.hostname;
    const until = backoff.get(key);
    if (until && until > Date.now()) throw new HttpError(`${rc ? rc.label : u.hostname} asked us to slow down — retry in ${Math.ceil((until - Date.now()) / 1000)} s`, 'rate_limited', 429);
    if (rc && rc.perMin) {
      const now = Date.now();
      let w = windows.get(rc.id);
      if (!w) { w = []; windows.set(rc.id, w); }
      while (w.length && now - w[0] > 60_000) w.shift();
      if (w.length >= rc.perMin) throw new HttpError(`Request budget for ${rc.label} is used up (${rc.perMin}/min) — retry in ${Math.ceil((60_000 - (now - w[0])) / 1000)} s`, 'rate_budget', 429);
      w.push(now);
    }
    return key;
  }
  /**
   * Some APIs state a limit per second ("3 requests per second"). For a rate class with `gapMs`, the starts of two requests
   * are at least that far apart: a burst of searches is spread out instead of being answered with 429.
   */
  const nextStart = new Map();          // rate class id -> epoch ms at which the next request may start
  async function paced(u) {
    const rc = rateKey(u);
    if (!rc || !rc.gapMs) return;
    const now = Date.now();
    const at = Math.max(now, nextStart.get(rc.id) || 0);
    nextStart.set(rc.id, at + rc.gapMs);
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));      // (not unref'd: a request is waiting on it)
  }
  /** Remaining requests this minute for a rate class (Infinity when unlimited, 0 while backing off). */
  function remaining(id) {
    const rc = conf.rateClasses.find((r) => r.id === id);
    if (!rc) return Infinity;
    const until = backoff.get(id);
    if (until && until > Date.now()) return 0;
    const now = Date.now();
    const w = (windows.get(id) || []).filter((t) => now - t <= 60_000);
    return Math.max(0, rc.perMin - w.length);
  }

  async function resolveHost(host, trusted) {
    const bare = host.replace(/^\[|\]$/g, '');
    const fam = ipFamily(bare);
    if (fam) {
      if (!trusted && isBlockedAddress(bare)) { stats.blocked++; throw new BlockedError('Address is private, loopback or reserved', 'private_address'); }
      return { address: bare, family: fam };
    }
    const c = dnsCache.get(bare);
    if (c && !trusted && Date.now() - c.ts < 60_000) return c.val;
    let list;
    try {
      const p = conf.lookup ? conf.lookup(bare) : dns.promises.lookup(bare, { all: true });
      list = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new HttpError('DNS lookup timed out', 'dns_timeout')), 4000))]);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(`DNS lookup failed for ${bare}`, 'dns');
    }
    if (!list || !list.length) throw new HttpError(`DNS returned no addresses for ${bare}`, 'dns');
    // Strict: if ANY record points at a private/reserved range the host is refused (rebinding defence).
    if (!trusted) for (const a of list) if (isBlockedAddress(a.address)) { stats.blocked++; throw new BlockedError(`${bare} resolves to a private or reserved address`, 'private_address'); }
    const pick = list.find((a) => a.family === 4) || list[0];
    const val = { address: pick.address, family: pick.family };
    if (dnsCache.size > 2000) dnsCache.clear();
    if (!trusted) dnsCache.set(bare, { val, ts: Date.now() });
    return val;
  }

  function rawGet(u, { address, family, headers, timeoutMs, maxBytes, signal, method = 'GET', body = null }) {
    return new Promise((resolve, reject) => {
      const isHttps = u.protocol === 'https:';
      const host = u.hostname.replace(/^\[|\]$/g, '');
      let done = false, timer = null, req = null;
      const finish = (err, val) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (err) reject(err); else resolve(val);
      };
      const onAbort = () => { if (req) req.destroy(); finish(new HttpError('Request aborted', 'aborted')); };
      if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
      req = (isHttps ? https : http).request({
        host, port: u.port || (isHttps ? 443 : 80), path: (u.pathname || '/') + (u.search || ''), method, headers,
        agent: agents[u.protocol],
        // Pin the connection to the address that was validated — the name is never resolved a second time.
        lookup: (hostname, options, cb) => {
          if (typeof options === 'function') { cb = options; options = {}; }
          if (options && options.all) cb(null, [{ address, family }]); else cb(null, address, family);
        },
        servername: ipFamily(host) ? undefined : host,
      });
      timer = setTimeout(() => { req.destroy(); finish(new HttpError(`Timed out after ${timeoutMs} ms`, 'timeout')); }, timeoutMs);
      req.on('error', (e) => finish(new HttpError(e.message || 'Network error', (e.code || 'network').toString().toLowerCase())));
      req.on('response', (res) => {
        const status = res.statusCode || 0, h = res.headers;
        if (status >= 300 && status < 400 && h.location) { res.resume(); return finish(null, { status, headers: h, body: Buffer.alloc(0), truncated: false }); }
        let stream = res;
        const enc = String(h['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
          else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
          else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        } catch { stream = res; }
        const chunks = [];
        let size = 0;
        stream.on('data', (c) => {
          if (done) return;
          size += c.length;
          if (size > maxBytes) {                         // hard cap on *decompressed* bytes (zip-bomb defence)
            chunks.push(c.subarray(0, c.length - (size - maxBytes)));
            res.destroy();
            finish(null, { status, headers: h, body: Buffer.concat(chunks), truncated: true });
          } else chunks.push(c);
        });
        stream.on('end', () => finish(null, { status, headers: h, body: Buffer.concat(chunks), truncated: false }));
        stream.on('error', (e) => (chunks.length ? finish(null, { status, headers: h, body: Buffer.concat(chunks), truncated: true }) : finish(new HttpError('Could not decode response: ' + e.message, 'decode'))));
        res.on('error', (e) => finish(new HttpError(e.message, 'network')));
      });
      req.end(body || undefined);
    });
  }

  function hostSem(host, limit) {
    let s = hostSems.get(host);
    if (!s) { if (hostSems.size > 3000) hostSems.clear(); s = new Semaphore(limit || conf.perHost); hostSems.set(host, s); }
    return s;
  }
  // Circuit breaker: three failures in a row (no answer at all) and the host is left alone for two minutes.
  // Any answer resets the count. A request may name its own circuit (opts.circuit) so that one slow endpoint
  // of a host — a search that times out — does not block its other endpoints, e.g. full-text delivery.
  function circuitOpen(key) {
    const f = failures.get(key);
    return !!f && f.n >= 3 && Date.now() - f.ts < 120_000;
  }
  function noteFailure(key) {
    const f = failures.get(key);
    if (!f || Date.now() - f.ts > 120_000) failures.set(key, { n: 1, ts: Date.now() }); else { f.n++; f.ts = Date.now(); }
    if (failures.size > 2000) failures.clear();
  }
  function noteAnswer(key) { if (failures.has(key) && !circuitOpen(key)) failures.delete(key); }

  async function robotsAllowed(u, signal) {
    if (!conf.respectRobots) return true;
    let entry = robotsCache.get(u.origin);
    if (!entry || Date.now() - entry.ts > 3600_000) {
      entry = { rules: null, deny: false, ts: Date.now() };
      try {
        const r = await get(u.origin + '/robots.txt', { robots: false, timeoutMs: 3500, maxBytes: 300_000, accept: 'any', signal, cache: false });
        if (r.status === 200) entry.rules = parseRobots(r.body.toString('utf8'));
        else if (r.status >= 500) entry.deny = true;        // RFC 9309: unreachable (5xx) => assume disallow
      } catch (e) {
        if (e && e.code === 'aborted') throw e;             // network failure: no information — the page fetch will decide
      }
      if (robotsCache.size > 3000) robotsCache.clear();
      robotsCache.set(u.origin, entry);
    }
    if (entry.deny) return false;
    if (!entry.rules) return true;
    return robotsPathAllowed(entry.rules, (u.pathname || '/') + (u.search || ''));
  }

  /**
   * GET a URL. opts: {signal, timeoutMs, maxBytes, accept:'html'|'json'|'xml'|'any', headers, robots, fresh, cache, ttlMs, hostLimit}
   * Returns {status, url, headers, body:Buffer, truncated, ms, bytes, redirects, fromCache}.
   */
  async function get(rawUrl, opts = {}) {
    const o = { timeoutMs: conf.timeoutMs, maxBytes: conf.maxBytes, accept: 'html', robots: false, fresh: false, cache: true, ...opts };
    const isPost = o.method === 'POST';
    const postBody = isPost ? Buffer.from(String(o.body || ''), 'utf8') : null;
    if (isPost && postBody.length > 16_384) throw new HttpError('Request body too large', 'bad_request');
    const key = o.accept + ' ' + rawUrl + (isPost ? ' POST ' + hash(postBody.toString('utf8')) : '') + (o.cacheTag ? ' ' + o.cacheTag : '');
    if (o.cache && !o.fresh) {
      const hit = cache.get(key);
      if (hit) return { ...hit, fromCache: true, ms: 0 };
    }
    let trusted = false;
    try { trusted = conf.trustedOrigins.includes(new URL(rawUrl).origin); } catch { /* validateUrl reports it */ }
    let u = trusted ? new URL(rawUrl) : validateUrl(rawUrl, { allowPorts: conf.allowPorts });
    const firstOrigin = u.origin;
    const started = Date.now();
    const redirects = [];
    for (let hop = 0; hop <= conf.maxRedirects; hop++) {
      const host = u.hostname;
      const ckey = o.circuit ? `${host}#${o.circuit}` : host;
      if (circuitOpen(ckey)) throw new HttpError(`${host} skipped after repeated failures`, 'circuit_open');
      if (o.robots && !(await robotsAllowed(u, o.signal))) { stats.robotsDenied++; throw new BlockedError('Disallowed by the site\'s robots.txt', 'robots'); }
      const addr = await resolveHost(host, trusted);
      const rkey = admit(u);
      const sem = hostSem(host, o.hostLimit);
      await sem.acquire(); await globalSem.acquire();
      let res;
      try {
        await paced(u);
        const remaining = Math.max(500, o.timeoutMs - (Date.now() - started));
        stats.requests++;
        const request = {
          ...addr, timeoutMs: remaining, maxBytes: o.maxBytes, signal: o.signal,
          method: isPost ? 'POST' : 'GET', body: postBody,
          headers: requestHeaders({ url: u, firstOrigin, userAgent: conf.userAgentFor ? conf.userAgentFor(u) : conf.userAgent, accept: ACCEPT[o.accept].header, lang: o.lang, extra: o.headers, postLength: isPost ? postBody.length : null }),
        };
        res = conf.transport ? await conf.transport(u, request, () => rawGet(u, request)) : await rawGet(u, request);
      } catch (e) {
        if (e.code !== 'aborted') { stats.errors++; noteFailure(ckey); }
        throw e;
      } finally { globalSem.release(); sem.release(); }
      noteAnswer(ckey);
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        if (isPost) throw new HttpError('The search API answered with a redirect, which is not followed for POST requests', 'bad_redirect');
        let next;
        try { next = new URL(res.headers.location, u).toString(); } catch { throw new HttpError('Redirect to an invalid URL', 'bad_redirect'); }
        redirects.push(next);
        u = validateUrl(next, { allowPorts: conf.allowPorts });   // every hop is validated again
        trusted = false;                                          // trust never follows a redirect
        continue;
      }
      if (res.status === 429 || (res.status === 503 && res.headers['retry-after'])) {
        const ra = Number(res.headers['retry-after']);
        backoff.set(rkey, Date.now() + Math.min(Number.isFinite(ra) && ra > 0 ? ra : 30, 300) * 1000);   // honour Retry-After
      }
      stats.bytes += res.body.length;
      const out = {
        status: res.status, url: u.toString(), body: res.body, truncated: res.truncated, bytes: res.body.length, redirects,
        headers: { 'content-type': String(res.headers['content-type'] || ''), 'last-modified': res.headers['last-modified'] || '', 'x-robots-tag': String(res.headers['x-robots-tag'] || ''), 'retry-after': res.headers['retry-after'] || '' },
        ms: Date.now() - started, fromCache: false,
      };
      if (o.cache && res.status === 200) cache.set(key, out, res.body.length + 400, o.ttlMs);
      return out;
    }
    throw new HttpError('Too many redirects', 'too_many_redirects');
  }

  function decode(res) {
    const ct = res.headers['content-type'];
    let charset = (ct.match(/charset\s*=\s*["']?([\w\-:.]+)/i) || [])[1];
    if (!charset) {
      const head = res.body.subarray(0, 2048).toString('latin1');
      charset = (head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w\-:.]+)/i) || head.match(/<\?xml[^>]+encoding\s*=\s*["']([\w\-:.]+)/i) || [])[1];
    }
    if (charset && !/^utf-?8$/i.test(charset)) {
      try { return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(res.body); } catch { /* unknown label → utf-8 */ }
    }
    return res.body.toString('utf8');
  }

  /** GET and decode text; throws HttpError on HTTP errors or a disallowed content type. */
  async function getText(url, opts = {}) {
    const res = await get(url, opts);
    if (res.status >= 400 || (res.status === 202 && !opts.accept202) || res.status === 204) {
      const hint = res.status === 403 || res.status === 401 ? ' (the site refused automated access)' : res.status === 429 ? ' (rate limited)' : res.status === 202 ? ' (challenge / not ready)' : '';
      throw Object.assign(new HttpError(`HTTP ${res.status}${hint}`, 'http_' + res.status, res.status), { retryAfter: Math.max(0, Number(res.headers['retry-after']) || 0) });
    }
    const ct = res.headers['content-type'].toLowerCase().trim();
    const accept = ACCEPT[opts.accept || 'html'];
    if (ct && !accept.re.test(ct)) throw new HttpError(`Unsupported content type: ${ct.split(';')[0]}`, 'content_type');
    return { ...res, text: decode(res) };
  }

  async function getJSON(url, opts = {}) {
    const res = await getText(url, { accept: 'json', ...opts });
    try { return { ...res, json: JSON.parse(res.text) }; } catch { throw new HttpError('Response was not valid JSON', 'bad_json'); }
  }
  /** JSON POST for search APIs. Same guard as GET (public addresses only, pinned DNS, size cap); redirects are refused. */
  const postJSON = (url, body, opts = {}) => getJSON(url, { ...opts, method: 'POST', body: JSON.stringify(body) });

  return {
    get, getText, getJSON, postJSON, robotsAllowed, remaining, config: conf,
    /** Seconds the site asks crawlers to leave between requests (0 when it states none, or its robots.txt has not been read yet). */
    crawlDelay(host) { const e = robotsCache.get(`https://${host}`) || robotsCache.get(`http://${host}`); return e && e.rules && e.rules.crawlDelay ? e.rules.crawlDelay : 0; },
    /** True while a host is being skipped after repeated failures (the crawler does not queue more pages from it). */
    hostDown: (host) => circuitOpen(host),
    clearCache() { cache.clear(); robotsCache.clear(); dnsCache.clear(); failures.clear(); },
    stats() { return { ...stats, cacheEntries: cache.map.size, cacheBytes: cache.bytes, cacheHits: cache.hits, cacheMisses: cache.misses }; },
    close() { agents['http:'].destroy(); agents['https:'].destroy(); },
  };
}
