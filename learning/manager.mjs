// INFINITY LLM — learning: supervision from inside the server. Starts learning cycles as separate processes, keeps the
// schedule, applies the admin controls. On a host that cannot train (read-only, serverless) it serves the snapshot that
// was published with the app and says so.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REPO, BUNDLED, stateDir, paths, readJSON, writeJSON, loadConfig, saveConfigPatch, logEvent, nowISO } from './store.mjs';
import { snapshot, workerRunning, isPaused, setState, getState } from './cycle.mjs';
import { rollback as doRollback, loadRegistry } from './registry.mjs';

/** Is the worker that wrote this record still alive? Judged by the age of its heartbeat. */
export function workerLiveness(w, now = Date.now()) {
  if (!w || !w.heartbeat) return { alive: false, heartbeatAgeSeconds: null };
  const age = Math.max(0, Math.round((now - Date.parse(w.heartbeat)) / 1000));
  return { alive: w.state !== 'stopped' && age < 180, heartbeatAgeSeconds: age };
}

function canTrainHere(root, { serverless, learning }) {
  if (!learning) return { ok: false, reason: 'learning is switched off on this host (INFINI_LEARNING=0)' };
  if (serverless) return { ok: false, reason: 'this deployment is serverless: it has no writable disk, no long-running processes and no Python, so training runs elsewhere and this page shows the records published with the app' };
  try { fs.mkdirSync(root, { recursive: true }); fs.accessSync(root, fs.constants.W_OK); return { ok: true }; } catch { return { ok: false, reason: `the state directory ${root} is not writable` }; }
}

export function createManager({ root = '', serverless = false, learning = true, scheduler = true, adminConfigured = false, bundled = BUNDLED, log = () => {}, channel = null } = {}) {
  root = root || stateDir();
  const env = process.env;
  const cap = canTrainHere(root, { serverless, learning });
  let child = null, timer = null;

  function view() {
    if (!cap.ok) {
      // records published by the learning worker through its channel are newer than the ones shipped with the app
      const live = channel && channel.snapshot();
      const snap = live || readJSON(path.join(bundled || BUNDLED, 'snapshot.json'), null);
      if (live) return { ...live, host: { trainingCapable: false, adminConfigured, remoteWorker: true, reason: 'training runs on a separate worker; this page shows the records that worker publishes', snapshotOf: live.published || null, channel: channel.info() }, worker: live.worker ? { ...live.worker, ...workerLiveness(live.worker) } : null };
      const base = snap || { status: { state: 'unavailable' }, model: null, registry: { models: {}, history: [] }, cycles: [], curve: [], datasets: [], corpus: null, evaluations: [], events: [], totals: {} };
      return { ...base, host: { trainingCapable: false, adminConfigured, reason: cap.reason, snapshotOf: snap ? snap.published : null, channel: channel ? channel.info() : undefined }, status: { ...(base.status || {}), state: 'not running on this host', phase: null, training: null } };
    }
    const s = snapshot(root);
    s.host = { trainingCapable: true, adminConfigured, channel: channel ? channel.info() : undefined };
    return s;
  }
  const workerAlive = () => workerLiveness(readJSON(paths(root).worker, null)).alive;
  function start(kind = 'cycle') {
    if (!cap.ok) throw Object.assign(new Error(cap.reason), { code: 'unavailable' });
    if (isPaused(root)) throw Object.assign(new Error('learning is paused; resume it first'), { code: 'paused' });
    // An always-on worker owns the state directory: never start a second process next to it. Ask it instead.
    if (workerAlive()) {
      if (kind !== 'cycle') throw Object.assign(new Error('the always-on worker is running; it evaluates every candidate itself'), { code: 'busy' });
      writeJSON(paths(root).control, { ...(readJSON(paths(root).control, {}) || {}), trainNow: nowISO() });
      logEvent(root, 'control', { action: 'start', kind, via: 'worker' });
      return { started: kind, via: 'worker', note: 'the always-on worker will start a learning cycle as its next step' };
    }
    if (workerRunning(root) || child) throw Object.assign(new Error('a learning cycle is already running'), { code: 'busy' });
    const out = fs.openSync(path.join(root, 'worker.log'), 'a');
    const ca = '/etc/ssl/certs/ca-certificates.crt';
    child = spawn(process.execPath, [path.join(REPO, 'learning', 'cli.mjs'), kind], { cwd: REPO, env: { ...env, INFINI_LLM_DIR: root, ...(env.NODE_EXTRA_CA_CERTS || !fs.existsSync(ca) ? {} : { NODE_EXTRA_CA_CERTS: ca }) }, stdio: ['ignore', out, out] });
    const pid = child.pid;
    child.on('exit', (code) => { child = null; fs.closeSync(out); log({ ev: 'learning_worker_exit', kind, code }); const st = getState(root); if (st.status === 'running' && !workerRunning(root)) setState(root, { status: 'idle', phase: null, pid: null, training: null, ...(code ? { lastError: { t: nowISO(), message: `the learning process ended unexpectedly (exit ${code})` } } : {}) }); schedule(); });
    child.on('error', (e) => { child = null; log({ ev: 'learning_worker_error', message: e.message }); });
    logEvent(root, 'control', { action: 'start', kind, pid });
    return { started: kind, pid };
  }
  function pause(by = 'admin') { need(); writeJSON(paths(root).control, { ...(readJSON(paths(root).control, {}) || {}), paused: true, t: nowISO() }); if (!workerRunning(root)) setState(root, { status: 'paused' }); logEvent(root, 'control', { action: 'pause', by }); return { paused: true }; }
  function resume(by = 'admin') {
    need();
    writeJSON(paths(root).control, { ...(readJSON(paths(root).control, {}) || {}), paused: false, t: nowISO() });
    setState(root, { status: 'idle' });
    logEvent(root, 'control', { action: 'resume', by });
    const cyc = readJSON(path.join(root, 'cycle.json'), null);
    if (cyc && !cyc.finished && !workerRunning(root) && !child && !workerAlive()) { try { return { paused: false, ...start('cycle'), continued: cyc.id }; } catch { /* reported by status */ } }
    return { paused: false };
  }
  function rollback({ to = null, reason = '' } = {}) { need(); const reg = doRollback(root, { to, reason: String(reason).slice(0, 300), by: 'admin' }); logEvent(root, 'control', { action: 'rollback', to: reg.production, from: reg.previous }); return { production: reg.production, previous: reg.previous }; }
  /** Only the settings an operator is meant to change, each checked. */
  function configure(patch) {
    need();
    const out = {}, num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
    const set = (sec, key, v) => { if (v !== undefined) (out[sec] = out[sec] || {})[key] = v; };
    const c = patch.cycle || {}, r = patch.resources || {}, m = patch.mixture || {};
    if (typeof c.auto === 'boolean') set('cycle', 'auto', c.auto);
    set('cycle', 'intervalMinutes', num(c.intervalMinutes, 5, 10080)); set('cycle', 'maxNewDocs', num(c.maxNewDocs, 1, 2000)); set('cycle', 'trainSeconds', num(c.trainSeconds, 20, 86400)); set('cycle', 'minNewDocs', num(c.minNewDocs, 1, 500));
    set('resources', 'threads', num(r.threads, 1, Math.max(1, os.cpus().length))); set('resources', 'nice', num(r.nice, 0, 19)); set('resources', 'duty', num(r.duty, 0.1, 1)); set('resources', 'maxTrainRssMb', num(r.maxTrainRssMb, 300, 1e6)); set('resources', 'minFreeMb', num(r.minFreeMb, 50, 1e6));
    for (const k of ['dialogue', 'fresh', 'replay']) set('mixture', k, num(m[k], 0.05, 0.9));
    set('mixture', 'groundedShare', num(m.groundedShare, 0.1, 0.9));
    if (Array.isArray(patch.sources)) {
      const cur = loadConfig(root).sources;
      out.sources = cur.map((s) => { const p = patch.sources.find((x) => x && x.id === s.id); if (!p) return s; const n = { ...s }; if (typeof p.enabled === 'boolean') n.enabled = p.enabled; if (Array.isArray(p.topics) && s.type === 'web') n.topics = p.topics.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 80)).slice(0, 200); const pc = num(p.perCycle, 1, 1000); if (pc !== undefined) n.perCycle = pc; return n; });
    }
    if (!Object.keys(out).length) throw Object.assign(new Error('nothing to change: no recognised setting was given'), { code: 'bad_request' });
    saveConfigPatch(root, out);
    logEvent(root, 'control', { action: 'configure', changed: Object.keys(out) });
    schedule();
    return { changed: out };
  }
  function need() { if (!cap.ok) throw Object.assign(new Error(cap.reason), { code: 'unavailable' }); }
  /** The schedule: when automatic cycles are on, start one when the interval since the last finished cycle has passed. */
  function schedule() {
    if (!cap.ok) return;
    const cfg = loadConfig(root), st = getState(root);
    const last = st.lastCycle && st.lastCycle.finished ? Date.parse(st.lastCycle.finished) : 0;
    const next = cfg.cycle.auto ? new Date(Math.max(Date.now(), last + cfg.cycle.intervalMinutes * 60000)).toISOString() : null;
    if ((st.nextRunAt || null) !== next) setState(root, { nextRunAt: next });
  }
  function tick() {
    if (!cap.ok) return;
    try {
      const cfg = loadConfig(root), st = getState(root);
      if (!cfg.cycle.auto || isPaused(root) || workerRunning(root) || child || workerAlive()) return;   // the worker decides when to train
      if (!st.nextRunAt) return schedule();
      if (Date.now() >= Date.parse(st.nextRunAt)) start('cycle');
    } catch (e) { log({ ev: 'learning_tick_error', message: String(e && e.message) }); }
  }
  if (cap.ok && scheduler) { schedule(); timer = setInterval(tick, 30000); timer.unref(); }
  return { capable: cap.ok, reason: cap.reason || '', view, start, pause, resume, rollback, configure, tick, registry: () => loadRegistry(root), close() { if (timer) clearInterval(timer); if (child) { try { child.kill('SIGTERM'); } catch { /* gone */ } } } };
}
