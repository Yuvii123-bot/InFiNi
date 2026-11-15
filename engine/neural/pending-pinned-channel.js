// One explicitly authorized future release, not the worker's mutable model channel.
// While training is unfinished the existing 75M pin remains active. Only a complete
// export from this exact run can replace it, after checksums and numerical parity.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createPinnedChannel, QA75M_STEP500 } from './pinned-channel.js';
import { loadModel, selfTest } from './model.js';

export const BOOKS_RELEASE = 'infinity-books100m-training-43698262111';
const BASE = 'https://github.com/Yuvii123-bot/InFiNi/releases/download/';
const API = 'https://api.github.com/repos/Yuvii123-bot/InFiNi/releases/tags/';
const NAMES = ['model.json', 'tokenizer.json', 'weights.0.bin', 'weights.1.bin'];
const TOKENIZER_HASH = '3c5373f704c5191c66819c1114c642efc0b54bbede23b337623ce8e3f93f1ce8';

/** Parse only a complete, expected export. Release metadata supplies exact asset sizes/hashes. */
export function completedManifest(release, metaBytes) {
  if (release.tag_name !== BOOKS_RELEASE || !Array.isArray(release.assets)) throw Error('wrong training release');
  const byName = new Map(release.assets.map(a => [a.name, a]));
  for (const n of [...NAMES, 'checkpoint-name.txt', 'books-evaluation.json', 'replay-evaluation.json', 'probes.json']) {
    if (!byName.has(n)) return null;
  }
  const files = NAMES.map(name => {
    const a = byName.get(name), digest = String(a.digest || '');
    if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !Number.isSafeInteger(a.size) || a.size <= 0 || a.size > 100_000_000) throw Error('invalid release asset');
    return { name, size: a.size, sha256: digest.slice(7) };
  });
  if (files[1].sha256 !== TOKENIZER_HASH) throw Error('unexpected tokenizer');
  if (!Buffer.isBuffer(metaBytes) || metaBytes.length !== files[0].size || crypto.createHash('sha256').update(metaBytes).digest('hex') !== files[0].sha256) throw Error('model metadata checksum mismatch');
  const m = JSON.parse(metaBytes.toString('utf8'));
  if (m.format !== 'infinity-llm/1' || m.dtype !== 'q8' || m.params !== 74727168 || m.step !== 781750 || m.tokens_seen !== 100064000 || m.dataset !== 'books100m-v1' ||
      !/^[a-f0-9]{64}$/.test(m.sha256) || JSON.stringify(m.weight_parts) !== JSON.stringify(['weights.0.bin', 'weights.1.bin'])) throw Error('export is not the completed 100M run');
  return { version: 'books100m-step781750', release: BOOKS_RELEASE, sha256: m.sha256, files };
}

function validateModel(where) {
  const model = loadModel(where.dir);
  if (!selfTest(model).ok) throw Error('completed model self-test failed');
  const tokenizer = JSON.parse(fs.readFileSync(path.join(where.dir, 'tokenizer.json'), 'utf8'));
  if (tokenizer.sha256 !== model.meta.tokenizer_sha) throw Error('completed model tokenizer mismatch');
}

export function createPendingPinnedChannel({ fetchImpl = (...a) => fetch(...a), log = () => {}, intervalMs = 300000, baseChannel = null, makeChannel = createPinnedChannel, validate = validateModel, ...opts } = {}) {
  const base = baseChannel || makeChannel({ ...opts, manifest: QA75M_STEP500, fetchImpl, log });
  let chosen = base, checking = null, lastCheck = 0, lastError = '';
  async function inspect() {
    lastCheck = Date.now();
    try {
      const res = await fetchImpl(API + BOOKS_RELEASE, { headers: { 'User-Agent': 'Infini-model-channel', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw Error(`training release HTTP ${res.status}`);
      const release = await res.json();
      if (!Number.isSafeInteger(release.id) || release.id < 1 || release.tag_name !== BOOKS_RELEASE) throw Error('invalid training release');
      // The embedded asset list may be truncated. Follow the documented paginated endpoint.
      release.assets = [];
      for (let page = 1; page <= 5; page++) {
        const ar = await fetchImpl(`https://api.github.com/repos/Yuvii123-bot/InFiNi/releases/${release.id}/assets?per_page=100&page=${page}`,
          { headers: { 'User-Agent': 'Infini-model-channel', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
        if (!ar.ok) throw Error(`training assets HTTP ${ar.status}`);
        const items = await ar.json();
        if (!Array.isArray(items)) throw Error('invalid training assets');
        release.assets.push(...items);
        if (items.length < 100) break;
        if (page === 5) throw Error('too many training assets');
      }
      const assetNames = new Set(release.assets.map(a => a.name));
      if (![...NAMES, 'checkpoint-name.txt', 'books-evaluation.json', 'replay-evaluation.json', 'probes.json'].every(n => assetNames.has(n))) return false;
      const mr = await fetchImpl(BASE + BOOKS_RELEASE + '/model.json', { signal: AbortSignal.timeout(15000) });
      if (!mr.ok) throw Error(`model metadata HTTP ${mr.status}`);
      const meta = Buffer.from(await mr.arrayBuffer());
      const manifest = completedManifest(release, meta);
      const next = makeChannel({ ...opts, manifest, fetchImpl, log });
      if (!await next.sync({ force: true })) throw Error('completed model download failed');
      validate(next.current());
      chosen = next; lastError = '';
      log({ ev: 'llm_authorized_training_activated', version: manifest.version });
      return true;
    } catch (e) {
      lastError = String(e.message || e).slice(0, 200);
      log({ ev: 'llm_authorized_training_pending', message: lastError });
      return false;
    }
  }
  async function sync() {
    const baseChanged = await base.sync();
    if (chosen !== base || Date.now() - lastCheck < intervalMs) return baseChanged;
    if (!checking) checking = inspect().finally(() => { checking = null; });
    return (await checking) || baseChanged;
  }
  return { enabled: true, pinned: true, sync, syncWithin: sync, current: () => chosen.current(), snapshot: () => null,
    info: () => ({ ...chosen.info(), pendingRelease: chosen === base ? BOOKS_RELEASE : undefined, pendingError: lastError || undefined }),
    stale: () => chosen === base ? (base.stale() || !lastCheck || Date.now() - lastCheck >= intervalMs) : chosen.stale(),
    everChecked: () => base.everChecked() };
}
