// Prepare supplementary, document-split general-knowledge shards with the 75M tokenizer.
// The caller must verify the source repositories are clean and at the revisions below
// (the preparation workflow does so). This does not alter or start the active training run.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFactbook, parseCnxml } from './sources.mjs';
import { createTokenizer, tokenizerSha, T } from '../engine/neural/tokenizer.js';

const [factDir, physicsDir, out] = process.argv.slice(2);
if (!out || !factDir || !physicsDir) throw Error('usage: node learning/knowledge75m-dataset.mjs FACTBOOK PHYSICS OUTPUT');
const revisions = { factbook: '144d6977b2b01ac1cbd220de754c0a005616760b', physics: '56e71824e73e371c0d20eb68a77611aa438b5f89' };
const repo = { factbook: 'factbook/factbook.json', physics: 'openstax/osbooks-physics' };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const spec = JSON.parse(fs.readFileSync('model/current/tokenizer.json'));
if (tokenizerSha(spec.merges) !== spec.sha256) throw Error('invalid tokenizer');
const tok = createTokenizer(spec);
fs.mkdirSync(out, { recursive: true });
const collection = fs.readFileSync(path.join(physicsDir, 'collections/physics.collection.xml'), 'utf8');
if (!/creativecommons\.org\/licenses\/by\/4\.0\//i.test(collection)) throw Error('unexpected physics collection license');
const physicsIds = [...new Set([...collection.matchAll(/<col:module\b[^>]*\bdocument="(m\d+)"/g)].map(m => m[1]))].sort();
const inputs = [];
for (const folder of fs.readdirSync(factDir).sort()) {
  const dir = path.join(factDir, folder);
  if (!/^[a-z-]+$/.test(folder) || !fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).sort()) if (/^[a-z]{2}\.json$/.test(file)) inputs.push({ group: 'factbook', relative: `${folder}/${file}`, full: path.join(dir, file) });
}
for (const id of physicsIds) inputs.push({ group: 'physics', relative: `modules/${id}/index.cnxml`, full: path.join(physicsDir, 'modules', id, 'index.cnxml') });
const fds = {}, counts = {}, sources = [];
try {
  for (const group of ['factbook', 'physics']) for (const split of ['train', 'val']) {
    const key = `${group}.${split}`; fds[key] = fs.openSync(path.join(out, `${key}.bin`), 'w'); counts[key] = { tokens: 0, documents: 0 };
  }
  for (const input of inputs) {
    const bytes = fs.readFileSync(input.full);
    const doc = input.group === 'factbook' ? parseFactbook(bytes.toString('utf8')) : parseCnxml(bytes.toString('utf8'));
    if (!doc) continue;
    if (doc.licenceUrl && !/creativecommons\.org\/licenses\/by\/4\.0\//i.test(doc.licenceUrl)) throw Error(`unexpected module licence ${input.relative}`);
    const paragraphs = doc.blocks.filter(b => b.type === 'p' && b.text && b.text.length >= 40).map(b => b.text);
    if (!paragraphs.length) continue;
    const id = `${input.group}:${input.relative}`;
    const split = parseInt(sha(id).slice(0, 8), 16) % 10 === 0 ? 'val' : 'train';
    const key = `${input.group}.${split}`;
    let tokens = 0;
    const write = ids => { const b = Buffer.allocUnsafe(ids.length * 2); ids.forEach((n, i) => b.writeUInt16LE(n, 2*i)); fs.writeSync(fds[key], b); tokens += ids.length; };
    write([T.DOC]);
    for (const text of [doc.title, ...paragraphs]) if (text) for (let i = 0; i < text.length; i += 16000) write(tok.encode(text.slice(i, i + 16000) + '\n'));
    write([T.END]);
    counts[key].tokens += tokens; counts[key].documents++;
    sources.push({ group: input.group, split, title: doc.title, path: input.relative, sha256: sha(bytes), revision: revisions[input.group], url: `https://github.com/${repo[input.group]}/blob/${revisions[input.group]}/${input.relative}`, tokens });
  }
} finally { for (const fd of Object.values(fds)) fs.closeSync(fd); }
const shards = Object.entries(counts).map(([key, count]) => { const [group, split] = key.split('.'); if (!count.tokens) throw Error(`empty shard ${key}`); return { file: `${key}.bin`, group, split, weight: split === 'train' ? 0.5 : 1, ...count }; });
const manifest = { version: 'knowledge75m-v1', vocab_size: spec.vocab_size, tokenizer_sha: spec.sha256, shards,
  sources: { factbook: { repository: repo.factbook, revision: revisions.factbook, licence: 'CC0-1.0', caveat: 'Historical archive; country statistics and descriptions can be stale or disputed.' }, physics: { repository: repo.physics, revision: revisions.physics, licence: 'CC-BY-4.0', attribution: 'Physics, OpenStax, Rice University; authors Fatih Gozuacik, Denise Pattison and Catherine Tabor; adapted by extracting prose, removing formulas, figures, tables and exercises.', licence_url: 'https://creativecommons.org/licenses/by/4.0/' } },
  note: 'Supplementary geography and introductory physics corpus, not a guarantee of accurate or current knowledge. Document split only; topics can overlap and parent-model contamination is unknown. Not yet integrated into a training run.' };
fs.writeFileSync(path.join(out, 'dataset.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(out, 'sources.json'), JSON.stringify({ files: sources }, null, 2));
fs.copyFileSync('model/current/tokenizer.json', path.join(out, 'tokenizer.json'));
console.log(JSON.stringify({ counts, sources: sources.length }));
