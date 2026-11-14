// A pinned, checksum-verified model export. Separate from the worker's mutable channel, so later worker
// publications cannot silently replace the model selected by the operator. Set INFINI_PINNED_MODEL=0 to roll back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const XL_STEP110 = {
  version: 'xl-step110',
  sha256: '4651ddbb358e13043d176fb2c831ed70f384cd0b88708d61f906bac935a23666',
  files: [
    { name: 'model.json', id: '1Ncy43yTonMQBzJtQcqEoGDGNDzyoCOlc', size: 17253, sha256: '8ac8bd16cc036c435b5ca28823e44d4e408d45e4f9820c8b7a2752065664a7cf' },
    { name: 'tokenizer.json', id: '1WHfsSSFRSM4YHr8j7YA8KcHkXCDgW3Nn', size: 93560, sha256: '3c5373f704c5191c66819c1114c642efc0b54bbede23b337623ce8e3f93f1ce8' },
    { name: 'weights.0.bin', id: '1Qy1NDqQfI7Wzjqhtzrk8ulg-GzAvZFJ9', size: 66000000, sha256: '599e5e9cc48980ab4d4e0ab74b9af11f4db933a3903c7c074cb0f47b5a69c9cd' },
    { name: 'weights.1.bin', id: '1de7ZZ3sVyqd7g3ARDurLCpoT_wGiLf6p', size: 51203712, sha256: '646a24402e13e5ae3e6e32add453e9e4bedcfecf3e9ac73ecf67d8f61c3a9dd7' },
  ],
};

export const XL_STEP2110 = {
  version: 'xl-qa-step2110',
  release: 'infinity-qa-more-43593739051',
  sha256: 'c2a221ead1bc3acc741e1e575e1faacc7b236ed4ca101a4045157a71bffb115b',
  files: [
    { name: 'model.json', size: 17253, sha256: 'ea1bab66308f0cb70b34e1fd21c0f308140f855f730d6b2730fdd65f10bbb638' },
    { name: 'tokenizer.json', size: 93560, sha256: '3c5373f704c5191c66819c1114c642efc0b54bbede23b337623ce8e3f93f1ce8' },
    { name: 'weights.0.bin', size: 66000000, sha256: 'b4e7b5209bc77f2c4107e7070b47a2ac1e126846f5c9b3c29fd1f01ae5db8d87' },
    { name: 'weights.1.bin', size: 51203712, sha256: '74fa6cb978071d70f364cf0bb5e3c1b819f818550ac5772cd990e4a8188e71b1' },
  ],
};

export function createPinnedChannel({ manifest = XL_STEP2110, dir = path.join(os.tmpdir(), 'infini-pinned-models'), fetchImpl = (...a) => fetch(...a), timeoutMs = 180000, log = () => {} } = {}) {
  const dest = path.join(dir, manifest.version);
  let active = null, inflight = null, lastCheck = 0, lastOk = 0, error = '', checks = 0;
  const validName = (name) => /^(model\.json|tokenizer\.json|weights\.\d+\.bin)$/.test(name);
  // Release tags are deliberately constrained to this repository; manifest input cannot pick arbitrary hosts.
  const validFile = (f) => validName(f.name) && (manifest.release ? /^infinity-qa-more-\d+$/.test(manifest.release) : /^[A-Za-z0-9_-]+$/.test(f.id)) && /^[a-f0-9]{64}$/.test(f.sha256) && Number.isSafeInteger(f.size) && f.size >= 0 && f.size <= 100_000_000;
  function verifyFiles(where) {
    for (const f of manifest.files) {
      if (!validFile(f)) throw new Error('invalid pinned manifest');
      const file = path.join(where, f.name);
      if (fs.statSync(file).size !== f.size || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== f.sha256) throw new Error(`${f.name}: checksum or size mismatch`);
    }
    const m = JSON.parse(fs.readFileSync(path.join(where, 'model.json'), 'utf8'));
    if (m.sha256 !== manifest.sha256 || m.dtype !== 'q8' || !Array.isArray(m.weight_parts) || m.weight_parts.some((name) => !manifest.files.some((f) => f.name === name))) throw new Error('model metadata does not match the pinned export');
  }
  async function download(f, where) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), timeoutMs);
    const filename = path.join(where, f.name);
    try {
      const url = manifest.release
        ? `https://github.com/Yuvii123-bot/InFiNi/releases/download/${manifest.release}/${f.name}`
        : `https://drive.usercontent.google.com/download?id=${encodeURIComponent(f.id)}&export=download&confirm=t`;
      const res = await fetchImpl(url, { signal: ac.signal, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`${f.name}: HTTP ${res.status}`);
      const hash = crypto.createHash('sha256'); let size = 0;
      const out = fs.openSync(filename, 'w');
      try {
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > f.size) throw new Error(`${f.name}: larger than expected`);
          hash.update(chunk); fs.writeFileSync(out, chunk);
        }
      } finally { fs.closeSync(out); }
      if (size !== f.size || hash.digest('hex') !== f.sha256) throw new Error(`${f.name}: checksum or size mismatch`);
    } finally { clearTimeout(timeout); }
  }
  async function check() {
    checks++; lastCheck = Date.now();
    try {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = fs.mkdtempSync(path.join(dir, 'incoming-'));
        try {
          for (const f of manifest.files) {
            if (!validFile(f)) throw new Error('invalid pinned manifest');
            await download(f, tmp);
          }
          verifyFiles(tmp);
          try { fs.renameSync(tmp, dest); } catch (e) { if (!fs.existsSync(dest)) throw e; }
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      }
      verifyFiles(dest);
      active = { dir: dest, id: manifest.version, source: 'pinned', registryMtime: 0 };
      lastOk = Date.now(); error = '';
      log({ ev: 'llm_pinned_ready', version: manifest.version });
      return true;
    } catch (e) {
      error = String(e.message || e).slice(0, 200);
      log({ ev: 'llm_pinned_failed', message: error });
      return false;
    }
  }
  function sync({ force = false } = {}) {
    if (active) return Promise.resolve(false);
    if (!force && !inflight && lastCheck && Date.now() - lastCheck < 10000) return Promise.resolve(false);
    if (!inflight) inflight = check().finally(() => { inflight = null; });
    return inflight;
  }
  return { enabled: true, pinned: true, sync, syncWithin: () => sync(), current: () => active, snapshot: () => null,
    info: () => ({ enabled: true, version: active?.id || null, checks, lastCheck: lastCheck ? new Date(lastCheck).toISOString() : null, lastOk: lastOk ? new Date(lastOk).toISOString() : null, error: error || undefined }),
    stale: () => !active && (!!inflight || !lastCheck || Date.now() - lastCheck >= 10000), everChecked: () => checks > 0 };
}
