// Builds test/fixtures/llm: a very small Infinity LLM (two layers, vocabulary 512) produced by the real pipeline
// (collect → dataset → train in PyTorch → export), so the offline tests exercise real weights and a real reference from
// PyTorch without needing Python. Needs network (a few public-domain documents from GitHub) and PyTorch; about a minute.
//
//   GITHUB_TOKEN=… node tools/llm/make-fixture.mjs
//
// The model is trained for seconds and is not expected to pass the promotion gate; it is marked production by this
// script, and the registry says so.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCycle } from '../../learning/cycle.mjs';
import { loadRegistry, promote } from '../../learning/registry.mjs';
import { writeJSON, paths, DEFAULTS } from '../../learning/store.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infini-fixture-'));
writeJSON(paths(root).config, {
  model: { preset: 'nano', vocab_size: 512 },
  dialogue: { conversations: 1200 },
  cycle: { bootstrapSeconds: 30, maxNewDocs: 8 },
  train: { batch_size: 16, eval_interval: 50, save_interval: 50 },
  sources: DEFAULTS.sources.filter((s) => s.id === 'factbook').map((s) => ({ ...s, perCycle: 8 })),
});
const out = await runCycle({ root, log: (m) => console.log(m) });
console.log('cycle outcome:', out.outcome || out);
let reg = loadRegistry(root);
if (!reg.models.m0001) throw new Error('no model was produced');
if (reg.production !== 'm0001') reg = promote(root, 'm0001', { reason: 'test fixture: promoted by tools/llm/make-fixture.mjs, not by the gate', by: 'fixture' });
const dest = path.join(REPO, 'test', 'fixtures', 'llm');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.join(dest, 'models', 'm0001'), { recursive: true });
for (const f of ['model.json', 'weights.bin', 'tokenizer.json']) fs.copyFileSync(path.join(root, 'models', 'm0001', f), path.join(dest, 'models', 'm0001', f));
fs.copyFileSync(path.join(root, 'registry.json'), path.join(dest, 'registry.json'));
fs.copyFileSync(path.join(root, 'tokenizer.json'), path.join(dest, 'tokenizer.json'));
fs.rmSync(root, { recursive: true, force: true });
console.log('written', dest, fs.readdirSync(path.join(dest, 'models', 'm0001')).map((f) => `${f} ${fs.statSync(path.join(dest, 'models', 'm0001', f)).size}`).join(', '));
