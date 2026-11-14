// Continuation set: tens of thousands of new, mechanically checked arithmetic pairs,
// plus conversational replay. Keep exact validation questions out of training.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDialogue, buildDataset } from './dataset.mjs';
import { tokenizerSha } from '../engine/neural/tokenizer.js';

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function addMoreQA(dialogue) {
  const names = ['What is your name?', "What's your name?", 'Tell me your name.', 'Who are you?', 'What should I call you?', 'Your name?', 'Can you tell me your name?', 'May I know your name?'];
  const holdout = ['What do people call you?', 'Could you share your name?', 'Which name do you go by?', 'How should I address you?'];
  const identitySet = new Set([...names, ...holdout].map(norm));
  dialogue.train = dialogue.train.filter((c) => c.every(([q]) => !identitySet.has(norm(q))));
  for (let i = 0; i < 80; i++) dialogue.train.push([[names[i % names.length], "I'm Infini.", 'identity']]);
  for (const q of holdout) dialogue.val.push([[q, "I'm Infini.", 'identity']]);
  let newTrain = 0, newVal = 0;
  for (let a = 0; a < 120; a++) for (let b = 0; b < 120; b++) {
    // No questions of these forms were added by the previous synthetic arithmetic generator.
    const rows = [
      [`What is ${a + b} minus ${b}?`, `${a + b} minus ${b} is ${a}.`, 'subtraction'],
      [`What is ${a} times ${b}?`, `${a} times ${b} is ${a * b}.`, 'multiplication'],
    ];
    for (const row of rows) {
      if ((a * 101 + b * 37) % 10 === 0) { dialogue.val.push([row]); newVal++; }
      else { dialogue.train.push([row]); newTrain++; }
    }
  }
  const train = new Set(dialogue.train.flatMap((c) => c.map(([q]) => norm(q))));
  dialogue.val = dialogue.val.filter((c) => c.every(([q]) => !train.has(norm(q))));
  dialogue.probes = dialogue.probes.filter((p) => !train.has(norm(p.user)));
  dialogue.stats = { ...dialogue.stats, trainConversations: dialogue.train.length, valConversations: dialogue.val.length, valPhrasingsInTrain: 0 };
  return { dialogue, names, holdout, newTrain, newVal };
}
export function buildMoreDataset(dir) {
  const tokenizer = JSON.parse(fs.readFileSync('model/current/tokenizer.json', 'utf8'));
  if (tokenizer.sha256 !== tokenizerSha(tokenizer.merges)) throw Error('tokenizer checksum mismatch');
  const { dialogue, names, holdout, newTrain, newVal } = addMoreQA(buildDialogue({ seed: 19, conversations: 30000 }));
  const cfg = { model: { vocab_size: tokenizer.vocab_size }, mixture: { dialogue: 1, fresh: 0, replay: 0, groundedShare: 0.35 } };
  const result = buildDataset({ dir, version: 'simple-qa-more-v2', docs: [], cfg, tokenizer, context: 128, cycle: 'simple-qa-more-v2', seed: 143, dialogue });
  fs.writeFileSync(path.join(dir, 'identity-probes.json'), JSON.stringify({ train: names, validation: holdout }, null, 2));
  return { ...result.manifest, addedArithmeticTrain: newTrain, addedArithmeticHeldOut: newVal };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('dataset output directory is required');
  console.log(JSON.stringify(buildMoreDataset(process.argv[2])));
}
