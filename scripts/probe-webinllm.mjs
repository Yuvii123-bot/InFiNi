// Probe the actual q8 runtime with controlled factual evidence, not a quality assertion.
import fs from 'node:fs';
import path from 'node:path';
import { loadModel, selfTest } from '../engine/neural/model.js';
import { createTokenizer } from '../engine/neural/tokenizer.js';
import { createRuntime } from '../engine/neural/generate.js';

const dir = process.argv[2];
if (!dir) throw new Error('Pass the exported model directory');
const model = loadModel(dir), parity = selfTest(model);
if (!parity.ok) throw new Error('Model parity failed');
const tok = createTokenizer(JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8')));
const rt = createRuntime(model, tok);
const questions = [
  { question: 'What is the capital of Nepal?', evidence: [{ text: 'Kathmandu is the capital and largest city of Nepal.' }, { text: 'Nepal is a landlocked country in South Asia.' }] },
  { question: 'Can penguins fly?', evidence: [{ text: 'Penguins cannot fly in the air; their wings have evolved into flippers for swimming.' }, { text: 'Penguins are flightless seabirds that live mostly in the Southern Hemisphere.' }] },
  { question: 'What causes seasons on Earth?', evidence: [{ text: 'Earth has seasons because its axis is tilted as it orbits the Sun.' }, { text: 'When a hemisphere tilts toward the Sun it receives more direct sunlight and experiences summer.' }] },
];
const results = [];
for (const p of questions) {
  const g = await rt.webAnswer({ ...p, maxNew: 48 });
  results.push({ ...p, result: g });
}
const chatResults = [];
for (const question of ['Hi', 'Hi!', 'hello', 'hello!', 'Thanks', 'Thanks!']) {
  const g = await rt.chat({ user: question, temperature: 0, maxNew: 48 });
  chatResults.push({ question, text: g.text, ended: g.ended, tokens: g.tokens });
}
console.log(JSON.stringify({ step: model.meta.step, params: model.params, parity, results, chatResults }, null, 2));
