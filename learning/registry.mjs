// INFINITY LLM — learning: model versions. Which model answers (production), the one before it (previous stable), the
// one being judged (experimental), every earlier version with its numbers, and the history of promotions and rollbacks.

import fs from 'node:fs';
import path from 'node:path';
import { paths, readJSON, writeJSON, nowISO, BUNDLED, copyDir, readLines } from './store.mjs';

const EMPTY = { format: 'infinity-registry/1', production: null, previous: null, experimental: null, models: {}, history: [] };
export function loadRegistry(root) { return { ...EMPTY, ...(readJSON(paths(root).registry, null) || {}) }; }
const save = (root, reg) => { reg.updated = nowISO(); writeJSON(paths(root).registry, reg); return reg; };
export const modelDir = (root, id) => path.join(paths(root).models, id);
const usable = (root, id) => !!id && fs.existsSync(path.join(modelDir(root, id), 'weights.bin')) && fs.existsSync(path.join(modelDir(root, id), 'model.json'));

export function registerModel(root, card) {
  const reg = loadRegistry(root);
  reg.models[card.id] = { ...(reg.models[card.id] || {}), ...card };
  if (card.status === 'experimental') reg.experimental = card.id;
  return save(root, reg);
}
/** Make a model the production model. The one it replaces becomes "previous stable". */
export function promote(root, id, { reason = '', by = 'gate' } = {}) {
  const reg = loadRegistry(root);
  if (!reg.models[id]) throw new Error(`unknown model ${id}`);
  if (!usable(root, id)) throw new Error(`model ${id} has no exported weights`);
  if (reg.production === id) return reg;
  const from = reg.production;
  if (from && reg.models[from]) reg.models[from].status = 'previous';
  if (reg.previous && reg.previous !== from && reg.models[reg.previous] && reg.models[reg.previous].status === 'previous') reg.models[reg.previous].status = 'archived';
  reg.previous = from; reg.production = id;
  reg.models[id].status = 'production'; reg.models[id].promotedAt = nowISO();
  if (reg.experimental === id) reg.experimental = null;
  reg.history.push({ t: nowISO(), action: 'promote', from, to: id, by, reason });
  return save(root, reg);
}
export function reject(root, id, { reason = '' } = {}) {
  const reg = loadRegistry(root);
  if (!reg.models[id]) throw new Error(`unknown model ${id}`);
  reg.models[id].status = 'rejected'; reg.models[id].rejectedAt = nowISO();
  if (reg.experimental === id) reg.experimental = null;
  reg.history.push({ t: nowISO(), action: 'reject', model: id, kept: reg.production, reason });
  return save(root, reg);
}
/**
 * Go back to an earlier model: the previous stable one by default, or any version that still has its weights.
 * The model that was in production stays on disk as "previous", so a rollback can itself be undone.
 */
export function rollback(root, { to = null, reason = '', by = 'admin' } = {}) {
  const reg = loadRegistry(root);
  const target = to || reg.previous;
  if (!target) throw new Error('there is no earlier model to go back to');
  if (!reg.models[target]) throw new Error(`unknown model ${target}`);
  if (!usable(root, target)) throw new Error(`the weights of ${target} are no longer on disk`);
  if (target === reg.production) throw new Error(`${target} is already the production model`);
  const from = reg.production;
  if (from && reg.models[from]) { reg.models[from].status = 'rolled-back'; reg.models[from].rolledBackAt = nowISO(); }
  reg.models[target].status = 'production';
  reg.production = target; reg.previous = from;
  reg.history.push({ t: nowISO(), action: 'rollback', from, to: target, by, reason });
  return save(root, reg);
}

/** Copy the production model (and a read-only snapshot of the learning records) into <repo>/model, the part that ships. */
export function publish(root, snapshot, { dest = BUNDLED } = {}) {
  const reg = loadRegistry(root);
  if (!reg.production) throw new Error('there is no production model to publish');
  fs.rmSync(path.join(dest, 'current'), { recursive: true, force: true });
  copyDir(modelDir(root, reg.production), path.join(dest, 'current'), ['model.json', 'weights.bin', 'tokenizer.json']);
  // the published records must not carry paths of the machine that trained the model
  const abs = path.resolve(root) + path.sep;
  const clean = JSON.parse(JSON.stringify({ ...snapshot, published: nowISO() }).split(JSON.stringify(abs).slice(1, -1)).join(''));
  writeJSON(path.join(dest, 'snapshot.json'), clean);
  return { model: reg.production, dest };
}

/** Where the serving process should load its model from: live state first, the bundled copy otherwise. */
export function resolveProduction(root, { bundled = BUNDLED } = {}) {
  const reg = loadRegistry(root);
  if (reg.production && usable(root, reg.production)) return { dir: modelDir(root, reg.production), id: reg.production, card: reg.models[reg.production], source: 'state', registryMtime: mtime(paths(root).registry) };
  const cur = path.join(bundled, 'current');
  if (fs.existsSync(path.join(cur, 'weights.bin'))) { const snap = readJSON(path.join(bundled, 'snapshot.json'), {}) || {}; const id = (snap.registry && snap.registry.production) || 'bundled'; return { dir: cur, id, card: (snap.registry && snap.registry.models && snap.registry.models[id]) || null, source: 'bundled', registryMtime: mtime(path.join(bundled, 'snapshot.json')) }; }
  return null;
}
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

/** Training curve of a run, thinned to at most `max` points (always keeps the points that carry a validation loss). */
export function runMetrics(root, runId, max = 400) {
  const rows = readLines(path.join(paths(root).runs, runId, 'metrics.jsonl'));
  if (rows.length <= max) return rows;
  const keep = Math.ceil(rows.length / max);
  return rows.filter((r, i) => i % keep === 0 || r.val_loss != null || i === rows.length - 1);
}
