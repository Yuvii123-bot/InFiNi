// INFINITY LLM — receiving an approved model from the learning worker.
//
// A serving process that cannot train (a serverless function, a container without Python) reads the worker's model
// channel over HTTPS: channel.json says which version is in production and gives the checksum of each of its files.
// A new version is downloaded into a scratch directory, every checksum is compared, the model is loaded and has to
// reproduce its reference numbers; only then does it become the model that answers. If anything fails, the model that
// is answering now keeps answering. A rollback on the worker arrives the same way (the channel names the older version).
//
// This module moves weights and learning records. It never sees a message and never writes a word of a reply.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadModel, selfTest } from './model.js';

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const LIMITS = { model: 4 << 20, tokenizer: 8 << 20, weights: 256 << 20 };

export function createChannel({ url = '', dir = '', intervalMs = 300_000, timeoutMs = 20_000, fetchImpl = (...a) => fetch(...a), log = () => {}, shipped = null } = {}) {
  const base = String(url).replace(/\/+$/, '');
  dir = dir || path.join(os.tmpdir(), 'infinity-channel-' + crypto.createHash('sha256').update(base).digest('hex').slice(0, 10));
  const st = { url: base, enabled: !!base, lastCheck: 0, lastOk: 0, checks: 0, swaps: 0, error: '', version: null, snapshot: null, status: null };
  let inflight = null, active = null;

  const readActive = () => { try { const a = JSON.parse(fs.readFileSync(path.join(dir, 'active.json'), 'utf8')); return a && a.version && fs.existsSync(path.join(dir, 'models', a.version, 'weights.bin')) ? a : null; } catch { return null; } };
  active = base ? readActive() : null;
  if (active) st.version = active.version;

  async function get(name, max) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}/${name}`, { redirect: 'follow', signal: ac.signal, headers: { 'User-Agent': 'infinity-llm-server', Accept: 'application/octet-stream, application/json' }, cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > max) throw new Error(`${name} is larger than allowed (${buf.length} bytes)`);
      return buf;
    } finally { clearTimeout(t); }
  }

  async function check() {
    st.checks++; st.lastCheck = Date.now();
    const raw = await get('channel.json', 1 << 20);
    if (!raw) { st.error = 'the channel has no channel.json yet'; return false; }
    const ch = JSON.parse(raw.toString('utf8'));
    if (!ch || ch.format !== 'infinity-channel/1' || !SAFE.test(String(ch.version)) || !ch.files) throw new Error('channel.json is not a model channel');
    let swapped = false;
    const same = active && active.version === ch.version && active.sha256 === ch.files.weights.sha256;
    // The version the channel names is the one that was shipped with this app (same id, same weights): nothing to fetch.
    const have = shipped ? shipped() : null;
    if (have && have.id === ch.version && have.sha256 === ch.files.weights.sha256) {
      if (active) { const old = active; active = null; fs.rmSync(path.join(dir, 'active.json'), { force: true }); fs.rmSync(path.join(dir, 'models', old.version), { recursive: true, force: true }); swapped = true; log({ ev: 'llm_channel_model', version: ch.version, replaced: old.version, using: 'the shipped copy' }); }
      st.version = ch.version; st.shipped = true;
    } else if (!same) {
      st.shipped = false;
      const tmp = path.join(dir, `incoming-${process.pid}-${Date.now()}`);
      fs.mkdirSync(tmp, { recursive: true });
      try {
        for (const [key, file] of [['model', 'model.json'], ['tokenizer', 'tokenizer.json'], ['weights', 'weights.bin']]) {
          const f = ch.files[key];
          if (!f || !SAFE.test(String(f.name)) || !/^[0-9a-f]{64}$/.test(String(f.sha256))) throw new Error(`channel.json does not describe the ${key} file`);
          const buf = await get(f.name, LIMITS[key]);
          if (!buf) throw new Error(`${f.name} is missing from the channel`);
          const sha = crypto.createHash('sha256').update(buf).digest('hex');
          if (sha !== f.sha256) throw new Error(`${f.name} does not match its checksum (download damaged or file replaced)`);
          fs.writeFileSync(path.join(tmp, file), buf);
        }
        const model = loadModel(tmp);                                  // verifies the checksum inside model.json as well
        const t = selfTest(model);
        if (!t.ok) throw new Error(`version ${ch.version} failed its self-test (difference ${t.maxDiff})`);
        const tok = JSON.parse(fs.readFileSync(path.join(tmp, 'tokenizer.json'), 'utf8'));
        if (!tok || !Array.isArray(tok.merges)) throw new Error('the tokenizer file is not a tokenizer');
        const dest = path.join(dir, 'models', ch.version);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(tmp, dest);
        const next = { version: ch.version, sha256: ch.files.weights.sha256, received: new Date().toISOString(), published: ch.published, previous: ch.previous || null, model: ch.model || null };
        fs.writeFileSync(path.join(dir, 'active.json.tmp'), JSON.stringify(next));
        fs.renameSync(path.join(dir, 'active.json.tmp'), path.join(dir, 'active.json'));
        const old = active; active = next; st.version = next.version; st.swaps++; swapped = true;
        log({ ev: 'llm_channel_model', version: next.version, replaced: old ? old.version : 'bundled' });
        if (old && old.version !== next.version) fs.rmSync(path.join(dir, 'models', old.version), { recursive: true, force: true });
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    // the learning records for the dashboard (optional: a channel without them still delivers the model)
    try { const s = await get('snapshot.json', 16 << 20); if (s) st.snapshot = JSON.parse(s.toString('utf8')); } catch (e) { log({ ev: 'llm_channel_snapshot_failed', message: String(e && e.message).slice(0, 120) }); }
    st.error = ''; st.lastOk = Date.now();
    return swapped;
  }

  /** Check the channel if the last check is older than the interval. Never throws. Resolves true when the model changed. */
  function sync({ force = false } = {}) {
    if (!base) return Promise.resolve(false);
    if (inflight) return inflight;
    if (!force && Date.now() - st.lastCheck < intervalMs) return Promise.resolve(false);
    inflight = check().catch((e) => { st.error = String(e && e.message).slice(0, 200); log({ ev: 'llm_channel_failed', message: st.error }); return false; }).finally(() => { inflight = null; });
    return inflight;
  }
  /** As sync(), but waits at most `ms` (a request must not hang on a slow download; the download carries on). */
  function syncWithin(ms, opts) { const p = sync(opts); return Promise.race([p, new Promise((r) => { const t = setTimeout(() => r(false), ms); if (t.unref) t.unref(); })]); }

  return {
    enabled: !!base, sync, syncWithin,
    /** Where the serving process loads the channel's model from, or null when none has been received. */
    current() { if (!active) return null; const d = path.join(dir, 'models', active.version); return fs.existsSync(path.join(d, 'weights.bin')) ? { dir: d, id: active.version, card: active.model || null, source: 'channel', registryMtime: Date.parse(active.received) || 0 } : null; },
    snapshot: () => st.snapshot,
    info: () => ({ enabled: !!base, url: base, version: st.version, usingShippedCopy: st.shipped || undefined, checks: st.checks, modelsReceived: st.swaps, lastCheck: st.lastCheck ? new Date(st.lastCheck).toISOString() : null, lastOk: st.lastOk ? new Date(st.lastOk).toISOString() : null, error: st.error || undefined, intervalSeconds: Math.round(intervalMs / 1000) }),
    stale: () => !!base && Date.now() - st.lastCheck >= intervalMs,
    everChecked: () => st.checks > 0,
  };
}
