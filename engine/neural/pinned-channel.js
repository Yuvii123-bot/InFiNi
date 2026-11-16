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

export const QA75M_STEP500 = {
  version: 'qa75m-step500',
  release: 'infinity-qa75m-43662976189',
  sha256: '15ca8c07f8b94fba0c4af2a6e5012d7eb888b85695a06defdafdb577213be0b2',
  files: [
    { name: 'model.json', size: 11593, sha256: 'be9ab915804f99373bab34a1a901de514b8a4ff22f6d89c1749211a455621629' },
    { name: 'tokenizer.json', size: 93560, sha256: '3c5373f704c5191c66819c1114c642efc0b54bbede23b337623ce8e3f93f1ce8' },
    { name: 'weights.0.bin', size: 40000000, sha256: '94a57d8c40c1f069fd4ddc713200f7b0f90b50c5e889dfde539d4871eecfaf83' },
    { name: 'weights.1.bin', size: 34727168, sha256: 'fadf93872478cbe27ab1efb0c34e871db3a4197800b28668677adb171e5a55f9' },
  ],
};

// Explicit snapshot of the still-running books training cycle. The release also retains its full checkpoint.
export const BOOKS75M_STEP21299 = {
  version: 'books75m-step21299',
  release: 'infinity-qa75m-43714520168',
  sha256: 'f473bc1db9643db9d113d28f9ebc99265132d8deb75086b15a461678576ac3f3',
  files: [
    { name: 'model.json', size: 11610, sha256: 'd8208f9f9ccd71dd821b5c70623fd847d8dbe1f3db872fa86fc4761c41c6b653' },
    { name: 'tokenizer.json', size: 93560, sha256: '3c5373f704c5191c66819c1114c642efc0b54bbede23b337623ce8e3f93f1ce8' },
    { name: 'weights.0.bin', size: 40000000, sha256: 'a84bd29b825c64ac5b8d1a6890c17a452a5cdf473682ab0e109cfb69af2cdb67' },
    { name: 'weights.1.bin', size: 34727168, sha256: '77e6482f04871a58e2cbcdf44ac3b3b7281aeab62d1f44ddc1b3d4882ef7dc43' },
  ],
};

// User-selected snapshot: 11,557,248 additional sampled positions into the 100M cycle.
export const BOOKS75M_STEP90791 = {
  version: 'books75m-step90791',
  release: 'infinity-qa75m-43774917836',
  sha256: '7b3f7280eec984803dd14f59fc89997f4f03dfacbffa46c1eba2a29c7c21450e',
  files: [
    { name: 'model.json', size: 11603, sha256: '750d02ecff7d9274fbe2029f30af1589639b9294e784457d68a15a178c38f42f' },
    { name: 'tokenizer.json', size: 93560, sha256: '3c5373f704c5191c66819c1114c642efc0b54bbede23b337623ce8e3f93f1ce8' },
    { name: 'weights.0.bin', size: 40000000, sha256: 'f0d77241f3146a82bbb73853411e48c10932488eada61139877d317f5e14a75a' },
    { name: 'weights.1.bin', size: 34727168, sha256: '426f7ead80713e81fdfc151c8b58912038a657fbe31c892ac7afb7e405575d17' },
  ],
};

// Fixed snapshot from the continuing books cycle; previous snapshots remain selectable for rollback.
export const BOOKS75M_STEP105000 = {
  version: 'books75m-step105000',
  release: 'infinity-qa75m-43784785804',
  sha256: '1d3f7882383d0352b44b57413e0c64452d948de50e896ca7f8a287664461d42c',
  files: [
    { name: 'model.json', size: 11593, sha256: 'f7aa673f44c8031eaf43981b36a7f8d2473545671c31f30fa60fd40aacbe4c2a' },
    { name: 'tokenizer.json', size: 93560, sha256: '3c5373f704c5191c66819c1114c642efc0b54bbede23b337623ce8e3f93f1ce8' },
    { name: 'weights.0.bin', size: 40000000, sha256: '28b786666f8dd2fe660d7f0abf6d44d257898372b58a53bcb3dd36fa90cb8ab2' },
    { name: 'weights.1.bin', size: 34727168, sha256: '999fe7e34587e917d6f248035292eaf19726cf729fa6993cfb86ed087f6d0316' },
  ],
};

// Completed stage 04 checkpoint, exported independently while the original training continues.
export const BOOKS75M_STEP111248 = {
  version: 'books75m-step111248',
  release: 'infinity-qa75m-43788993113',
  sha256: '1c88b8328ffa448ba3289f8dee7fc87ab96b30a50171ee2ef15488f92e1ec22e',
  files: [
    { name: 'model.json', size: 11587, sha256: 'f72882c2a960ba9ea138e6c8845bacca4295e1d349b80c7fb250051952decf7b' },
    { name: 'tokenizer.json', size: 93560, sha256: '3c5373f704c5191c66819c1114c642efc0b54bbede23b337623ce8e3f93f1ce8' },
    { name: 'weights.0.bin', size: 40000000, sha256: 'b50fe8bff9d96f35fe63540d89a67d63390ff36b84770de8bf13e9460efa2916' },
    { name: 'weights.1.bin', size: 34727168, sha256: '41a5c4492b3f629c897aedeb16787206aaea86e9c1a14b4b9847fc549f6ca2fc' },
  ],
};

// Stage 07 snapshot independently exported and checked while training continues.
export const BOOKS75M_STEP224813 = {
  version: 'books75m-step224813',
  release: 'infinity-qa75m-43850778510',
  sha256: 'c342b0a62be06376ab0cf35d5ca7b5bb65b62fb20c1206fdfbb1be3a94d669d0',
  files: [
    { name: 'model.json', size: 11600, sha256: '3152a5cad8dc9834f3733bfc7f5d0152c5ee13dabfded5fe1ffd42049e2ff926' },
    { name: 'tokenizer.json', size: 93560, sha256: '3c5373f704c5191c66819c1114c642efc0b54bbede23b337623ce8e3f93f1ce8' },
    { name: 'weights.0.bin', size: 40000000, sha256: '8af2d5c7d8026cc3c00daa4c66e3a2669e72db97e2b44f5f7206838d6b7998a1' },
    { name: 'weights.1.bin', size: 34727168, sha256: '81a41233c29db3670d90fcfaf4fd79e63d9b9ea5e3fbc61915e1aee9d16a2221' },
  ],
};

/** Explicit selections only: an invalid version must not silently select another model. */
export function pinnedManifest(version = '') {
  if (!version || version === 'books75m-step224813') return BOOKS75M_STEP224813;
  if (version === 'books75m-step111248') return BOOKS75M_STEP111248;
  if (version === 'books75m-step105000') return BOOKS75M_STEP105000;
  if (version === 'books75m-step90791') return BOOKS75M_STEP90791;
  if (version === 'books75m-step21299') return BOOKS75M_STEP21299;
  if (version === 'qa75m-step500') return QA75M_STEP500;
  if (version === 'xl-qa-step2110') return XL_STEP2110;
  if (version === 'xl-step110') return XL_STEP110;
  throw new Error(`unknown pinned model version: ${version}`);
}

export function createPinnedChannel({ manifest = BOOKS75M_STEP224813, dir = path.join(os.tmpdir(), 'infini-pinned-models'), fetchImpl = (...a) => fetch(...a), timeoutMs = 180000, log = () => {} } = {}) {
  const dest = path.join(dir, manifest.version);
  let active = null, inflight = null, lastCheck = 0, lastOk = 0, error = '', checks = 0;
  const validName = (name) => /^(model\.json|tokenizer\.json|weights\.\d+\.bin)$/.test(name);
  // Release tags are deliberately constrained to this repository; manifest input cannot pick arbitrary hosts.
  const validFile = (f) => validName(f.name) && (manifest.release ? /^infinity-(?:qa-more|qa75m|books100m-training)-\d+$/.test(manifest.release) : /^[A-Za-z0-9_-]+$/.test(f.id)) && /^[a-f0-9]{64}$/.test(f.sha256) && Number.isSafeInteger(f.size) && f.size >= 0 && f.size <= 100_000_000;
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
