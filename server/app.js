// INFINI AI — HTTP application (framework-free). Used by the standalone server and by the serverless entry.
// Endpoints: POST /api/ask (NDJSON stream) · POST /api/preview · GET /api/status · GET /api/health · static files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, loadConfig, VERSION } from '../engine/index.js';
import { BlockedError } from '../engine/net/guard.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const MAX_BODY = 64 * 1024;

export function createApp(cfg = loadConfig()) {
  const engine = createEngine(cfg);
  const buckets = new Map();          // ip -> {tokens, ts}
  let active = 0;
  const log = (o) => { if (process.env.LOG_LEVEL !== 'silent') console.log(JSON.stringify({ t: new Date().toISOString(), ...o })); };

  const clientIp = (req) => {
    if (cfg.trustProxy) { const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (xf) return xf.slice(0, 64); }
    return (req.socket && req.socket.remoteAddress) || 'unknown';
  };
  /** Token bucket per client address. Returns seconds to wait (0 = allowed). */
  const rateLimit = (ip, cost = 1) => {
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
    const wait = rateLimit(ip);
    if (wait) return json(res, 429, { error: 'rate_limited', message: `Too many questions from this address. Try again in ${wait} s.`, retryAfter: wait }, { 'Retry-After': String(wait) });
    if (active >= cfg.maxConcurrentAsks) return json(res, 503, { error: 'busy', message: 'The server is answering other questions right now. Please retry in a few seconds.' }, { 'Retry-After': '3' });
    const body = await parseJson(req);
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
      const result = await engine.ask({ question: body.question, context: body.context, settings: body.settings, learned: body.learned, regenerate: body.regenerate === true }, { signal: ac.signal, onEvent: send });
      send({ type: 'done', ms: Date.now() - t0 });
      log({ ev: 'ask', ms: Date.now() - t0, kind: result.kind, confidence: result.confidence ? result.confidence.level : null, sources: result.sources.length, ...(process.env.LOG_QUESTIONS === '1' ? { q: body.question.slice(0, 200) } : {}) });
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
      if (p === '/api/status') { const s = engine.status(); return json(res, 200, { version: VERSION, llm: false, uptimeS: s.uptimeS, totals: s.totals, wikimediaBudget: s.wikimediaBudget, contactConfigured: s.contactConfigured, cache: { entries: s.http.cacheEntries, bytes: s.http.cacheBytes, hits: s.http.cacheHits, misses: s.http.cacheMisses }, providers: engine.providers(), rate: cfg.rate }); }
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
