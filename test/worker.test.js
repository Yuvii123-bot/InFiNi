// Infinity LLM — the always-on learning worker and everything around it, tested offline.
//
//   continuous operation   the worker decides by itself, crashes are retried, a killed worker is replaced by one that
//                          continues the same cycle, a stop leaves the cycle resumable            (fake steps, real worker)
//   benchmark and gate     the fixed benchmark cannot change unnoticed and is kept out of training; the gate refuses
//                          regressions, memorisation and "not better"                              (real code)
//   persistence            the state survives as an archive; a state starts from the published model
//   publication            channel to a directory and to a GitHub release (fake API); the server takes a new model,
//                          a damaged upload and a rollback from the channel without a restart
//   discovery              the MediaWiki collector (fake site)
//   controls               the dashboard's server never starts a second trainer next to a live worker
//
// The steps the worker runs are replaced by test/helpers/fake-cli.mjs here; the real steps are exercised by the worker
// itself on a machine with Python (docs/WORKER.md lists what was measured).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createWorker } from '../learning/worker.mjs';
import { paths, readJSON, writeJSON, readLines, DEFAULTS, REPO, nowISO } from '../learning/store.mjs';
import { loadRegistry, registerModel, promote, rollback, modelDir } from '../learning/registry.mjs';
import { loadBenchmark, benchmarkSentences, isBenchmarkSentence, runBenchmark, memorizationProbe, BENCHMARK_FILE } from '../learning/benchmark.mjs';
import { promotionGate } from '../learning/evalsuite.mjs';
import { acquire } from '../learning/corpus.mjs';
import { packState, restoreState, healthCheck, seedFromPublished, pruneState } from '../learning/persist.mjs';
import { buildChannel, publishDir, publishGithub, fetchGithubAsset, publishAll, withoutPaths, statusNotes, newerCommit } from '../learning/publish.mjs';
import { collectMediawiki } from '../learning/sources.mjs';
import { createManager } from '../learning/manager.mjs';
import { snapshot, pendingInfo, needsChallenger } from '../learning/cycle.mjs';
import { createChannel } from '../engine/neural/channel.js';
import { loadModel } from '../engine/neural/model.js';
import { createTokenizer } from '../engine/neural/tokenizer.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../engine/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'llm');
const FAKE = path.join(HERE, 'helpers', 'fake-cli.mjs');
const WORKER = path.join(REPO, 'learning', 'worker.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `infini-${name}-`));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const FAST = { model: { preset: 'auto' }, worker: { discoverPauseSeconds: 0.05, idleSeconds: 0.05, trainWhenNewDocs: 6, trainAfterMinutes: 45, heartbeatSeconds: 1, backoffSeconds: 0.2, backoffMaxSeconds: 0.5, publishSeconds: 0, stallMinutes: 5 } };

/** A private state directory holding the fixture model m0001 as production, with fast worker timings. */
function state(plan = {}, config = FAST) {
  const dir = tmp('worker');
  fs.cpSync(FIX, dir, { recursive: true });
  writeJSON(path.join(dir, 'config.json'), config);
  writeJSON(path.join(dir, 'fake.json'), plan);
  return dir;
}
const fakeLog = (root) => readLines(path.join(root, 'fake.log'));
async function until(what, cond, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await cond(); if (v) return v; await sleep(40); } throw new Error(`timed out waiting for ${what}`); }
/** Run a worker in this process until `cond` holds, then stop it. */
async function runUntil(root, cond, { what = 'the condition', env = {}, ...opts } = {}) {
  const lines = [];
  const worker = createWorker({ root, env: { PATH: process.env.PATH, ...env }, cli: FAKE, seed: false, log: (s) => lines.push(s), ...opts });
  const done = worker.run();
  let error = null;
  try { await until(what, () => cond(worker)); } catch (e) { error = e; }
  worker.stop('test finished');
  const code = await done;
  if (error) throw new Error(`${error.message}\n${lines.slice(-25).join('\n')}`);
  return { code, lines, record: worker.record() };
}
/** A worker as its own operating-system process (to kill it, or to send it a signal). */
function spawnWorker(root, extra = []) {
  const child = spawn(process.execPath, [WORKER, '--no-seed', ...extra], { env: { PATH: process.env.PATH, INFINI_LLM_DIR: root, INFINI_WORKER_CLI: FAKE }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.on('close', (code, signal) => r({ code, signal })));
  return { child, exited, output: () => out };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---------------------------------------------------------------- continuous operation

test('larger architecture is a separate challenger, including imported cards without a preset', () => {
  const cfg = { model: { preset: 'xl' } };
  assert.equal(needsChallenger(cfg, { production: null, models: {} }), false);
  assert.equal(needsChallenger(cfg, { production: 'm1', models: { m1: { preset: 'micro' } } }), true);
  assert.equal(needsChallenger(cfg, { production: 'm1', models: { m1: {} } }), true);
  assert.equal(needsChallenger(cfg, { production: 'm1', models: { m1: { preset: 'xl' } } }), false);
  assert.equal(needsChallenger({ model: { preset: 'auto' } }, { production: 'm1', models: { m1: { preset: 'micro' } } }), false);
});

test('worker schedules a challenger without waiting for new documents', async () => {
  const root = state({ docsPerRound: 0 }, { ...FAST, model: { preset: 'xl' } });
  const { record } = await runUntil(root, () => fakeLog(root).some((r) => r.kind === 'cycle'), { what: 'challenger cycle' });
  const cycle = fakeLog(root).find((r) => r.kind === 'cycle');
  assert.deepEqual(cycle.args, ['--no-acquire']);
  assert.match(record.lastStep.why, /xl challenger/);
});

test('worker reports a failed final state checkpoint as failure', async () => {
  const root = state({ docsPerRound: 0 });
  const worker = createWorker({ root, env: { PATH: process.env.PATH }, cli: FAKE, seed: false, once: true, log: () => {}, onCheckpoint: async () => { throw new Error('upload failed'); } });
  assert.equal(await worker.run(), 1);
  assert.ok(worker.record().errors.some((e) => e.where === 'state checkpoint'));
});

test('pruning retains the persistent challenger checkpoint across cycles', () => {
  const root = state({});
  const dir = path.join(paths(root).runs, 'challenger-xl');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ckpt.pt'), 'important');
  for (let i = 1; i <= 4; i++) {
    const d = path.join(paths(root).runs, `c000${i}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'ckpt.pt'), 'old');
  }
  pruneState(root, { worker: { keepModels: 1, keepDatasets: 1, keepRuns: 1 } });
  assert.equal(fs.readFileSync(path.join(dir, 'ckpt.pt'), 'utf8'), 'important');
});

test('worker: discovers, starts training by itself when enough documents arrived, publishes the approved model, and carries on', async () => {
  const root = state({ docsPerRound: 3 });
  const out = tmp('channel');
  const { code, record, lines } = await runUntil(root, () => readLines(paths(root).cycles).length >= 1 && readLines(path.join(root, 'discovery.jsonl')).length >= 3 && (readJSON(path.join(out, 'channel.json'), {}) || {}).version === 'm0002', { what: 'promotion, publication and a further discovery round', env: { INFINI_PUBLISH_DIR: out } });
  assert.equal(code, 0);
  const steps = fakeLog(root).filter((l) => l.round || l.outcome).map((l) => (l.round ? 'discover' : `cycle:${l.outcome}`));
  assert.deepEqual(steps.slice(0, 4), ['discover', 'discover', 'cycle:promoted', 'discover'], 'two rounds bring six documents, then the worker trains without being asked, then it discovers again');
  assert.deepEqual(fakeLog(root).find((l) => l.kind === 'cycle').args, ['--no-acquire'], 'the cycle trains on what discovery already verified');
  // nobody asked: no control file, no admin call
  assert.equal(fs.existsSync(paths(root).control), false);
  assert.equal(record.totals.cycles, 1);
  assert.equal(record.totals.promoted, 1);
  assert.ok(record.totals.discoveryRounds >= 3);
  assert.equal(record.totals.documentsAccepted, record.totals.discoveryRounds * 3);
  assert.equal(record.state, 'stopped');
  assert.ok(lines.some((l) => /published m0002 to directory/.test(l)), lines.join('\n'));
  // the published channel: pointer, the three files with matching checksums, records
  const ch = readJSON(path.join(out, 'channel.json'));
  assert.equal(ch.format, 'infinity-channel/1');
  assert.equal(ch.previous, 'm0001');
  for (const f of Object.values(ch.files)) assert.equal(sha(path.join(out, f.name)), f.sha256);
  const snap = readJSON(path.join(out, 'snapshot.json'));
  assert.equal(snap.registry.production, 'm0002');
  assert.equal(snap.host.remoteWorker, true);
  assert.equal(snap.worker.format, 'infinity-worker/1');
  assert.doesNotMatch(JSON.stringify(snap), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no path of the worker machine is published');
  // the lock is released, so the next worker can start
  assert.equal(fs.existsSync(paths(root).supervisor), false);
});

test('worker: a refused candidate changes nothing in production and learning continues', async () => {
  const root = state({ docsPerRound: 6, outcomes: ['rejected', 'promoted'] });
  const { record } = await runUntil(root, () => readLines(paths(root).cycles).length >= 2, { what: 'two cycles' });
  const cycles = readLines(paths(root).cycles);
  assert.deepEqual(cycles.map((c) => c.outcome), ['rejected', 'promoted']);
  const reg = loadRegistry(root);
  assert.equal(reg.models.m0002.status, 'rejected');
  assert.equal(reg.production, 'm0003');
  assert.equal(reg.previous, 'm0001', 'the refused model never became production, so it is not the one to go back to');
  assert.equal(record.totals.rejected, 1);
  assert.equal(record.totals.promoted, 1);
});

test('worker: a crashing step is retried after a growing pause; the worker itself keeps running', async () => {
  const root = state({ docsPerRound: 1, crashDiscover: 2 });
  const { record, lines } = await runUntil(root, () => readLines(path.join(root, 'discovery.jsonl')).length >= 2, { what: 'two successful rounds after two crashes' });
  assert.equal(record.childFailures, 2);
  assert.equal(record.consecutiveFailures, 0, 'a success clears the failure count');
  assert.equal(record.backoffUntil, null);
  assert.equal(record.errors.filter((e) => e.where === 'discover').length, 2);
  assert.match(record.errors[0].message, /exit code 7.*fake: discovery crashed/);
  const retries = lines.filter((l) => /retrying in/.test(l));
  assert.match(retries[0], /retrying in 0\.2 s \(failure 1 in a row\)/);
  assert.match(retries[1], /retrying in 0\.4 s \(failure 2 in a row\)/);
  assert.ok(readLines(paths(root).events).some((e) => e.type === 'worker-error'));
});

test('worker: killed in the middle of a cycle, the next worker stops what was left running and continues the same cycle', async () => {
  const root = state({ docsPerRound: 6, hang: true });
  const first = spawnWorker(root);
  const hanging = await until('the cycle to be under way', () => fakeLog(root).find((l) => l.kind === 'cycle'));
  assert.equal(readJSON(path.join(root, 'cycle.json')).finished, false);
  const firstPid = readJSON(paths(root).worker).pid;
  first.child.kill('SIGKILL');                                            // power cut: no shutdown code runs
  const end = await first.exited;
  assert.equal(end.signal, 'SIGKILL');
  assert.equal(readJSON(paths(root).worker).state, 'running', 'the dead worker could not say goodbye');
  assert.ok(alive(hanging.pid), 'its step is still running, without a parent');
  assert.ok(fs.existsSync(paths(root).supervisor));

  writeJSON(path.join(root, 'fake.json'), { docsPerRound: 6 });           // the step no longer hangs
  const { record, lines } = await runUntil(root, () => readLines(paths(root).cycles).length >= 1, { what: 'the continued cycle to finish' });
  assert.equal(alive(hanging.pid), false, 'the orphaned step was stopped');
  assert.equal(record.starts, 2);
  assert.equal(record.recoveries, 1);
  assert.notEqual(record.pid, firstPid);
  const found = record.lastRecovery.found.join(' | ');
  assert.match(found, /previous worker .* ended without shutting down/);
  assert.match(found, /step of the previous worker was still running .* and was stopped/);
  assert.match(found, /cycle c0001 is unfinished .* will be continued/);
  const cycles = readLines(paths(root).cycles);
  assert.equal(cycles.length, 1, 'one cycle, not two');
  assert.equal(cycles[0].id, 'c0001');
  assert.equal(cycles[0].attempts, 2, 'the same cycle was continued by the second worker');
  assert.equal(fakeLog(root).filter((l) => l.kind === 'cycle' && l.resumed).length, 1);
  assert.ok(lines.some((l) => /cycle: continuing c0001/.test(l)));
  assert.ok(readLines(paths(root).events).some((e) => e.type === 'worker-recovered'));
});

test('worker: a step that is killed (out of memory, for example) leaves a resumable cycle that is finished on the next try', async () => {
  const root = state({ docsPerRound: 6, killCycle: 1 });
  const { record } = await runUntil(root, () => readLines(paths(root).cycles).length >= 1, { what: 'the cycle to finish after its step was killed' });
  assert.equal(record.childFailures, 1);
  assert.match(record.errors[0].message, /signal SIGKILL/);
  const cycles = readLines(paths(root).cycles);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].attempts, 2);
});

test('worker: SIGTERM stops the running step at a safe point and records a clean stop; a second worker cannot start next to a live one', async () => {
  const root = state({ docsPerRound: 6, hang: true });
  const w = spawnWorker(root);
  await until('the cycle to be under way', () => fakeLog(root).find((l) => l.kind === 'cycle'));
  // a second worker on the same state directory refuses
  const second = createWorker({ root, env: { PATH: process.env.PATH }, cli: FAKE, seed: false, log: () => {} });
  assert.equal(await second.run(), 3);
  assert.equal(readJSON(paths(root).supervisor).pid, w.child.pid, 'the lock still belongs to the first worker');

  w.child.kill('SIGTERM');
  const end = await w.exited;
  assert.equal(end.code, 0, w.output());
  const rec = readJSON(paths(root).worker);
  assert.equal(rec.state, 'stopped');
  assert.equal(rec.detail, 'SIGTERM');
  assert.ok(fakeLog(root).some((l) => l.interrupted), 'the step was asked to stop and did');
  assert.equal(readJSON(path.join(root, 'cycle.json')).finished, false, 'the cycle stays resumable');
  assert.equal(rec.childFailures, 0, 'a stop that was asked for is not a failure');
  assert.equal(fs.existsSync(paths(root).supervisor), false);
  assert.ok(readLines(paths(root).events).some((e) => e.type === 'worker-stop'));

  // the next start continues it and counts no recovery (the stop was clean)
  writeJSON(path.join(root, 'fake.json'), { docsPerRound: 6 });
  const { record } = await runUntil(root, () => readLines(paths(root).cycles).length >= 1, { what: 'the continued cycle' });
  assert.equal(record.starts, 2);
  assert.equal(readLines(paths(root).cycles)[0].attempts, 2);
  assert.match(record.lastRecovery.found.join(' '), /cycle c0001 is unfinished/);
});

test('worker: a session with a time limit ends by itself and the next session continues the totals', async () => {
  const root = state({ docsPerRound: 1 });
  const lines = [];
  const a = createWorker({ root, env: { PATH: process.env.PATH }, cli: FAKE, seed: false, maxRuntime: 1.2, log: (s) => lines.push(s) });
  const t0 = Date.now();
  assert.equal(await a.run(), 0);
  assert.ok(Date.now() - t0 < 8000);
  const first = readJSON(paths(root).worker);
  assert.equal(first.state, 'stopped');
  assert.match(first.detail, /session's time/);
  assert.ok(first.totals.discoveryRounds >= 2);
  const b = createWorker({ root, env: { PATH: process.env.PATH }, cli: FAKE, seed: false, maxRuntime: 0.6, log: () => {} });
  await b.run();
  const second = readJSON(paths(root).worker);
  assert.equal(second.starts, 2);
  assert.equal(second.recoveries, 0);
  assert.ok(second.totals.discoveryRounds > first.totals.discoveryRounds);
  assert.equal(second.firstStarted, first.firstStarted);
});

test('worker: a session ends between two steps when newer code was pushed, and not otherwise', async () => {
  const root = state({ docsPerRound: 1 }, { model: FAST.model, worker: { ...FAST.worker, codeCheckMinutes: 0 } });
  let asked = 0;
  const lines = [];
  const w = createWorker({ root, env: { PATH: process.env.PATH }, cli: FAKE, seed: false, log: (s) => lines.push(s), newerCode: async () => { asked++; return asked >= 3 ? 'abcdef0123456789abcdef0123456789abcdef01' : null; } });
  const code = await w.run();                                                // ends by itself: nobody calls stop()
  assert.equal(code, 0);
  assert.equal(asked, 3);
  assert.equal(readLines(path.join(root, 'discovery.jsonl')).length, 3, 'three whole steps ran; none was cut short');
  assert.equal(w.record().state, 'stopped');
  assert.match(lines.join('\n'), /newer code is available \(abcdef0\): this session ends so that the next one runs it/);
  assert.equal(fs.existsSync(paths(root).supervisor), false, 'the lock is released for the next session');

  // the question itself: same commit → no; another commit → its id; no answer → no (a session never ends because GitHub was unreachable)
  const sha = 'a'.repeat(40), other = 'b'.repeat(40);
  const calls = [];
  const answer = (status, body) => async (url, init) => { calls.push({ url, auth: init.headers.authorization }); return new Response(body, { status }); };
  const q = { repo: 'o/r', ref: 'feature/x', sha, env: { GITHUB_TOKEN: 'secret-token', INFINI_GITHUB_API: 'https://api.test' } };
  assert.equal(await newerCommit({ ...q, fetchImpl: answer(200, sha + '\n') }), null);
  assert.equal(await newerCommit({ ...q, fetchImpl: answer(200, other) }), other);
  assert.equal(await newerCommit({ ...q, fetchImpl: answer(500, 'oops') }), null);
  assert.equal(await newerCommit({ ...q, fetchImpl: answer(200, '<html>not a commit</html>') }), null);
  assert.equal(await newerCommit({ ...q, fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await newerCommit({ ...q, sha: '', fetchImpl: answer(200, other) }), null);
  assert.equal(calls[0].url, 'https://api.test/repos/o/r/commits/feature%2Fx');
  assert.equal(calls[0].auth, 'Bearer secret-token');
});

test('worker: a production model that turns out damaged is rolled back at once, and the rollback is published', async () => {
  const root = state({ docsPerRound: 6, outcomes: ['promoted-damaged'] });
  const out = tmp('channel');
  const { record } = await runUntil(root, () => readLines(paths(root).cycles).length >= 1 && (readJSON(path.join(out, 'channel.json'), {}) || {}).version === 'm0001' && readLines(paths(root).events).some((e) => e.type === 'auto-rollback'), { what: 'the automatic rollback to be published', env: { INFINI_PUBLISH_DIR: out } });
  const reg = loadRegistry(root);
  assert.equal(reg.production, 'm0001');
  assert.equal(reg.models.m0002.status, 'unhealthy');
  assert.equal(reg.previous, null, 'a damaged model is not a model to go back to');
  assert.equal(reg.history[reg.history.length - 1].action, 'rollback');
  assert.equal(reg.history[reg.history.length - 1].by, 'worker');
  assert.match(record.errors.find((e) => e.where === 'health check').message, /checksum.*rolled back to m0001/);
  assert.equal(readJSON(path.join(out, 'channel.json')).version, 'm0001');
});

test('worker: pause is obeyed without stopping the worker; a request from the dashboard starts a cycle', async () => {
  const root = state({ docsPerRound: 1 }, { worker: { ...FAST.worker, trainWhenNewDocs: 1000 } });
  writeJSON(paths(root).control, { paused: true });
  const lines = [];
  const worker = createWorker({ root, env: { PATH: process.env.PATH }, cli: FAKE, seed: false, log: (s) => lines.push(s) });
  const done = worker.run();
  try {
    await until('the worker to report that it is paused', () => (readJSON(paths(root).worker, {}) || {}).activity === 'paused');
    await sleep(300);
    assert.equal(fakeLog(root).length, 0, 'nothing runs while paused');
    // a live worker owns the state: the server-side manager hands the request over instead of starting a process
    const manager = createManager({ root, scheduler: false, adminConfigured: true });
    assert.throws(() => manager.start('cycle'), /paused/);
    manager.resume();
    const r = manager.start('cycle');
    assert.equal(r.via, 'worker');
    assert.equal(r.pid, undefined, 'no second process was started');
    await until('the requested cycle', () => readLines(paths(root).cycles).length >= 1);
    assert.equal(readJSON(paths(root).control).trainNow, null, 'the request is taken once');
    assert.ok(lines.some((l) => /cycle: requested by an operator/.test(l)));
    manager.tick();                                                       // the timer of the server never competes with the worker
    manager.close();
    const view = snapshot(root);
    assert.equal(view.status.mode, 'worker');
    assert.equal(view.worker.alive, true);
  } finally { worker.stop('test finished'); await done; }
});

// ---------------------------------------------------------------- benchmark and gate

test('benchmark: the file cannot change unnoticed, its sentences are recognised, and the score is reproducible', () => {
  const bench = loadBenchmark();
  assert.equal(bench.id, 'infinity-bench-1');
  // any edit is detected
  const copy = path.join(tmp('bench'), 'v1.json');
  const edited = JSON.parse(fs.readFileSync(BENCHMARK_FILE, 'utf8'));
  edited.language[0][0] += ' ';
  fs.writeFileSync(copy, JSON.stringify(edited));
  assert.throws(() => loadBenchmark(copy), /benchmark file was changed/);
  // the sentences the dataset builder must leave out
  const set = benchmarkSentences(bench);
  assert.ok(set.size > 300);
  const s = bench.knowledge[0][0];
  assert.equal(isBenchmarkSentence(set, s), true);
  assert.equal(isBenchmarkSentence(set, '  ' + s.toUpperCase().replace(/\.$/, ' !')), true, 'case and punctuation do not hide a benchmark sentence');
  assert.equal(isBenchmarkSentence(set, 'This sentence is certainly not part of the benchmark.'), false);
  // the same model gives the same score, and the result has the documented shape
  const model = loadModel(path.join(FIX, 'models', 'm0001'));
  const tok = createTokenizer(JSON.parse(fs.readFileSync(path.join(FIX, 'models', 'm0001', 'tokenizer.json'), 'utf8')));
  const small = { ...bench, language: bench.language.slice(0, 6), knowledge: bench.knowledge.slice(0, 6), reasoning: bench.reasoning.slice(0, 6), conversation: bench.conversation.slice(0, 4), passages: bench.passages.slice(0, 2) };
  const a = runBenchmark(model, tok, small), b = runBenchmark(model, tok, small);
  assert.equal(a.score, b.score);
  assert.equal(a.passages.loss, b.passages.loss);
  assert.equal(a.items, 22);
  assert.ok(a.score >= 0 && a.score <= 1);
  for (const c of ['language', 'knowledge', 'reasoning', 'conversation']) assert.ok(a.categories[c].accuracy >= 0 && a.categories[c].accuracy <= 1);
  assert.ok(Number.isFinite(a.passages.loss) && a.passages.loss > 0);
});

test('dataset: benchmark sentences never reach the training text', async () => {
  const { buildDataset, buildDialogue } = await import('../learning/dataset.mjs');
  const bench = loadBenchmark();
  const leak = [bench.knowledge[0][0], bench.language[1][0], bench.passages[0].split(/(?<=[.!?])\s+/)[0]];
  const filler = (n) => Array.from({ length: 14 }, (_, i) => `The river station number ${n} recorded a water level of ${120 + i + n} centimetres on day ${i + 1} of the survey.`).join(' ');
  const mk = (i, extra = '') => ({ id: `doc${i}`, url: `https://example.org/${i}`, title: `Survey ${i}`, contentHash: crypto.createHash('sha256').update(`doc${i}`).digest('hex'), licence: { id: 'CC0-1.0' }, split: i % 5 === 0 ? 'val' : 'train', weight: 1, cycle: 'r0001', verification: { status: 'single-source', score: 0.8, disputed: [] }, paras: [{ text: `${filler(i)} ${extra}`.trim() }, { text: filler(i + 100) }] });
  const docs = Array.from({ length: 10 }, (_, i) => mk(i + 1, i === 1 ? leak.join(' ') : ''));
  const dir = tmp('dataset');
  const tokenizer = JSON.parse(fs.readFileSync(path.join(REPO, 'model', 'current', 'tokenizer.json'), 'utf8'));
  const { manifest } = buildDataset({ dir, version: 'd0001', docs, cfg: DEFAULTS, tokenizer, context: 256, cycle: 'c0001', dialogue: buildDialogue({ seed: 7, conversations: 300 }) });
  const tok = createTokenizer(tokenizer);
  const text = (file) => { const b = fs.readFileSync(path.join(dir, file)); const ids = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2); return tok.decode(Array.from(ids)); };
  const train = manifest.shards.filter((s) => s.split === 'train' && s.group !== 'dialogue').map((s) => text(s.file)).join(' ');
  assert.match(train, /river station number 2 recorded/, 'the document itself is used');
  for (const s of leak) assert.equal(train.includes(s), false, `benchmark sentence leaked into training: ${s}`);
  assert.ok(manifest.integrity.benchmarkSentencesRemoved >= leak.length, JSON.stringify(manifest.integrity));
  assert.equal(manifest.integrity.benchmarkSentencesInTraining, 0, 'measured on the written shards');
  assert.equal(manifest.integrity.benchmark, 'infinity-bench-1');
  assert.equal(manifest.integrity.valDocumentsInTraining + manifest.integrity.valHashesInTraining, 0);
  assert.equal(manifest.droppedTooLong, 0);
  // the memorisation probe is written with the dataset: trained passages and passages from held-out documents
  const probe = readJSON(path.join(dir, 'memprobe.json'));
  assert.ok(probe.trained.length > 0 && probe.unseen.length > 0);
});

test('dataset: a benchmark sentence embedded in a longer sentence is removed too', async () => {
  const { buildDataset, buildDialogue } = await import('../learning/dataset.mjs');
  const bench = loadBenchmark();
  const fact = bench.knowledge[0][0];                       // e.g. "The capital of France is Paris."
  const embedded = `${fact} This is widely known and appears in many reference works about the region and its history.`;
  const filler = (n) => Array.from({ length: 14 }, (_, i) => `The river station number ${n} recorded a water level of ${120 + i + n} centimetres on day ${i + 1} of the survey.`).join(' ');
  const mk = (i, extra = '') => ({ id: `doc${i}`, url: `https://example.org/${i}`, title: `Survey ${i}`, contentHash: crypto.createHash('sha256').update(`doc${i}`).digest('hex'), licence: { id: 'CC0-1.0' }, split: i % 5 === 0 ? 'val' : 'train', weight: 1, cycle: 'r0001', verification: { status: 'single-source', score: 0.8, disputed: [] }, paras: [{ text: `${filler(i)} ${extra}`.trim() }, { text: filler(i + 100) }] });
  const docs = Array.from({ length: 10 }, (_, i) => mk(i + 1, i === 1 ? embedded : ''));
  const dir = tmp('dataset-embed');
  const tokenizer = JSON.parse(fs.readFileSync(path.join(REPO, 'model', 'current', 'tokenizer.json'), 'utf8'));
  const { manifest } = buildDataset({ dir, version: 'd0001', docs, cfg: DEFAULTS, tokenizer, context: 256, cycle: 'c0001', dialogue: buildDialogue({ seed: 7, conversations: 300 }) });
  const tok = createTokenizer(tokenizer);
  const text = (file) => { const b = fs.readFileSync(path.join(dir, file)); const ids = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2); return tok.decode(Array.from(ids)); };
  const train = manifest.shards.filter((s) => s.split === 'train' && s.group !== 'dialogue').map((s) => text(s.file)).join(' ');
  assert.equal(train.includes(fact), false, `embedded benchmark sentence leaked into training: ${fact}`);
  assert.equal(manifest.integrity.benchmarkSentencesInTraining, 0, 'measured on the written shards');
  assert.ok(manifest.integrity.benchmarkSentencesRemoved >= 1, JSON.stringify(manifest.integrity));
});

test('dataset: exact and embedded benchmark phrases are removed from training dialogue', async () => {
  const { buildDataset, buildDialogue } = await import('../learning/dataset.mjs');
  const dialogue = buildDialogue({ seed: 7, conversations: 300 });
  const fact = loadBenchmark().knowledge[0][0];
  dialogue.train.push([['What fact is this?', fact, 'test']]);
  dialogue.train.push([['Tell me something.', `As a reminder, ${fact} This is a known fact.`, 'test']]);
  const originalLength = dialogue.train.length;
  const dir = tmp('dialogue-leak');
  const tokenizer = JSON.parse(fs.readFileSync(path.join(REPO, 'model', 'current', 'tokenizer.json'), 'utf8'));
  const { manifest } = buildDataset({ dir, version: 'dialogue-test', docs: [], cfg: DEFAULTS, tokenizer, context: 256, dialogue });
  assert.equal(dialogue.train.length, originalLength, 'the supplied dialogue is not mutated');
  assert.ok(manifest.integrity.benchmarkConversationsRemoved >= 2);
  assert.equal(manifest.integrity.benchmarkPhrasesInDialogue, 0);
  const shard = manifest.shards.find((s) => s.split === 'train' && s.group === 'dialogue');
  const bytes = fs.readFileSync(path.join(dir, shard.file));
  const text = createTokenizer(tokenizer).decode(Array.from(new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)));
  assert.equal(text.includes(fact), false);
});

test('memorisation probe: reports how much easier trained text is, and whether it is continued word for word', () => {
  const dir = path.join(FIX, 'models', 'm0001');
  const model = loadModel(dir);
  const tok = createTokenizer(JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8')));
  const seq = (text) => [3, ...tok.encode(text)].slice(0, 64);
  const a = Array.from({ length: 4 }, (_, i) => seq(`hello there, how are you today? i am fine, thank you. what can i do for you now? tell me about the weather in the valley number ${i}. it is sunny and warm today, and the sky is clear.`));
  const b = Array.from({ length: 4 }, (_, i) => seq(`zq${i} xv kj wq pz mn bv cx lk jh gf ds ap oi uy tr ew qa zs xd cf vg bh nj mk lo pi uy tr ew qz xx vv kk jj ww qq zz`));
  const r = memorizationProbe(model, tok, { trained: a, unseen: b });
  assert.deepEqual([r.trained.passages, r.unseen.passages], [4, 4]);
  assert.ok(Number.isFinite(r.trained.loss) && Number.isFinite(r.unseen.loss));
  assert.ok(r.trained.verbatim >= 0 && r.trained.verbatim <= 1);
  assert.equal(r.gap, +(r.unseen.loss - r.trained.loss).toFixed(4));
  assert.ok(r.gap > 0, 'ordinary English is easier for the model than random letters');
  const none = memorizationProbe(model, tok, { trained: [], unseen: [] });
  assert.equal(none.trained.verbatim, null);
});

test('promotion gate: the benchmark, memorisation and "measurably better" decide together with the earlier checks', () => {
  const gate = DEFAULTS.gate;
  const bench = (score, loss) => ({ id: 'infinity-bench-1', score, items: 176, passages: { loss } });
  const mem = (trained, unseen, verbatim = 0, unseenVerbatim = 0) => ({ trained: { loss: trained, verbatim }, unseen: { loss: unseen, verbatim: unseenVerbatim }, gap: +(unseen - trained).toFixed(4), verbatimExcess: +(verbatim - unseenVerbatim).toFixed(4), passages: [48, 46] });
  const card = (over = {}, probes = {}) => ({ id: 'm', val_loss: 2.0, groups: { dialogue: { val_loss: 1.9 }, web: { val_loss: 4.0 } }, probes: { parity: { ok: true, maxDiff: 0.0001 }, chat: { f1: 0.5 }, grounded: { accuracy: 0.6, chance: 0.3 }, route: { accuracy: 0.9 }, sampling: { repetition: 0.05 }, benchmark: bench(0.58, 6.7), memorization: mem(3.6, 4.0), ...probes }, ...over });
  const prod = card({ id: 'm0002' });
  const failed = (g) => g.checks.filter((c) => !c.pass).map((c) => c.name);
  const run = (over, probes) => promotionGate(card({ id: 'm0003', ...over }, probes), prod, gate);

  assert.deepEqual(failed(run({ val_loss: 1.95 })), [], 'better held-out loss, nothing worse');
  assert.deepEqual(failed(run({}, { benchmark: bench(0.6, 6.7) })), [], 'same loss, clearly better benchmark');
  assert.deepEqual(failed(run({})), ['measurably better than production'], 'equal is not enough to replace production');
  assert.deepEqual(failed(run({ val_loss: 1.999 })), ['measurably better than production'], 'an improvement inside the noise is not enough');
  assert.deepEqual(failed(run({ val_loss: 1.9 }, { benchmark: bench(0.54, 6.7) })), ['fixed benchmark score did not fall']);
  assert.deepEqual(failed(run({ val_loss: 1.9 }, { benchmark: bench(0.58, 6.9) })), ['fixed benchmark text is not read worse']);
  assert.deepEqual(failed(run({ val_loss: 1.9 }, { benchmark: undefined })), ['fixed benchmark was run'], 'a candidate without a benchmark result cannot be promoted');
  assert.deepEqual(failed(run({ val_loss: 1.9, groups: { dialogue: { val_loss: 1.8 }, web: { val_loss: 4.2 } } })), ['held-out document text is not read worse'], 'better conversation may not hide worse reading of new documents');
  // memorisation
  assert.deepEqual(failed(run({ val_loss: 1.9 }, { memorization: mem(2.0, 4.0, 0.4, 0) })), ['does not recite its training text', 'trained text is not much easier than unseen text']);
  assert.deepEqual(failed(run({ val_loss: 1.9 }, { memorization: mem(3.6, 4.0, 0.2, 0.02) })), ['does not recite its training text']);
  assert.deepEqual(failed(run({ val_loss: 1.9 }, { memorization: mem(3.2, 4.0) })), ['trained text is not much easier than unseen text'], 'gap 0.8 against a limit of 0.6');
  // production measured on the same passages is the control: its own gap explains part of the candidate's, up to a ceiling
  const hardProd = card({ id: 'm0002' }, { memorization: mem(3.4, 4.02) });      // gap 0.62, as measured for m0002 in the sandbox
  const vs = (m) => failed(promotionGate(card({ id: 'm0003', val_loss: 1.9 }, { memorization: m }), hardProd, gate));
  assert.deepEqual(vs(mem(3.3, 4.02)), [], 'gap 0.72 ≤ 0.62 + 0.15');
  assert.deepEqual(vs(mem(2.88, 4.19)), ['trained text is not much easier than unseen text'], 'the candidate of cycle c0003: gap 1.31');
  const extreme = card({ id: 'm0002' }, { memorization: mem(2.0, 4.0) });
  assert.match(promotionGate(card({ id: 'm0003', val_loss: 1.9 }, { memorization: mem(1.95, 4.0) }), extreme, gate).checks.find((c) => /much easier/.test(c.name)).detail, /limit 1;/, 'never beyond the ceiling');
  // the earlier checks still decide
  assert.deepEqual(failed(run({ val_loss: 2.1 }, { benchmark: bench(0.62, 6.5) })), ['held-out loss is not worse than production']);
  // a first model: benchmark required, nothing to compare with
  assert.equal(promotionGate(card(), null, gate).pass, true);
  assert.deepEqual(failed(promotionGate(card({}, { benchmark: undefined }), null, gate)), ['fixed benchmark was run']);
  // the defaults themselves (a change here must be deliberate)
  assert.deepEqual({ r: gate.benchmarkRequired, d: gate.maxBenchmarkDrop, l: gate.maxBenchmarkLossRegression, v: gate.maxVerbatim, g: gate.maxGeneralizationGap, i: gate.minImprovement, b: gate.minBenchmarkGain, reg: gate.maxLossRegression, w: gate.maxWebRegression }, { r: true, d: 0.03, l: 0.05, v: 0.15, g: 0.6, i: 0.002, b: 0.01, reg: 0, w: 0.05 });
});

// ---------------------------------------------------------------- persistence

test('persistence: the state survives as an archive; a new state starts from the published model; old large files are removed', async () => {
  const root = state({});
  const dir = modelDir(root, 'm0002');
  fs.cpSync(modelDir(root, 'm0001'), dir, { recursive: true });
  registerModel(root, { id: 'm0002', status: 'candidate', parent: 'm0001', sha256: sha(path.join(dir, 'weights.bin')) });
  promote(root, 'm0002', { reason: 'test' });
  writeJSON(paths(root).supervisor, { pid: 1 }); writeJSON(paths(root).lock, { pid: 1 });
  fs.mkdirSync(paths(root).channel, { recursive: true }); fs.writeFileSync(path.join(paths(root).channel, 'big.bin'), 'x');
  const file = path.join(tmp('archive'), 'state.tar.gz');
  const packed = packState(root, file);
  assert.equal(packed.sha256, sha(file));
  const back = tmp('restored');
  const r = restoreState(file, back);
  assert.equal(r.production, 'm0002');
  assert.equal(sha(path.join(modelDir(back, 'm0002'), 'weights.bin')), sha(path.join(dir, 'weights.bin')));
  assert.deepEqual(loadRegistry(back).history.map((h) => h.action), loadRegistry(root).history.map((h) => h.action));
  for (const f of ['supervisor.lock', 'worker.lock', 'channel']) assert.equal(fs.existsSync(path.join(back, f)), false, `${f} is not part of the archive`);
  assert.equal(healthCheck(back).ok, true);

  // a fresh state directory starts from the model published with the app (no Python here: no training checkpoint)
  const fresh = tmp('fresh');
  const seeded = await seedFromPublished(fresh, { env: { PATH: '', INFINI_PYTHON: '/nonexistent/python' } });
  const bundled = readJSON(path.join(REPO, 'model', 'snapshot.json')).registry.production;
  assert.equal(seeded.seeded, true);
  assert.equal(seeded.production, bundled);
  assert.equal(typeof seeded.checkpoint, 'boolean', 'true only where Python with PyTorch is installed');
  assert.equal(loadRegistry(fresh).production, bundled);
  assert.equal(healthCheck(fresh).ok, true);
  assert.equal((await seedFromPublished(fresh, { env: { PATH: '' } })).seeded, false, 'a state that has a model is left alone');
  assert.equal(pendingInfo(fresh).ids.length, 0);

  // pruning keeps production, the previous stable model and the newest versions; cards stay
  for (let i = 3; i <= 12; i++) { const id = 'm' + String(i).padStart(4, '0'); fs.cpSync(modelDir(root, 'm0001'), modelDir(root, id), { recursive: true }); registerModel(root, { id, status: 'rejected' }); }
  const removed = pruneState(root);
  assert.ok(removed.length > 0);
  for (const id of ['m0001', 'm0002', 'm0012', 'm0007']) assert.ok(fs.existsSync(path.join(modelDir(root, id), 'weights.bin')), `${id} is kept`);
  assert.equal(fs.existsSync(path.join(modelDir(root, 'm0003'), 'weights.bin')), false);
  assert.ok(fs.existsSync(path.join(modelDir(root, 'm0003'), 'model.json')));
  assert.equal(loadRegistry(root).models.m0003.status, 'rejected');
});

// ---------------------------------------------------------------- publication

/** A GitHub API small enough to read: releases with assets, kept in memory. */
function fakeGithub() {
  const releases = new Map();
  const calls = [];
  let nextId = 1;
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url), method = opts.method || 'GET';
    calls.push(`${method} ${u.pathname}`);
    if (!/^Bearer secret-token$/.test((opts.headers || {}).Authorization || '')) return json({ message: 'Bad credentials' }, 401);
    let m;
    if ((m = /^\/repos\/o\/r\/releases\/tags\/(.+)$/.exec(u.pathname)) && method === 'GET') { const r = releases.get(decodeURIComponent(m[1])); return r ? json({ id: r.id, tag_name: r.tag }) : json({ message: 'Not Found' }, 404); }
    if (u.pathname === '/repos/o/r/releases' && method === 'POST') { const b = JSON.parse(opts.body); const r = { id: nextId++, tag: b.tag_name, body: b.body, assets: new Map() }; releases.set(r.tag, r); return json({ id: r.id }, 201); }
    const byId = (id) => [...releases.values()].find((r) => r.id === Number(id));
    if ((m = /^\/repos\/o\/r\/releases\/(\d+)\/assets$/.exec(u.pathname)) && method === 'GET') return json([...byId(m[1]).assets.values()].map((a) => ({ id: a.id, name: a.name, size: a.data.length, state: 'uploaded', updated_at: a.t })));
    if ((m = /^\/repos\/o\/r\/releases\/(\d+)\/assets$/.exec(u.pathname)) && method === 'POST') { const name = u.searchParams.get('name'); const r = byId(m[1]); if ([...r.assets.values()].some((a) => a.name === name)) return json({ message: 'already_exists' }, 422); const a = { id: nextId++, name, data: Buffer.from(opts.body), t: nowISO() }; r.assets.set(a.id, a); return json({ id: a.id }, 201); }
    if ((m = /^\/repos\/o\/r\/releases\/assets\/(\d+)$/.exec(u.pathname))) {
      const r = [...releases.values()].find((x) => x.assets.has(Number(m[1])));
      if (!r) return json({ message: 'Not Found' }, 404);
      if (method === 'DELETE') { r.assets.delete(Number(m[1])); return new Response(null, { status: 204 }); }
      if (method === 'PATCH') { const a = r.assets.get(Number(m[1])); a.name = JSON.parse(opts.body).name; return json({ id: a.id, name: a.name }); }
      return new Response(r.assets.get(Number(m[1])).data, { status: 200 });
    }
    if ((m = /^\/repos\/o\/r\/releases\/(\d+)$/.exec(u.pathname)) && method === 'PATCH') { byId(m[1]).body = JSON.parse(opts.body).body; return json({}); }
    return json({ message: 'unexpected ' + method + ' ' + u.pathname }, 500);
  };
  const names = (tag) => [...releases.get(tag).assets.values()].map((a) => a.name).sort();
  return { fetchImpl, releases, calls, names };
}

test('publication: a GitHub release as the channel — created when missing, unchanged versions not re-uploaded, the state archive stored and fetched', async () => {
  const root = state({});
  const gh = fakeGithub();
  const env = { INFINI_PUBLISH_GITHUB: 'o/r', GITHUB_TOKEN: 'secret-token', INFINI_GITHUB_API: 'https://api.test', INFINI_GITHUB_UPLOADS: 'https://uploads.test' };
  const first = await publishAll(root, { env, fetchImpl: gh.fetchImpl });
  assert.equal(first.version, 'm0001');
  assert.equal(first.results[0].error, undefined, JSON.stringify(first.results));
  assert.deepEqual(gh.names('infinity-model'), ['channel.json', 'm0001.model.json', 'm0001.tokenizer.json', 'm0001.weights.bin', 'snapshot.json', 'status.json']);
  assert.match(gh.releases.get('infinity-model').body, /production model: `m0001`/);
  assert.equal(first.results[0].uploaded, 6);
  // the pointer is uploaded after the files it names
  const posts = gh.calls.filter((c) => /^POST .*assets$/.test(c)).length;
  assert.equal(posts, 6);
  // nothing changed: the model files are not sent again, the records are refreshed
  const again = await publishAll(root, { env, fetchImpl: gh.fetchImpl });
  assert.equal(again.results[0].skipped, 3);
  assert.equal(again.results[0].uploaded, 3);
  // a status-only publication does not touch the model files at all
  const statusOnly = await publishAll(root, { env, model: false, fetchImpl: gh.fetchImpl });
  assert.equal(statusOnly.results[0].uploaded, 2);
  // a wrong token is reported, not thrown
  const bad = await publishAll(root, { env: { ...env, GITHUB_TOKEN: 'wrong' }, fetchImpl: gh.fetchImpl });
  assert.match(bad.results[0].error, /401/);

  // the state archive: stored, fetched and restored
  const { pushState } = await import('../learning/publish.mjs');
  const stored = await pushState(root, { env: { ...env, INFINI_STATE_GITHUB: 'o/r' }, fetchImpl: gh.fetchImpl });
  assert.equal(stored.stored, true);
  assert.deepEqual(gh.names('infinity-state'), ['state.tar.gz']);
  const to = path.join(tmp('pull'), 'state.tar.gz');
  const got = await fetchGithubAsset({ repo: 'o/r', tag: 'infinity-state', name: 'state.tar.gz', token: 'secret-token', api: 'https://api.test', fetchImpl: gh.fetchImpl, to });
  assert.equal(sha(to), stored.sha256);
  assert.equal(got.bytes, stored.bytes);
  const back = tmp('restored');
  assert.equal(restoreState(to, back).production, 'm0001');
  // A failed upload cannot delete the last good state. A failed final rename is recoverable from staging.
  const failUpload = async (url, opts) => String(url).includes('name=state-staging-') ? new Response('failed', { status: 503 }) : gh.fetchImpl(url, opts);
  await assert.rejects(pushState(root, { env: { ...env, INFINI_STATE_GITHUB: 'o/r' }, fetchImpl: failUpload }), /503/);
  assert.deepEqual(gh.names('infinity-state'), ['state.tar.gz']);
  const failRename = async (url, opts) => opts?.method === 'PATCH' && /\/assets\/\d+$/.test(new URL(url).pathname) ? new Response('failed', { status: 503 }) : gh.fetchImpl(url, opts);
  await assert.rejects(pushState(root, { env: { ...env, INFINI_STATE_GITHUB: 'o/r' }, fetchImpl: failRename }), /503/);
  assert.match(gh.names('infinity-state')[0], /^state-staging-/);
  assert.ok(await fetchGithubAsset({ repo: 'o/r', tag: 'infinity-state', name: 'state.tar.gz', token: 'secret-token', api: 'https://api.test', fetchImpl: gh.fetchImpl, to }), 'completed staging asset recovers after failed rename');
  assert.equal(await fetchGithubAsset({ repo: 'o/r', tag: 'no-such-release', name: 'state.tar.gz', token: 'secret-token', api: 'https://api.test', fetchImpl: gh.fetchImpl, to }), null, 'no stored state yet is not an error');
});

/** Serve a published channel directory under https://channel.test/live/ (what a release or a static host does). */
function channelHost(dir) {
  const hits = [];
  let down = false;
  const fetchImpl = async (url) => {
    const u = new URL(url);
    hits.push(u.pathname);
    if (down) throw new Error('network unreachable');
    if (u.origin !== 'https://channel.test' || !u.pathname.startsWith('/live/')) return new Response('no', { status: 404 });
    const f = path.join(dir, path.basename(u.pathname));
    return fs.existsSync(f) ? new Response(fs.readFileSync(f), { status: 200 }) : new Response('not found', { status: 404 });
  };
  return { fetchImpl, hits, setDown: (v) => { down = v; } };
}
/** A worker state with m0002 promoted over m0001 (the same weights under a new version, enough to follow versions). */
function promoteCopy(root, id) {
  const from = modelDir(root, loadRegistry(root).production), to = modelDir(root, id);
  fs.cpSync(from, to, { recursive: true });
  registerModel(root, { id, status: 'candidate', parent: loadRegistry(root).production, sha256: sha(path.join(to, 'weights.bin')) });
  promote(root, id, { reason: 'test' });
}

test('publication: the published records name no place on the worker machine, and the short status carries what a remote reader needs', async () => {
  const root = state({});
  const there = path.resolve(root) + path.sep;
  const cleaned = withoutPaths({
    a: `${there}models/m0005/ckpt.pt`, b: `continued from ${there}models/m0005/ckpt.pt`, c: 'https://github.com/o/r/releases/download/infinity-model/',
    d: '/home/someone/channel', e: 'loss 6.904 vs 6.713 (allowed +0.05)', f: 'dialogue 0.34 / fresh 0.33', g: '/usr/bin/python3',
    h: 'C:\\Users\\me\\state\\x.bin', i: 'see https://en.wikipedia.org/wiki/Foo and /api/llm/status', n: 3, list: ['/tmp/x', { deep: '/root/secret/file.txt' }],
  }, there);
  assert.deepEqual(cleaned, {
    a: 'models/m0005/ckpt.pt', b: 'continued from models/m0005/ckpt.pt', c: 'https://github.com/o/r/releases/download/infinity-model/',
    d: 'channel', e: 'loss 6.904 vs 6.713 (allowed +0.05)', f: 'dialogue 0.34 / fresh 0.33', g: 'python3',
    h: 'x.bin', i: 'see https://en.wikipedia.org/wiki/Foo and /api/llm/status', n: 3, list: ['x', { deep: 'file.txt' }],
  });

  // a worker that publishes into a directory: neither the state directory nor the publishing directory appears in the records
  const dest = tmp('pub');
  const run = state({ docsPerRound: 3 });
  await runUntil(run, () => readLines(paths(run).cycles).length >= 1 && (readJSON(path.join(dest, 'channel.json'), {}) || {}).version === 'm0002', { what: 'a promotion published to the directory', env: { INFINI_PUBLISH_DIR: dest } });
  const text = fs.readFileSync(path.join(dest, 'snapshot.json'), 'utf8');
  assert.ok(!text.includes(path.resolve(run)), 'the state directory is not named');
  assert.ok(!text.includes(dest), 'the publishing directory is not named');
  assert.ok(!text.includes(os.tmpdir() + path.sep), 'no temporary path at all');
  const snap = JSON.parse(text);
  assert.equal(snap.host.remoteWorker, true);
  assert.equal(snap.worker.lastPublish.targets[0].target, 'directory');
  for (const f of fs.readdirSync(dest)) assert.equal(fs.statSync(path.join(dest, f)).mode & 0o044, 0o044, `${f} is readable by a web server running as another user`);

  // the short status (the text of the release): readable without downloading anything
  const notes = statusNotes(run);
  const data = JSON.parse(notes.split('```json\n')[1].split('\n```')[0]);
  assert.equal(data.production, 'm0002');
  assert.equal(data.worker.totals.promoted, 1);
  assert.ok(Array.isArray(data.cycles) && data.cycles.some((c) => c.outcome === 'promoted'));
  assert.ok(Array.isArray(data.discovery) && data.discovery.length >= 1);
  assert.ok(data.sources && typeof data.sources === 'object');
  assert.ok(!notes.includes(path.resolve(run)));
});

test('channel: the serving side takes a verified model, refuses a damaged one, follows a rollback, and survives an unreachable channel', async () => {
  const root = state({});
  const out = tmp('channel');
  const host = channelHost(out);
  const pub = () => publishDir(buildChannel(root), out);
  const ch = createChannel({ url: 'https://channel.test/live/', dir: tmp('recv'), intervalMs: 0, fetchImpl: host.fetchImpl });
  assert.equal(ch.current(), null);
  assert.equal(await ch.sync(), false, 'nothing published yet');
  assert.match(ch.info().error, /no channel\.json yet/);

  pub();
  assert.equal(await ch.sync(), true);
  assert.equal(ch.current().id, 'm0001');
  assert.equal(ch.snapshot().registry.production, 'm0001');
  assert.equal(await ch.sync(), false, 'the same version is not downloaded again');
  const before = host.hits.filter((h) => /weights/.test(h)).length;
  await ch.sync();
  assert.equal(host.hits.filter((h) => /weights/.test(h)).length, before);

  promoteCopy(root, 'm0002'); pub();
  assert.equal(await ch.sync(), true);
  assert.equal(ch.current().id, 'm0002');
  assert.ok(loadModel(ch.current().dir), 'what was received loads as a model');

  // a damaged upload: the pointer names m0003 but the weights do not match the checksum → the model in use stays
  promoteCopy(root, 'm0003'); pub();
  const w = path.join(out, 'm0003.weights.bin'); const b = fs.readFileSync(w); b[b.length - 9] ^= 0xff; fs.writeFileSync(w, b);
  assert.equal(await ch.sync(), false);
  assert.equal(ch.current().id, 'm0002');
  assert.match(ch.info().error, /does not match its checksum/);
  // a pointer that lies about the checksum but ships a broken model fails the self-test instead
  const chj = readJSON(path.join(out, 'channel.json')); chj.files.weights.sha256 = sha(w); writeJSON(path.join(out, 'channel.json'), chj);
  assert.equal(await ch.sync(), false);
  assert.equal(ch.current().id, 'm0002');
  assert.ok(ch.info().error.length > 0);

  // the worker rolls back (m0003 → m0002 is already in use; go further back to m0001): the server follows
  rollback(root, { to: 'm0001', reason: 'test', by: 'admin' }); pub();
  assert.equal(await ch.sync(), true);
  assert.equal(ch.current().id, 'm0001');
  assert.equal(ch.info().error, undefined);

  // unreachable: no exception, the model in use stays, and it is still there for a new process (kept on disk)
  host.setDown(true);
  assert.equal(await ch.sync(), false);
  assert.equal(ch.current().id, 'm0001');
  assert.match(ch.info().error, /network unreachable/);
  // names that could leave the directory are refused
  host.setDown(false);
  const evil = readJSON(path.join(out, 'channel.json')); evil.version = 'm0009'; evil.files.weights.name = '../../etc/passwd'; writeJSON(path.join(out, 'channel.json'), evil);
  assert.equal(await ch.sync(), false);
  assert.equal(ch.current().id, 'm0001');
});

test('server: an approved model reaches a running server through the channel — no restart, no redeploy — and so does a rollback', async () => {
  process.env.LOG_LEVEL = 'silent';
  const root = state({});                                                 // the worker's machine
  const out = tmp('channel');
  const host = channelHost(out);
  // the serving machine: its own empty state directory and a bundled model m0001 (what was deployed)
  const bundled = tmp('bundled');
  fs.cpSync(path.join(FIX, 'models', 'm0001'), path.join(bundled, 'current'), { recursive: true });
  writeJSON(path.join(bundled, 'snapshot.json'), { ...snapshot(root), host: { trainingCapable: false } });
  const cfg = loadConfig({ RATE_LIMIT_PER_MIN: '600', RATE_LIMIT_BURST: '300', INFINI_LLM: '1', INFINI_LLM_DIR: path.join(tmp('serve'), 'none'), INFINI_LLM_BUNDLED: bundled, INFINI_LEARNING: '0', INFINI_LEARNING_SCHEDULER: '0', INFINI_MODEL_CHANNEL: 'https://channel.test/live', INFINI_MODEL_CHANNEL_SECONDS: '5', INFINI_MODEL_CHANNEL_DIR: tmp('recv'), INFINI_LLM_MIN_LOGPROB: '-50', INFINI_LLM_MIN_AGREEMENT: '0' });
  cfg.fetchImpl = host.fetchImpl;
  const app = createApp(cfg);
  const srv = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const status = async () => (await fetch(base + '/api/llm/status')).json();
  const version = async () => { await app.channel.sync({ force: true }); app.neural.refresh(true); return (await (await fetch(base + '/api/status')).json()).llm; };
  try {
    // nothing published yet: the deployed model answers
    let llm = await version();
    assert.equal(llm.version, 'm0001');
    assert.equal(app.neural.info().source, 'bundled');

    // the worker promotes m0002 and publishes; the same server process now answers with m0002
    promoteCopy(root, 'm0002');
    writeJSON(paths(root).worker, { format: 'infinity-worker/1', state: 'running', activity: 'discovering', heartbeat: nowISO(), started: nowISO(), starts: 1, totals: { cycles: 1 } });
    publishDir(buildChannel(root), out);
    llm = await version();
    assert.equal(llm.version, 'm0002');
    assert.equal(app.neural.info().source, 'channel');
    const res = await fetch(base + '/api/llm/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hello there', temperature: 0 }) });
    assert.equal(res.status, 200);
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.match(JSON.stringify(events), /m0002/, 'the reply was produced by the model that arrived through the channel');

    // the dashboard shows the worker's records, live
    const view = await status();
    assert.equal(view.learning.registry.production, 'm0002');
    assert.equal(view.learning.host.remoteWorker, true);
    assert.equal(view.learning.host.channel.version, 'm0002');
    assert.equal(view.learning.worker.alive, true);
    assert.equal(view.learning.worker.activity, 'discovering');

    // rollback on the worker → the server goes back as well
    rollback(root, { reason: 'test: back to the stable model', by: 'admin' });
    publishDir(buildChannel(root), out);
    const fetchedBefore = host.hits.filter((x) => /weights/.test(x)).length;
    llm = await version();
    assert.equal(llm.version, 'm0001');
    assert.equal(app.channel.info().version, 'm0001');
    assert.equal(app.neural.info().source, 'bundled', 'm0001 is exactly what was deployed: the shipped copy answers');
    assert.equal(host.hits.filter((x) => /weights/.test(x)).length, fetchedBefore, '… and it is not downloaded again');
    assert.equal((await status()).learning.registry.history.slice(-1)[0].action, 'rollback');

    // a worker that stopped reporting is shown as not alive (old heartbeat)
    writeJSON(paths(root).worker, { format: 'infinity-worker/1', state: 'running', activity: 'discovering', heartbeat: new Date(Date.now() - 3600_000).toISOString(), starts: 1 });
    publishDir(buildChannel(root, { model: false }), out);
    await app.channel.sync({ force: true });
    const stale = await status();
    assert.equal(stale.learning.worker.alive, false);
    assert.ok(stale.learning.worker.heartbeatAgeSeconds >= 3600);
  } finally { srv.close(); await app.close(); }
});

// ---------------------------------------------------------------- discovery

test('discovery: the MediaWiki collector reads random articles, skips stubs and pages already seen, keeps to its budget and records failures', async () => {
  const page = (id, title, length) => ({ pageid: id, title, length, fullurl: `https://simple.wiki.test/wiki/${title}` });
  const batches = [
    { 1: page(1, 'Alpha', 9000), 2: page(2, 'Stub', 400), 3: page(3, 'Seen', 8000), 4: page(4, 'Broken', 7000), 5: page(5, 'Beta', 6000) },
    { 6: page(6, 'Gamma', 5000), 7: page(7, 'Delta', 5000), 8: page(8, 'Epsilon', 5000) },
  ];
  const apiCalls = [], fetched = [];
  const engine = {
    http: { getJSON: async (u) => { apiCalls.push(u); return { json: { query: { pages: batches[apiCalls.length - 1] || {} } } }; } },
    acquire: async (url) => {
      fetched.push(url);
      if (/Broken/.test(url)) throw Object.assign(new Error('HTTP 503'), { code: 'http' });
      return { url, html: '<html><head><link rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/"></head><body></body></html>', headers: {}, page: { title: url.split('/').pop(), lang: 'en', site: 'Test Wiki', robots: '', blocks: [{ type: 'p', text: 'Some text.' }] } };
    },
  };
  const st = { urls: { 'https://simple.wiki.test/wiki/Seen': { t: nowISO(), status: 'accepted' } }, cursors: {}, frontier: [] };
  const notes = [];
  const out = await collectMediawiki(engine, { id: 'simplewiki', type: 'mediawiki', site: 'https://simple.wiki.test/', maxCalls: 3 }, st, 4, { note: (s) => notes.push(s) });
  assert.match(apiCalls[0], /^https:\/\/simple\.wiki\.test\/w\/api\.php\?action=query&format=json&generator=random&grnnamespace=0/);
  assert.equal(out.length, 4, 'the budget of four is kept');
  assert.deepEqual(out.map((d) => d.url.split('/').pop()), ['Alpha', 'Broken', 'Beta', 'Gamma']);
  assert.equal(fetched.some((u) => /Stub|Seen/.test(u)), false, 'stubs and known pages cost no request');
  assert.match(st.urls['https://simple.wiki.test/wiki/Stub'].status, /skipped:stub/);
  const ok = out.filter((d) => !d.error);
  assert.equal(ok.length, 3);
  assert.equal(ok[0].source, 'simplewiki');
  assert.equal(ok[0].licence.id, 'CC-BY-SA-4.0');
  assert.equal(ok[0].trusted, false, 'a wiki article is not trusted because of where it came from; verification decides');
  assert.match(out[1].error, /503/);
  assert.match(notes[0], /simplewiki: 4 articles read .* \(1 stubs skipped\)/);
  // the three wiki sources are configured, each with a per-cycle limit and a licence that the allow-list contains
  const wiki = DEFAULTS.sources.filter((s) => s.type === 'mediawiki');
  assert.deepEqual(wiki.map((s) => s.id).sort(), ['simplewiki', 'wikibooks', 'wikivoyage']);
  for (const s of wiki) { assert.ok(s.perCycle > 0 && s.perCycle <= 40); assert.match(s.site, /^https:\/\//); }
});

// ---------------------------------------------------------------- deployment files

test('discovery: every source gets its share of a round, the first place rotates, and what one source cannot deliver goes to the others', async () => {
  const sources = [
    { id: 'web', type: 'web', perCycle: 40 }, { id: 'simplewiki', type: 'mediawiki', perCycle: 30 }, { id: 'wikibooks', type: 'mediawiki', perCycle: 10 },
    { id: 'wikivoyage', type: 'mediawiki', perCycle: 10 }, { id: 'factbook', type: 'github', perCycle: 30 }, { id: 'openstax', type: 'github', perCycle: 40 },
    { id: 'switched-off', type: 'github', perCycle: 40, enabled: false },
  ];
  const cfg = { ...DEFAULTS, sources };
  const ask = async (cycle, maxDocs, down = []) => {
    const asked = [];
    const collectImpl = async (engine, src, st, budget) => {
      asked.push([src.id, budget]);
      if (down.includes(src.id)) throw new Error('unreachable');
      return Array.from({ length: budget }, (_, i) => ({ source: src.id, url: `https://${src.id}.test/${cycle}/${i}`, error: 'not fetched in this test', collectedAt: nowISO() }));
    };
    const r = await acquire({ engine: null, cfg, root: tmp('shares'), cycle, maxDocs, collectImpl });
    return { asked, report: r.report };
  };
  // a discovery round of 40 with six sources whose limits add up to 160: nobody takes the round alone
  const a = await ask('r00006', 40);
  assert.deepEqual(a.asked, [['web', 10], ['simplewiki', 8], ['wikibooks', 3], ['wikivoyage', 3], ['factbook', 7], ['openstax', 9]]);
  assert.equal(a.report.collected, 40);
  assert.deepEqual(Object.keys(a.report.bySource).sort(), ['factbook', 'openstax', 'simplewiki', 'web', 'wikibooks', 'wikivoyage']);
  // the next round starts with the next source
  const b = await ask('r00007', 40);
  assert.equal(b.asked[0][0], 'simplewiki');
  assert.equal(b.asked[b.asked.length - 1][0], 'web');
  assert.equal(b.asked.reduce((n, x) => n + x[1], 0), 40);
  // three sources are down: their share goes to the ones that answer, and the failures are recorded
  const c = await ask('r00006', 40, ['simplewiki', 'wikibooks', 'wikivoyage']);
  assert.deepEqual(c.asked.filter((x) => !['simplewiki', 'wikibooks', 'wikivoyage'].includes(x[0])), [['web', 10], ['factbook', 13], ['openstax', 17]]);
  assert.equal(c.report.collected, 40);
  assert.equal(c.report.errors.length, 3);
  // a full cycle (budget as large as all limits together): every source may deliver up to its own limit, never more
  const d = await ask('c0009', 160);
  assert.deepEqual(Object.fromEntries(d.asked), { web: 40, simplewiki: 30, wikibooks: 10, wikivoyage: 10, factbook: 30, openstax: 40 });
  const e = await ask('c0009', 1000);
  assert.deepEqual(Object.fromEntries(e.asked), { web: 40, simplewiki: 30, wikibooks: 10, wikivoyage: 10, factbook: 30, openstax: 40 });
  assert.ok(!a.asked.concat(b.asked, c.asked, d.asked).some((x) => x[0] === 'switched-off'));
});

test('deployment: the workflow, the container and the service unit run the same worker and keep its state', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'infinity-learning.yml'), 'utf8');
  assert.match(wf, /node learning\/worker\.mjs --max-runtime "\$SESSION_SECONDS"/);
  assert.match(wf, /RUNTIME: \$\{\{ inputs\.runtime \|\| '18000' \}\}/, 'a session stays inside the six hours a hosted runner lives');
  assert.match(wf, /node learning\/cli\.mjs state-pull/);
  assert.match(wf, /INFINI_STATE_GITHUB: \$\{\{ github\.repository \}\}/);
  assert.match(wf, /INFINI_PUBLISH_GITHUB: \$\{\{ github\.repository \}\}/);
  assert.match(wf, /gh workflow run infinity-learning\.yml/, 'each session starts the next one');
  assert.match(wf, /concurrency:\s*\n\s*group: infinity-learning\s*\n\s*cancel-in-progress: false/, 'two sessions never train at once');
  assert.match(wf, /vars\.INFINITY_LEARNING != 'off'/, 'there is a switch to stop the chain');
  assert.match(wf, /watchdog:\s*\n\s*if: \$\{\{ github\.event_name == 'schedule'/, 'the hourly schedule only checks and restarts');
  assert.match(wf, /session:\s*\n\s*if: \$\{\{ github\.event_name != 'schedule'/, 'a scheduled run never trains next to a running session');
  assert.match(wf, /timeout-minutes: 340/);
  assert.doesNotMatch(wf, /secrets\.(?!GITHUB_TOKEN)/, 'no secret beyond the token GitHub provides');
  assert.match(wf, /INFINI_WORKER_CODE_SHA: \$\{\{ github\.sha \}\}/, 'a session knows which commit it runs, and ends early when a newer one was pushed');
  const df = fs.readFileSync(path.join(REPO, 'Dockerfile.worker'), 'utf8');
  assert.match(df, /torch/); assert.match(df, /VOLUME \/data/); assert.match(df, /HEALTHCHECK .*cli\.mjs alive/); assert.match(df, /CMD \["node", .*"learning\/worker\.mjs"\]/); assert.match(df, /USER node/);
  const dc = fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8');
  assert.match(dc, /restart: unless-stopped[\s\S]*restart: unless-stopped/); assert.match(dc, /Dockerfile\.worker/); assert.match(dc, /infinity-state:\/data[\s\S]*infinity-state:\/data/);
  const unit = fs.readFileSync(path.join(REPO, 'deploy', 'infinity-worker.service'), 'utf8');
  assert.match(unit, /Restart=always/); assert.match(unit, /learning\/worker\.mjs/); assert.match(unit, /KillSignal=SIGTERM/);
});
