// Generate actual raw outputs for held-out greeting phrasings and a few seen examples.
// Usage: node learning/tiny75k-probe.mjs EXPORTED_MODEL DATASET
import fs from 'node:fs';
import path from 'node:path';
import { loadModel, selfTest } from '../engine/neural/model.js';
import { createTokenizer } from '../engine/neural/tokenizer.js';
import { createRuntime } from '../engine/neural/generate.js';

const [modelDir, dataDir] = process.argv.slice(2);
if (!modelDir || !dataDir) throw Error('model and dataset directories required');
const model = loadModel(modelDir);
const parity = selfTest(model);
if (!parity.ok) throw Error('exported model numerical self-test failed');
const tok = createTokenizer(JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer.json'), 'utf8')));
const runtime = createRuntime(model, tok);
const heldout = JSON.parse(fs.readFileSync(path.join(dataDir, 'heldout-greetings.json'), 'utf8'));
const prompts = [...heldout.map((p) => ({ ...p, split: 'heldout' })), ...['Hey!', "What's your name?", 'Please help me.'].map((question) => ({ question, split: 'seen' }))];
const results = [];
for (const p of prompts) {
  const g = await runtime.chat({ user: p.question, temperature: 0, maxNew: 48, seed: 1 });
  results.push({ ...p, text: g.text, finished: g.ended, tokens: g.tokens });
}
console.log(JSON.stringify({ step: model.meta.step, params: model.params, parity, results }, null, 2));
