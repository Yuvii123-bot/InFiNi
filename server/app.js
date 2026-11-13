// INFINI AI — HTTP application (framework-free). Used by the standalone server and by the serverless entry.
// Endpoints: POST /api/ask (NDJSON stream) · POST /api/preview · GET /api/status · GET /api/health · static files.
//
// Infinity LLM: GET /api/llm/status (model + learning records) · POST /api/llm/chat (the model alone, token stream) ·
//               POST /api/llm/admin (training controls; needs "Authorization: Bearer <INFINI_ADMIN_TOKEN>").
//
// /api/ask streams one JSON object per line: stage, search, fetch, note, research, progress, draft, token, answer, done | error.
// A research run ("depth": "research", or a message such as "do deep research on …") can take a few minutes and reads
// hundreds of pages, so it costs more of a client's allowance and each client may start only a few per hour.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, loadConfig, VERSION } from '../engine/index.js';
import { BlockedError } from '../engine/net/guard.js';
import crypto from 'node:crypto';
import { createNeural, lean } from '../engine/neural/service.js';
import { createChannel } from '../engine/neural/channel.js';
import { createManager } from '../learning/manager.mjs';
import { BUNDLED as BUNDLED_MODEL } from '../learning/store.mjs';

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
  // Infinity LLM: the neural model that writes the replies, and the supervisor of its learning cycles. Both are optional:
  // without a trained model (or with INFINI_LLM=0) the application answers exactly as before.
  const llm = cfg.llm || { enabled: false };
  // Models approved by the learning worker arrive through its channel (weights and records only; see engine/neural/channel.js).
  /** The model that was deployed with this app: when the channel names exactly this one, it is not downloaded again. */
  let shippedMemo;
  const shippedModel = () => {
    if (shippedMemo !== undefined) return shippedMemo;
    try { const dir = llm.bundled || BUNDLED_MODEL; const snap = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8')); const meta = JSON.parse(fs.readFileSync(path.join(dir, 'current', 'model.json'), 'utf8')); shippedMemo = snap.registry && snap.registry.production && meta.sha256 ? { id: snap.registry.production, sha256: meta.sha256 } : null; } catch { shippedMemo = null; }
    return shippedMemo;
  };
  const channel = llm.enabled && llm.channel ? createChannel({ url: llm.channel, dir: llm.channelDir || '', intervalMs: (llm.channelSeconds || 300) * 1000, log, shipped: shippedModel, ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}) }) : null;
  const neural = llm.enabled ? createNeural({ root: llm.dir, minLogProb: llm.minLogProb, minAgreement: llm.minAgreement, log, bundled: llm.bundled || undefined, channel }) : null;
  /** Look at the channel when the last look is old. The first look of a process is waited for; later ones only briefly. */
  async function modelSync() { if (!channel || !channel.stale()) return; const changed = await channel.syncWithin(channel.everChecked() ? 2500 : 12000); if (changed && neural) neural.refresh(true); }
  // what the brain says about itself follows what is really loaded
  engine.brain.setModel(() => (neural && neural.ready() ? neural.info() : null));
  const manager = llm.enabled ? createManager({ root: llm.dir, serverless: llm.serverless, learning: llm.learning, scheduler: llm.scheduler, adminConfigured: !!llm.adminToken, bundled: llm.bundled || undefined, log, channel }) : null;
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const isAdmin = (req) => { const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || '')); return !!(llm.adminToken && m && crypto.timingSafeEqual(sha(m[1].trim()), sha(llm.adminToken))); };

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
      // With the model switched on, the engine's finished answer is held back for a moment: the model writes its part
      // (streamed as "token" events) and the combined answer is sent. A client can opt out per request (settings.neural === false).
      const useNeural = !!(neural && neural.ready() && !(body.settings && typeof body.settings === 'object' && body.settings.neural === false));
      let held = null;
      const onEvent = useNeural ? (ev) => { if (ev && ev.type === 'answer') held = ev.result; else send(ev); } : (ev) => send(ev && ev.type === 'answer' ? { ...ev, result: lean(ev.result) } : ev);
      let result = await engine.ask({ question: body.question, context: body.context, settings: body.settings, learned: body.learned, regenerate: body.regenerate === true, tz, country: countryName(cc), researchAllowed: () => researchAllowed(ip) }, { signal: ac.signal, onEvent });
      if (useNeural && held) { result = await neural.enhance({ result: held, question: body.question, history: body.history, send, signal: ac.signal }); send({ type: 'answer', result }); }
      send({ type: 'done', ms: Date.now() - t0 });
      log({ ev: 'ask', ms: Date.now() - t0, kind: result.kind, neural: result.neural ? (result.neural.used ? result.neural.mode : 'fallback') : undefined, depth: result.depth ? result.depth.used : null, pages: result.run ? result.run.pages : undefined, confidence: result.confidence ? result.confidence.level : null, sources: result.sources.length, ...(process.env.LOG_QUESTIONS === '1' ? { q: body.question.slice(0, 200) } : {}) });
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

  /**
   * Pure neural chat: the reply is whatever Infinity LLM generates, one token at a time, from the conversation so far.
   * This handler touches nothing but the model. It does not call the engine (no rule-based brain, no skills, no memory
   * store) and makes no outbound request (no search, no page reading, no outside model). Nothing replaces, edits or
   * filters the generated text: a reply the model did not finish, or one it was unsure of, is delivered as it is, with a
   * note. test/pure.test.js holds this to account. Streams NDJSON: start, token…, answer, done.
   */
  async function llmChat(req, res) {
    const ip = clientIp(req);
    const wait = rateLimit(ip);
    if (wait) return json(res, 429, { error: 'rate_limited', message: `Too many messages from this address. Try again in ${wait} s.`, retryAfter: wait }, { 'Retry-After': String(wait) });
    const body = await parseJson(req);
    if (typeof body.message !== 'string' || !body.message.trim()) return json(res, 400, { error: 'bad_request', message: 'Field "message" (string) is required.' });
    if (body.message.length > 2000) return json(res, 400, { error: 'bad_request', message: 'The message is too long (limit: 2000 characters).' });
    if (!neural || !neural.ready()) return json(res, 503, { error: 'llm_unavailable', message: `Infinity LLM is not available: ${neural ? neural.info().reason : 'switched off'}.` });
    const ac = new AbortController();
    let finished = false;
    res.on('close', () => { if (!finished) ac.abort(); });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    const send = (ev) => { if (!res.writableEnded && !ac.signal.aborted) res.write(JSON.stringify(ev) + '\n'); };
    const temperature = typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 1.5 ? body.temperature : 0.6;
    const seed = Number.isInteger(body.seed) && body.seed >= 0 && body.seed <= 0xffffffff ? body.seed : null;
    const maxNew = Number.isInteger(body.maxTokens) && body.maxTokens >= 8 && body.maxTokens <= 160 ? body.maxTokens : 120;
    const info = neural.info();
    send({ type: 'start', mode: 'pure-llm', model: { name: 'Infinity LLM', version: info.version, parameters: info.parameters, context: info.context }, temperature, seed, maxTokens: maxNew });
    const g = await neural.chat({ user: body.message, history: body.history, temperature, seed, maxNew, signal: ac.signal, onToken: (text) => send({ type: 'token', text }) });
    const note = g.text === undefined ? (g.reason || 'generation failed') : !g.text ? 'the model produced no text' : g.loop ? 'the model started repeating itself' : !g.ended ? (ac.signal.aborted ? 'stopped' : 'the reply reached the length limit before the model ended it') : '';
    send({ type: 'answer', mode: 'pure-llm', ok: g.text !== undefined, text: g.text || '', note: note || undefined, finished: !!g.ended, model: g.model, tokens: g.tokens, promptTokens: g.promptTokens, contextTurns: g.usedTurns, contextWindow: g.context, ms: g.ms, tokensPerSecond: g.tokensPerSecond, meanLogProb: g.meanLogProb });
    send({ type: 'done' });
    finished = true; res.end();
    log({ ev: 'llm_chat', ms: g.ms, tokens: g.tokens, finished: !!g.ended });
  }
  /** Training controls. Every action needs the admin token; without a configured token the controls do not exist. */
  async function llmAdmin(req, res) {
    const ip = clientIp(req);
    if (!llm.adminToken) return json(res, 403, { error: 'admin_disabled', message: 'The training controls are disabled on this server: no admin token is configured (INFINI_ADMIN_TOKEN, at least 16 characters).' });
    if (!isAdmin(req)) { const wait = rateLimit(ip, 3); log({ ev: 'admin_denied', ip }); return json(res, wait ? 429 : 401, { error: wait ? 'rate_limited' : 'unauthorized', message: wait ? `Too many attempts. Try again in ${wait} s.` : 'A valid admin token is required.' }, wait ? { 'Retry-After': String(wait) } : { 'WWW-Authenticate': 'Bearer' }); }
    const body = await parseJson(req);
    const action = String(body.action || '');
    try {
      let out;
      if (action === 'check') out = { ok: true };
      else if (action === 'pause') out = manager.pause();
      else if (action === 'resume') out = manager.resume();
      else if (action === 'start') out = manager.start('cycle');
      else if (action === 'evaluate') out = manager.start('evaluate');
      else if (action === 'rollback') { out = manager.rollback({ to: typeof body.to === 'string' && /^m\d{4,}$/.test(body.to) ? body.to : null, reason: typeof body.reason === 'string' ? body.reason : '' }); if (neural) neural.refresh(true); }
      else if (action === 'configure') out = manager.configure(body.settings && typeof body.settings === 'object' ? body.settings : {});
      else return json(res, 400, { error: 'bad_request', message: 'Unknown action. Use check, pause, resume, start, evaluate, rollback or configure.' });
      log({ ev: 'admin', action });
      return json(res, 200, { ok: true, action, ...out });
    } catch (e) {
      const status = e.code === 'unavailable' ? 409 : e.code === 'busy' || e.code === 'paused' ? 409 : e.code === 'bad_request' ? 400 : 422;
      return json(res, status, { error: e.code || 'failed', message: String(e.message).slice(0, 300) });
    }
  }
  function llmStatus(req, res) {
    const wait = rateLimit(clientIp(req), 0.2);
    if (wait) return json(res, 429, { error: 'rate_limited', message: `Too many requests. Try again in ${wait} s.` }, { 'Retry-After': String(wait) });
    return json(res, 200, { version: VERSION, model: neural ? neural.info() : { available: false, reason: 'switched off' }, learning: manager ? manager.view() : null });
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
      if (channel && (p.startsWith('/api/llm/') || p === '/api/ask' || p === '/api/status')) { await modelSync(); if (neural) neural.refresh(); }
      if (p === '/api/llm/status') return req.method === 'GET' ? llmStatus(req, res) : json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
      if (p === '/api/llm/chat') return req.method === 'POST' ? await llmChat(req, res) : json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      if (p === '/api/llm/admin') return req.method === 'POST' ? await llmAdmin(req, res) : json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      if (p === '/api/status') { const s = engine.status(); return json(res, 200, { version: VERSION, llm: neural ? neural.info() : false, brain: s.brain, uptimeS: s.uptimeS, totals: s.totals, depths: ['auto', 'fast', 'balanced', 'deep', 'research'], research: { ...s.research, perClientPerHour: cfg.research.perClientPerHour }, wikimediaBudget: s.wikimediaBudget, contactConfigured: s.contactConfigured, cache: { entries: s.http.cacheEntries, bytes: s.http.cacheBytes, hits: s.http.cacheHits, misses: s.http.cacheMisses }, providers: engine.providers(), rate: cfg.rate, ...(s.langsearch ? { langsearch: s.langsearch } : {}) }); }
      if (p.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
      return serveStatic(req, res, p);
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch { /* socket already closed */ } return; }
      if (e.status === 413) res.on('finish', () => req.destroy());
      return json(res, e.status || 500, { error: e.status ? 'bad_request' : 'internal_error', message: e.status ? e.message : 'Internal error' }, e.status === 413 ? { Connection: 'close' } : {});
    }
  }
  return { handle, engine, cfg, neural, manager, channel, close: () => { if (manager) manager.close(); return engine.close(); } };
}
