// Starter dialogue data for the 75M layer-pruned model. Uses its parent's tokenizer unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDialogue, buildDataset } from './dataset.mjs';
import { tokenizerSha } from '../engine/neural/tokenizer.js';
import { makeTinyDialogue, HELD_OUT } from './tiny75k-dataset.mjs';

export function build75mDataset(dir) {
  const tokenizer = JSON.parse(fs.readFileSync('model/current/tokenizer.json', 'utf8'));
  if (tokenizer.sha256 !== tokenizerSha(tokenizer.merges)) throw Error('tokenizer checksum mismatch');
  const dialogue = makeTinyDialogue(buildDialogue({ seed: 41, conversations: 30000 }));
  const cfg = { model: { vocab_size: tokenizer.vocab_size }, mixture: { dialogue: 1, fresh: 0, replay: 0, groundedShare: 0.35 } };
  const { manifest } = buildDataset({ dir, version: 'qa75m-starter-v1', docs: [], cfg, tokenizer, context: 128, cycle: 'qa75m-starter-v1', seed: 177, dialogue });
  fs.writeFileSync(path.join(dir, 'heldout-greetings.json'), JSON.stringify(HELD_OUT.map(([question, intent]) => ({ question, intent })), null, 2));
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('dataset output directory required');
  console.log(JSON.stringify(build75mDataset(process.argv[2])));
}
