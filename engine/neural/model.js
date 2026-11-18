// INFINITY LLM — inference engine. Pure JavaScript, no dependency, no external model.
//
// Loads the weights that llm/export.py wrote and computes the same decoder-only Transformer forward pass as llm/model.py:
// token + position embedding → N × [RMSNorm → causal multi-head attention → residual; RMSNorm → GELU feed-forward → residual]
// → RMSNorm → projection onto the vocabulary. One token is processed at a time and the keys and values of earlier
// positions are kept (KV cache), so generating a token costs one pass, not a pass over the whole text.
// model.json carries logits computed by PyTorch; selfTest() checks that this file reproduces them.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FORMAT = 'infinity-llm/1';

function f16ToF32(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    out[i] = e === 0 ? s * 5.960464477539063e-8 * f : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
  }
  return out;
}

/** Read model.json + weights.bin from a directory. Throws with a precise message when anything is inconsistent. */
export function loadModel(dir, { verify = true } = {}) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
  if (meta.format !== FORMAT) throw new Error(`unsupported model format "${meta.format}" (expected ${FORMAT})`);
  const parts = meta.weight_parts || ['weights.bin'];
  if (!Array.isArray(parts) || !parts.length || parts.some((p) => typeof p !== 'string' || !/^weights(?:\.\d+)?\.bin$/.test(p))) throw new Error('invalid model weight parts');
  const raw = parts.length === 1 ? fs.readFileSync(path.join(dir, parts[0])) : Buffer.concat(parts.map((p) => fs.readFileSync(path.join(dir, p))));
  if (verify && meta.sha256 && crypto.createHash('sha256').update(raw).digest('hex') !== meta.sha256) throw new Error('weights.bin does not match the checksum in model.json');
  if (!['f16', 'f32', 'q8'].includes(meta.dtype)) throw new Error(`unsupported model dtype "${meta.dtype}"`);
  const per = meta.dtype === 'q8' ? 1 : meta.dtype === 'f16' ? 2 : 4;
  const total = meta.tensors.reduce((a, t) => a + t.size, 0);
  if (raw.length !== total * per) throw new Error(`weights.bin has ${raw.length} bytes, expected ${total * per}`);
  let all;
  if (meta.dtype === 'q8') {
    all = new Float32Array(total);
    const values = new Int8Array(raw.buffer, raw.byteOffset, raw.length);
    for (const t of meta.tensors) {
      if (!Number.isFinite(t.scale) || t.scale <= 0 || !Number.isInteger(t.offset) || t.offset < 0 || !Number.isInteger(t.size) || t.size < 0 || t.offset + t.size > total) throw new Error('invalid quantized tensor');
      for (let i = t.offset, end = t.offset + t.size; i < end; i++) all[i] = values[i] * t.scale;
    }
  } else {
    const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);
    all = meta.dtype === 'f16' ? f16ToF32(new Uint16Array(ab)) : new Float32Array(ab);
  }
  const W = Object.create(null);
  for (const t of meta.tensors) W[t.name] = all.subarray(t.offset, t.offset + t.size);
  const c = meta.config;
  const need = ['tok_emb.weight', 'pos_emb.weight', 'norm_f.weight'];
  for (let l = 0; l < c.n_layer; l++) for (const n of ['norm1.weight', 'attn.qkv.weight', 'attn.proj.weight', 'norm2.weight', 'mlp.fc.weight', 'mlp.proj.weight']) need.push(`blocks.${l}.${n}`);
  for (const n of need) if (!W[n]) throw new Error(`weights are missing tensor ${n}`);
  if (!c.tie_weights && !W['head.weight']) throw new Error('weights are missing tensor head.weight');
  return { dir, meta, config: c, W, params: meta.params };
}

// y[r] = sum_c W[r*cols + c] * x[c]
function matvec(W, x, y, rows, cols) {
  const c4 = cols - (cols % 4);
  for (let r = 0, o = 0; r < rows; r++, o += cols) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c = 0;
    for (; c < c4; c += 4) { s0 += W[o + c] * x[c]; s1 += W[o + c + 1] * x[c + 1]; s2 += W[o + c + 2] * x[c + 2]; s3 += W[o + c + 3] * x[c + 3]; }
    for (; c < cols; c++) s0 += W[o + c] * x[c];
    y[r] = s0 + s1 + s2 + s3;
  }
}
function norm(x, w, out, d, kind) {
  if (kind === 'layernorm') {
    let m = 0; for (let i = 0; i < d; i++) m += x[i]; m /= d;
    let v = 0; for (let i = 0; i < d; i++) { const z = x[i] - m; v += z * z; }
    const r = 1 / Math.sqrt(v / d + 1e-5);
    for (let i = 0; i < d; i++) out[i] = (x[i] - m) * r * w[i];
    return;
  }
  let ss = 0; for (let i = 0; i < d; i++) ss += x[i] * x[i];
  const r = 1 / Math.sqrt(ss / d + 1e-5);
  for (let i = 0; i < d; i++) out[i] = x[i] * r * w[i];
}
const GELU_C = Math.sqrt(2 / Math.PI);

/** One conversation's worth of state: the KV cache and the position. feed(token) returns the logits for the next token. */
export function createSession(model) {
  const c = model.config, W = model.W, d = c.d_model, L = c.n_layer, H = c.n_head, dh = d / H, ctx = c.context, V = c.vocab_size;
  const hidden = Math.round(c.mlp_ratio * d), scale = 1 / Math.sqrt(dh);
  const K = Array.from({ length: L }, () => new Float32Array(ctx * d)), Vv = Array.from({ length: L }, () => new Float32Array(ctx * d));
  const x = new Float32Array(d), h = new Float32Array(d), qkv = new Float32Array(3 * d), att = new Float32Array(d), tmp = new Float32Array(d), mid = new Float32Array(hidden), sc = new Float32Array(ctx), logits = new Float32Array(V);
  const tok = W['tok_emb.weight'], posE = W['pos_emb.weight'], head = c.tie_weights ? tok : W['head.weight'];
  const layers = Array.from({ length: L }, (_, l) => ({ n1: W[`blocks.${l}.norm1.weight`], qkv: W[`blocks.${l}.attn.qkv.weight`], proj: W[`blocks.${l}.attn.proj.weight`], n2: W[`blocks.${l}.norm2.weight`], fc: W[`blocks.${l}.mlp.fc.weight`], mp: W[`blocks.${l}.mlp.proj.weight`] }));
  let pos = 0;

  function feed(token, wantLogits = true) {
    if (pos >= ctx) throw new Error(`context window of ${ctx} tokens is full`);
    if (!(token >= 0 && token < V)) throw new Error(`token id ${token} is outside the vocabulary`);
    const to = token * d, po = pos * d;
    for (let i = 0; i < d; i++) x[i] = tok[to + i] + posE[po + i];
    for (let l = 0; l < L; l++) {
      const ly = layers[l], Kl = K[l], Vl = Vv[l];
      norm(x, ly.n1, h, d, c.norm);
      matvec(ly.qkv, h, qkv, 3 * d, d);
      for (let i = 0; i < d; i++) { Kl[po + i] = qkv[d + i]; Vl[po + i] = qkv[2 * d + i]; }
      for (let hd = 0; hd < H; hd++) {
        const ho = hd * dh;
        let mx = -Infinity;
        for (let t = 0; t <= pos; t++) { let s = 0; const ko = t * d + ho; for (let i = 0; i < dh; i++) s += qkv[ho + i] * Kl[ko + i]; s *= scale; sc[t] = s; if (s > mx) mx = s; }
        let z = 0;
        for (let t = 0; t <= pos; t++) { const e = Math.exp(sc[t] - mx); sc[t] = e; z += e; }
        for (let i = 0; i < dh; i++) att[ho + i] = 0;
        for (let t = 0; t <= pos; t++) { const p = sc[t] / z, vo = t * d + ho; for (let i = 0; i < dh; i++) att[ho + i] += p * Vl[vo + i]; }
      }
      matvec(ly.proj, att, tmp, d, d);
      for (let i = 0; i < d; i++) x[i] += tmp[i];
      norm(x, ly.n2, h, d, c.norm);
      matvec(ly.fc, h, mid, hidden, d);
      for (let i = 0; i < hidden; i++) { const v = mid[i]; mid[i] = 0.5 * v * (1 + Math.tanh(GELU_C * (v + 0.044715 * v * v * v))); }
      matvec(ly.mp, mid, tmp, d, hidden);
      for (let i = 0; i < d; i++) x[i] += tmp[i];
    }
    pos++;
    if (!wantLogits) return null;
    norm(x, W['norm_f.weight'], h, d, c.norm);
    matvec(head, h, logits, V, d);
    return logits;
  }
  return {
    feed, logits,
    get pos() { return pos; },
    /** Go back to an earlier position (the cache beyond it is simply overwritten). */
    rewind(p) { if (!(p >= 0 && p <= pos)) throw new Error('cannot rewind forward'); pos = p; },
    reset() { pos = 0; },
    room: () => ctx - pos,
    context: ctx,
  };
}

export function logSoftmaxAt(logits, id) {
  let mx = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > mx) mx = logits[i];
  let z = 0;
  for (let i = 0; i < logits.length; i++) z += Math.exp(logits[i] - mx);
  return logits[id] - mx - Math.log(z);
}

/** Small seeded generator (mulberry32) so that evaluation runs are repeatable. */
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Pick the next token from logits. temperature 0 = most likely token. Repetition penalty divides the score of tokens
 * seen recently; `banned` tokens can never be chosen.
 */
export function sample(logits, { temperature = 0.7, topK = 40, topP = 0.95, repetitionPenalty = 1.0, recent = null, banned = null, random = Math.random } = {}) {
  const V = logits.length;
  const l = Float32Array.from(logits);
  if (banned) for (const b of banned) l[b] = -Infinity;
  if (recent && repetitionPenalty !== 1) for (const id of new Set(recent)) if (l[id] > -Infinity) l[id] = l[id] > 0 ? l[id] / repetitionPenalty : l[id] * repetitionPenalty;
  if (!(temperature > 0)) { let b = 0; for (let i = 1; i < V; i++) if (l[i] > l[b]) b = i; return b; }
  let idx = Array.from({ length: V }, (_, i) => i).filter((i) => l[i] > -Infinity);
  idx.sort((a, b) => l[b] - l[a]);
  if (topK > 0 && idx.length > topK) idx = idx.slice(0, topK);
  const mx = l[idx[0]];
  let ps = idx.map((i) => Math.exp((l[i] - mx) / temperature));
  let z = ps.reduce((a, b) => a + b, 0);
  if (topP > 0 && topP < 1) { let acc = 0, n = 0; while (n < ps.length && acc < topP * z) acc += ps[n++]; ps = ps.slice(0, Math.max(1, n)); idx = idx.slice(0, ps.length); z = ps.reduce((a, b) => a + b, 0); }
  let r = random() * z;
  for (let i = 0; i < ps.length; i++) { r -= ps[i]; if (r <= 0) return idx[i]; }
  return idx[idx.length - 1];
}

/** Compare this engine with the logits PyTorch wrote into model.json. Returns {ok, maxDiff, argmaxAgree}. */
export function selfTest(model) {
  const ref = model.meta.reference;
  if (!ref || !Array.isArray(ref.tokens)) return { ok: false, reason: 'model.json has no reference logits' };
  const s = createSession(model);
  let agree = 0, last = null;
  ref.tokens.forEach((t, i) => { last = s.feed(t); let b = 0; for (let j = 1; j < last.length; j++) if (last[j] > last[b]) b = j; if (b === ref.argmax[i]) agree++; });
  let maxDiff = 0;
  ref.last_logits_head.forEach((v, i) => { maxDiff = Math.max(maxDiff, Math.abs(v - last[i])); });
  const tol = model.meta.dtype === 'f16' ? 2e-2 : 2e-3;
  return { ok: maxDiff < tol && agree >= ref.tokens.length - 1, maxDiff: Number(maxDiff.toFixed(6)), argmaxAgree: agree, positions: ref.tokens.length, tolerance: tol };
}

/** Average next-token loss (nats per token) of a token sequence, in windows of the context length. */
export function sequenceLoss(model, ids, { maxTokens = 4096 } = {}) {
  const s = createSession(model), ctx = model.config.context;
  let nll = 0, n = 0;
  for (let start = 0; start + 1 < ids.length && n < maxTokens; start += ctx) {
    s.reset();
    const end = Math.min(ids.length - 1, start + ctx);
    for (let i = start; i < end && n < maxTokens; i++) { const lg = s.feed(ids[i]); nll -= logSoftmaxAt(lg, ids[i + 1]); n++; }
  }
  return { loss: n ? nll / n : NaN, tokens: n };
}
