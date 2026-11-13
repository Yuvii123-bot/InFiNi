// INFINI AI — HTTP application (framework-free). Used by the standalone server and by the serverless entry.
// Endpoints: POST /api/ask (NDJSON stream) · POST /api/preview · GET /api/status · GET /api/health · static files.
//
// /api/ask streams one JSON object per line: stage, search, fetch, note, research, progress, draft, answer, done | error.
// A research run ("depth": "research", or a message such as "do deep research on …") can take a few minutes and reads
// hundreds of pages, so it costs more of a client's allowance and each client may start only a few per hour.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, loadConfig, VERSION } from '../engine/index.js';
import { BlockedError } from '../engine/net/guard.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const MAX_BODY = 64 * 1024;

let REGION = null;
function countryName(code) {
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX') return '';
  try { REGION = REGION || new Intl.DisplayNames(['en'], { type: 'region' }); const n = REGION.of(code); return n && n !== code ? n : ''; } catch { return ''; }
}

export function createApp(cfg = loadConfig()) {
  const engine = createEngine(cfg);
  const buckets = new Map();          // ip -> {tokens, ts}
  const researchStarts = new Map();   // ip -> [start times of research runs in the last hour]
  let active = 0;
  const DEPTH_COST = new Map([['fast', 1], ['balanced', 1], ['auto', 1], ['deep', 2], ['research', 4]]);      // a Map: the depth comes from the request body and must never reach an object's prototype
  /** '' when this client may start a research run now (and counts it), else the reason why not. */
  const researchAllowed = (ip) => {
    const now = Date.now();
    const list = (researchStarts.get(ip) || []).filter((t) => now - t < 3600_000);
    if (list.length >= cfg.research.perClientPerHour) { researchStarts.set(ip, list); return `this device has started ${list.length} research runs in the last hour (the limit is ${cfg.research.perClientPerHour} per hour); the next one can start in about ${Math.max(1, Math.ceil((3600_000 - (now - list[0])) / 60000))} min`; }
    list.push(now); researchStarts.set(ip, list);
    if (researchStarts.size > 5000) for (const [k, v] of researchStarts) if (!v.length || now - v[v.length - 1] > 3600_000) researchStarts.delete(k);
    return '';
  };
  const log = (o) => { if (process.env.LOG_LEVEL !== 'silent') console.log(JSON.stringify({ t: new Date().toISOString(), ...o })); };

  const clientIp = (req) => {
    if (cfg.trustProxy) { const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (xf) return xf.slice(0, 64); }
    return (req.socket && req.socket.remoteAddress) || 'unknown';
  };
  /** Token bucket per client address. Returns seconds to wait (0 = allowed). */
  const rateLimit = (ip, cost = 1) => {
    if (!(Number.isFinite(cost) && cost > 0)) cost = 1;
    const now = Date.now();
    const b = buckets.get(ip) || { tokens: cfg.rate.burst, ts: now };
    b.tokens = Math.min(cfg.rate.burst, b.tokens + ((now - b.ts) / 60000) * cfg.rate.perMin);
    b.ts = now;
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.ts > 600000) buckets.delete(k);
    if (b.tokens < cost) { buckets.set(ip, b); return Math.ceil(((cost - b.tokens) / cfg.rate.perMin) * 60); }
    b.tokens -= cost; buckets.set(ip, b);
    return 0;
  };
  const securityHeaders = (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'${cfg.allowEmbed ? '' : "; frame-ancestors 'self'"}`);
    if (!cfg.allowEmbed) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  };
  const json = (res, status, body, headers = {}) => { const s = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(s), ...headers }); res.end(s); };
  const readBody = (req) => new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));   // pre-parsed by a serverless platform
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) return void chunks.push(c);
      chunks.length = 0;                                                     // stop buffering, answer 413, then drop the connection
      reject(Object.assign(new Error('Request body too large'), { status: 413 }));
      if (size > 16 * MAX_BODY) req.destroy();
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  const parseJson = async (req) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw Object.assign(new Error('Content-Type must be application/json'), { status: 415 });
    const raw = await readBody(req);
    try { const v = JSON.parse(raw); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object'); return v; } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
  };

  async function ask(req, res) {
    const ip = clientIp(req);
    // every request costs one of the client's allowance, before anything is parsed
    const wait = rateLimit(ip);
    if (wait) return json(res, 429, { error: 'rate_limited', message: `Too many questions from this address. Try again in ${wait} s.`, retryAfter: wait }, { 'Retry-After': String(wait) });
    if (active >= cfg.maxConcurrentAsks) return json(res, 503, { error: 'busy', message: 'The server is answering other questions right now. Please retry in a few seconds.' }, { 'Retry-After': '3' });
    const body = await parseJson(req);
    // a deeper search costs more: deep 2 in all, research 4 in all
    const askedDepth = body.settings && typeof body.settings === 'object' && typeof body.settings.depth === 'string' ? body.settings.depth : 'auto';
    const extra = Math.min((DEPTH_COST.get(askedDepth) || 1) - 1, Math.max(0, cfg.rate.burst - 1));
    if (extra > 0) {
      const more = rateLimit(ip, extra);
      if (more) return json(res, 429, { error: 'rate_limited', message: `A search at depth “${askedDepth}” counts ${extra + 1} times against the limit on questions from one address, and that allowance is used up. Try again in ${more} s, or ask at a lower depth.`, retryAfter: more }, { 'Retry-After': String(more) });
    }
    if (typeof body.question !== 'string' || !body.question.trim()) return json(res, 400, { error: 'bad_request', message: 'Field "question" (string) is required.' });
    if (body.question.length > 2000) return json(res, 400, { error: 'bad_request', message: 'The question is too long (limit: 2000 characters; the first 600 are analysed).' });
    const ac = new AbortController();
    let finished = false;
    res.on('close', () => { if (!finished) ac.abort(); });           // client pressed Stop or went away → stop retrieving
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    const send = (ev) => { if (!res.writableEnded && !ac.signal.aborted) res.write(JSON.stringify(ev) + '\n'); };
    active++;
    const t0 = Date.now();
    try {
      // the device's time zone (for "what time is it") and the country the edge reports (only used to phrase a helpline search)
      const tz = typeof body.tz === 'string' && /^[A-Za-z_+\-/0-9]{2,48}$/.test(body.tz) ? body.tz : '';
      const cc = cfg.trustProxy ? String(req.headers['x-vercel-ip-country'] || '').toUpperCase() : '';
      const result = await engine.ask({ question: body.question, context: body.context, settings: body.settings, learned: body.learned, regenerate: body.regenerate === true, tz, country: countryName(cc), researchAllowed: () => researchAllowed(ip) }, { signal: ac.signal, onEvent: send });
      send({ type: 'done', ms: Date.now() - t0 });
      log({ ev: 'ask', ms: Date.now() - t0, kind: result.kind, depth: result.depth ? result.depth.used : null, pages: result.run ? result.run.pages : undefined, confidence: result.confidence ? result.confidence.level : null, sources: result.sources.length, ...(process.env.LOG_QUESTIONS === '1' ? { q: body.question.slice(0, 200) } : {}) });
    } catch (e) {
      if (e.code === 'aborted' || ac.signal.aborted) log({ ev: 'ask_stopped', ms: Date.now() - t0 });
      else { log({ ev: 'ask_error', message: e.message, stack: String(e.stack || '').split('\n').slice(0, 4).join(' | ') }); send({ type: 'error', message: 'The engine hit an internal error while answering. Nothing was made up; please retry.', detail: String(e.message || '').slice(0, 200) }); }
    } finally { active--; finished = true; res.end(); }
  }

  async function preview(req, res) {
    const wait = rateLimit(clientIp(req), 0.5);
    if (wait) return json(res, 429, { error: 'rate_limited', message: `Too many requests. Try again in ${wait} s.` }, { 'Retry-After': String(wait) });
    const body = await parseJson(req);
    if (typeof body.url !== 'string' || body.url.length > 2000 || !/^https?:\/\//i.test(body.url)) return json(res, 400, { error: 'bad_request', message: 'Field "url" must be an http(s) URL.' });
    try { return json(res, 200, await engine.preview(body.url)); }
    catch (e) { return json(res, e instanceof BlockedError ? 403 : 502, { error: e.code || 'fetch_failed', message: e instanceof BlockedError ? `That address is not allowed: ${e.message}` : `The page could not be read: ${String(e.message).split('\n')[0].slice(0, 160)}` }); }
  }

  function serveStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return json(res, 400, { error: 'bad_request' }); }
    if (rel.includes('\0') || /(^|[\\/])\.[^\\/]*/.test(rel)) return json(res, 404, { error: 'not_found' });      // no dot-segments, no dotfiles
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'forbidden' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return json(res, 404, { error: 'not_found' });
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ETag: etag, 'Cache-Control': /sw\.js$|\.html$|manifest/.test(file) ? 'no-cache' : 'public, max-age=3600' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  async function handle(req, res) {
    securityHeaders(res);
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'bad_request' }); }
    const p = url.pathname;
    try {
      if (p === '/api/ask') return req.method === 'POST' ? await ask(req, res) : json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      if (p === '/api/preview') return req.method === 'POST' ? await preview(req, res) : json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      if (p === '/api/health') return json(res, 200, { ok: true, version: VERSION });
      if (p === '/api/status') { const s = engine.status(); return json(res, 200, { version: VERSION, llm: false, brain: s.brain, uptimeS: s.uptimeS, totals: s.totals, depths: ['auto', 'fast', 'balanced', 'deep', 'research'], research: { ...s.research, perClientPerHour: cfg.research.perClientPerHour }, wikimediaBudget: s.wikimediaBudget, contactConfigured: s.contactConfigured, cache: { entries: s.http.cacheEntries, bytes: s.http.cacheBytes, hits: s.http.cacheHits, misses: s.http.cacheMisses }, providers: engine.providers(), rate: cfg.rate, ...(s.langsearch ? { langsearch: s.langsearch } : {}) }); }
      if (p.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
      return serveStatic(req, res, p);
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch { /* socket already closed */ } return; }
      if (e.status === 413) res.on('finish', () => req.destroy());
      return json(res, e.status || 500, { error: e.status ? 'bad_request' : 'internal_error', message: e.status ? e.message : 'Internal error' }, e.status === 413 ? { Connection: 'close' } : {});
    }
  }
  return { handle, engine, cfg };
}
