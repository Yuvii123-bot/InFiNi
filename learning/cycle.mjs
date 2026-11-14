// INFINITY LLM — learning: one learning cycle, start to finish, resumable at every phase.
//
//   acquire → dataset → train → export → evaluate → gate → promote or reject
//
// Runs in its own process (learning/cli.mjs), never inside the chat server: acquisition and dataset building use this
// process, training and loss evaluation use a Python process at low priority, and the chat keeps answering from the
// production weights the whole time. A candidate model replaces production only through the gate at the end.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REPO, paths, loadConfig, readJSON, writeJSON, appendLine, readLines, nowISO, nextId, listDirs, pythonPath, logEvent } from './store.mjs';
import { acquire, loadCorpus, corpusStats } from './corpus.mjs';
import { buildDataset, buildDialogue } from './dataset.mjs';
import { evaluateModel, promotionGate } from './evalsuite.mjs';
import { loadRegistry, registerModel, promote, reject, modelDir } from './registry.mjs';

export const isPaused = (root) => !!(readJSON(paths(root).control, {}) || {}).paused;
export function setState(root, patch) { const P = paths(root); const s = { ...(readJSON(P.state, {}) || {}), ...patch, updated: nowISO() }; writeJSON(P.state, s); return s; }
export const getState = (root) => readJSON(paths(root).state, {}) || {};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export function workerRunning(root) { const l = readJSON(paths(root).lock, null); return l && l.pid && alive(l.pid) ? l : null; }

/** Run a Python module of the llm package; JSON lines on its stdout go to onEvent. Resolves {code, last, stderr}. */
export function runPython(cfg, args, { onEvent = null, onSpawn = null, env = process.env } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(pythonPath(cfg, env), ['-m', ...args], { cwd: REPO, env: { ...env, PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ code: -1, last: null, stderr: String(e && e.message), all: '' }); }
    if (onSpawn) onSpawn(child);
    let buf = '', all = '', err = '', last = null;
    child.stdout.on('data', (d) => { buf += d; all += d; if (all.length > 400000) all = all.slice(-200000); let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line[0] !== '{') continue; try { last = JSON.parse(line); if (onEvent) onEvent(last); } catch { /* not a JSON line */ } } });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', (e) => resolve({ code: -1, last, stderr: String(e && e.message), all }));
    child.on('close', (code) => resolve({ code, last, stderr: err, all }));
  });
}
const parseOut = (all) => { try { return JSON.parse(all.slice(all.indexOf('{'))); } catch { return null; } };

/** What this machine can train on. Never throws: when Python or PyTorch is missing, training is reported unavailable. */
export async function probeHardware(root, cfg, { bench = false, env = process.env } = {}) {
  const r = await runPython(cfg, ['llm.hw', ...(bench ? ['--bench', '--vocab', String(cfg.model.vocab_size)] : [])], { env });
  const out = r.code === 0 ? parseOut(r.all) : null;
  const hw = out ? { ...out, available: true, probed: nowISO() } : { available: false, probed: nowISO(), reason: (r.stderr || 'Python with PyTorch was not found').trim().split('\n').pop().slice(0, 200), hardware: { cpu_count: os.cpus().length, memory_gb: +(os.totalmem() / 2 ** 30).toFixed(2) } };
  writeJSON(path.join(root, 'hardware.json'), hw);
  return hw;
}

/**
 * Verified documents that discovery rounds collected and no training cycle has used yet. Derived from the corpus itself
 * (documents carry the round that found them), so a crash between two writes cannot lose or duplicate one.
 */
export function pendingInfo(root) {
  const done = new Set(((readJSON(paths(root).pending, null) || {}).trained) || []);
  const docs = loadCorpus(root).filter((d) => /^r\d+$/.test(d.cycle || '') && !done.has(d.id));
  return { ids: docs.map((d) => d.id), since: docs.length ? docs[0].collectedAt : null };
}
export const pendingDocs = (root) => pendingInfo(root).ids;
function clearPending(root, ids) { const P = paths(root); const cur = readJSON(P.pending, null) || { trained: [] }; cur.trained = [...new Set([...(cur.trained || []), ...ids])]; cur.updated = nowISO(); writeJSON(P.pending, cur); }

/** A trainer left behind by a killed cycle process would write into the same run directory: stop it before continuing. */
export async function reapTrainer(root, run) {
  if (!run) return false;
  const st = readJSON(path.join(paths(root).runs, run, 'status.json'), null);
  const pid = st && st.pid;
  if (!pid || pid === process.pid || !alive(pid)) return false;
  let cmd = '';
  try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { /* not Linux: trust the pid */ cmd = 'llm.train'; }
  if (!cmd.includes('llm.train')) return false;
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }                    // it writes a checkpoint and exits
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 500));
  if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  logEvent(root, 'orphan-stopped', { pid, run });
  return true;
}

/**
 * One discovery round: find, read, filter and verify new documents, without training. The accepted ones wait in
 * corpus/pending.json until the next training cycle uses them as its fresh data. Returns the acquisition report.
 */
export async function discover({ root, engine, env = process.env, maxDocs = 0, log = () => {} } = {}) {
  const P = paths(root);
  fs.mkdirSync(root, { recursive: true });
  if (workerRunning(root)) throw Object.assign(new Error('a learning step is already running'), { code: 'busy' });
  if (isPaused(root)) throw Object.assign(new Error('learning is paused'), { code: 'paused' });
  writeJSON(P.lock, { pid: process.pid, started: nowISO(), kind: 'discover' });
  try {
    const cfg = loadConfig(root);
    const note = (text, extra = {}) => { log(text); logEvent(root, 'note', { text, ...extra }); };
    const n = readLines(path.join(root, 'discovery.jsonl')).length + 1;
    const round = 'r' + String(n).padStart(5, '0');
    setState(root, { status: 'running', phase: 'discover', cycle: null, message: 'finding and reading new documents', pid: process.pid, startedAt: nowISO() });
    logEvent(root, 'phase', { phase: 'discover', round, message: 'finding and reading new documents' });
    const started = nowISO();
    const result = await acquire({ engine, cfg, root, cycle: round, env, note, maxDocs: maxDocs || cfg.worker.discoverDocs });
    const pend = pendingInfo(root);
    const rec = { round, started, finished: nowISO(), collected: result.report.collected, accepted: result.report.accepted, rejected: result.report.rejected, reasons: result.report.reasons, bySource: result.report.bySource, errors: result.report.errors, waiting: pend.ids.length };
    appendLine(path.join(root, 'discovery.jsonl'), rec);
    setState(root, { status: 'idle', phase: null, pid: null, message: `discovery ${round}: ${rec.accepted} accepted, ${rec.rejected} rejected; ${rec.waiting} waiting for training`, lastDiscovery: { round, t: rec.finished, accepted: rec.accepted, rejected: rec.rejected, collected: rec.collected } });
    logEvent(root, 'discovery', { round, collected: rec.collected, accepted: rec.accepted, rejected: rec.rejected, waiting: rec.waiting });
    return rec;
  } finally { try { fs.unlinkSync(P.lock); } catch { /* already gone */ } }
}

class Paused extends Error { constructor() { super('paused'); this.code = 'paused'; } }

/**
 * @param opts.kind 'cycle' (default) | 'evaluate' (re-evaluate the production model only)
 * @returns the cycle record that was appended to cycles.jsonl
 */
export async function runCycle({ root, engine = null, env = process.env, overrides = {}, log = () => {} } = {}) {
  const P = paths(root);
  fs.mkdirSync(root, { recursive: true });
  if (workerRunning(root)) throw Object.assign(new Error('a learning cycle is already running'), { code: 'busy' });
  if (isPaused(root)) throw Object.assign(new Error('learning is paused'), { code: 'paused' });
  writeJSON(P.lock, { pid: process.pid, started: nowISO() });
  const cfg = loadConfig(root);
  Object.assign(cfg.cycle, overrides.cycle || {});
  const note = (text, extra = {}) => { log(text); logEvent(root, 'note', { text, ...extra }); };
  const cycFile = path.join(root, 'cycle.json');
  let cyc = readJSON(cycFile, null);
  if (!cyc || cyc.finished) {
    const done = readLines(P.cycles).map((c) => c.id);
    cyc = { id: nextId('c', [...done, ...listDirs(P.runs)]), started: nowISO(), phases: {}, parent: loadRegistry(root).production };
  } else { note(`continuing cycle ${cyc.id} after an interruption`); await reapTrainer(root, cyc.run); }
  const saveCyc = () => writeJSON(cycFile, cyc);
  let interrupted = false;                       // SIGTERM / SIGINT: stop at the next safe point and leave the cycle resumable
  const onSignal = () => { interrupted = true; if (cyc.run) { try { fs.writeFileSync(path.join(P.runs, cyc.run, 'stop'), 'shutdown'); } catch { /* run directory not there yet */ } } };
  process.on('SIGTERM', onSignal); process.on('SIGINT', onSignal);
  const phase = (name, message) => { if (isPaused(root) || interrupted) throw new Paused(); setState(root, { status: 'running', phase: name, cycle: cyc.id, message, pid: process.pid, startedAt: cyc.started }); logEvent(root, 'phase', { cycle: cyc.id, phase: name, message }); log(`[${cyc.id}] ${name}: ${message}`); };
  let child = null;
  const watch = setInterval(() => { if (isPaused(root) && child && cyc.run) { try { fs.writeFileSync(path.join(P.runs, cyc.run, 'stop'), 'paused'); } catch { /* run directory not there yet */ } } }, 1500);
  const finish = (outcome, extra = {}) => {
    cyc.finished = nowISO(); cyc.outcome = outcome; Object.assign(cyc, extra); saveCyc();
    const rec = { id: cyc.id, started: cyc.started, finished: cyc.finished, seconds: Math.round((Date.parse(cyc.finished) - Date.parse(cyc.started)) / 1000), outcome, parent: cyc.parent, dataset: cyc.dataset || null, model: cyc.model || null, acquisition: cyc.acquisition || null, training: cyc.training || null, plan: cyc.plan || null, cautionAfter: cyc.cautionAfter ?? null, data: cyc.datasetSummary || null, evaluation: cyc.evaluation || null, gate: cyc.gate || null, message: cyc.message || '' };
    appendLine(P.cycles, rec);
    if (['promoted', 'rejected'].includes(outcome)) clearPending(root, cyc.fresh || []);      // these documents have been trained on; from now on they are replay
    const ok = ['promoted', 'rejected', 'no-new-data'].includes(outcome);
    setState(root, { status: 'idle', phase: null, pid: null, training: null, candidate: null, message: cyc.message || outcome, lastCycle: { id: cyc.id, outcome, finished: cyc.finished }, ...(ok ? { lastSuccess: cyc.finished } : { lastError: { t: cyc.finished, message: cyc.message || outcome } }) });
    logEvent(root, 'cycle', { cycle: cyc.id, outcome, message: cyc.message || '' });
    return rec;
  };
  try {
    const reg0 = loadRegistry(root);
    // A configured preset that differs from the production model's architecture starts a new lineage: train a
    // fresh model of the requested size from random weights instead of continuing the small one. It is judged as
    // a first model (it does not have to beat the small production model), and the old model stays in place until
    // the new one is approved, so a failed attempt costs nothing.
    const wantPreset = cfg.model.preset && cfg.model.preset !== 'auto' ? cfg.model.preset : null;
    const prodPreset = reg0.production ? (reg0.models[reg0.production] || {}).preset : null;
    const newLineage = !!(wantPreset && prodPreset && wantPreset !== prodPreset);
    const bootstrap = !reg0.production || newLineage;
    cyc.newLineage = newLineage;
    // ---------- A–D: discover, acquire, process, verify ----------
    if (!cyc.phases.acquire) {
      phase('acquire', 'finding and reading new documents');
      const before = loadCorpus(root).length;
      const waiting = pendingDocs(root);            // verified documents that discovery rounds collected since the last training cycle
      const collectNow = overrides.acquire !== false;
      let result = { accepted: [], report: { collected: 0, accepted: 0, rejected: 0, reasons: {}, bySource: {}, errors: collectNow ? ['no search engine available in this process'] : [] } };
      if (engine && collectNow) result = await acquire({ engine, cfg, root, cycle: cyc.id, env, note, maxDocs: bootstrap ? Math.max(cfg.cycle.maxNewDocs, cfg.cycle.bootstrapDocs || 0) : cfg.cycle.maxNewDocs });
      cyc.acquisition = { ...result.report, fromDiscovery: waiting.length, corpusBefore: before, corpusAfter: before + result.report.accepted };
      cyc.fresh = [...new Set([...waiting, ...result.accepted.map((d) => d.id)])];
      cyc.phases.acquire = nowISO(); saveCyc();
      note(`${waiting.length} documents waiting from discovery; collected ${result.report.collected} now, accepted ${result.report.accepted}, rejected ${result.report.rejected} ${JSON.stringify(result.report.reasons)}`);
    }
    if (!bootstrap && cyc.fresh.length < cfg.cycle.minNewDocs) { cyc.message = `only ${cyc.fresh.length} new verified documents (at least ${cfg.cycle.minNewDocs} are needed): nothing was trained`; return finish('no-new-data'); }
    // ---------- E: dataset ----------
    if (!cyc.phases.dataset) {
      phase('dataset', 'building training and validation sequences');
      const version = nextId('d', listDirs(P.datasets));
      const tokenizer = readJSON(P.tokenizer, null);
      const context = bootstrap ? null : loadRegistry(root).models[reg0.production].context;
      const hw = bootstrap ? await probeHardware(root, cfg, { bench: true, env }) : readJSON(path.join(root, 'hardware.json'), null) || await probeHardware(root, cfg, { env });
      if (bootstrap) { cyc.preset = cfg.model.preset === 'auto' ? (hw.recommended_preset || 'micro') : cfg.model.preset; cyc.hardware = hw.hardware || null; }
      const ctxLen = context || ((hw.presets && hw.presets[cyc.preset]) || { context: 256 }).context;
      const built = buildDataset({ dir: path.join(P.datasets, version), version, docs: loadCorpus(root), freshIds: bootstrap ? null : cyc.fresh, cfg, tokenizer, context: ctxLen, cycle: cyc.id, parent: (reg0.models[reg0.production] || {}).dataset || '', seed: 11 + listDirs(P.datasets).length, log: note, dialogue: buildDialogue({ seed: 7, conversations: cfg.dialogue.conversations }) });
      if (!tokenizer) writeJSON(P.tokenizer, built.tokenizer);
      // a dataset in which benchmark or validation material is found is never trained on
      { const it = built.manifest.integrity; const leaks = (it.benchmarkSentencesInTraining || 0) + (it.valDocumentsInTraining || 0) + (it.valHashesInTraining || 0);
        if (leaks) { cyc.message = `dataset ${version} failed its contamination check (${it.benchmarkSentencesInTraining || 0} benchmark sentences, ${(it.valDocumentsInTraining || 0) + (it.valHashesInTraining || 0)} validation documents in the training text): not trained`; cyc.datasetSummary = { integrity: it }; return finish('error'); } }
      cyc.dataset = version; cyc.datasetSummary = { tokens: built.manifest.tokens, documents: built.manifest.documents, mixture: built.manifest.mixture, integrity: built.manifest.integrity };
      cyc.phases.dataset = nowISO(); saveCyc();
      note(`dataset ${version}: ${built.manifest.tokens.train} training tokens, ${built.manifest.tokens.validation} validation tokens, mixture ${JSON.stringify(built.manifest.mixture)}`);
    }
    const dataDir = path.join(P.datasets, cyc.dataset);
    const manifest = readJSON(path.join(dataDir, 'dataset.json'));
    // ---------- F: training ----------
    cyc.run = cyc.run || cyc.id;
    const runDir = path.join(P.runs, cyc.run);
    if (!cyc.phases.train) {
      const hw = readJSON(path.join(root, 'hardware.json'), {}) || {};
      if (!hw.available) { cyc.message = `training is not available on this machine (${hw.reason || 'no Python with PyTorch'}); the collected data is kept for a later cycle`; cyc.phases = { acquire: cyc.phases.acquire }; return finish('training-unavailable'); }
      const freeMb = os.freemem() / 2 ** 20;
      if (freeMb < cfg.resources.minFreeMb) { cyc.message = `only ${Math.round(freeMb)} MB of memory is free (limit ${cfg.resources.minFreeMb} MB): training postponed`; return finish('postponed'); }
      const budget = bootstrap ? cfg.cycle.bootstrapSeconds : cfg.cycle.trainSeconds;
      const used = (cyc.training && cyc.training.cycle_seconds_total) || 0;
      const left = Math.max(20, budget - used);
      const bs = cfg.train.batch_size * (cfg.train.grad_accum || 1);
      const b = (hw.bench || []).find((x) => x.preset === (cyc.preset || (reg0.models[reg0.production] || {}).preset));
      const tps = (cyc.training && cyc.training.tok_per_s) || (b && b.tokens_per_second) || 8000;
      cyc.plannedSteps = cyc.plannedSteps || Math.max(50, Math.round(budget * tps * 0.9 / (bs * manifest.context)));
      phase('train', bootstrap ? `training the first model from random weights (${cyc.preset}, about ${Math.round(budget / 60)} min)` : `continuing from ${reg0.production} on ${cyc.dataset} (about ${Math.round(budget / 60)} min)`);
      const sets = { ...cfg.train, threads: cfg.resources.threads, nice: cfg.resources.nice, duty: cfg.resources.duty };
      if (!bootstrap) {
        // Caution: every candidate that was refused for generalising worse makes the next cycle train more carefully
        // (half the learning rate, twice the pull towards the approved weights, fewer passes); a promotion relaxes it.
        if (cyc.caution == null) {
          cyc.caution = Math.max(0, Math.min(cfg.cycle.maxCaution ?? 3, getState(root).caution || 0));
          const trainTokens = (manifest.shards || []).filter((x) => x.split === 'train').reduce((a, x) => a + x.tokens, 0);
          const passes = (cfg.cycle.maxPasses ?? 1.5) / (1 + cyc.caution);
          const cap = Math.max(50, Math.round(passes * trainTokens / (bs * manifest.context)));
          cyc.plan = { caution: cyc.caution, lr: +(cfg.cycle.incrementalLr / 2 ** cyc.caution).toPrecision(3), anchorL2: +(cfg.cycle.anchorL2 * 2 ** cyc.caution).toPrecision(3), passes: +passes.toFixed(2), stepsByTime: cyc.plannedSteps, stepsByData: cap };
          cyc.plannedSteps = Math.min(cyc.plannedSteps, cap);
          cyc.plan.steps = cyc.plannedSteps;
          saveCyc();                                             // a continued cycle keeps the same plan
          if (cyc.caution) note(`careful training (level ${cyc.caution}): learning rate ${cyc.plan.lr}, ${cyc.plan.passes} passes over the data, ${cyc.plannedSteps} steps`);
        }
        sets.lr = cyc.plan.lr; sets.min_lr = cyc.plan.lr / 4; sets.anchor_l2 = cyc.plan.anchorL2; sets.warmup_steps = 30;
      }
      const args = ['llm.train', '--data', dataDir, '--run', runDir, '--steps', String(cyc.plannedSteps), '--max-seconds', String(left), '--cycle', cyc.id];
      if (bootstrap) args.push('--preset', cyc.preset); else args.push('--init-from', path.join(modelDir(root, reg0.production), 'ckpt.pt'));
      for (const [k, v] of Object.entries(sets)) args.push('--set', `${k}=${v}`);
      let startInfo = null, lastStep = null, stoppedForMemory = false;
      const r = await runPython(cfg, args, { env, onSpawn: (c) => { child = c; }, onEvent: (ev) => {
        if (ev.event === 'start') { startInfo = ev; logEvent(root, 'train-start', { cycle: cyc.id, source: ev.source, params: ev.params, device: ev.device, precision: ev.precision }); }
        if (ev.event === 'step') {
          lastStep = ev;
          setState(root, { training: { step: ev.step, of: cyc.plannedSteps + ((startInfo && startInfo.cycle && startInfo.cycle.start_step) || 0), loss: ev.loss, val_loss: ev.val_loss ?? (getState(root).training || {}).val_loss ?? null, lr: ev.lr, tokens: ev.tokens, tokPerS: ev.tok_per_s, elapsedS: ev.elapsed_s, rssMb: ev.rss_mb ?? null } });
          if (ev.rss_mb && ev.rss_mb > cfg.resources.maxTrainRssMb && !stoppedForMemory) { stoppedForMemory = true; try { fs.writeFileSync(path.join(runDir, 'stop'), 'memory'); } catch { /* ignore */ } }
        }
      } });
      child = null;
      const end = r.last && r.last.event === 'end' ? r.last : null;
      if (!end) { cyc.message = `training stopped with an error: ${(r.last && r.last.message) || r.stderr.trim().split('\n').pop() || 'exit code ' + r.code}`; cyc.training = { ...(cyc.training || {}), error: cyc.message }; return finish('training-failed'); }
      cyc.training = { source: startInfo && startInfo.source, params: startInfo && startInfo.params, device: startInfo && startInfo.device, precision: startInfo && startInfo.precision, model_config: startInfo && startInfo.model_config, step: end.step, tokens_seen: end.tokens_seen, train_seconds: end.train_seconds, cycle_seconds_total: used + end.cycle_seconds, val_loss: end.val_loss, reason: end.reason, finished: end.finished, rss_mb: end.rss_mb, tok_per_s: lastStep && lastStep.tok_per_s, last_loss: lastStep && lastStep.loss, lr: lastStep && lastStep.lr, planned_steps: cyc.plannedSteps };
      saveCyc();
      if (isPaused(root) || interrupted) throw new Paused();
      if (stoppedForMemory) { cyc.message = `training used more than ${cfg.resources.maxTrainRssMb} MB and was stopped; the checkpoint is kept`; return finish('postponed'); }
      cyc.phases.train = nowISO(); saveCyc();
      note(`training ended (${end.reason}) at step ${end.step}, validation loss ${end.val_loss}`);
    }
    // ---------- export the candidate ----------
    const reg1 = loadRegistry(root);
    if (!cyc.phases.export) {
      phase('export', 'writing the candidate model');
      cyc.model = cyc.model || nextId('m', [...Object.keys(reg1.models), ...listDirs(P.models)]);
      const mdir = modelDir(root, cyc.model);
      fs.mkdirSync(mdir, { recursive: true });
      fs.copyFileSync(path.join(runDir, 'ckpt.pt'), path.join(mdir, 'ckpt.pt'));
      const r = await runPython(cfg, ['llm.export', '--ckpt', path.join(mdir, 'ckpt.pt'), '--out', mdir, '--dtype', 'f16'], { env });
      if (r.code !== 0) { cyc.message = `export failed: ${r.stderr.trim().split('\n').pop()}`; return finish('export-failed'); }
      fs.copyFileSync(P.tokenizer, path.join(mdir, 'tokenizer.json'));
      const meta = readJSON(path.join(mdir, 'model.json'));
      registerModel(root, { id: cyc.model, status: 'experimental', created: nowISO(), parent: cyc.parent, cycle: cyc.id, dataset: cyc.dataset, preset: cyc.preset || (reg1.models[cyc.parent] || {}).preset || '', config: meta.config, context: meta.config.context, params: meta.params, step: meta.step, tokens_seen: meta.tokens_seen, train_seconds: cyc.training.train_seconds, sha256: meta.sha256, weightsBytes: fs.statSync(path.join(mdir, 'weights.bin')).size, tokenizer_sha: meta.tokenizer_sha, initialisation: cyc.parent ? `continued from ${cyc.parent}` : 'random (seeded), no pretrained weights' });
      cyc.phases.export = nowISO(); saveCyc();
    }
    // ---------- G: evaluation and the promotion gate ----------
    phase('evaluate', 'measuring the candidate against the production model on held-out data and the fixed benchmark');
    // a new-lineage model (a bigger architecture trained from scratch) is judged as a first model: it does not
    // have to beat the small production model, which stays in place until the new one is approved
    const prodId = newLineage ? null : reg1.production;
    setState(root, { candidate: { id: cyc.model, parent: cyc.parent, dataset: cyc.dataset, since: nowISO() } });
    const ckpts = [path.join(modelDir(root, cyc.model), 'ckpt.pt'), ...(prodId ? [path.join(modelDir(root, prodId), 'ckpt.pt')] : [])];
    const ev = await runPython(cfg, ['llm.evaluate', '--data', dataDir, ...ckpts.flatMap((c) => ['--ckpt', c]), '--windows', String(cfg.cycle.evalWindows), '--threads', String(cfg.resources.threads)], { env });
    const losses = ev.code === 0 ? parseOut(ev.all) : null;
    if (!losses) { cyc.message = `evaluation failed: ${ev.stderr.trim().split('\n').pop()}`; reject(root, cyc.model, { reason: cyc.message }); return finish('evaluation-failed'); }
    const cand = { id: cyc.model, ...pickLoss(losses.results[0]), probes: await evaluateModel(modelDir(root, cyc.model), dataDir) };
    const prod = prodId ? { id: prodId, ...pickLoss(losses.results[1]), probes: await evaluateModel(modelDir(root, prodId), dataDir) } : null;
    const gate = promotionGate(cand, prod, cfg.gate, { vocab: manifest.vocab_size });
    cyc.evaluation = { dataset: cyc.dataset, candidate: summary(cand), production: prod ? summary(prod) : null };
    cyc.gate = gate;
    writeJSON(path.join(modelDir(root, cyc.model), 'evaluation.json'), { dataset: cyc.dataset, candidate: cand, production: prod, gate, evaluated: nowISO() });
    if (prod && prod.probes.benchmark && !(reg1.models[prodId] || {}).benchmark) registerModel(root, { id: prodId, benchmark: summary(prod).benchmark });
    registerModel(root, { id: cyc.model, val_loss: cand.val_loss, groups: cand.groups, probes: summary(cand).probes, benchmark: summary(cand).benchmark, memorization: summary(cand).memorization, gate: { pass: gate.pass, comparedWith: gate.comparedWith, failed: gate.checks.filter((c) => !c.pass).map((c) => c.name) }, evaluatedOn: cyc.dataset });
    if (prod) {
      const general = /benchmark|held-out document text|trained text|recite|earlier knowledge/;
      const before = getState(root).caution || 0;
      const after = gate.pass ? Math.max(0, before - 1) : gate.checks.some((c) => !c.pass && general.test(c.name)) ? Math.min(cfg.cycle.maxCaution ?? 3, before + 1) : before;
      if (after !== before) { setState(root, { caution: after }); note(`training caution ${before} → ${after}`); }
      cyc.cautionAfter = after;
    }
    if (gate.pass) {
      promote(root, cyc.model, { reason: prod ? `passed all ${gate.checks.length} checks against ${prodId}` : `first model; passed all ${gate.checks.length} checks`, by: 'gate' });
      const bs = (m) => (m.probes.benchmark ? m.probes.benchmark.score : 'n/a');
      cyc.message = prod ? `${cyc.model} replaced ${prodId} (held-out loss ${cand.val_loss} vs ${prod.val_loss}; benchmark ${bs(cand)} vs ${bs(prod)})` : `${cyc.model} is the first production model (held-out loss ${cand.val_loss}; benchmark ${bs(cand)})`;
      return finish('promoted');
    }
    const failed = gate.checks.filter((c) => !c.pass).map((c) => `${c.name} [${c.detail}]`).join('; ');
    reject(root, cyc.model, { reason: failed });
    cyc.message = `${cyc.model} was not promoted: ${failed}. ${prodId ? prodId + ' stays in production.' : 'There is still no production model.'}`;
    return finish('rejected');
  } catch (e) {
    if (e && e.code === 'paused' && interrupted && !isPaused(root)) { saveCyc(); setState(root, { status: 'idle', pid: null, message: `cycle ${cyc.id} was interrupted and will continue where it stopped` }); logEvent(root, 'interrupted', { cycle: cyc.id, phase: getState(root).phase }); return { id: cyc.id, outcome: 'interrupted' }; }
    if (e && e.code === 'paused') { saveCyc(); setState(root, { status: 'paused', phase: getState(root).phase, pid: null, message: `cycle ${cyc.id} is paused and will continue where it stopped` }); logEvent(root, 'paused', { cycle: cyc.id }); return { id: cyc.id, outcome: 'paused' }; }
    cyc.message = `cycle failed: ${String(e && e.message).slice(0, 300)}`;
    return finish('error');
  } finally {
    process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
    clearInterval(watch);
    try { fs.unlinkSync(P.lock); } catch { /* already gone */ }
  }
}
const pickLoss = (r) => ({ val_loss: r.val_loss, perplexity: r.perplexity, groups: r.groups, windows: r.windows, step: r.step });
const benchSummary = (b) => (b ? { id: b.id, score: b.score, items: b.items, language: b.categories.language.accuracy, knowledge: b.categories.knowledge.accuracy, reasoning: b.categories.reasoning.accuracy, conversation: b.categories.conversation.accuracy, passageLoss: b.passages.loss } : null);
const memSummary = (m) => (m ? { gap: m.gap, verbatimTrained: m.trained.verbatim, verbatimUnseen: m.unseen.verbatim, lossTrained: m.trained.loss, lossUnseen: m.unseen.loss, passages: [m.trained.passages, m.unseen.passages] } : null);
const summary = (m) => ({ id: m.id, val_loss: m.val_loss, perplexity: m.perplexity, groups: m.groups, benchmark: benchSummary(m.probes.benchmark), memorization: memSummary(m.probes.memorization), probes: { parity: m.probes.parity.ok, chatExact: m.probes.chat.exact, chatAccepted: m.probes.chat.accepted ?? null, chatF1: m.probes.chat.f1, grounded: m.probes.grounded.accuracy, groundedChance: m.probes.grounded.chance, route: m.probes.route.accuracy, repetition: m.probes.sampling.repetition, unfinished: m.probes.sampling.unfinished, tokensPerSecond: m.probes.inference.tokensPerSecond } });

/** Evaluate the production model again on the newest dataset (admin "evaluate now"). */
export async function evaluateProduction({ root, env = process.env } = {}) {
  const P = paths(root), cfg = loadConfig(root), reg = loadRegistry(root);
  if (!reg.production) throw new Error('there is no production model');
  if (workerRunning(root)) throw Object.assign(new Error('a learning cycle is running'), { code: 'busy' });
  writeJSON(P.lock, { pid: process.pid, started: nowISO(), kind: 'evaluate' });
  try {
    const ds = listDirs(P.datasets).pop();
    const dataDir = path.join(P.datasets, ds);
    setState(root, { status: 'running', phase: 'evaluate', message: `evaluating ${reg.production} on ${ds}`, pid: process.pid });
    const ev = await runPython(cfg, ['llm.evaluate', '--data', dataDir, '--ckpt', path.join(modelDir(root, reg.production), 'ckpt.pt'), '--windows', String(cfg.cycle.evalWindows)], { env });
    const losses = ev.code === 0 ? parseOut(ev.all) : null;
    const m = { id: reg.production, ...(losses ? pickLoss(losses.results[0]) : { val_loss: null, groups: {} }), probes: await evaluateModel(modelDir(root, reg.production), dataDir) };
    const rec = { t: nowISO(), model: reg.production, dataset: ds, ...summary(m), lossAvailable: !!losses };
    appendLine(path.join(root, 'evaluations.jsonl'), rec);
    setState(root, { status: 'idle', phase: null, pid: null, message: `evaluated ${reg.production}` });
    logEvent(root, 'evaluation', { model: reg.production, dataset: ds, val_loss: m.val_loss });
    return rec;
  } finally { try { fs.unlinkSync(P.lock); } catch { /* already gone */ } }
}

/** Everything the dashboard shows, read from the files the training system wrote. */
export function snapshot(root, { curvePoints = 300 } = {}) {
  const P = paths(root), reg = loadRegistry(root), cfg = loadConfig(root);
  const cycles = readLines(P.cycles);
  const st = getState(root);
  const running = workerRunning(root);
  const prod = reg.production ? reg.models[reg.production] : null;
  const curve = [];
  for (const run of listDirs(P.runs)) { const rows = readLines(path.join(P.runs, run, 'metrics.jsonl')); const keep = Math.max(1, Math.ceil(rows.length / curvePoints)); rows.forEach((r, i) => { if (i % keep === 0 || r.val_loss != null || i === rows.length - 1) curve.push({ run, step: r.step, loss: r.loss, val_loss: r.val_loss ?? null, lr: r.lr, tokens: r.tokens, tok_per_s: r.tok_per_s, t: r.t }); }); }
  const dsets = listDirs(P.datasets).map((d) => { const m = readJSON(path.join(P.datasets, d, 'dataset.json'), null); return m ? { version: m.version, created: m.created, cycle: m.cycle, parent: m.parent, tokens: m.tokens, documents: m.documents, mixture: m.mixture, integrity: m.integrity, probes: m.probes } : null; }).filter(Boolean);
  // the always-on worker: alive when its heartbeat is recent
  let worker = readJSON(P.worker, null);
  if (worker) { const age = Math.max(0, Math.round((Date.now() - Date.parse(worker.heartbeat)) / 1000)); worker = { ...worker, heartbeatAgeSeconds: age, alive: worker.state !== 'stopped' && age < 180 && (worker.pid === process.pid || alive(worker.pid) || worker.host !== os.hostname()) }; }
  const pend = fs.existsSync(P.docs) ? pendingInfo(root) : { ids: [], since: null };
  const judged = [...cycles].reverse().find((c) => c.gate && c.model);
  const benchRows = Object.values(reg.models).filter((m) => m.benchmark).sort((a, b) => (a.id < b.id ? -1 : 1)).map((m) => ({ ...m.benchmark, benchmark: m.benchmark.id || null, id: m.id, status: m.status, val_loss: m.val_loss ?? null, evaluatedOn: m.evaluatedOn || null }));
  return {
    generated: nowISO(), host: { trainingCapable: true },
    status: { state: isPaused(root) ? 'paused' : running ? 'running' : (st.status === 'running' ? 'idle' : st.status || 'idle'), paused: isPaused(root), phase: running ? st.phase : null, cycle: running ? st.cycle : null, message: st.message || '', training: running ? st.training || null : null, lastCycle: st.lastCycle || null, lastSuccess: st.lastSuccess || null, lastError: st.lastError || null, nextRunAt: st.nextRunAt || null, auto: !!cfg.cycle.auto, lastDiscovery: st.lastDiscovery || null, mode: worker && worker.alive ? 'worker' : cfg.cycle.auto ? 'schedule' : 'manual' },
    worker,
    discovery: { waiting: pend.ids.length, waitingSince: pend.since, trainAt: cfg.worker.trainWhenNewDocs, trainAfterMinutes: cfg.worker.trainAfterMinutes, minNewDocs: cfg.cycle.minNewDocs, rounds: readLines(path.join(root, 'discovery.jsonl'), { last: 30 }) },
    candidate: { current: running && st.candidate ? st.candidate : (running && st.phase && ['train', 'export', 'evaluate'].includes(st.phase) ? { id: null, cycle: st.cycle, phase: st.phase } : null), last: judged ? { id: judged.model, cycle: judged.id, outcome: judged.outcome, finished: judged.finished, comparedWith: judged.gate.comparedWith, passed: judged.gate.pass, failed: judged.gate.checks.filter((c) => !c.pass).map((c) => c.name), evaluation: judged.evaluation || null, plan: judged.plan || null } : null, caution: st.caution || 0 },
    benchmark: { file: 'learning/benchmark/v1.json', models: benchRows },
    model: prod ? { ...prod } : null,
    registry: { production: reg.production, previous: reg.previous, experimental: reg.experimental, models: reg.models, history: reg.history.slice(-60) },
    cycles: cycles.slice(-40), curve, datasets: dsets, corpus: fs.existsSync(P.docs) ? corpusStats(root) : null,
    evaluations: readLines(path.join(root, 'evaluations.jsonl'), { last: 20 }),
    hardware: readJSON(path.join(root, 'hardware.json'), null),
    config: { cycle: cfg.cycle, mixture: cfg.mixture, gate: cfg.gate, resources: cfg.resources, quality: cfg.quality, licences: cfg.licences, sources: cfg.sources.map((s) => ({ id: s.id, type: s.type, enabled: s.enabled !== false, repo: s.repo || undefined, topics: s.topics || undefined, perCycle: s.perCycle, publisher: s.publisher || undefined })) },
    events: readLines(P.events, { last: 60 }),
    totals: { cycles: cycles.length, promoted: cycles.filter((c) => c.outcome === 'promoted').length, rejected: cycles.filter((c) => c.outcome === 'rejected').length, trainSeconds: prod ? prod.train_seconds : 0, tokensTrained: prod ? prod.tokens_seen : 0, steps: prod ? prod.step : 0 },
  };
}
