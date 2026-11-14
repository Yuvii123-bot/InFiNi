// INFINITY LLM — learning: turning text into training sequences and token shards.
//
// Three kinds of sequence, all ending in <|end|>:
//   conversation   <|user|> hello <|assistant|> Hello! What's on your mind? <|end|>          (several turns may follow each other)
//   grounded       <|user|> question <|search|> <|evidence|> s1 <|evidence|> s2 … <|assistant|> the sentence that answers <|end|>
//   prose          <|doc|> Title \n running text <|end|>
// After <|user|> text the model itself has to choose between <|assistant|> (just reply) and <|search|> (look it up).
//
// The conversation data is the project's own: phrasings and replies of the built-in rule-based brain (engine/brain/data,
// licences in its NOTICE.md), produced by running that brain as a teacher. Web text comes from the verified corpus.
// Validation data is split off by content hash before anything else happens and never enters a training shard.

import fs from 'node:fs';
import path from 'node:path';
import { createBrain } from '../engine/brain/index.js';
import { parseTemplate, expand, hasSlot } from '../engine/brain/pattern.js';
import { blocksToText } from '../engine/index.js';
import { STOPWORDS } from '../engine/util/text.js';
import { trainBPE, createTokenizer, tokenizerSpec, T, normalizeText } from '../engine/neural/tokenizer.js';
import { rng } from '../engine/neural/model.js';
import { goodSentences, sha256 } from './process.mjs';
import { REPO, writeJSON, nowISO } from './store.mjs';
import { benchmarkSentences, isBenchmarkSentence, normSentence, loadBenchmark } from './benchmark.mjs';

const pick = (r, list) => list[Math.floor(r() * list.length)];
const shuffle = (r, list) => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
const isVal = (s) => parseInt(sha256(s).slice(0, 8), 16) % 10 === 0;
const NAMES = ['Sam', 'Maya', 'Alex', 'Priya', 'Tom', 'Sara', 'Ravi', 'Emma', 'Liam', 'Anna', 'Omar', 'Lena', 'Ben', 'Nina', 'Raj', 'Zoe', 'Luca', 'Mia', 'Dev', 'Ella', 'Noah', 'Asha', 'Finn', 'Tara', 'Hugo', 'Ines', 'Kofi', 'Sita', 'Ian', 'Ruth', 'Yuvi', 'Aarav', 'Bina', 'Carl', 'Dina', 'Evan', 'Gita', 'Hana', 'Ivan', 'Jade'];

/** How a real person might type a stored phrasing: capital letter, question mark, and so on. */
function surface(r, s) {
  let t = s;
  const x = r();
  if (x < 0.45) t = t.charAt(0).toUpperCase() + t.slice(1);
  const q = /^(what|who|where|when|why|how|can|could|do|does|did|is|are|am|will|would|should|may|have|has)\b/i.test(t);
  const y = r();
  if (!/[.!?]$/.test(t)) { if (q && y < 0.6) t += '?'; else if (!q && y < 0.15) t += '.'; else if (!q && y < 0.25) t += '!'; }
  return t;
}

/**
 * Conversations with the rule-based brain as the teacher.
 * @returns {{train: Array, val: Array, probes: Array, stats: object}} each conversation = [[user, reply], …]
 */
export function buildDialogue({ seed = 7, conversations = 30000, maxReply = 320, now = Date.UTC(2026, 0, 15, 12) } = {}) {
  const r = rng(seed);
  const data = JSON.parse(fs.readFileSync(path.join(REPO, 'engine', 'brain', 'data', 'dialogue.json'), 'utf8'));
  const sense = JSON.parse(fs.readFileSync(path.join(REPO, 'engine', 'brain', 'data', 'commonsense.json'), 'utf8'));
  // The teacher describes the system as it is once this model serves: it has a language model. No version or size is
  // given, so no reply with a number that would go stale can enter the training text.
  const brain = createBrain({ version: '', creator: '', maxPages: 0, llm: {} });
  const intents = [];
  for (const it of data.intents) {
    const set = new Set();
    for (const t of it.t || []) { try { const tree = parseTemplate(t); if (hasSlot(tree)) continue; for (const p of expand(tree, 400)) if (p) set.add(p); } catch { /* too many expansions: skip this template */ } }
    for (const p of String((data.imported && data.imported[it.id]) || '').split('\n')) if (p.trim()) set.add(p.trim());
    const all = [...set];
    if (all.length) intents.push({ id: it.id, train: all.filter((p) => !isVal(p)), val: all.filter(isVal) });
  }
  // everyday common-sense questions the brain answers from its fact base
  const things = Object.entries((sense.core && sense.core.things) || {});
  const senseQ = [];
  for (const [name, f] of things) {
    const a = /^[aeiou]/.test(name) ? 'an' : 'a';
    for (const c of (f.can || []).slice(0, 3)) senseQ.push(`can ${a} ${name} ${c}`);
    for (const c of (f.cannot || []).slice(0, 2)) senseQ.push(`can ${a} ${name} ${c}`);
    for (const c of (f.needs || []).slice(0, 1)) senseQ.push(`does ${a} ${name} need ${c}`);
    senseQ.push(`what is ${a} ${name}`);
  }
  intents.push({ id: 'sense', train: senseQ.filter((p) => !isVal(p)), val: senseQ.filter(isVal), weight: 30 });
  const weights = intents.map((i) => i.weight || 1), totalW = weights.reduce((a, b) => a + b, 0);
  const pickIntent = () => { let x = r() * totalW; for (let i = 0; i < intents.length; i++) { x -= weights[i]; if (x <= 0) return intents[i]; } return intents[intents.length - 1]; };
  const accept = new Map();            // intent → replies the teacher has given (for the reply-match probe)
  const origins = {};
  const run = (split, n) => {
    const out = [];
    for (let c = 0; c < n; c++) {
      const turns = 1 + (r() < 0.45 ? 1 : 0) + (r() < 0.15 ? 1 : 0);
      let state = null; const conv = [];
      for (let k = 0; k < turns; k++) {
        let user, key;
        if (r() < 0.05) { const nm = pick(r, split === 'val' ? NAMES.slice(30) : NAMES.slice(0, 30)); user = pick(r, ['my name is ', 'I am ', "I'm ", 'call me ', 'My name is ']) + nm; key = 'name.set'; }
        else { const it = pickIntent(); const pool = it[split]; if (!pool.length) continue; user = surface(r, pick(r, pool)); key = it.id; }
        let b;
        try { b = brain.respond({ question: user, state, now, tz: 'UTC', country: '', health: { resting: 0 }, ctxTurn: conv.length, regenerate: false, route: '', strict: false }); } catch { break; }
        if (!b || !b.handled) break;
        state = b.state || state;
        const reply = normalizeText(blocksToText(b.blocks)).trim();
        if (!reply || reply.length > maxReply || !['conversation', 'commonsense', 'memory'].includes(b.origin)) break;
        if (/\b(today|o'clock|\d{1,2}:\d{2}|january|february|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d\d)\b/i.test(reply)) break;   // depends on the clock: not something to memorise
        origins[b.origin] = (origins[b.origin] || 0) + 1;
        conv.push([user, reply, b.intent || key]);
        const a = accept.get(b.intent || key) || new Set(); if (a.size < 40) a.add(reply); accept.set(b.intent || key, a);
      }
      if (conv.length) out.push(conv);
    }
    return out;
  };
  const train = run('train', conversations);
  const val = run('val', Math.max(300, Math.round(conversations / 12)));
  const probes = [];
  const seen = new Set();
  for (const conv of val) { const [user, , intent] = conv[0]; if (seen.has(user) || !accept.has(intent)) continue; seen.add(user); probes.push({ user, intent, accept: [...accept.get(intent)] }); if (probes.length >= 400) break; }
  const trainUsers = new Set(train.flatMap((c) => c.map((t) => t[0].toLowerCase().replace(/[.!?]+$/, ''))));
  const leak = val.flatMap((c) => c.map((t) => t[0].toLowerCase().replace(/[.!?]+$/, ''))).filter((u) => trainUsers.has(u) && !/^(my name is|i am|i'm|call me)/.test(u)).length;
  return { train, val, probes, stats: { intents: intents.length, trainConversations: train.length, valConversations: val.length, origins, valPhrasingsInTrain: leak } };
}

const conversationSeq = (conv) => conv.flatMap(([u, a]) => [T.USER, u, T.ASSISTANT, a, T.END]);

// ---------- sequences from verified documents ----------
const LABELLED = /^(.{3,70}?) of (?:the )?(.{2,60}?): (.+)$/;
function keywords(sentence, r, n) {
  const words = [...new Set((sentence.match(/\p{L}{4,}/gu) || []).filter((w) => !STOPWORDS.has(w.toLowerCase())))];
  words.sort((a, b) => b.length - a.length);
  return shuffle(r, words.slice(0, 6)).slice(0, n);
}
/** A question a person could ask to which `sentence` (from a document titled `title`) is the answer. */
export function questionFor(r, { title, sentence, lead }) {
  const m = LABELLED.exec(sentence);
  if (m && m[2].toLowerCase().includes(title.toLowerCase().replace(/^the /, ''))) {
    const label = m[1].toLowerCase().replace(/,\s*/g, ' ');
    return pick(r, [`What is the ${label} of ${title}?`, `${title} ${label}`, `${label} of ${title}?`, `Tell me the ${label} of ${title}.`, `what is ${title}'s ${label}?`, `${label} in ${title}`]);
  }
  if (lead) return pick(r, [`What is ${title}?`, `Tell me about ${title}.`, `${title}`, `What do you know about ${title}?`, `Explain ${title}.`, `tell me about ${title.toLowerCase()}`, `Give me a summary of ${title}.`]);
  const k = keywords(sentence, r, 2 + (r() < 0.5 ? 1 : 0));
  if (k.length < 2) return '';
  return pick(r, [`${title}: ${k.join(' ')}?`, `What about ${k.join(' and ')}?`, `${k.join(' ')}`, `Tell me about ${k.join(' and ')} in ${title}.`, `${k.join(' ')} ${title}`]).replace(/\s+/g, ' ');
}
let BENCH = null;                                  // sentences of the fixed benchmark: never part of any training or validation text
const benchSet = () => (BENCH || (BENCH = benchmarkSentences()));
let BENCH_ID = null;
const loadBenchmarkId = () => (BENCH_ID || (BENCH_ID = loadBenchmark().id));
let benchRemoved = 0;                              // benchmark sentences met in documents and left out (reset per dataset)
// a sentence that merely contains a benchmark sentence (the fact inside a longer sentence, e.g.
// "The capital of Nepal is Kathmandu, a major city in the Himalayas") leaks just as much as one
// that equals it: drop it too, or the contamination check finds it in the written shards and the
// whole cycle is aborted without any training
const containsBenchmark = (bench, s) => { const n = normSentence(s); if (n.length < 24) return false; for (const b of bench) if (b.length >= 24 && n.includes(b)) return true; return false; };
function docSentences(doc) {
  const disputed = new Set(((doc.verification && doc.verification.disputed) || []).map((d) => d.text));
  const bench = benchSet();
  const out = [];
  doc.paras.forEach((p, pi) => { for (const s of goodSentences(p.text)) { if (isBenchmarkSentence(bench, s) || containsBenchmark(bench, s)) benchRemoved++; else if (!disputed.has(s)) out.push({ s, h: p.h, pi, lead: out.length === 0 }); } });
  return out;
}
const labelOf = (s) => { const m = LABELLED.exec(s); return m ? m[1] : ''; };

/** Grounded examples for a set of documents: {question, evidence[], answer (index into evidence), doc}. */
export function groundedExamples(docs, r, { perDoc = 40, pool = null } = {}) {
  const sents = docs.map(docSentences);
  const others = (pool || docs).map(docSentences);
  const byLabel = new Map();
  others.forEach((list, di) => { for (const x of list) { const l = labelOf(x.s); if (!l) continue; let a = byLabel.get(l); if (!a) byLabel.set(l, (a = [])); a.push({ ...x, di }); } });
  const out = [];
  docs.forEach((doc, di) => {
    const list = sents[di].filter((x) => x.s.length <= 260);
    if (list.length < 3) return;
    const n = Math.min(Math.round(perDoc * (doc.weight || 1)), list.length * 2);
    for (let k = 0; k < n; k++) {
      const target = k === 0 ? list[0] : pick(r, list);
      const question = questionFor(r, { title: doc.title, sentence: target.s, lead: target.lead });
      if (!question) continue;
      const ev = [target.s];
      const want = 2 + Math.floor(r() * 3);
      const label = labelOf(target.s);
      const same = label && byLabel.get(label);                       // the same fact about a different subject: a hard distractor
      if (same && same.length > 1) { const o = pick(r, same); if (o.s !== target.s && !ev.includes(o.s) && (pool || docs)[o.di] !== doc) ev.push(o.s); }
      let guard = 0;
      while (ev.length < want && guard++ < 12) {
        const from = r() < 0.5 ? list : pick(r, others).filter((x) => x.s.length <= 260);
        if (!from.length) continue;
        const o = pick(r, from);
        if (!ev.includes(o.s)) ev.push(o.s);
      }
      if (ev.length < 2) continue;
      shuffle(r, ev);
      out.push({ question, evidence: ev, answer: ev.indexOf(target.s), doc: doc.id });
    }
  });
  return out;
}
export const groundedSeq = (ex) => [T.USER, ex.question, T.SEARCH, ...ex.evidence.flatMap((e) => [T.EVIDENCE, e]), T.ASSISTANT, ex.evidence[ex.answer], T.END];
/** Running text of a document in pieces of roughly `chars` characters. */
export function proseChunks(doc, chars = 620) {
  const out = [];
  let cur = '', head = '';
  const flush = () => { if (cur.trim().length > 80) out.push([T.DOC, `${doc.title}${head ? ' — ' + head : ''}\n${cur.trim()}`, T.END]); cur = ''; };
  for (const { s, h } of docSentences(doc)) { if (h !== head && cur) flush(); head = h; if (cur.length + s.length > chars) flush(); cur += (cur ? ' ' : '') + s; }
  flush();
  return out;
}

function encodeSeqs(tok, seqs, context) {
  const ids = [], starts = [];
  let dropped = 0;
  for (const seq of seqs) {
    const one = [];
    for (const part of seq) { if (typeof part === 'number') one.push(part); else for (const id of tok.encode(part)) one.push(id); }
    if (one.length > context - 2) { dropped++; continue; }               // must fit in one window with its answer
    starts.push(ids.length);
    for (const id of one) ids.push(id);
  }
  return { ids: Uint16Array.from(ids), starts: Uint32Array.from(starts), dropped };
}

/**
 * Build one immutable dataset version.
 * @param docs      every accepted document (records from the corpus)
 * @param freshIds  ids of the documents that are new in this cycle (the rest is replay)
 */
export function buildDataset({ dir, version, docs, freshIds = null, cfg, tokenizer = null, context = 256, cycle = '', parent = '', seed = 11, dialogue = null, log = () => {} }) {
  benchRemoved = 0;
  fs.mkdirSync(dir, { recursive: true });
  const r = rng(seed);
  const dlg = dialogue || buildDialogue({ seed: 7 });
  const fresh = new Set(freshIds || docs.map((d) => d.id));
  const trainDocs = docs.filter((d) => d.split === 'train'), valDocs = docs.filter((d) => d.split === 'val');
  let spec = tokenizer;
  if (!spec) {
    log('training the tokenizer (byte-pair encoding) on the training text');
    const texts = [...dlg.train.flatMap((c) => c.flatMap(([u, a]) => [u, a])), ...trainDocs.flatMap((d) => [d.title, ...d.paras.map((p) => p.text)])];
    const t0 = Date.now();
    const { merges, stats } = trainBPE(texts, cfg.model.vocab_size);
    spec = tokenizerSpec(merges, { created: nowISO(), trained_on: { ...stats, ms: Date.now() - t0 } });
  }
  const tok = createTokenizer(spec);
  const gs = cfg.mixture.groundedShare;
  const webSeqs = (list, pool) => {
    const prose = [];
    for (const d of list) { const ch = proseChunks(d); for (const c of ch) { prose.push(c); if (r() < ((d.weight || 1) - 0.5) * 2 * 0.5) prose.push(c); } }
    const proseChars = prose.reduce((a, s) => a + s[1].length, 0);
    const perDoc = list.length ? Math.max(8, Math.round((proseChars * gs / (1 - gs)) / 520 / list.length)) : 0;      // ≈520 characters per grounded example
    const grounded = groundedExamples(list, r, { perDoc, pool }).map(groundedSeq);
    return { seqs: shuffle(r, [...prose, ...grounded]), prose: prose.length, grounded: grounded.length };
  };
  const groups = [
    { group: 'dialogue', split: 'train', seqs: shuffle(r, dlg.train.map(conversationSeq)) },
    { group: 'dialogue', split: 'val', seqs: dlg.val.map(conversationSeq) },
  ];
  const freshDocs = trainDocs.filter((d) => fresh.has(d.id)), replayDocs = trainDocs.filter((d) => !fresh.has(d.id));
  const counts = { dialogue: { conversations: dlg.train.length } };
  if (freshDocs.length) { const w = webSeqs(freshDocs, trainDocs); groups.push({ group: 'fresh', split: 'train', seqs: w.seqs }); counts.fresh = { documents: freshDocs.length, prose: w.prose, grounded: w.grounded }; }
  if (replayDocs.length) { const w = webSeqs(replayDocs, trainDocs); groups.push({ group: 'replay', split: 'train', seqs: w.seqs }); counts.replay = { documents: replayDocs.length, prose: w.prose, grounded: w.grounded }; }
  if (valDocs.length) { const w = webSeqs(valDocs, valDocs); groups.push({ group: 'web', split: 'val', seqs: w.seqs }); counts.webVal = { documents: valDocs.length, prose: w.prose, grounded: w.grounded }; }
  // mixture: shares of the groups that exist, renormalised
  const mix = { dialogue: cfg.mixture.dialogue, fresh: cfg.mixture.fresh, replay: cfg.mixture.replay };
  const present = groups.filter((g) => g.split === 'train').map((g) => g.group);
  const total = present.reduce((a, g) => a + mix[g], 0);
  const shards = [];
  const documentText = [];                          // what was actually written, decoded again: the contamination check reads this
  let dropped = 0;
  for (const g of groups) {
    const enc = encodeSeqs(tok, g.seqs, context);
    dropped += enc.dropped;
    if (enc.ids.length < context + 2) continue;
    if (g.group !== 'dialogue') documentText.push(normSentence(tok.decode(Array.from(enc.ids))));
    const file = `${g.group}.${g.split}.bin`, index = `${g.group}.${g.split}.idx`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(enc.ids.buffer, enc.ids.byteOffset, enc.ids.byteLength));
    fs.writeFileSync(path.join(dir, index), Buffer.from(enc.starts.buffer, enc.starts.byteOffset, enc.starts.byteLength));
    shards.push({ file, index, split: g.split, group: g.group, weight: g.split === 'train' ? +(mix[g.group] / total).toFixed(4) : 1, tokens: enc.ids.length, sequences: enc.starts.length });
  }
  // behaviour probes, all from held-out material
  const pr = rng(seed + 1);
  const grounded = valDocs.length ? groundedExamples(valDocs, pr, { perDoc: Math.max(6, Math.ceil(240 / valDocs.length)), pool: valDocs }).slice(0, 240) : [];
  const chat = dlg.probes.slice(0, 240);
  const route = shuffle(pr, [...chat.slice(0, 150).map((p) => ({ text: p.user, label: 'chat' })), ...grounded.slice(0, 150).map((g) => ({ text: g.question, label: 'search' }))]);
  writeJSON(path.join(dir, 'probes.json'), { chat, grounded, route });
  // memorization probe: passages exactly as they are trained on (newest documents first) and passages from held-out documents
  const probeSeqs = (list, n) => {
    const out = [];
    const per = Math.max(1, Math.ceil(n / Math.max(1, list.length)));
    for (const d of list) { const ch = proseChunks(d); for (let i = 0; i < ch.length && i < per; i++) { const ids = [ch[i][0], ...tok.encode(ch[i][1])].slice(0, context - 2); if (ids.length >= 56) out.push(ids.slice(0, 64)); } if (out.length >= n) break; }
    return out.slice(0, n);
  };
  const memprobe = { trained: probeSeqs(shuffle(rng(seed + 2), [...(freshDocs.length ? freshDocs : trainDocs)]), 64), unseen: probeSeqs(shuffle(rng(seed + 3), [...valDocs]), 64) };
  writeJSON(path.join(dir, 'memprobe.json'), memprobe);
  // contamination check, by actual intersection
  const valIds = new Set(valDocs.map((d) => d.id));
  const bench = benchSet();
  const benchHits = [...dlg.train.flatMap((c) => c.flatMap(([u, a]) => [u, a]))].filter((t) => isBenchmarkSentence(bench, t)).length;
  // measured on the written shards, not assumed: every benchmark sentence is searched in the decoded document text
  const written = ' ' + documentText.join(' ') + ' ';
  const benchFound = [...bench].filter((b) => b.length >= 24 && written.includes(' ' + b + ' ')).length;
  const integrity = { benchmark: (loadBenchmarkId()), benchmarkSentencesInTraining: benchFound, benchmarkSentencesRemoved: benchRemoved, benchmarkPhrasesInDialogue: benchHits, valDocumentsInTraining: trainDocs.filter((d) => valIds.has(d.id)).length, valHashesInTraining: trainDocs.filter((d) => valDocs.some((v) => v.contentHash === d.contentHash)).length, valPhrasingsInTraining: dlg.stats.valPhrasingsInTrain };
  writeJSON(path.join(dir, 'documents.json'), docs.map((d) => ({ id: d.id, url: d.url, title: d.title, licence: d.licence.id, split: d.split, group: d.split === 'val' ? 'web-val' : fresh.has(d.id) ? 'fresh' : 'replay', weight: d.weight, verification: d.verification.status, score: d.verification.score, cycle: d.cycle })));
  const manifest = {
    version, created: nowISO(), cycle, parent, vocab_size: tok.vocabSize, tokenizer_sha: spec.sha256, context,
    shards, mixture: Object.fromEntries(present.map((g) => [g, +(mix[g] / total).toFixed(4)])), counts,
    documents: { total: docs.length, train: trainDocs.length, validation: valDocs.length, fresh: freshDocs.length, replay: replayDocs.length },
    tokens: { train: shards.filter((s) => s.split === 'train').reduce((a, s) => a + s.tokens, 0), validation: shards.filter((s) => s.split === 'val').reduce((a, s) => a + s.tokens, 0) },
    probes: { chat: chat.length, grounded: grounded.length, route: route.length, memorization: { trained: memprobe.trained.length, unseen: memprobe.unseen.length } }, droppedTooLong: dropped, integrity, dialogue: dlg.stats,
  };
  writeJSON(path.join(dir, 'dataset.json'), manifest);
  return { manifest, tokenizer: spec };
}
