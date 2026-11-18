// INFINITY LLM — learning: keeping the learning state alive across machines and restarts.
//
//   seedFromPublished   a worker on a new machine starts from the published model (model/current): the registry, the
//                       history, the tokenizer and a training checkpoint rebuilt from the exported weights
//   pruneState          old versions keep their records for ever; their large files are removed after a while
//   packState / restoreState   the whole state directory as one archive (hosts without a permanent disk store it
//                       between sessions; hosts with a disk do not need it)
//   healthCheck         the production model must load and reproduce its reference numbers, or the worker rolls back

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { paths, readJSON, writeJSON, appendLine, readLines, nowISO, listDirs, loadConfig, BUNDLED, logEvent } from './store.mjs';
import { loadRegistry, modelDir, rollback } from './registry.mjs';
import { runPython } from './cycle.mjs';
import { loadModel, selfTest } from '../engine/neural/model.js';

const exists = (f) => fs.existsSync(f);
const sha256File = (f) => {
  const hash = crypto.createHash('sha256'), fd = fs.openSync(f, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
};

/** Start a state directory from the published model. Does nothing when the state already has a production model. */
export async function seedFromPublished(root, { bundled = BUNDLED, env = process.env, log = () => {} } = {}) {
  const P = paths(root);
  const reg0 = loadRegistry(root);
  if (reg0.production && exists(path.join(modelDir(root, reg0.production), 'weights.bin'))) return { seeded: false, reason: 'the state already has a production model', production: reg0.production };
  const cur = path.join(bundled, 'current');
  if (!exists(path.join(cur, 'weights.bin'))) return { seeded: false, reason: 'no published model to start from' };
  const snap = readJSON(path.join(bundled, 'snapshot.json'), {}) || {};
  const sreg = snap.registry || {};
  const id = sreg.production || 'm0001';
  fs.mkdirSync(root, { recursive: true });
  const mdir = modelDir(root, id);
  fs.mkdirSync(mdir, { recursive: true });
  for (const f of ['model.json', 'weights.bin', 'tokenizer.json']) fs.copyFileSync(path.join(cur, f), path.join(mdir, f));
  fs.copyFileSync(path.join(cur, 'tokenizer.json'), P.tokenizer);
  // the history that came with the published model: earlier versions keep their cards, but their weights are not here
  const models = {};
  for (const [k, v] of Object.entries(sreg.models || {})) models[k] = k === id ? { ...v, status: 'production' } : { ...v, status: v.status === 'previous' ? 'archived' : v.status, weightsKept: false };
  const meta = readJSON(path.join(mdir, 'model.json'), {});
  if (!models[id]) models[id] = { id, status: 'production', created: meta.exported || nowISO(), config: meta.config, context: meta.config.context, params: meta.params, step: meta.step, tokens_seen: meta.tokens_seen, train_seconds: meta.train_seconds, sha256: meta.sha256, tokenizer_sha: meta.tokenizer_sha };
  models[id].importedAt = nowISO();
  writeJSON(P.registry, { format: 'infinity-registry/1', production: id, previous: null, experimental: null, models, history: [...(sreg.history || []), { t: nowISO(), action: 'import', to: id, by: 'worker', reason: 'state started from the published model' }] });
  if (!exists(P.cycles)) for (const c of snap.cycles || []) appendLine(P.cycles, c);
  for (const d of snap.datasets || []) { const dd = path.join(P.datasets, d.version); if (!exists(dd)) writeJSON(path.join(dd, 'dataset.json'), { ...d, archived: true }); }
  // a checkpoint to continue training from: the exported weights, turned back into the training framework's format
  const cfg = loadConfig(root);
  const r = await runPython(cfg, ['llm.import_weights', '--model', mdir, '--out', path.join(mdir, 'ckpt.pt')], { env });
  const checkpoint = r.code === 0;
  logEvent(root, 'seeded', { model: id, checkpoint, note: checkpoint ? 'training will continue from the published weights' : `no checkpoint could be built (${(r.stderr || '').trim().split('\n').pop() || 'Python with PyTorch is missing'})` });
  log(`state started from the published model ${id}${checkpoint ? '' : ' (no training checkpoint: Python with PyTorch is missing)'}`);
  return { seeded: true, production: id, checkpoint };
}

/** Remove the large files of old versions. Registry cards, evaluations, manifests and training curves stay. */
export function pruneState(root, cfg = loadConfig(root)) {
  const P = paths(root), reg = loadRegistry(root), w = cfg.worker;
  const removed = [];
  const rm = (f) => { if (exists(f)) { fs.rmSync(f, { recursive: true, force: true }); removed.push(path.relative(root, f)); } };
  const ids = listDirs(P.models);
  const keep = new Set([reg.production, reg.previous, reg.experimental, ...ids.slice(-w.keepModels)].filter(Boolean));
  for (const id of ids) if (!keep.has(id)) { for (const f of ['ckpt.pt', 'weights.bin', 'tokenizer.json']) rm(path.join(P.models, id, f)); }
  const cyc = readJSON(path.join(root, 'cycle.json'), null);
  const live = cyc && !cyc.finished ? cyc : null;
  const dsets = listDirs(P.datasets), keepD = new Set([...dsets.slice(-w.keepDatasets), live && live.dataset].filter(Boolean));
  for (const d of dsets) if (!keepD.has(d)) for (const f of fs.readdirSync(path.join(P.datasets, d))) if (f !== 'dataset.json') rm(path.join(P.datasets, d, f));
  // A challenger must survive ordinary pruning between cycles and runner sessions.
  const runs = listDirs(P.runs), keepR = new Set([...runs.filter((r) => r.startsWith('challenger-')), ...runs.slice(-w.keepRuns), live && live.run].filter(Boolean));
  for (const r of runs) if (!keepR.has(r)) rm(path.join(P.runs, r, 'ckpt.pt'));
  if (removed.length) logEvent(root, 'pruned', { files: removed.length });
  return removed;
}

const tar = (args, cwd) => { const r = spawnSync('tar', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); if (r.status !== 0) throw new Error(`tar failed: ${String(r.stderr || r.error || '').trim().slice(0, 300)}`); };
/** The whole state as one archive (locks and the publishing scratch directory are left out). */
export function packState(root, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  tar(['-czf', tmp, '--exclude=./worker.lock', '--exclude=./supervisor.lock', '--exclude=./channel', '--exclude=*.tmp-*', '.'], root);
  fs.renameSync(tmp, file);
  return { file, bytes: fs.statSync(file).size, sha256: sha256File(file) };
}
export function restoreState(file, root) {
  fs.mkdirSync(root, { recursive: true });
  tar(['-xzf', file], root);
  for (const f of ['worker.lock', 'supervisor.lock']) fs.rmSync(path.join(root, f), { force: true });
  return { root, production: loadRegistry(root).production };
}

/**
 * The production model must be loadable, match its recorded checksum and reproduce its reference logits.
 * If it does not, go back to the previous stable model at once (when there is one) and say so.
 */
export function healthCheck(root, { autoRollback = true } = {}) {
  const reg = loadRegistry(root);
  if (!reg.production) return { ok: true, production: null, note: 'no production model yet' };
  const dir = modelDir(root, reg.production);
  let problem = '';
  try {
    const card = reg.models[reg.production] || {};
    if (card.sha256 && sha256File(path.join(dir, 'weights.bin')) !== card.sha256) problem = 'the weights file does not match its recorded checksum';
    else { const t = selfTest(loadModel(dir)); if (!t.ok) problem = `self-test failed (difference ${t.maxDiff})`; }
  } catch (e) { problem = String(e && e.message).slice(0, 200); }
  if (!problem) return { ok: true, production: reg.production };
  logEvent(root, 'health-failed', { model: reg.production, problem });
  if (autoRollback && reg.previous && fs.existsSync(path.join(modelDir(root, reg.previous), 'weights.bin'))) {
    const bad = reg.production;
    const after = rollback(root, { reason: `automatic: ${bad} failed its health check (${problem})`, by: 'worker' });
    // a model that failed its health check is not something to go "back" to
    const reg2 = loadRegistry(root);
    if (reg2.previous === bad) { reg2.previous = null; if (reg2.models[bad]) { reg2.models[bad].status = 'unhealthy'; reg2.models[bad].problem = problem; } writeJSON(paths(root).registry, reg2); }
    logEvent(root, 'auto-rollback', { from: bad, to: after.production, problem });
    return { ok: false, rolledBack: true, from: bad, production: after.production, problem };
  }
  return { ok: false, rolledBack: false, production: reg.production, problem };
}

/** Size of the state directory in megabytes (for the dashboard). */
export function stateSizeMb(root) {
  let total = 0;
  const walk = (d) => { let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of list) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { try { total += fs.statSync(f).size; } catch { /* vanished */ } } } };
  walk(root);
  return +(total / 2 ** 20).toFixed(1);
}
export { readLines };
