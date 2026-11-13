// INFINITY LLM — learning: behaviour evaluation of an exported model, in the same JavaScript engine that serves the chat.
// All probes come from held-out material (validation phrasings, validation documents). The numbers reported are measured;
// nothing here estimates or extrapolates.

import fs from 'node:fs';
import path from 'node:path';
import { loadModel, selfTest } from '../engine/neural/model.js';
import { createTokenizer } from '../engine/neural/tokenizer.js';
import { createRuntime, tokenF1, replyCheck } from '../engine/neural/generate.js';

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const f1 = tokenF1;

export async function evaluateModel(modelDir, datasetDir, { chatN = 160, groundedN = 120, routeN = 240, sampleN = 40 } = {}) {
  const t0 = Date.now();
  const model = loadModel(modelDir);
  const tok = createTokenizer(JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer.json'), 'utf8')));
  const rt = createRuntime(model, tok);
  const probes = JSON.parse(fs.readFileSync(path.join(datasetDir, 'probes.json'), 'utf8'));
  const out = { parity: selfTest(model), params: model.params };
  // 1. conversation: does the most likely reply to an unseen phrasing match what the teacher would say for that situation?
  let match = 0, fsum = 0, tokens = 0, ms = 0, accepted = 0;
  const chat = probes.chat.slice(0, chatN), examples = [];
  for (const p of chat) {
    const g = await rt.chat({ user: p.user, temperature: 0, maxNew: 80 });
    tokens += g.tokens + g.promptTokens; ms += g.ms;
    const exact = p.accept.some((a) => norm(a) === norm(g.text));
    const best = Math.max(0, ...p.accept.map((a) => f1(g.text, a)));
    if (exact) match++; fsum += best;
    if (replyCheck(g.text, p.accept).ok) accepted++;   // would this reply be shown at serving time (single attempt)?
    if (examples.length < 12) examples.push({ user: p.user, reply: g.text, exact, f1: +best.toFixed(2) });
  }
  out.chat = { n: chat.length, accepted: chat.length ? +(accepted / chat.length).toFixed(4) : null, exact: chat.length ? +(match / chat.length).toFixed(4) : null, f1: chat.length ? +(fsum / chat.length).toFixed(4) : null, examples };
  // 2. grounded answering: does the model choose the evidence sentence that answers the question?
  const gr = probes.grounded.slice(0, groundedN);
  let right = 0, chance = 0;
  const gex = [];
  for (const p of gr) {
    const g = await rt.grounded({ question: p.question, evidence: p.evidence.map((text) => ({ text })), maxSentences: 1 });
    tokens += g.tokens; ms += g.ms;
    chance += 1 / p.evidence.length;
    const ok = g.picks[0] === p.answer;
    if (ok) right++;
    if (gex.length < 6) gex.push({ question: p.question, chosen: g.text.slice(0, 160), correct: ok, options: p.evidence.length });
  }
  out.grounded = { n: gr.length, accuracy: gr.length ? +(right / gr.length).toFixed(4) : null, chance: gr.length ? +(chance / gr.length).toFixed(4) : null, examples: gex };
  // 3. the search decision
  const ro = probes.route.slice(0, routeN);
  let ok = 0, sN = 0, sOk = 0, cN = 0, cOk = 0;
  for (const p of ro) { const r = rt.route(p.text); const pred = r.search >= 0.5 ? 'search' : 'chat'; if (pred === p.label) ok++; if (p.label === 'search') { sN++; if (pred === 'search') sOk++; } else { cN++; if (pred === 'chat') cOk++; } }
  out.route = { n: ro.length, accuracy: ro.length ? +(ok / ro.length).toFixed(4) : null, searchRecall: sN ? +(sOk / sN).toFixed(4) : null, chatRecall: cN ? +(cOk / cN).toFixed(4) : null };
  // 4. sampled replies: loops, empty replies, replies that never end
  let loops = 0, empty = 0, unfinished = 0;
  const sm = chat.slice(0, sampleN);
  for (let i = 0; i < sm.length; i++) { const g = await rt.chat({ user: sm[i].user, temperature: 0.7, seed: 1000 + i, maxNew: 96 }); tokens += g.tokens + g.promptTokens; ms += g.ms; if (g.loop) loops++; if (!g.text) empty++; if (!g.ended) unfinished++; }
  out.sampling = { n: sm.length, repetition: sm.length ? +(loops / sm.length).toFixed(4) : null, empty: sm.length ? +(empty / sm.length).toFixed(4) : null, unfinished: sm.length ? +(unfinished / sm.length).toFixed(4) : null };
  out.inference = { tokensPerSecond: ms ? Math.round(tokens / (ms / 1000)) : null, engine: 'javascript' };
  out.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  return out;
}

/**
 * The promotion gate. A candidate replaces the production model only when every check passes.
 * @param cand, prod  { val_loss, groups: {dialogue:{val_loss}, web:{val_loss}}, probes: evaluateModel() } on the SAME dataset
 */
export function promotionGate(cand, prod, gate, { vocab = 4096 } = {}) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  add('exported weights reproduce the training framework', !gate.parityRequired || (cand.probes.parity && cand.probes.parity.ok), cand.probes.parity ? `largest difference ${cand.probes.parity.maxDiff}` : 'no reference');
  add('validation loss is a number', num(cand.val_loss), String(cand.val_loss));
  const cg = (g) => (cand.groups && cand.groups[g] && cand.groups[g].val_loss), pg = (g) => (prod && prod.groups && prod.groups[g] && prod.groups[g].val_loss);
  if (prod) {
    add('held-out loss is not worse than production', num(cand.val_loss) && cand.val_loss <= prod.val_loss + gate.maxLossRegression, `${cand.val_loss} vs ${prod.val_loss} (allowed +${gate.maxLossRegression})`);
    if (num(cg('dialogue')) && num(pg('dialogue'))) add('earlier knowledge kept (conversation data)', cg('dialogue') <= pg('dialogue') + gate.maxAnchorRegression, `${cg('dialogue')} vs ${pg('dialogue')} (allowed +${gate.maxAnchorRegression})`);
    for (const [name, get] of [['reply match', (p) => p.chat.f1], ['evidence choice', (p) => p.grounded.accuracy], ['search decision', (p) => p.route.accuracy]]) {
      const c = get(cand.probes), p = get(prod.probes);
      if (num(c) && num(p)) add(`${name} did not fall`, c >= p - gate.maxProbeDrop, `${c} vs ${p} (allowed −${gate.maxProbeDrop})`);
    }
  } else {
    add('learned something (loss well below a uniform guess)', num(cand.val_loss) && cand.val_loss < (gate.minLearnRatio ?? 0.6) * Math.log(vocab), `${cand.val_loss} vs ${(gate.minLearnRatio ?? 0.6)} × ln(${vocab}) = ${((gate.minLearnRatio ?? 0.6) * Math.log(vocab)).toFixed(2)}`);
    const f = gate.minProbeFloor;
    if (num(cand.probes.chat.f1)) add('replies resemble the expected ones', cand.probes.chat.f1 >= f.chat, `${cand.probes.chat.f1} (floor ${f.chat})`);
    if (num(cand.probes.grounded.accuracy)) add('chooses the right evidence more often than chance', cand.probes.grounded.accuracy >= Math.max(f.grounded, (cand.probes.grounded.chance || 0) + 0.05), `${cand.probes.grounded.accuracy} (chance ${cand.probes.grounded.chance}, floor ${f.grounded})`);
    if (num(cand.probes.route.accuracy)) add('search decision is better than guessing', cand.probes.route.accuracy >= f.route, `${cand.probes.route.accuracy} (floor ${f.route})`);
  }
  if (num(cand.probes.sampling.repetition)) add('sampled replies do not loop', cand.probes.sampling.repetition <= gate.maxRepetition, `${cand.probes.sampling.repetition} (limit ${gate.maxRepetition})`);
  return { pass: checks.every((c) => c.pass), checks, comparedWith: prod ? prod.id : null };
}
