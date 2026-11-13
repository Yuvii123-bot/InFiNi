// Writes the "Measured results" section of docs/INFINITY-LLM.md from the published records (model/snapshot.json), so
// the numbers in the document are the ones the training system recorded, not typed by hand.
//
//   node learning/cli.mjs publish && node tools/llm/report.mjs          (prints)        … --write (updates the document)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const snap = JSON.parse(fs.readFileSync(path.join(REPO, 'model', 'snapshot.json'), 'utf8'));
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—');
const fix = (n, d = 3) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—');
const pct = (n) => (typeof n === 'number' && Number.isFinite(n) ? (n * 100).toFixed(1) + '%' : '—');
const min = (s) => (typeof s === 'number' ? (s / 60).toFixed(1) + ' min' : '—');

const reg = snap.registry, models = Object.values(reg.models).sort((a, b) => (a.id < b.id ? -1 : 1));
const prod = reg.models[reg.production];
const hw = (snap.hardware && snap.hardware.hardware) || {};
const accOf = (m) => { if (m.probes && m.probes.chatAccepted != null) return m.probes.chatAccepted; const e = [...(snap.evaluations || [])].reverse().find((x) => x.model === m.id && x.probes && x.probes.chatAccepted != null); return e ? e.probes.chatAccepted : null; };
const L = [];
L.push(`Written by \`tools/llm/report.mjs\` from \`model/snapshot.json\` (published ${snap.published}). Every figure below was recorded by`);
L.push('the training and evaluation code during the runs it describes.');
L.push('');
L.push(`**Machine**: ${hw.cpu_count || '?'} CPU cores, ${hw.memory_gb || '?'} GB memory, ${hw.gpu_training ? 'GPU' : 'no GPU'}; PyTorch ${hw.torch || '?'}, device \`${hw.device || '?'}\`, precision ${hw.precision || '?'}.`);
if (snap.hardware && snap.hardware.bench && snap.hardware.bench.length) {
  L.push('');
  L.push('Training speed measured on it (a few real optimiser steps per size, batch 16):');
  L.push('');
  L.push('| Size | Parameters | Seconds per step | Training tokens per second |');
  L.push('|---|---|---|---|');
  for (const b of snap.hardware.bench) L.push(`| ${b.preset} | ${num(b.params)} | ${b.seconds_per_step ?? '—'} | ${num(b.tokens_per_second)} |`);
  L.push('');
  L.push(`Size chosen: \`${prod ? prod.preset : snap.hardware.recommended_preset}\`.`);
}
if (prod) {
  const p = prod.probes || {};
  L.push('');
  L.push(`**Production model: ${prod.id}**`);
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| Architecture | decoder-only Transformer, ${prod.config.n_layer} layers, ${prod.config.n_head} heads, width ${prod.config.d_model}, context ${prod.config.context} tokens, vocabulary ${num(prod.config.vocab_size)} |`);
  L.push(`| Parameters | ${num(prod.params)} |`);
  L.push(`| Initialisation | ${prod.initialisation} |`);
  L.push(`| Built from | ${prod.parent ? `${prod.parent} (continued training)` : 'random weights'} |`);
  L.push(`| Optimiser steps | ${num(prod.step)} |`);
  L.push(`| Tokens trained on (with repetition) | ${num(prod.tokens_seen)} |`);
  L.push(`| Training time | ${min(prod.train_seconds)} |`);
  L.push(`| Weights file | ${(prod.weightsBytes / 1048576).toFixed(2)} MB, SHA-256 \`${String(prod.sha256).slice(0, 16)}…\` |`);
  L.push(`| Validation loss | ${fix(prod.val_loss)} (perplexity ${Math.exp(prod.val_loss).toFixed(1)}; a uniform guess over the vocabulary would be ${Math.log(prod.config.vocab_size).toFixed(2)}) |`);
  for (const [g, v] of Object.entries(prod.groups || {})) L.push(`| Validation loss, ${g === 'dialogue' ? 'conversation data' : g === 'web' ? 'document text' : g} | ${fix(v.val_loss)} |`);
  L.push(`| Reply match on unseen phrasings | F1 ${pct(p.chatF1)}, exact ${pct(p.chatExact)} |`);
  const accepted = accOf(prod);
  if (accepted != null) L.push(`| Generated replies that pass the reply check (single attempt, unseen phrasings) | ${pct(accepted)}; the others are replaced by the rule-based reply |`);
  L.push(`| Evidence choice | ${pct(p.grounded)} (chance ${pct(p.groundedChance)}) |`);
  L.push(`| Search decision | ${pct(p.route)} |`);
  L.push(`| Looping replies | ${pct(p.repetition)} |`);
  L.push(`| JavaScript engine versus PyTorch | ${p.parity ? 'reproduces the reference outputs' : 'does NOT reproduce the reference outputs'} |`);
  L.push(`| Inference speed (JavaScript, one core) | ${num(p.tokensPerSecond)} tokens per second |`);
}
L.push('');
L.push('**All model versions**');
L.push('');
L.push('| Version | Status | Built from | Trained on | Steps | Validation loss (measured on) | Reply F1 | Passes reply check | Evidence | Search | Gate |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const m of models) L.push(`| ${m.id} | ${m.status} | ${m.parent || 'random weights'} | ${m.dataset} | ${num(m.step)} | ${fix(m.val_loss)} (${m.evaluatedOn || m.dataset}) | ${pct(m.probes && m.probes.chatF1)} | ${pct(accOf(m))} | ${pct(m.probes && m.probes.grounded)} | ${pct(m.probes && m.probes.route)} | ${m.gate ? (m.gate.pass ? 'passed' : 'failed: ' + (m.gate.failed || []).join('; ')) : '—'} |`);
L.push('');
L.push('Validation loss depends on the validation set, and each dataset version has its own (later ones hold more document text,');
L.push('which is harder to predict than conversation). Figures measured on different datasets must not be compared. The gate');
L.push('never does: in each cycle it measures the candidate and the current model on the same new validation set, and those');
L.push('two figures are in the gate checks below.');
L.push('');
L.push('**Learning cycles**');
L.push('');
L.push('| Cycle | Outcome | Documents collected / accepted / rejected | Dataset | Training tokens in dataset | Training time | What happened |');
L.push('|---|---|---|---|---|---|---|');
for (const c of snap.cycles || []) { const a = c.acquisition || {}; const d = (snap.datasets || []).find((x) => x.version === c.dataset); L.push(`| ${c.id} | ${c.outcome} | ${num(a.collected)} / ${num(a.accepted)} / ${num(a.rejected)} | ${c.dataset || '—'} | ${d ? num(d.tokens.train) : '—'} | ${min(c.training && c.training.cycle_seconds_total)} | ${String(c.message || '').replace(/\|/g, '/')} |`); }
for (const c of (snap.cycles || []).filter((x) => x.gate)) {
  L.push('');
  L.push(`Gate checks of cycle ${c.id} (candidate ${c.model}${c.gate.comparedWith ? `, compared with ${c.gate.comparedWith}` : ', first model: absolute floors'}):`);
  L.push('');
  for (const k of c.gate.checks) L.push(`* ${k.pass ? 'passed' : '**failed**'}: ${k.name} (${k.detail})`);
}
if (snap.corpus) {
  const c = snap.corpus, obj = (o) => Object.entries(o || {}).map(([k, v]) => `${k} ${num(v)}`).join(', ') || 'none';
  L.push('');
  L.push('**Training data**');
  L.push('');
  L.push(`* ${num(c.documents)} documents accepted (${num(c.train)} for training, ${num(c.validation)} held out), ${num(c.chars)} characters; ${num(c.rejected)} rejected (${obj(c.rejectedByStage)}).`);
  L.push(`* By licence: ${obj(c.byLicence)}. By source: ${obj(c.bySource)}.`);
  L.push(`* Verification: ${obj(c.byVerification)}; mean score ${fix(c.meanVerificationScore, 2)}; ${num(c.disputedStatements)} disputed statements left out.`);
  const d = (snap.datasets || [])[(snap.datasets || []).length - 1];
  if (d) L.push(`* Latest dataset ${d.version}: ${num(d.tokens.train)} training tokens, ${num(d.tokens.validation)} validation tokens; validation documents, hashes or phrasings found in training: ${d.integrity ? d.integrity.valDocumentsInTraining + d.integrity.valHashesInTraining + d.integrity.valPhrasingsInTraining : '—'}.`);
}
if ((reg.history || []).length) {
  L.push('');
  L.push('**Promotions, rejections and rollbacks**');
  L.push('');
  for (const e of reg.history) L.push(`* ${e.t}: ${e.action === 'promote' ? `${e.to} promoted${e.from ? `, replacing ${e.from}` : ''} (${e.by}: ${e.reason})` : e.action === 'rollback' ? `rolled back from ${e.from} to ${e.to} (${e.by}${e.reason ? ': ' + e.reason : ''})` : `${e.model} rejected, ${e.kept || 'no model'} kept (${e.reason})`}`);
}
const text = L.join('\n');
if (process.argv.includes('--write')) {
  const file = path.join(REPO, 'docs', 'INFINITY-LLM.md');
  const doc = fs.readFileSync(file, 'utf8');
  const a = '<!-- results:start -->', b = '<!-- results:end -->';
  if (!doc.includes(a) || !doc.includes(b)) throw new Error('markers not found in docs/INFINITY-LLM.md');
  fs.writeFileSync(file, doc.slice(0, doc.indexOf(a) + a.length) + '\n' + text + '\n' + doc.slice(doc.indexOf(b)));
  console.log('updated', file);
} else console.log(text);
