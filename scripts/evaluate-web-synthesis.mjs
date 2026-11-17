// Real-model diagnostic: known and counterfactual evidence. No network, no training.
import fs from 'node:fs';
import path from 'node:path';
import { loadModel, selfTest } from '../engine/neural/model.js';
import { createTokenizer } from '../engine/neural/tokenizer.js';
import { createRuntime } from '../engine/neural/generate.js';
import { citeWebDraft } from '../engine/neural/web-citations.js';
const dir = process.argv[2];
if (!dir) throw Error('Model directory required');
const model = loadModel(dir), parity = selfTest(model);
if (!parity.ok) throw Error('Model parity failed');
const tok = createTokenizer(JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8')));
const rt = createRuntime(model, tok);
const cases = [
  ['What is the capital of Nepal?', 'Kathmandu is the capital and largest city of Nepal.', /kathmandu/i],
  ['Can penguins fly?', 'Penguins cannot fly in the air; their wings have evolved into flippers for swimming.', /(?:cannot|can.t|no|flightless)/i],
  ['What color is the fictional Glim bird?', 'The fictional Glim bird has green feathers and a yellow beak.', /green/i],
  ['What color is the fictional Glim bird?', 'The fictional Glim bird has blue feathers and a yellow beak.', /blue/i],
];
const results = [];
for (const [question, text, expected] of cases) {
  const evidence = [{ text, cites: [1] }];
  const g = await rt.webAnswer({ question, evidence, maxNew: 48 });
  const spans = g.ended && !g.loop ? citeWebDraft(g.text, (g.usedIndices || []).map(i => evidence[i]).filter(Boolean)) : null;
  results.push({ question, evidence: text, output: g.text, ended: g.ended, ms: g.ms, correctKeyword: expected.test(g.text), acceptedByLexicalFilter: !!spans });
}
console.log(JSON.stringify({ step: model.meta.step, parameters: model.params, parity, results, note: 'Keyword and lexical checks are not fact-checks or general capability evaluations.' }, null, 2));
