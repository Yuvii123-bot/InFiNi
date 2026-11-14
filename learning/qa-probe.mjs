// Small, honest generation probe for the pinned 117M model before/after Q&A fine-tuning.
// Usage: node learning/qa-probe.mjs MODEL_DIR DATASET_DIR
import fs from 'node:fs';
import path from 'node:path';
import { loadModel, selfTest } from '../engine/neural/model.js';
import { createTokenizer } from '../engine/neural/tokenizer.js';
import { createRuntime } from '../engine/neural/generate.js';

const [dir, data] = process.argv.slice(2);
if (!dir || !data) throw Error('model and dataset directories required');
const model = loadModel(dir);
const parity = selfTest(model);
if (!parity.ok) throw Error('model parity check failed: ' + JSON.stringify(parity));
const tok = createTokenizer(JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8')));
const runtime = createRuntime(model, tok);
const probes = JSON.parse(fs.readFileSync(path.join(data, 'identity-probes.json'), 'utf8'));
probes.general = ['Hello!', 'What is 2 plus 3?', 'What is 17 plus 28?', 'What color is the sky?', 'What is water?', 'How are you?', 'What is the capital of France?', 'Can you help me?', 'Tell me a joke.', 'What is 8 plus 5?'];
const output = [];
for (const [split, prompts] of Object.entries(probes)) {
  for (const user of (split === 'train' ? prompts.slice(0, 2) : prompts)) {
    const g = await runtime.chat({ user, temperature: 0, maxNew: 24, seed: 1 });
    output.push({ split, user, text: g.text, ended: g.ended, tokens: g.tokens, mentionsInfini: /\binfini\b/i.test(g.text) });
  }
}
console.log(JSON.stringify({ version: model.meta.step, parity, prompts: output }));
