// INFINITY LLM — generation: turning the model's next-token scores into replies.
//
//   chat()      free generation from the model's own weights, one token at a time, with the conversation so far as context
//   grounded()  an answer that can only say what the retrieved evidence says: at every step the model chooses among the
//               tokens that continue one of the evidence sentences (constrained decoding). The model decides which sentence
//               answers the question and when to stop; it cannot add a word that no source contains.
//   route()     the model's own estimate of whether a message needs a search (<|search|>) or just a reply (<|assistant|>)

import { createSession, sample, logSoftmaxAt, rng } from './model.js';
import { T } from './tokenizer.js';

const tick = () => new Promise((r) => setImmediate(r));
const NO_SPECIALS = [T.USER, T.ASSISTANT, T.SEARCH, T.EVIDENCE, T.DOC, T.PAD, T.RESERVED];

export function createRuntime(model, tok) {
  const ctx = model.config.context;
  let spare = null;                                             // one session is reused when free; concurrent requests get their own
  const take = () => { const s = spare || createSession(model); spare = null; s.reset(); return s; };
  const give = (s) => { spare = s; };
  const feedAll = (s, ids) => { let lg = null; for (let i = 0; i < ids.length; i++) lg = s.feed(ids[i], i === ids.length - 1); return lg; };

  /** Token ids of the conversation: as many of the latest turns as fit, then the new message. */
  function chatPrompt(history, user, reserve) {
    const u = tok.encode(String(user)).slice(0, Math.max(8, ctx - reserve - 8));
    const tail = [T.USER, ...u, T.ASSISTANT];
    let budget = ctx - reserve - tail.length;
    const turns = [];
    for (let i = (history || []).length - 1; i >= 0; i--) {
      const [hu, ha] = history[i];
      if (!hu || !ha) continue;
      const ids = [T.USER, ...tok.encode(String(hu)), T.ASSISTANT, ...tok.encode(String(ha)), T.END];
      if (ids.length > budget) break;
      budget -= ids.length; turns.unshift(ids);
    }
    return { ids: [...turns.flat(), ...tail], usedTurns: turns.length };
  }

  async function chat({ history = [], user, maxNew = 96, temperature = 0.6, topK = 40, topP = 0.92, repetitionPenalty = 1.08, seed = null, onToken = null, signal = null } = {}) {
    const t0 = Date.now();
    const s = take();
    try {
      const prompt = chatPrompt(history, user, Math.min(maxNew, ctx >> 1));
      let logits = feedAll(s, prompt.ids);
      const random = seed == null ? Math.random : rng(seed);
      const dec = tok.streamDecoder();
      const out = [];
      let text = '', lp = 0, ended = false;
      while (out.length < maxNew && s.room() > 0) {
        if (signal && signal.aborted) break;
        const id = sample(logits, { temperature, topK, topP, repetitionPenalty, recent: out.slice(-48), banned: NO_SPECIALS, random });
        lp += logSoftmaxAt(logits, id);
        if (id === T.END) { ended = true; break; }
        out.push(id);
        const piece = dec.push(id);
        if (piece) { text += piece; if (onToken) onToken(piece, id); }
        logits = s.feed(id);
        if (onToken && out.length % 4 === 0) await tick();        // let the chunks reach the network while generating
      }
      const rest = dec.end(); if (rest) { text += rest; if (onToken) onToken(rest, -1); }
      return { text: text.trim(), tokens: out.length, promptTokens: prompt.ids.length, usedTurns: prompt.usedTurns, ended, meanLogProb: out.length ? lp / (out.length + (ended ? 1 : 0)) : 0, ms: Date.now() - t0, loop: looping(out) };
    } finally { give(s); }
  }

  /**
   * @param evidence [{text, ...}] sentences in order of the retrieval engine's ranking
   * @returns {{text, picks: number[], sentences: string[], confidence: number[], tokens, used: number}} picks index into `evidence`
   */
  async function grounded({ question, evidence, maxSentences = 2, maxEvidenceTokens = 60, onToken = null, signal = null } = {}) {
    const t0 = Date.now();
    const q = tok.encode(String(question)).slice(0, 48);
    const items = [];
    let used = 3 + q.length, longest = 0;
    for (let i = 0; i < evidence.length; i++) {
      const ids = tok.encode(String(evidence[i].text).trim());
      if (!ids.length || ids.length > maxEvidenceTokens) continue;
      // room for the prompt, this item, and the answer (up to maxSentences of the longest items) must remain
      if (used + ids.length + 1 + Math.max(longest, ids.length) * maxSentences + 2 > ctx) continue;
      used += ids.length + 1; longest = Math.max(longest, ids.length);
      items.push({ i, ids });
    }
    if (!items.length) return { text: '', picks: [], sentences: [], confidence: [], tokens: 0, used: 0, ms: 0 };
    const s = take();
    try {
      let logits = feedAll(s, [T.USER, ...q, T.SEARCH, ...items.flatMap((it) => [T.EVIDENCE, ...it.ids]), T.ASSISTANT]);
      const picks = [], confidence = [], dec = tok.streamDecoder();
      let text = '', n = 0;
      const usedSet = new Set();
      while (picks.length < maxSentences) {
        if (signal && signal.aborted) break;
        let cands = items.filter((it) => !usedSet.has(it.i));
        if (!cands.length) break;
        let off = 0, conf = 1;
        let done = null;
        while (!done) {
          const allowed = new Map();                                       // next token → candidates that continue with it
          for (const c of cands) { const t = c.ids[off]; let l = allowed.get(t); if (!l) allowed.set(t, (l = [])); l.push(c); }
          const canStop = off === 0 && picks.length > 0;
          let best = -1, bestV = -Infinity, mx = -Infinity;
          for (const t of allowed.keys()) { if (logits[t] > bestV) { bestV = logits[t]; best = t; } }
          if (canStop && logits[T.END] > bestV) { best = T.END; }
          if (allowed.size > 1 || canStop) {                                   // a real choice: how sure was the model?
            const opts = [...allowed.keys(), ...(canStop ? [T.END] : [])];
            for (const t of opts) if (logits[t] > mx) mx = logits[t];
            let z = 0; for (const t of opts) z += Math.exp(logits[t] - mx);
            conf *= Math.exp(logits[best] - mx) / z;
          }
          if (best === T.END) { cands = []; break; }
          cands = allowed.get(best); off++; n++;
          const piece = (picks.length && off === 1 ? ' ' : '') + dec.push(best);
          if (piece) { text += piece; if (onToken) onToken(piece, best); }
          logits = s.feed(best);
          if (onToken && n % 4 === 0) await tick();
          done = cands.find((c) => c.ids.length === off) || null;
        }
        if (!done) break;
        picks.push(done.i); usedSet.add(done.i); confidence.push(+conf.toFixed(3));
      }
      const rest = dec.end(); if (rest) text += rest;
      return { text: text.trim(), picks, sentences: picks.map((i) => String(evidence[i].text).trim()), confidence, tokens: n, used: items.length, ms: Date.now() - t0 };
    } finally { give(s); }
  }

  /** P(search) against P(reply) right after the user's message. */
  function route(text) {
    const s = take();
    try {
      const lg = feedAll(s, [T.USER, ...tok.encode(String(text)).slice(0, ctx - 4)]);
      const a = lg[T.SEARCH], b = lg[T.ASSISTANT], m = Math.max(a, b);
      const ps = Math.exp(a - m) / (Math.exp(a - m) + Math.exp(b - m));
      return { search: +ps.toFixed(4), reply: +(1 - ps).toFixed(4) };
    } finally { give(s); }
  }

  /** Plain continuation of a text (no chat format): used by tests and the command line. */
  function complete(prefixIds, { maxNew = 40, temperature = 0, seed = 1 } = {}) {
    const s = take();
    try {
      let logits = feedAll(s, prefixIds);
      const out = [], random = rng(seed);
      while (out.length < maxNew && s.room() > 0) { const id = sample(logits, { temperature, random }); out.push(id); logits = s.feed(id); }
      return out;
    } finally { give(s); }
  }
  return { chat, grounded, route, complete, model, tokenizer: tok };
}

/** Did the generated tokens fall into a loop (the same four tokens three times)? */
export function looping(ids) {
  const seen = new Map();
  for (let i = 0; i + 4 <= ids.length; i++) { const k = ids.slice(i, i + 4).join(','); const n = (seen.get(k) || 0) + 1; if (n >= 3) return true; seen.set(k, n); }
  return false;
}

const normWords = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
/** Word-overlap F1 between two texts (0 … 1): the measure used both by the evaluation probes and by the reply check at serving time. */
export function tokenF1(a, b) {
  const x = normWords(a), y = normWords(b);
  if (!x.length || !y.length) return 0;
  const count = new Map(); for (const w of y) count.set(w, (count.get(w) || 0) + 1);
  let hit = 0; for (const w of x) { const n = count.get(w) || 0; if (n > 0) { hit++; count.set(w, n - 1); } }
  if (!hit) return 0;
  const p = hit / x.length, r = hit / y.length;
  return 2 * p * r / (p + r);
}

const NEGATION = new Set(['no', 'not', 'never', 'none', 'nothing', 'nobody', 'neither', 'nor', 'cannot', 'without', 't']);   // "t" is what remains of can't, don't, isn't …
/**
 * The reply check used at serving time. A generated reply may be shown in place of the rule-based one only if
 *   1. its word overlap (F1) with one of the correct wordings reaches `minAgreement`;
 *   2. it uses no word that none of the correct wordings uses (so it cannot bring in a wrong name, time of day or claim);
 *   3. it has exactly as many negations as the wording it matches (so "can" cannot stand in for "can't");
 *   4. it contains the same numbers as that wording.
 * `minAgreement` 0 switches the whole check off (for experiments; the app then shows whatever the model writes).
 * Returns { ok, agreement, reason, match }.
 */
export function replyCheck(text, alternatives, minAgreement = 0.6) {
  const alts = (Array.isArray(alternatives) ? alternatives : []).filter((a) => typeof a === 'string' && a.trim());
  if (!alts.length) return { ok: false, agreement: 0, reason: 'there is no rule-based wording to compare with', match: -1 };
  const words = normWords(text);
  if (!words.length) return { ok: false, agreement: 0, reason: 'the reply is empty', match: -1 };
  let match = 0, agreement = -1;
  alts.forEach((a, i) => { const f = tokenF1(text, a); if (f > agreement) { agreement = f; match = i; } });
  if (minAgreement <= 0) return { ok: true, agreement, reason: '', match };   // the operator switched the check off
  if (agreement < minAgreement) return { ok: false, agreement, reason: `it does not say what this message calls for (word overlap ${agreement.toFixed(2)}, needed ${minAgreement})`, match };
  const allowed = new Set(alts.flatMap(normWords));
  const foreign = words.filter((w) => !allowed.has(w));
  if (foreign.length) return { ok: false, agreement, reason: `it uses ${foreign.length === 1 ? 'a word' : 'words'} that no correct reply to this message uses (“${foreign.slice(0, 3).join('”, “')}”)`, match };
  const ref = normWords(alts[match]);
  const neg = (ws) => ws.filter((w) => NEGATION.has(w)).length;
  if (neg(words) !== neg(ref)) return { ok: false, agreement, reason: 'it differs from the correct reply in a negation', match };
  const nums = (ws) => ws.filter((w) => /^\d+$/.test(w)).sort().join(' ');
  if (nums(words) !== nums(ref)) return { ok: false, agreement, reason: 'it differs from the correct reply in a number', match };
  return { ok: true, agreement, reason: '', match };
}
