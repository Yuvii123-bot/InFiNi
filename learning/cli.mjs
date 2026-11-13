#!/usr/bin/env node
// INFINITY LLM — learning: command line and worker entry.
//   node learning/cli.mjs cycle [--train-seconds N] [--max-docs N]   one learning cycle (the first one trains the first model)
//   node learning/cli.mjs evaluate | status | publish | rollback [mNNNN] | pause | resume | hw | chat "text"
import fs from 'node:fs';
import path from 'node:path';
import { stateDir, paths, writeJSON, readJSON, loadConfig } from './store.mjs';
import { runCycle, evaluateProduction, snapshot, probeHardware, setState } from './cycle.mjs';
import { rollback, publish, resolveProduction } from './registry.mjs';

const [cmd = 'status', ...rest] = process.argv.slice(2);
const flag = (name, d = null) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : d; };
const root = stateDir();

async function withEngine(fn) {
  const { loadConfig: engineConfig } = await import('../engine/config.js');
  const { createEngine } = await import('../engine/index.js');
  const engine = createEngine(engineConfig(process.env));
  try { return await fn(engine); } finally { await engine.close(); }
}
const main = {
  async cycle() {
    const overrides = { cycle: {} };
    if (flag('train-seconds')) { overrides.cycle.trainSeconds = Number(flag('train-seconds')); overrides.cycle.bootstrapSeconds = Number(flag('train-seconds')); }
    if (flag('max-docs')) { overrides.cycle.maxNewDocs = Number(flag('max-docs')); overrides.cycle.bootstrapDocs = Number(flag('max-docs')); }
    const rec = await withEngine((engine) => runCycle({ root, engine, overrides, log: (s) => console.log(new Date().toISOString().slice(11, 19), s) }));
    console.log(JSON.stringify({ id: rec.id, outcome: rec.outcome, message: rec.message, model: rec.model, gate: rec.gate && { pass: rec.gate.pass, checks: rec.gate.checks } }, null, 1));
    return ['error', 'training-failed', 'export-failed', 'evaluation-failed'].includes(rec.outcome) ? 1 : 0;
  },
  async evaluate() { console.log(JSON.stringify(await evaluateProduction({ root }), null, 1)); return 0; },
  async status() { const s = snapshot(root); console.log(JSON.stringify({ status: s.status, model: s.model && { id: s.model.id, params: s.model.params, step: s.model.step, val_loss: s.model.val_loss, probes: s.model.probes }, registry: { production: s.registry.production, previous: s.registry.previous, history: s.registry.history }, corpus: s.corpus, totals: s.totals }, null, 1)); return 0; },
  async hw() { console.log(JSON.stringify(await probeHardware(root, loadConfig(root), { bench: rest.includes('--bench') }), null, 1)); return 0; },
  async publish() { console.log(JSON.stringify(publish(root, { ...snapshot(root), host: { trainingCapable: false } }))); return 0; },
  async rollback() { const reg = rollback(root, { to: rest[0] && !rest[0].startsWith('--') ? rest[0] : null, reason: flag('reason', 'command line'), by: 'cli' }); console.log(JSON.stringify({ production: reg.production, previous: reg.previous })); return 0; },
  async pause() { writeJSON(paths(root).control, { ...(readJSON(paths(root).control, {}) || {}), paused: true }); setState(root, { status: 'paused' }); console.log('paused'); return 0; },
  async resume() { writeJSON(paths(root).control, { ...(readJSON(paths(root).control, {}) || {}), paused: false }); setState(root, { status: 'idle' }); console.log('resumed'); return 0; },
  async chat() {
    const { loadModel } = await import('../engine/neural/model.js');
    const { createTokenizer } = await import('../engine/neural/tokenizer.js');
    const { createRuntime } = await import('../engine/neural/generate.js');
    const where = resolveProduction(root);
    if (!where) { console.error('no model yet: run "node learning/cli.mjs cycle" first'); return 1; }
    const rt = createRuntime(loadModel(where.dir), createTokenizer(JSON.parse(fs.readFileSync(path.join(where.dir, 'tokenizer.json'), 'utf8'))));
    const g = await rt.chat({ user: rest.filter((a) => !a.startsWith('--')).join(' ') || 'hello', onToken: (t) => process.stdout.write(t), temperature: Number(flag('temperature', '0.6')) });
    process.stdout.write(`\n[${where.id}, ${g.tokens} tokens, ${g.ms} ms]\n`);
    return 0;
  },
};
if (!main[cmd]) { console.error(`unknown command "${cmd}". Commands: ${Object.keys(main).join(', ')}`); process.exit(2); }
main[cmd]().then((code) => process.exit(code || 0), (e) => { console.error(e && e.code === 'busy' ? 'A learning cycle is already running.' : e && e.code === 'paused' ? 'Learning is paused (node learning/cli.mjs resume).' : (e && e.stack) || e); process.exit(1); });
