#!/usr/bin/env node
// A stand-in for learning/cli.mjs, used by test/worker.test.js to drive the always-on worker without Python or the
// network. It does what the real steps do to the state directory (documents arrive, a cycle produces a model that is
// promoted or refused) and misbehaves on request (<state>/fake.json): it can crash, be killed mid-cycle, or hang.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, readJSON, writeJSON, appendLine, readLines, nowISO } from '../../learning/store.mjs';
import { registerModel, promote, reject, loadRegistry, modelDir } from '../../learning/registry.mjs';

const root = process.env.INFINI_LLM_DIR;
const P = paths(root);
const planFile = path.join(root, 'fake.json');
const plan = readJSON(planFile, {}) || {};
const savePlan = () => writeJSON(planFile, plan);
const kind = process.argv[2], args = process.argv.slice(3);
const record = (o) => appendLine(path.join(root, 'fake.log'), { t: nowISO(), kind, args, pid: process.pid, ...o });
const pad = (n) => String(n).padStart(4, '0');

if (kind === 'discover') {
  if (plan.crashDiscover > 0) { plan.crashDiscover--; savePlan(); record({ crashed: true }); console.error('fake: discovery crashed'); process.exit(7); }
  const round = readLines(path.join(root, 'discovery.jsonl')).length + 1;
  const n = plan.docsPerRound ?? 3;
  for (let i = 0; i < n; i++) appendLine(P.docs, { id: `doc-${round}-${i}`, url: `https://example.org/${round}/${i}`, cycle: `r${pad(round)}`, collectedAt: nowISO(), split: 'train', source: 'fake', domain: 'example.org', licence: { id: 'CC0-1.0' }, verification: { status: 'single-source', score: 0.8, disputed: [] }, quality: { text: 0.9, stats: { chars: 1200 } } });
  const trained = new Set(((readJSON(P.pending, null) || {}).trained) || []);
  const waiting = readLines(P.docs).filter((d) => !trained.has(d.id)).length;
  appendLine(path.join(root, 'discovery.jsonl'), { round, t: nowISO(), collected: n, accepted: n, rejected: 0, waiting });
  record({ round, waiting });
  process.exit(0);
}

if (kind === 'cycle') {
  let cyc = readJSON(path.join(root, 'cycle.json'), null);
  const resumed = !!(cyc && !cyc.finished);
  if (!resumed) cyc = { id: 'c' + pad(readLines(P.cycles).length + 1), started: nowISO(), phases: { acquire: { done: true } }, finished: false, attempts: 0 };
  cyc.attempts++;
  writeJSON(path.join(root, 'cycle.json'), cyc);
  writeJSON(P.lock, { pid: process.pid, started: nowISO() });
  record({ cycle: cyc.id, resumed, attempt: cyc.attempts });
  if (plan.killCycle > 0) { plan.killCycle--; savePlan(); process.kill(process.pid, 'SIGKILL'); await new Promise(() => {}); }
  if (plan.hang) {
    process.on('SIGTERM', () => { fs.rmSync(P.lock, { force: true }); record({ cycle: cyc.id, interrupted: true }); process.exit(0); });
    await new Promise((r) => setInterval(r, 1 << 30));
  }
  const outcome = (plan.outcomes || []).shift() || 'promoted';
  savePlan();
  const reg = loadRegistry(root);
  const id = 'm' + pad(Object.keys(reg.models).length + 1);
  const from = modelDir(root, reg.production), to = modelDir(root, id);
  fs.mkdirSync(to, { recursive: true });
  for (const f of ['model.json', 'weights.bin', 'tokenizer.json']) fs.copyFileSync(path.join(from, f), path.join(to, f));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(to, 'weights.bin'))).digest('hex');
  registerModel(root, { id, status: 'candidate', parent: reg.production, cycle: cyc.id, sha256: sha, created: nowISO() });
  let message = '';
  if (outcome === 'rejected') { reject(root, id, { reason: 'fake gate: worse than production' }); message = `${id} was not promoted`; }
  else {
    promote(root, id, { reason: 'fake gate: passed', by: 'gate' });
    message = `${id} replaced ${reg.production}`;
    if (outcome === 'promoted-damaged') { const f = path.join(to, 'weights.bin'); const b = fs.readFileSync(f); for (let i = 0; i < 64; i++) b[b.length - 1 - i] ^= 0xff; fs.writeFileSync(f, b); }
  }
  const docs = readLines(P.docs).map((d) => d.id);
  writeJSON(P.pending, { trained: docs, updated: nowISO() });
  const final = outcome === 'promoted-damaged' ? 'promoted' : outcome;
  appendLine(P.cycles, { id: cyc.id, started: cyc.started, finished: nowISO(), outcome: final, model: id, parent: reg.production, attempts: cyc.attempts, message });
  writeJSON(path.join(root, 'cycle.json'), { ...cyc, finished: true, outcome: final });
  fs.rmSync(P.lock, { force: true });
  record({ cycle: cyc.id, outcome: final, model: id });
  process.exit(0);
}
console.error(`fake cli: unknown step ${kind}`);
process.exit(2);
