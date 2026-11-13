// INFINITY LLM — the model inside the serving process.
// Loads the production weights (live state first, the copy bundled with the app otherwise), reloads them when a promotion
// or a rollback changes which model is in production, and writes the neural part of every answer. If no model is present,
// or it fails its self-test, the service reports "unavailable" and the application carries on without it.

import fs from 'node:fs';
import path from 'node:path';
import { loadModel, selfTest } from './model.js';
import { createTokenizer } from './tokenizer.js';
import { createRuntime, replyCheck } from './generate.js';
import { resolveProduction } from '../../learning/registry.mjs';
import { stateDir } from '../../learning/store.mjs';

const CHAT_ORIGINS = new Set(['conversation']);   // common-sense facts stay with the rules: the model is not a source of facts

/** The engine's result without the fields that exist only for the reply check (they are not for the client). */
export const lean = (r) => (r && r.brain && 'alternatives' in r.brain ? { ...r, brain: { intent: r.brain.intent, group: r.brain.group, sure: r.brain.sure } } : r);

export function createNeural({ root = '', enabled = true, minLogProb = -1.6, minAgreement = 0.6, log = () => {}, bundled = undefined } = {}) {
  root = root || stateDir();
  let cur = null, lastCheck = 0, lastError = '';
  const stats = { chats: 0, checked: 0, accepted: 0, grounded: 0, fallbacks: 0, tokens: 0, ms: 0, reloads: 0 };

  function load() {
    const where = resolveProduction(root, bundled ? { bundled } : {});
    if (!where) { cur = null; lastError = 'no trained model has been published yet'; return; }
    if (cur && cur.id === where.id && cur.dir === where.dir && cur.registryMtime === where.registryMtime) return;
    if (cur && cur.id === where.id && cur.dir === where.dir) { cur.registryMtime = where.registryMtime; cur.card = where.card || cur.card; return; }
    try {
      const model = loadModel(where.dir);
      const parity = selfTest(model);
      if (!parity.ok) throw new Error(`self-test failed (difference ${parity.maxDiff})`);
      const tok = createTokenizer(JSON.parse(fs.readFileSync(path.join(where.dir, 'tokenizer.json'), 'utf8')));
      if (tok.vocabSize !== model.config.vocab_size) throw new Error('tokenizer and model disagree on the vocabulary size');
      if (cur) stats.reloads++;
      cur = { ...where, model, tok, rt: createRuntime(model, tok), parity, loadedAt: new Date().toISOString() };
      lastError = '';
      log({ ev: 'llm_loaded', model: where.id, params: model.params, source: where.source });
    } catch (e) { lastError = `model ${where.id} could not be loaded: ${String(e && e.message).slice(0, 160)}`; log({ ev: 'llm_load_failed', message: lastError }); /* keep answering with the model already in memory */ }
  }
  function refresh(force = false) { if (!enabled) return; const now = Date.now(); if (!force && now - lastCheck < 2000) return; lastCheck = now; try { load(); } catch (e) { lastError = String(e && e.message); } }
  refresh(true);

  const ready = () => { refresh(); return enabled && !!cur; };
  function info() {
    refresh();
    if (!enabled) return { available: false, reason: 'switched off (INFINI_LLM=0)' };
    if (!cur) return { available: false, reason: lastError || 'no model' };
    const c = cur.model.config, m = cur.model.meta, card = cur.card || {};
    return {
      available: true, name: 'Infinity LLM', version: cur.id, source: cur.source, architecture: 'decoder-only Transformer', parameters: cur.model.params,
      layers: c.n_layer, heads: c.n_head, width: c.d_model, context: c.context, vocabulary: c.vocab_size, norm: c.norm, precision: m.dtype,
      trainedSteps: m.step, trainedTokens: m.tokens_seen, validationLoss: card.val_loss ?? m.val_loss ?? null, dataset: m.dataset || card.dataset || null,
      initialisation: 'random; no pretrained weights', inference: 'own JavaScript engine in this server; no external model or API',
      selfTest: cur.parity, loadedAt: cur.loadedAt, probes: card.probes || null, served: { ...stats, acceptedShare: stats.checked ? +(stats.accepted / stats.checked).toFixed(3) : null, tokensPerSecond: stats.ms ? Math.round(stats.tokens / (stats.ms / 1000)) : null }, note: lastError || undefined,
    };
  }
  const tag = () => ({ name: 'Infinity LLM', version: cur.id, parameters: cur.model.params });
  const cleanHistory = (h) => (Array.isArray(h) ? h : []).filter((t) => Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string' && t[0].trim() && t[1].trim()).slice(-8).map((t) => [t[0].slice(0, 500), t[1].slice(0, 700)]);

  /** A reply generated from the model's own weights. Never throws; ok=false says why the reply should not be shown. */
  async function chat({ user, history = [], onToken = null, signal = null, temperature = 0.6, maxNew = 120 } = {}) {
    if (!ready()) return { ok: false, reason: lastError || 'no model' };
    const me = cur;
    try {
      const g = await me.rt.chat({ user: String(user).slice(0, 1200), history: cleanHistory(history), onToken, signal, temperature, maxNew });
      stats.chats++; stats.tokens += g.tokens + g.promptTokens; stats.ms += g.ms;
      const reason = !g.text ? 'the model produced no text' : g.loop ? 'the model started repeating itself' : !g.ended ? 'the model did not finish its reply' : g.meanLogProb < minLogProb ? 'the model was unsure of its own reply' : '';
      return { ok: !reason, reason, text: g.text, model: { name: 'Infinity LLM', version: me.id, parameters: me.model.params }, tokens: g.tokens, promptTokens: g.promptTokens, usedTurns: g.usedTurns, ms: g.ms, tokensPerSecond: g.ms ? Math.round((g.tokens + g.promptTokens) / (g.ms / 1000)) : null, meanLogProb: +g.meanLogProb.toFixed(3), route: me.rt.route(String(user).slice(0, 600)) };
    } catch (e) { return { ok: false, reason: `generation failed: ${String(e && e.message).slice(0, 120)}` }; }
  }

  /**
   * Take the engine's finished answer and add the model's part to it.
   *   conversation  → the reply is generated by the model (the rule-based reply is kept as the fallback)
   *   web answer    → the model writes a short answer out of the retrieved evidence, with the sources of each sentence;
   *                   the engine's own evidence-based answer stays below it, so retrieval works however weak the model is
   */
  const enhance = async (args) => lean(await enhanceFull(args));
  async function enhanceFull({ result, question, history = [], send = () => {}, signal = null } = {}) {
    if (!ready() || !result || !result.answer) return result;
    const me = cur;
    try {
      // Questions about the assistant itself keep the reply from its records: version and parameter count must be exact.
      if (result.kind === 'brain' && result.brain && result.brain.group === 'self') return { ...result, neural: { used: false, mode: 'chat', reason: 'questions about the assistant itself are answered from its own records, so the figures are exact', model: tag() } };
      if (result.kind === 'brain' && CHAT_ORIGINS.has(result.origin)) {
        // The model writes a reply; it is shown only if it passes replyCheck() against the rule-based wordings for this
        // message. A small model can produce a fluent reply to the wrong message, and its own confidence does not
        // reveal that, so the rules are the judge. Up to three samples.
        const expected = result.brain && Array.isArray(result.brain.alternatives) ? result.brain.alternatives : [];
        if (!expected.length) return { ...result, neural: { used: false, mode: 'chat', reason: 'this reply carries details from the conversation that only the rule-based reply holds', model: tag() } };
        let best = null, why = '';
        for (let attempt = 1; attempt <= 3 && !(signal && signal.aborted); attempt++) {
          const g = await chat({ user: question, history, signal, temperature: attempt === 1 ? 0 : 0.7 });   // first the most likely reply, then two samples
          if (!g.ok) { why = why || g.reason; continue; }
          const check = replyCheck(g.text, expected, minAgreement);
          if (!best || check.ok || (!best.check.ok && check.agreement > best.check.agreement)) best = { ...g, check, agreement: check.agreement, attempt };
          if (check.ok) break;
        }
        stats.checked++;
        if (!best || !best.check.ok) {
          stats.fallbacks++;
          const reason = best ? `the model's own reply was not shown because ${best.check.reason}` : why || 'the model produced no usable reply';
          return { ...result, neural: { used: false, mode: 'chat', reason, model: tag(), agreement: best ? +best.agreement.toFixed(2) : null, attempts: best ? best.attempt : 3 } };
        }
        stats.accepted++;
        const g = best;
        send({ type: 'token', start: true, mode: 'chat', model: tag() });
        for (const piece of g.text.match(/\S+\s*/g) || [g.text]) send({ type: 'token', text: piece });
        // the conversation memory must hold what was actually said ("what did you say?" quotes it)
        const context = result.context && result.context.brain ? { ...result.context, brain: { ...result.context.brain, lastText: g.text.slice(0, 400) } } : result.context;
        return { ...result, context, origin: 'neural', answer: { blocks: g.text.split(/\n{2,}/).map((t) => ({ type: 'paragraph', spans: [{ text: t }] })), text: g.text }, neural: { used: true, mode: 'chat', model: g.model, tokens: g.tokens, promptTokens: g.promptTokens, contextTurns: g.usedTurns, ms: g.ms, tokensPerSecond: g.tokensPerSecond, meanLogProb: g.meanLogProb, agreement: +g.agreement.toFixed(2), attempts: g.attempt, ruleBasedReply: result.answer.text || expected[0], note: 'generated token by token from the model\'s own weights, then checked against the rule-based replies for this message' } };
      }
      if (result.kind === 'retrieval' && result.research && Array.isArray(result.research.passages) && result.research.passages.length && result.sources && result.sources.length && !(result.confidence && result.confidence.level === 'insufficient')) {
        const evidence = [];
        for (const p of result.research.passages.slice(0, 12)) for (const s of String(p.text).split(/(?<=[.!?])\s+(?=[A-Z"“(])/)) { const t = s.trim(); if (t.length >= 25 && t.length <= 320 && !evidence.some((e) => e.text === t)) evidence.push({ text: t, source: p.source, also: p.alsoSupportedBy || [] }); }
        if (!evidence.length) return result;
        send({ type: 'token', start: true, mode: 'grounded', model: tag() });
        const g = await me.rt.grounded({ question: result.question || question, evidence: evidence.slice(0, 10), maxSentences: 2, signal, onToken: (text) => send({ type: 'token', text }) });
        stats.grounded++; stats.tokens += g.tokens; stats.ms += g.ms;
        if (!g.picks.length) { send({ type: 'token', reset: true }); return { ...result, neural: { used: false, mode: 'grounded', reason: 'the evidence did not fit the model\'s context window', model: tag() } }; }
        const spans = g.picks.map((i) => ({ text: evidence[i].text, cites: [...new Set([evidence[i].source, ...evidence[i].also])].slice(0, 4) }));
        const block = { type: 'paragraph', neural: true, spans };
        return { ...result, answer: { ...result.answer, blocks: [block, ...result.answer.blocks] }, neural: { used: true, mode: 'grounded', model: tag(), tokens: g.tokens, ms: g.ms, evidenceOffered: g.used, chosen: g.picks.length, confidence: g.confidence, route: me.rt.route(String(question).slice(0, 600)), note: 'every sentence is taken from the retrieved sources; the model chose which ones answer the question' } };
      }
    } catch (e) { stats.fallbacks++; send({ type: 'token', reset: true }); log({ ev: 'llm_error', message: String(e && e.message).slice(0, 200) }); return { ...result, neural: { used: false, reason: 'the model failed on this message; the engine\'s own answer is shown' } }; }
    return result;
  }
  return { ready, info, chat, enhance, refresh, get runtime() { return cur ? cur.rt : null; } };
}
