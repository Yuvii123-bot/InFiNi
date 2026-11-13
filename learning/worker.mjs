#!/usr/bin/env node
// INFINITY LLM — the always-on learning worker.
//
//   node learning/worker.mjs [--max-runtime SECONDS] [--once] [--no-seed]
//
// One long-lived process that needs nobody: it keeps discovering and verifying new text, starts a training cycle by
// itself when enough of it has arrived, lets the gate decide about every candidate, publishes an approved model to the
// serving machines, and goes back to discovering. It does the work in child processes (learning/cli.mjs), so a crash in
// a step cannot take the worker down, and it survives its own death as well: everything it knows is on disk, and a new
// worker process continues the interrupted cycle at the phase where it stopped.
//
//   start      take the supervisor lock · clear what a dead worker left behind (stale lock, orphaned trainer) ·
//              start the state from the published model if it is empty · check the production model's health
//   loop       paused? wait · unfinished cycle? continue it · enough new documents? train · otherwise discover
//   after a step   failure → wait (15 s, 30 s, 60 s … 15 min) and try again · health check (automatic rollback) ·
//              remove old large files · publish the model and the status
//   stop       SIGTERM / SIGINT / --max-runtime: the trainer writes a checkpoint, the cycle stays resumable
//
// It is a real process and must run on a machine that stays on (docs/WORKER.md). It does not run on Vercel.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO, stateDir, paths, loadConfig, readJSON, writeJSON, readLines, nowISO, logEvent } from './store.mjs';
import { isPaused, pendingInfo, reapTrainer, getState } from './cycle.mjs';
import { loadRegistry } from './registry.mjs';
import { seedFromPublished, pruneState, healthCheck, stateSizeMb, packState } from './persist.mjs';
import { publishAll } from './publish.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const rssMb = (pid) => { try { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? Math.round(Number(m[1]) / 1024) : null; } catch { return null; } };
/** Memory of a process and everything it started (the trainer is a grandchild of the worker). */
function treeRssMb(pid) {
  let total = rssMb(pid) || 0;
  try { for (const t of fs.readdirSync(`/proc/${pid}/task`)) for (const c of fs.readFileSync(`/proc/${pid}/task/${t}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)) total += treeRssMb(Number(c)); } catch { /* not Linux, or the process ended */ }
  return total;
}

export function createWorker({ root = stateDir(), env = process.env, log = (s) => console.log(s), maxRuntime = 0, once = false, seed = true, cli = env.INFINI_WORKER_CLI || path.join(HERE, 'cli.mjs'), publish = publishAll, onCheckpoint = null } = {}) {
  const P = paths(root);
  fs.mkdirSync(root, { recursive: true });
  const t0 = Date.now();
  let cfg = loadConfig(root);
  let child = null, stopping = false, stopReason = '', beat = null, lastPublish = 0, lastPublished = null, lastCheckpoint = 0, lastSize = 0, lastHealth = 0;
  const prev = readJSON(P.worker, null);
  const w = {
    format: 'infinity-worker/1', pid: process.pid, host: os.hostname(), platform: `${os.platform()} ${os.arch()}`, node: process.version, session: env.INFINI_WORKER_SESSION || '', where: env.INFINI_WORKER_WHERE || '',
    started: nowISO(), heartbeat: nowISO(), uptimeSeconds: 0, state: 'starting', activity: 'starting', detail: '',
    starts: ((prev && prev.starts) || 0) + 1, recoveries: (prev && prev.recoveries) || 0, childFailures: (prev && prev.childFailures) || 0, consecutiveFailures: 0, backoffUntil: null, nextAction: '',
    firstStarted: (prev && prev.firstStarted) || nowISO(),
    totals: { uptimeSeconds: 0, discoveryRounds: 0, cycles: 0, promoted: 0, rejected: 0, documentsCollected: 0, documentsAccepted: 0, documentsRejected: 0, ...((prev && prev.totals) || {}) },
    lastStep: (prev && prev.lastStep) || null, lastRecovery: (prev && prev.lastRecovery) || null, errors: ((prev && prev.errors) || []).slice(-20), resources: {}, lastPublish: (prev && prev.lastPublish) || null, lastCheckpoint: (prev && prev.lastCheckpoint) || null,
  };
  const baseUptime = w.totals.uptimeSeconds || 0;

  function resources() {
    let disk = null; try { const s = fs.statfsSync(root); disk = Math.round(s.bavail * s.bsize / 2 ** 20); } catch { /* older Node */ }
    if (Date.now() - lastSize > 300_000 || !w.resources.stateMb) { lastSize = Date.now(); w.resources.stateMb = stateSizeMb(root); }
    const st = getState(root);
    return { cpus: os.cpus().length, load1: +os.loadavg()[0].toFixed(2), memTotalMb: Math.round(os.totalmem() / 2 ** 20), memFreeMb: Math.round(os.freemem() / 2 ** 20), workerRssMb: Math.round(process.memoryUsage().rss / 2 ** 20), stepRssMb: child && child.pid ? treeRssMb(child.pid) : null, trainerRssMb: (st.training && st.training.rssMb) || null, diskFreeMb: disk, stateMb: w.resources.stateMb };
  }
  function save(patch = {}) {
    Object.assign(w, patch);
    w.heartbeat = nowISO(); w.uptimeSeconds = Math.round((Date.now() - t0) / 1000); w.totals.uptimeSeconds = baseUptime + w.uptimeSeconds;
    w.resources = resources();
    writeJSON(P.worker, w);
  }
  const say = (text) => { log(`${new Date().toISOString().slice(11, 19)} worker: ${text}`); };
  function fail(where, message) { const e = { t: nowISO(), where, message: String(message).slice(0, 300) }; w.errors.push(e); w.errors = w.errors.slice(-20); logEvent(root, 'worker-error', e); say(`error in ${where}: ${e.message}`); }

  /** What a worker that died without saying goodbye left behind. */
  async function recover() {
    const found = [];
    const sup = readJSON(P.supervisor, null);
    if (sup && sup.pid && sup.pid !== process.pid && alive(sup.pid)) throw Object.assign(new Error(`another worker is already running (pid ${sup.pid})`), { code: 'busy' });
    writeJSON(P.supervisor, { pid: process.pid, started: nowISO() });
    if (prev && prev.state !== 'stopped') found.push(`the previous worker (pid ${prev.pid}, started ${prev.started}) ended without shutting down`);
    const lock = readJSON(P.lock, null);
    if (lock && lock.pid && alive(lock.pid) && lock.pid !== process.pid) {                 // the step outlived its worker: end it, it is resumable
      try { process.kill(lock.pid, 'SIGTERM'); } catch { /* gone */ }
      for (let i = 0; i < 60 && alive(lock.pid); i++) await sleep(500);
      if (alive(lock.pid)) { try { process.kill(lock.pid, 'SIGKILL'); } catch { /* gone */ } }
      found.push(`a step of the previous worker was still running (pid ${lock.pid}) and was stopped`);
    }
    if (fs.existsSync(P.lock)) { fs.rmSync(P.lock, { force: true }); if (lock && !found.some((f) => f.includes('still running'))) found.push('a stale step lock was removed'); }
    const cyc = readJSON(path.join(root, 'cycle.json'), null);
    if (cyc && !cyc.finished) {
      if (await reapTrainer(root, cyc.run)) found.push('a trainer without a parent was stopped (its checkpoint is kept)');
      found.push(`cycle ${cyc.id} is unfinished (phases done: ${Object.keys(cyc.phases || {}).join(', ') || 'none'}) and will be continued`);
    }
    const st = getState(root);
    if (st.status === 'running') writeJSON(P.state, { ...st, status: 'idle', pid: null, updated: nowISO() });
    if (found.length) { w.recoveries++; w.lastRecovery = { t: nowISO(), found }; logEvent(root, 'worker-recovered', { found }); for (const f of found) say(`recovery: ${f}`); }
    return found;
  }

  /** Run one step in a child process. Resolves when it has ended, however it ended. */
  function step(kind, args = []) {
    return new Promise((resolve) => {
      const started = Date.now();
      let tail = '', stalled = false, lastProgress = Date.now();
      const ca = '/etc/ssl/certs/ca-certificates.crt';              // hosts whose outbound TLS goes through their own certificate authority
      try { child = spawn(process.execPath, [cli, kind, ...args], { cwd: REPO, env: { ...env, INFINI_LLM_DIR: root, ...(env.NODE_EXTRA_CA_CERTS || !fs.existsSync(ca) ? {} : { NODE_EXTRA_CA_CERTS: ca }) }, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { child = null; return resolve({ kind, code: -1, signal: null, tail: String(e && e.message), seconds: 0 }); }
      const onData = (d) => { const text = String(d); tail = (tail + text).slice(-3000); lastProgress = Date.now(); for (const line of text.split('\n')) if (line.trim() && line.length < 400 && line[0] !== '{' && line[0] !== ' ' && line[0] !== '}') log(`  ${line}`); };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      const watch = setInterval(() => {
        const cyc = readJSON(path.join(root, 'cycle.json'), null);
        const seen = Math.max(lastProgress, mtime(P.state), mtime(P.events), cyc && cyc.run ? mtime(path.join(P.runs, cyc.run, 'status.json')) : 0);
        if (Date.now() - seen > cfg.worker.stallMinutes * 60_000 && child) { stalled = true; try { child.kill('SIGKILL'); } catch { /* gone */ } }
      }, 5000);
      child.on('error', (e) => { clearInterval(watch); child = null; resolve({ kind, code: -1, signal: null, tail: String(e && e.message), seconds: (Date.now() - started) / 1000 }); });
      child.on('close', (code, signal) => { clearInterval(watch); child = null; resolve({ kind, code, signal, tail, stalled, seconds: Math.round((Date.now() - started) / 1000) }); });
    });
  }
  /** Sleep that ends early when the worker is asked to stop; keeps the heartbeat going. */
  async function wait(seconds, activity, detail = '') {
    const until = Date.now() + seconds * 1000;
    save({ activity, detail, nextAction: `${detail || activity} until ${new Date(until).toISOString().replace(/\.\d+Z$/, 'Z')}` });
    while (Date.now() < until && !stopping && !expired()) await sleep(Math.min(1000, Math.max(50, until - Date.now())));
  }
  const expired = () => maxRuntime > 0 && (Date.now() - t0) / 1000 >= maxRuntime;

  async function afterStep({ changed = false } = {}) {
    cfg = loadConfig(root);
    if (Date.now() - lastHealth > 600_000 || changed) {
      lastHealth = Date.now();
      try { const h = healthCheck(root); if (!h.ok) { fail('health check', `${h.problem}${h.rolledBack ? `; rolled back to ${h.production}` : '; there is no earlier model to go back to'}`); changed = changed || h.rolledBack; } } catch (e) { fail('health check', e && e.message); }
    }
    try { pruneState(root, cfg); } catch (e) { fail('prune', e && e.message); }
    const prod = loadRegistry(root).production;
    const modelChanged = prod !== lastPublished;
    if (modelChanged || changed || Date.now() - lastPublish > cfg.worker.publishSeconds * 1000) await publishNow(modelChanged || changed);
    if (onCheckpoint && (changed || Date.now() - lastCheckpoint > 900_000)) await checkpoint();
  }
  let publishing = false;
  async function publishNow(model) {
    if (publishing) return;
    publishing = true;
    try {
      save();
      const r = await publish(root, { env, model });
      lastPublish = Date.now();
      const errs = r.results.filter((x) => x.error);
      if (errs.length) for (const e of errs) fail(`publish (${e.target})`, e.error);
      else if (model && model !== 'never') lastPublished = r.version;
      if (r.results.length) w.lastPublish = { t: nowISO(), version: r.version, model: model === true, targets: r.results.map((x) => ({ target: x.target, ok: !x.error, uploaded: x.uploaded, url: x.url || null })) };
      if (model && model !== 'never' && r.results.length && !errs.length) { logEvent(root, 'published', { model: r.version, targets: r.results.map((x) => x.target) }); say(`published ${r.version} to ${r.results.map((x) => x.target).join(', ')}`); }
    } catch (e) { fail('publish', e && e.message); }
    finally { publishing = false; }
  }
  async function checkpoint() {
    try { lastCheckpoint = Date.now(); const r = await onCheckpoint(root); w.lastCheckpoint = { t: nowISO(), ...(r || {}) }; } catch (e) { fail('state checkpoint', e && e.message); }
  }

  async function run() {
    try { await recover(); } catch (e) { if (e.code === 'busy') { say(e.message); return 3; } throw e; }
    save({ state: 'running', activity: 'starting' });
    beat = setInterval(() => { try { save(); } catch { /* disk full or gone: the next beat tries again */ } }, Math.max(1, cfg.worker.heartbeatSeconds) * 1000);
    beat.unref();
    // while a long step runs (training takes minutes), the published records are still refreshed, so a dashboard
    // elsewhere keeps seeing the heartbeat and the progress; the model pointer is only moved after a step, by afterStep()
    const live = setInterval(() => { if (child && !stopping && Date.now() - lastPublish > cfg.worker.publishSeconds * 1000) publishNow('never'); }, 5000);
    live.unref();
    logEvent(root, 'worker-start', { pid: process.pid, host: w.host, starts: w.starts, session: w.session });
    say(`started (pid ${process.pid}, start number ${w.starts}, state in ${root})`);
    if (seed) { try { const r = await seedFromPublished(root, { env, log: say }); void r; } catch (e) { fail('seed', e && e.message); } }
    lastPublished = (readJSON(path.join(P.channel, 'channel.json'), null) || {}).version || null;
    await afterStep({ changed: false });
    let trainingBlockedUntil = 0, steps = 0;
    while (!stopping && !expired()) {
      cfg = loadConfig(root);
      if (isPaused(root)) { await wait(5, 'paused', 'learning is paused'); continue; }
      if (w.backoffUntil && Date.parse(w.backoffUntil) > Date.now()) { await wait((Date.parse(w.backoffUntil) - Date.now()) / 1000, 'backing off', `waiting after ${w.consecutiveFailures} failed step(s)`); continue; }
      // ---- decide ----
      const cyc = readJSON(path.join(root, 'cycle.json'), null);
      const unfinished = cyc && !cyc.finished;
      const reg = loadRegistry(root);
      const pend = pendingInfo(root);
      const waitedMin = pend.since ? (Date.now() - Date.parse(pend.since)) / 60000 : 0;
      const canTrain = Date.now() >= trainingBlockedUntil;
      let kind = 'discover', args = [], why = '';
      const ctl = readJSON(P.control, {}) || {};
      if (ctl.trainNow) writeJSON(P.control, { ...ctl, trainNow: null });            // a request from the dashboard, taken once
      if (ctl.trainNow && canTrain && !unfinished && reg.production) { kind = 'cycle'; args = pend.ids.length >= cfg.worker.trainWhenNewDocs ? ['--no-acquire'] : []; why = `requested by an operator (${pend.ids.length} new documents waiting)`; }
      else if (unfinished && canTrain) { kind = 'cycle'; args = cyc.phases && cyc.phases.acquire ? ['--no-acquire'] : []; why = `continuing ${cyc.id}`; }
      else if (!reg.production && canTrain) { kind = 'cycle'; why = 'no model yet: collecting data and training the first one'; }
      else if (canTrain && (pend.ids.length >= cfg.worker.trainWhenNewDocs || (pend.ids.length >= cfg.cycle.minNewDocs && waitedMin >= cfg.worker.trainAfterMinutes))) { kind = 'cycle'; args = ['--no-acquire']; why = `${pend.ids.length} new verified documents are waiting`; }
      else why = `${pend.ids.length} new documents waiting (training starts at ${cfg.worker.trainWhenNewDocs}, or at ${cfg.cycle.minNewDocs} after ${cfg.worker.trainAfterMinutes} min)`;
      save({ activity: kind === 'cycle' ? 'learning cycle' : 'discovering', detail: why, nextAction: '' });
      say(`${kind}: ${why}`);
      const before = { cycles: readLines(P.cycles).length, rounds: readLines(path.join(root, 'discovery.jsonl')).length, production: reg.production };
      const r = await step(kind, args);
      steps++;
      // ---- what happened ----
      const cycles = readLines(P.cycles), rounds = readLines(path.join(root, 'discovery.jsonl'));
      const rec = kind === 'cycle' ? (cycles.length > before.cycles ? cycles[cycles.length - 1] : null) : (rounds.length > before.rounds ? rounds[rounds.length - 1] : null);
      const outcome = kind === 'cycle' ? (rec ? rec.outcome : r.code === 0 ? 'interrupted' : 'crashed') : (rec ? 'done' : r.code === 0 ? 'nothing' : 'crashed');
      w.lastStep = { kind, why, started: new Date(Date.now() - r.seconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z'), seconds: r.seconds, code: r.code, signal: r.signal || null, outcome };
      let pause = 0, pauseWhy = '';
      const crashed = !stopping && (r.code !== 0 || r.stalled) && !(rec && ['training-failed', 'export-failed', 'evaluation-failed', 'error'].includes(rec.outcome));
      if (stopping && !rec) { /* we stopped it ourselves: nothing to count */ }
      else if (crashed || (rec && ['training-failed', 'export-failed', 'evaluation-failed', 'error'].includes(rec.outcome))) {
        w.childFailures++; w.consecutiveFailures++;
        const secs = Math.min(cfg.worker.backoffMaxSeconds, cfg.worker.backoffSeconds * 2 ** (w.consecutiveFailures - 1));
        w.backoffUntil = new Date(Date.now() + secs * 1000).toISOString();
        fail(kind, rec ? `${rec.outcome}: ${rec.message || ''}` : r.stalled ? `the step reported nothing for ${cfg.worker.stallMinutes} minutes and was killed` : `the step ended with ${r.signal ? 'signal ' + r.signal : 'exit code ' + r.code}: ${r.tail.trim().split('\n').pop() || ''}`);
        say(`retrying in ${secs} s (failure ${w.consecutiveFailures} in a row)`);
      } else {
        w.consecutiveFailures = 0; w.backoffUntil = null;
        if (kind === 'discover' && rec) {
          w.totals.discoveryRounds++; w.totals.documentsCollected += rec.collected; w.totals.documentsAccepted += rec.accepted; w.totals.documentsRejected += rec.rejected;
          if (rec.collected === 0) { pause = cfg.worker.idleSeconds; pauseWhy = 'the sources have nothing new right now'; } else { pause = cfg.worker.discoverPauseSeconds; pauseWhy = 'pause between discovery rounds'; }
        }
        if (kind === 'cycle' && rec) {
          w.totals.cycles++;
          if (rec.outcome === 'promoted') w.totals.promoted++;
          if (rec.outcome === 'rejected') w.totals.rejected++;
          if (rec.acquisition) { w.totals.documentsCollected += rec.acquisition.collected || 0; w.totals.documentsAccepted += rec.acquisition.accepted || 0; w.totals.documentsRejected += rec.acquisition.rejected || 0; }
          if (rec.outcome === 'training-unavailable') { trainingBlockedUntil = Date.now() + 30 * 60_000; fail('training', rec.message); }
          if (rec.outcome === 'postponed') { trainingBlockedUntil = Date.now() + 5 * 60_000; }
          if (rec.outcome === 'no-new-data') { pause = cfg.worker.discoverPauseSeconds; pauseWhy = 'pause before looking for more documents'; }
          say(`cycle ${rec.id}: ${rec.outcome}. ${rec.message || ''}`);
        }
      }
      save();
      await afterStep({ changed: kind === 'cycle' && !!rec && loadRegistry(root).production !== before.production });
      if (once) break;
      if (pause && !stopping) await wait(pause, 'waiting', pauseWhy);
    }
    return shutdown(stopping ? stopReason : expired() ? `the session's time (${maxRuntime} s) is used up` : 'done');
  }

  async function shutdown(reason) {
    save({ state: 'stopping', activity: 'stopping', detail: reason });
    if (child) await stopChild();
    try { await publishNow(loadRegistry(root).production !== lastPublished); } catch { /* reported inside */ }
    clearInterval(beat);
    save({ state: 'stopped', activity: 'stopped', detail: reason, stoppedAt: nowISO() });
    if (onCheckpoint) await checkpoint();
    writeJSON(P.worker, w);
    logEvent(root, 'worker-stop', { reason, uptimeSeconds: w.uptimeSeconds });
    try { const sup = readJSON(P.supervisor, null); if (sup && sup.pid === process.pid) fs.rmSync(P.supervisor, { force: true }); } catch { /* ignore */ }
    say(`stopped: ${reason}`);
    return 0;
  }
  /** Ask the running step to stop at a safe point (the trainer writes its checkpoint); kill it if it does not. */
  async function stopChild() {
    const c = child;
    if (!c) return;
    try { c.kill('SIGTERM'); } catch { /* gone */ }
    for (let i = 0; i < 90 && child === c; i++) await sleep(500);
    if (child === c) { try { c.kill('SIGKILL'); } catch { /* gone */ } for (let i = 0; i < 20 && child === c; i++) await sleep(250); }
  }
  function stop(reason = 'asked to stop') { if (stopping) return; stopping = true; stopReason = reason; say(`stopping: ${reason}`); stopChild(); }
  // a session that has used up its time stops its running step the same way
  const timer = maxRuntime > 0 ? setInterval(() => { if (expired() && child && !stopping) { stopping = true; stopReason = `the session's time (${maxRuntime} s) is used up`; say(`stopping: ${stopReason}`); stopChild(); } }, 1000) : null;
  if (timer) timer.unref();
  return { run, stop, record: () => w, root };
}

// ---------- command line ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (name, d = null) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : d; };
  const root = stateDir();
  const archive = process.env.INFINI_STATE_ARCHIVE || '';                 // hosts without a permanent disk: keep an archive of the state up to date
  const worker = createWorker({
    root, maxRuntime: Number(flag('max-runtime', process.env.INFINI_WORKER_MAX_RUNTIME || 0)) || 0, once: argv.includes('--once'), seed: !argv.includes('--no-seed'),
    onCheckpoint: process.env.INFINI_STATE_GITHUB ? async (r) => { const { pushState } = await import('./publish.mjs'); const p = await pushState(r); return { where: `${p.repo} release ${p.tag}`, bytes: p.bytes }; }
      : archive ? async (r) => { const p = packState(r, path.resolve(archive)); return { where: path.basename(p.file), bytes: p.bytes }; } : null,
  });
  process.on('SIGTERM', () => worker.stop('SIGTERM'));
  process.on('SIGINT', () => worker.stop('SIGINT'));
  worker.run().then((code) => process.exit(code || 0), (e) => { console.error((e && e.stack) || e); process.exit(1); });
}
