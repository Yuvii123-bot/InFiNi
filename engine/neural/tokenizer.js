// INFINITY LLM — tokenizer: byte-level BPE, trained from scratch on the project's own corpus.
//
// Ids 0–7 are control tokens, 8–263 are the 256 byte values, everything above is a learned merge of two earlier ids.
// encode() never produces a control token: text typed by a user or scraped from a page is bytes and nothing else, so a
// page that contains the characters "<|assistant|>" cannot inject a turn. Control tokens are added by id, by code.

import crypto from 'node:crypto';

export const SPECIALS = ['<|end|>', '<|user|>', '<|assistant|>', '<|search|>', '<|evidence|>', '<|doc|>', '<|pad|>', '<|reserved|>'];
export const T = { END: 0, USER: 1, ASSISTANT: 2, SEARCH: 3, EVIDENCE: 4, DOC: 5, PAD: 6, RESERVED: 7 };
const BYTE0 = SPECIALS.length;            // id of byte 0x00
const FIRST_MERGE = BYTE0 + 256;
const PIECE = / ?\p{L}+| ?\p{N}{1,3}| ?[^\s\p{L}\p{N}]+|\s+/gu;
const enc = new TextEncoder();

/** The one normal form every text takes before tokenizing (training and inference alike). */
export function normalizeText(s) {
  return String(s == null ? '' : s).normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
function pieces(text) {
  const out = text.match(PIECE) || [];
  for (let i = 0; i < out.length; i++) if (out[i].length > 24 && /^\s+$/.test(out[i])) out[i] = out[i].slice(0, 24);      // very long runs of spaces carry no information
  return out;
}
const key = (a, b) => a * 65536 + b;

/**
 * Learn merges from texts. `texts` is any iterable of strings. Deterministic: the same corpus gives the same vocabulary.
 * @returns {{merges: number[][], stats: object}}
 */
export function trainBPE(texts, vocabSize, { minCount = 2, log = null } = {}) {
  if (!(vocabSize > FIRST_MERGE && vocabSize <= 65536)) throw new Error(`vocabSize must be between ${FIRST_MERGE + 1} and 65536`);
  const freq = new Map();
  let docs = 0, bytes = 0;
  for (const t of texts) {
    const s = normalizeText(t); docs++; bytes += s.length;
    for (const p of pieces(s)) freq.set(p, (freq.get(p) || 0) + 1);
  }
  const words = [];
  for (const [w, n] of freq) { if (n < minCount && freq.size > 20000) continue; const b = enc.encode(w); if (b.length < 2) continue; words.push({ ids: Array.from(b, (x) => x + BYTE0), n }); }
  const count = new Map(), where = new Map();
  const add = (wi, sign) => {
    const { ids, n } = words[wi];
    for (let i = 0; i + 1 < ids.length; i++) {
      const k = key(ids[i], ids[i + 1]);
      const v = (count.get(k) || 0) + sign * n;
      if (v <= 0) count.delete(k); else count.set(k, v);
      if (sign > 0) { let s = where.get(k); if (!s) where.set(k, (s = new Set())); s.add(wi); }
    }
  };
  for (let i = 0; i < words.length; i++) add(i, 1);
  const merges = [];
  while (FIRST_MERGE + merges.length < vocabSize) {
    let best = -1, bestN = 0;
    for (const [k, n] of count) if (n > bestN || (n === bestN && k < best)) { best = k; bestN = n; }
    if (bestN < 2) break;
    const a = Math.floor(best / 65536), b = best % 65536, id = FIRST_MERGE + merges.length;
    merges.push([a, b]);
    const touched = where.get(best) || new Set();
    where.delete(best);
    for (const wi of touched) {
      const w = words[wi];
      let has = false;
      for (let i = 0; i + 1 < w.ids.length; i++) if (w.ids[i] === a && w.ids[i + 1] === b) { has = true; break; }
      if (!has) continue;
      add(wi, -1);
      const out = [];
      for (let i = 0; i < w.ids.length; i++) { if (i + 1 < w.ids.length && w.ids[i] === a && w.ids[i + 1] === b) { out.push(id); i++; } else out.push(w.ids[i]); }
      w.ids = out;
      add(wi, 1);
    }
    if (log && merges.length % 500 === 0) log(`${merges.length} merges`);
  }
  return { merges, stats: { docs, chars: bytes, distinctPieces: freq.size, merges: merges.length } };
}

export function createTokenizer(spec) {
  const merges = spec.merges || [];
  const vocabSize = FIRST_MERGE + merges.length;
  const rank = new Map();
  merges.forEach(([a, b], i) => rank.set(key(a, b), i));
  // bytes of every id (control tokens decode to nothing)
  const bytesOf = new Array(vocabSize);
  for (let i = 0; i < BYTE0; i++) bytesOf[i] = new Uint8Array(0);
  for (let i = 0; i < 256; i++) bytesOf[BYTE0 + i] = Uint8Array.of(i);
  merges.forEach(([a, b], i) => { const x = bytesOf[a], y = bytesOf[b]; const z = new Uint8Array(x.length + y.length); z.set(x); z.set(y, x.length); bytesOf[FIRST_MERGE + i] = z; });
  const cache = new Map();

  function encodePiece(p) {
    const hit = cache.get(p);
    if (hit) return hit;
    let ids = Array.from(enc.encode(p), (x) => x + BYTE0);
    while (ids.length > 1) {
      let best = Infinity;
      for (let i = 0; i + 1 < ids.length; i++) { const r = rank.get(key(ids[i], ids[i + 1])); if (r !== undefined && r < best) best = r; }
      if (best === Infinity) break;
      const [a, b] = merges[best], id = FIRST_MERGE + best, out = [];
      for (let i = 0; i < ids.length; i++) { if (i + 1 < ids.length && ids[i] === a && ids[i + 1] === b) { out.push(id); i++; } else out.push(ids[i]); }
      ids = out;
    }
    if (cache.size > 200000) cache.clear();
    cache.set(p, ids);
    return ids;
  }
  /** Text → token ids. Never emits a control token. */
  function encode(text) {
    const out = [];
    for (const p of pieces(normalizeText(text))) { const ids = encodePiece(p); for (let i = 0; i < ids.length; i++) out.push(ids[i]); }
    return out;
  }
  function toBytes(ids) {
    let n = 0;
    for (const id of ids) n += (bytesOf[id] || bytesOf[0]).length;
    const buf = new Uint8Array(n);
    let o = 0;
    for (const id of ids) { const b = bytesOf[id] || bytesOf[0]; buf.set(b, o); o += b.length; }
    return buf;
  }
  /** Token ids → text. Control tokens are dropped unless showSpecial is set. */
  function decode(ids, { showSpecial = false } = {}) {
    if (!showSpecial) return new TextDecoder('utf-8').decode(toBytes(ids));
    let s = '', run = [];
    const flush = () => { if (run.length) { s += new TextDecoder('utf-8').decode(toBytes(run)); run = []; } };
    for (const id of ids) { if (id < BYTE0) { flush(); s += SPECIALS[id]; } else run.push(id); }
    flush();
    return s;
  }
  /** Incremental decoder for streaming: a multi-byte character split across tokens is held back until it is complete. */
  function streamDecoder() {
    const dec = new TextDecoder('utf-8');
    return { push: (id) => dec.decode(bytesOf[id] || bytesOf[0], { stream: true }), end: () => dec.decode() };
  }
  return { vocabSize, encode, decode, streamDecoder, bytesOf, merges, sha: spec.sha256 || tokenizerSha(merges), isSpecial: (id) => id < BYTE0, specials: T };
}

export function tokenizerSha(merges) { return crypto.createHash('sha256').update(JSON.stringify(merges)).digest('hex'); }
export function tokenizerSpec(merges, extra = {}) { return { format: 'infinity-bpe/1', specials: SPECIALS, vocab_size: FIRST_MERGE + merges.length, sha256: tokenizerSha(merges), ...extra, merges }; }
