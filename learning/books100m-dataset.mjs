// Build bounded token shards with the existing 75M tokenizer. Large data stays outside Git.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTokenizer, T, tokenizerSha } from '../engine/neural/tokenizer.js';

const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const args = process.argv.slice(2);
if (args.length !== 4) throw Error('usage: node learning/books100m-dataset.mjs <download-dir> <botbots-dir> <replay-dir> <output-dir>');
const [raw, bot, replay, dir] = args;
fs.mkdirSync(dir, { recursive: true });
const spec = JSON.parse(fs.readFileSync('model/current/tokenizer.json', 'utf8'));
if (tokenizerSha(spec.merges) !== spec.sha256) throw Error('invalid tokenizer');
const tok = createTokenizer(spec), source = JSON.parse(fs.readFileSync(path.join(raw, 'sources.json')));

function writeTokens(fd, ids) {
  const b = Buffer.allocUnsafe(ids.length * 2);
  for (let i = 0; i < ids.length; i++) b.writeUInt16LE(ids[i], 2 * i);
  fs.writeSync(fd, b);
}
function books(split, limit) {
  const filename = `books.${split}.bin`, fd = fs.openSync(path.join(dir, filename), 'w');
  const selected = source.books.filter(b => b.split === (split === 'train' ? 'train' : 'validation'));
  let count = 0; const used = [];
  try {
    for (const book of selected) {
      if (count >= limit) break;
      const bytes = fs.readFileSync(path.join(raw, book.split, `${book.id}.txt`));
      if (sha(bytes) !== book.sha256) throw Error(`book checksum mismatch ${book.id}`);
      const text = bytes.toString('utf8');
      let local = 0;
      // Bound memory by splitting at paragraphs. These are language-model prose windows, not Q&A.
      const chunks = text.match(/[^\n]{1,16000}\n?|\n/g) || [];
      for (const chunk of chunks) {
        if (!chunk || count >= limit) continue;
        let ids = tok.encode(chunk);
        if (local === 0) ids = [T.DOC, ...ids];
        ids = ids.slice(0, limit - count);
        writeTokens(fd, ids); count += ids.length; local += ids.length;
      }
      if (count < limit) { writeTokens(fd, [T.END]); count++; local++; }
      if (local) used.push({ ...book, tokens: local });
    }
  } finally { fs.closeSync(fd); }
  if (count < limit) throw Error(`${split} books insufficient: ${count} < ${limit}`);
  return { file: filename, split, group: 'books', weight: split === 'train' ? 0.55 : 1, tokens: count, used };
}
function dialogues(split) {
  const filename = `conversation.${split}.bin`, index = `conversation.${split}.idx`;
  const fd = fs.openSync(path.join(dir, filename), 'w'), idx = fs.openSync(path.join(dir, index), 'w');
  let count = 0, sequences = 0;
  const names = fs.readdirSync(path.join(bot, 'tod')).filter(x => x.endsWith('.json')).sort();
  try {
    for (const name of names) {
      const records = JSON.parse(fs.readFileSync(path.join(bot, 'tod', name), 'utf8'));
      for (const item of records) {
        const turns = item.utterances || [];
        const isVal = parseInt(sha(`${name}:${item.sample_id}`).slice(0, 8), 16) % 10 === 0;
        if (isVal !== (split === 'val')) continue;
        for (let i = 0; i + 1 < turns.length; i++) {
          if (turns[i][0] !== 'agent2' || turns[i + 1][0] !== 'agent1') continue;
          const clean = s => String(s).replace(/\[([^|\]]+)\|([^\]]+)\]/g, '$2').trim();
          const u = clean(turns[i][1]), a = clean(turns[i + 1][1]);
          if (!u || !a) continue;
          const ids = [T.USER, ...tok.encode(u), T.ASSISTANT, ...tok.encode(a), T.END];
          if (ids.length > 128 || count + ids.length > 0xffffffff) continue;
          const b = Buffer.allocUnsafe(4); b.writeUInt32LE(count); fs.writeSync(idx, b);
          writeTokens(fd, ids); count += ids.length; sequences++;
        }
      }
    }
  } finally { fs.closeSync(fd); fs.closeSync(idx); }
  if (!count) throw Error('no usable conversations');
  return { file: filename, index, split, group: 'conversation', weight: split === 'train' ? 0.35 : 1, tokens: count, sequences };
}
const trainLimit = Number(process.env.BOOKS_TRAIN_TOKENS || 100_000_000);
const valLimit = Number(process.env.BOOKS_VAL_TOKENS || 500_000);
if (!Number.isSafeInteger(trainLimit) || !Number.isSafeInteger(valLimit) || trainLimit < 129 || valLimit < 129) throw Error('invalid token limits');
const bookTrain = books('train', trainLimit), bookVal = books('val', valLimit);
const trainDialogue = dialogues('train'), valDialogue = dialogues('val');
const old = JSON.parse(fs.readFileSync(path.join(replay, 'dataset.json')));
if (old.tokenizer_sha !== spec.sha256) throw Error('replay tokenizer mismatch');
const replayShards = old.shards.filter(s => s.group === 'dialogue').map(s => {
  for (const f of [s.file, s.index].filter(Boolean)) fs.copyFileSync(path.join(replay, f), path.join(dir, 'replay-' + f));
  return { ...s, file: 'replay-' + s.file, index: s.index ? 'replay-' + s.index : undefined,
           group: 'replay', weight: s.split === 'train' ? 0.1 : 1 };
});
const used = [...bookTrain.used, ...bookVal.used];
delete bookTrain.used; delete bookVal.used;
const shards = [bookTrain, bookVal, trainDialogue, valDialogue, ...replayShards];
const manifest = { version: 'books100m-v1', vocab_size: spec.vocab_size, tokenizer_sha: spec.sha256, shards,
  tokens: { train: shards.filter(x => x.split === 'train').reduce((n,x) => n+x.tokens,0), validation: shards.filter(x => x.split === 'val').reduce((n,x) => n+x.tokens,0) },
  sources: { pg19: 'https://github.com/google-deepmind/pg19', botbots: 'https://github.com/radi-cho/botbots', botbots_revision: 'fa2a674b9a5f79980a4af7307f0ee6eb5b9a1461', replay: 'infinity-qa75m-43662976189' },
  note: 'PG-19 books are historical; Botbots conversations are machine-generated. Random windows sample with replacement; token positions processed do not equal unique tokens covered. Source-book split is PG-19 official train/validation.' };
fs.writeFileSync(path.join(dir, 'dataset.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(dir, 'books-sources.json'), JSON.stringify({ books: used }, null, 2));
fs.copyFileSync('model/current/tokenizer.json', path.join(dir, 'tokenizer.json'));
console.log(JSON.stringify({ ...manifest, books_used: used.length, grammar_books: used.filter(b => b.grammar_priority).map(b => b.title) }));
