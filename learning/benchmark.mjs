// INFINITY LLM — learning: the fixed benchmark and the memorization probe.
//
// The benchmark (learning/benchmark/v1.json) is the same for every model version, so scores of different versions can
// be compared directly. It is never trained on: the dataset builder drops any sentence that appears in it.
//   language / knowledge / reasoning   pairs of sentences that differ in one point; the model is right when it finds the
//                                      acceptable sentence more probable than the unacceptable one (chance = 0.5)
//   conversation                       a message with a fitting and an unfitting reply; right when the fitting reply
//                                      is more probable per token (chance = 0.5)
//   passages                           running text written for the benchmark; next-token loss (nats per token)
// The memorization probe gives the model the beginning of passages it was trained on and of passages it has never seen,
// and measures how often it continues them word for word and how much lower its loss is on the trained ones.
// Everything runs in the JavaScript engine that serves the chat; nothing is estimated.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSession, logSoftmaxAt } from '../engine/neural/model.js';
import { T } from '../engine/neural/tokenizer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BENCHMARK_FILE = path.join(HERE, 'benchmark', 'v1.json');
export const PAIR_CATEGORIES = ['language', 'knowledge', 'reasoning'];

/** Load the benchmark and check that it is the file that was committed (a changed benchmark would make scores incomparable). */
export function loadBenchmark(file = BENCHMARK_FILE) {
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { sha256, ...body } = b;
  const actual = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if (sha256 !== actual) throw new Error(`the benchmark file was changed (checksum ${actual.slice(0, 12)} does not match the recorded ${String(sha256).slice(0, 12)})`);
  return b;
}
export const normSentence = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Every sentence of the benchmark, normalised: the dataset builder leaves these out of the training text. */
export function benchmarkSentences(bench = loadBenchmark()) {
  const out = new Set();
  for (const c of PAIR_CATEGORIES) for (const pair of bench[c]) for (const s of pair) out.add(normSentence(s));
  for (const [, a, b] of bench.conversation) { out.add(normSentence(a)); out.add(normSentence(b)); }
  for (const p of bench.passages) for (const s of p.split(/(?<=[.!?])\s+/)) out.add(normSentence(s));
  out.delete('');
  return out;
}
export const isBenchmarkSentence = (set, s) => set.has(normSentence(s));

/** Sum of log-probabilities of ids[from..] given everything before (teacher forcing). */
function logProb(session, ids, from) {
  session.reset();
  let lp = 0, n = 0;
  const end = Math.min(ids.length, session.context);
  for (let i = 0; i < end - 1; i++) { const lg = session.feed(ids[i]); if (i + 1 >= from) { lp += logSoftmaxAt(lg, ids[i + 1]); n++; } }
  return { lp, n };
}

export function runBenchmark(model, tok, bench = loadBenchmark()) {
  const t0 = Date.now();
  const s = createSession(model);
  const categories = {};
  let items = 0;
  for (const c of PAIR_CATEGORIES) {
    let right = 0;
    for (const [good, bad] of bench[c]) {
      const a = logProb(s, [T.DOC, ...tok.encode(good)], 1), b = logProb(s, [T.DOC, ...tok.encode(bad)], 1);
      if (a.lp > b.lp) right++;
    }
    categories[c] = { n: bench[c].length, right, accuracy: +(right / bench[c].length).toFixed(4) };
    items += bench[c].length;
  }
  let right = 0;
  for (const [user, good, bad] of bench.conversation) {
    const prefix = [T.USER, ...tok.encode(user), T.ASSISTANT];
    const a = logProb(s, [...prefix, ...tok.encode(good), T.END], prefix.length), b = logProb(s, [...prefix, ...tok.encode(bad), T.END], prefix.length);
    if (a.lp / a.n > b.lp / b.n) right++;
  }
  categories.conversation = { n: bench.conversation.length, right, accuracy: +(right / bench.conversation.length).toFixed(4) };
  items += bench.conversation.length;
  let nll = 0, n = 0;
  for (const p of bench.passages) { const r = logProb(s, [T.DOC, ...tok.encode(p)], 1); nll -= r.lp; n += r.n; }
  const names = Object.keys(categories);
  return {
    id: bench.id, sha256: bench.sha256, items, chance: 0.5,
    score: +(names.reduce((a, c) => a + categories[c].accuracy, 0) / names.length).toFixed(4),       // mean of the four accuracies
    categories, passages: { n: bench.passages.length, tokens: n, loss: +(nll / n).toFixed(4), perplexity: +Math.exp(Math.min(20, nll / n)).toFixed(2) },
    seconds: +((Date.now() - t0) / 1000).toFixed(1),
  };
}

/**
 * @param trained, unseen  arrays of token-id sequences exactly as they appear in training ([DOC, text…, END])
 * @returns per set: loss on the continuation, share continued word for word; and the differences between the two sets
 */
export function memorizationProbe(model, tok, { trained = [], unseen = [], prompt = 24, span = 24, verbatimAt = 16, limit = 48 } = {}) {
  const t0 = Date.now();
  const s = createSession(model);
  const measure = (seqs) => {
    let nll = 0, n = 0, verb = 0, matchSum = 0, used = 0;
    for (const ids of seqs) {
      if (used >= limit) break;
      if (ids.length < 1 + prompt + span) continue;
      used++;
      s.reset();
      let lg = null;
      for (let i = 0; i <= prompt; i++) lg = s.feed(ids[i]);
      const p0 = s.pos;
      // teacher-forced loss on the true continuation
      let l = lg;
      for (let i = 0; i < span; i++) { const want = ids[prompt + 1 + i]; nll -= logSoftmaxAt(l, want); n++; l = s.feed(want); }
      // the model's own most likely continuation, compared with the true one token by token
      s.rewind(p0 - 1); l = s.feed(ids[prompt]);          // the logits buffer is shared: recompute the first step
      let match = 0;
      for (let i = 0; i < span; i++) {
        let best = 0; for (let k = 1; k < l.length; k++) if (l[k] > l[best]) best = k;
        if (best !== ids[prompt + 1 + i]) break;
        match++; l = s.feed(best);
      }
      matchSum += match;
      if (match >= verbatimAt) verb++;
    }
    return { passages: used, loss: n ? +(nll / n).toFixed(4) : null, verbatim: used ? +(verb / used).toFixed(4) : null, meanMatch: used ? +(matchSum / used).toFixed(2) : null };
  };
  const a = measure(trained), b = measure(unseen);
  const num = (x) => typeof x === 'number';
  return {
    trained: a, unseen: b, promptTokens: prompt, spanTokens: span, verbatimAt,
    gap: num(a.loss) && num(b.loss) ? +(b.loss - a.loss).toFixed(4) : null,                       // how much easier trained text is than unseen text
    verbatimExcess: num(a.verbatim) && num(b.verbatim) ? +(a.verbatim - b.verbatim).toFixed(4) : null,
    seconds: +((Date.now() - t0) / 1000).toFixed(1),
  };
}
