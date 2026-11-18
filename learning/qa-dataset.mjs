// Generate simple Q&A fine-tuning data without retraining or changing the published tokenizer.
// Usage: node learning/qa-dataset.mjs data/llm/datasets/qa-v1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDialogue, buildDataset } from './dataset.mjs';
import { tokenizerSha } from '../engine/neural/tokenizer.js';

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hashSplit = (a, b) => (a * 101 + b * 37) % 10 === 0;

export function addSimpleQA(dialogue) {
  const identityTrain = ['What is your name?', 'what is your name', "What's your name?", 'Tell me your name.', 'Who are you?', 'What should I call you?', 'Your name?', 'Can you tell me your name?', 'May I know your name?', 'Please tell me your name.'];
  const identityVal = ['What do people call you?', 'Could you share your name?', 'Which name do you go by?', 'How should I address you?'];
  // Avoid contradictory labels and keep the identity holdout entirely out of training, including the teacher corpus.
  const identityQuestions = new Set([...identityTrain, ...identityVal].map(norm));
  dialogue.train = dialogue.train.filter((c) => c.every((t) => !identityQuestions.has(norm(t[0]))));
  // Oversample only the small identity lesson; all evaluation prompts are different from these training phrasings.
  for (let i = 0; i < 1200; i++) dialogue.train.push([[identityTrain[i % identityTrain.length], "I'm Infini.", 'identity']]);
  for (const question of identityVal) dialogue.val.push([[question, "I'm Infini.", 'identity']]);
  const valMath = [];
  for (let a = 0; a < 60; a++) for (let b = 0; b < 60; b++) {
    const row = [[`What is ${a} plus ${b}?`, `${a} plus ${b} is ${a + b}.`, 'addition']];
    if (hashSplit(a, b)) { dialogue.val.push(row); valMath.push(row[0][0]); }
    else dialogue.train.push(row);
  }
  const trainNames = new Set(dialogue.train.flatMap((c) => c.map((t) => norm(t[0]))));
  // The teacher-generated data can occasionally collide with our validation questions; remove those cases.
  dialogue.val = dialogue.val.filter((c) => c.every((t) => !trainNames.has(norm(t[0]))));
  dialogue.probes = dialogue.probes.filter((p) => !trainNames.has(norm(p.user)));
  dialogue.stats = { ...dialogue.stats, trainConversations: dialogue.train.length, valConversations: dialogue.val.length, valPhrasingsInTrain: dialogue.val.flatMap((c) => c.map((t) => t[0])).filter((q) => trainNames.has(norm(q))).length };
  return { dialogue, identityTrain, identityVal, valMath };
}

export function buildQADataset(dir) {
  const tokenizer = JSON.parse(fs.readFileSync(path.join('model', 'current', 'tokenizer.json'), 'utf8'));
  if (tokenizer.sha256 !== tokenizerSha(tokenizer.merges)) throw new Error('tokenizer checksum mismatch');
  const { dialogue, identityTrain, identityVal } = addSimpleQA(buildDialogue({ seed: 7, conversations: 30000 }));
  const cfg = { model: { vocab_size: tokenizer.vocab_size }, mixture: { dialogue: 1, fresh: 0, replay: 0, groundedShare: 0.35 } };
  const result = buildDataset({ dir, version: 'simple-qa-v1', docs: [], cfg, tokenizer, context: 128, cycle: 'simple-qa-v1', seed: 143, dialogue });
  const probes = { train: identityTrain, validation: identityVal };
  fs.writeFileSync(path.join(dir, 'identity-probes.json'), JSON.stringify(probes, null, 2));
  return { ...result.manifest, identityTrainPhrasings: identityTrain.length, identityValidationPhrasings: identityVal.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) throw new Error('dataset output directory is required');
  const manifest = buildQADataset(dir);
  console.log(JSON.stringify(manifest));
}
