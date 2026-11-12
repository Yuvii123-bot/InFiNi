// INFINI AI — brain: loads the conversation database and matches a message against it.
// Everything is plain data: phrases written for this project plus phrasings imported from open datasets (see data/NOTICE.md).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTemplate, expand, compile } from './pattern.js';
import { variants, editDistance } from './normalize.js';
import { FILLER, ADDRESS, STOP } from './lexicon.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

let VOCAB = null;
/** General English vocabulary (used to undo letter stretching and to spot gibberish). */
export function vocab() {
  if (!VOCAB) VOCAB = new Set(fs.readFileSync(path.join(DIR, 'vocab.txt'), 'utf8').split('\n'));
  return VOCAB;
}
export const known = (w) => vocab().has(w);

let DLG = null;
/** The conversation database, expanded once per process. */
export function dialogue() {
  if (DLG) return DLG;
  const raw = readJson('dialogue.json');
  const intents = raw.intents.map((it, i) => ({ id: it.id, group: it.g || '', handler: it.h || '', replies: it.r.map(([c, t, e]) => ({ c, t, e })), chips: it.c || [], idx: i }));
  const byId = new Map(intents.map((it) => [it.id, it]));
  const exact = new Map();                 // phrase -> intent index, or an array when several intents share a phrase
  const df = new Map();                    // token -> number of phrases containing it
  const phrases = [], owners = [];
  const addExact = (ph, i) => {
    const cur = exact.get(ph);
    if (cur === undefined) {
      exact.set(ph, i);
      phrases.push(ph); owners.push(i);
      for (const t of new Set(ph.split(' '))) df.set(t, (df.get(t) || 0) + 1);
    } else if (typeof cur === 'number') { if (cur !== i) exact.set(ph, [cur, i]); } else if (!cur.includes(i)) cur.push(i);
  };
  const rules = [];
  raw.intents.forEach((it, i) => {
    for (const t of it.t) for (const ph of expand(parseTemplate(t), 60000)) if (ph) addExact(ph, i);
    for (const t of it.s) { const re = compile(parseTemplate(t)); rules.push({ re, i, src: t }); }
  });
  raw.intents.forEach((it, i) => { const lines = raw.imported[it.id]; if (lines) for (const ph of lines.split('\n')) if (ph) addExact(ph, i); });
  DLG = { meta: raw.meta, intents, byId, exact, rules, df, phrases, owners, fun: raw.fun, index: null };
  return DLG;
}

/** Intents that own a phrase, in database order. */
export function ownersOf(text) {
  const D = dialogue();
  const v = D.exact.get(text);
  if (v === undefined) return [];
  return (typeof v === 'number' ? [v] : v).map((i) => D.intents[i]);
}

/** Exact lookup of a message, also without filler words and without names of address ("thanks a lot bro"). */
export function lookup(tokens) {
  for (const v of variants(tokens)) {
    const o = ownersOf(v.join(' '));
    if (o.length) return { intents: o, phrase: v.join(' '), exact: v.length === tokens.length };
  }
  return null;
}

/** All slot patterns that match, in database order: [{intent, slots}]. */
export function ruleMatches(text) {
  const D = dialogue();
  const out = [];
  const s = ' ' + text;
  for (const r of D.rules) {
    const m = r.re.exec(s);
    if (m) out.push({ intent: D.intents[r.i], slots: m.groups ? { ...m.groups } : {}, src: r.src });
  }
  return out;
}

/** Correct obvious typing slips against the words the database knows ("how aer you" → "how are you"). Returns null when nothing changed. */
export function correctTypos(tokens) {
  const D = dialogue();
  let changed = false;
  const out = tokens.map((t) => {
    if (D.df.has(t) || t.length < 3 || !/^[a-z]+$/.test(t)) return t;
    const max = t.length >= 8 ? 2 : 1;
    let best = null, bestScore = -1, ties = 0;
    for (const [w, n] of D.df) {
      if (Math.abs(w.length - t.length) > max || w.length < 2) continue;
      if (w[0] !== t[0] && w[1] !== t[1] && w[0] !== t[1]) continue;                       // cheap pre-filter
      const d = editDistance(t, w, max);
      if (d > max) continue;
      const score = (max - d) * 1e6 + n;
      if (score > bestScore) { ties = best && Math.floor(score / 1e6) === Math.floor(bestScore / 1e6) && n === (D.df.get(best) || 0) ? ties + 1 : 0; best = w; bestScore = score; }
    }
    if (best && (D.df.get(best) || 0) >= 3) { changed = true; return best; }
    return t;
  });
  return changed ? out : null;
}

function buildIndex(D) {
  const post = new Map();
  D.phrases.forEach((ph, id) => { for (const t of new Set(ph.split(' '))) { let a = post.get(t); if (!a) post.set(t, (a = [])); a.push(id); } });
  const N = D.phrases.length;
  const idf = (t) => Math.log(1 + N / (1 + (D.df.get(t) || 0)));
  D.index = { post, idf };
  return D.index;
}

/**
 * Closest stored phrase by weighted word overlap. Only used for messages of four or more words whose every content word
 * the database knows: an unknown word means the message is about something the brain has no business answering.
 */
export function fuzzy(tokens) {
  const D = dialogue();
  const core = tokens.filter((t) => !FILLER.has(t));
  const q = [...new Set(core)];
  if (q.length < 4 || q.length > 14) return null;
  if (q.some((t) => !D.df.has(t) && !ADDRESS.has(t))) return null;
  const { post, idf } = D.index || buildIndex(D);
  const acc = new Map();
  let qw = 0;
  for (const t of q) {
    const w = idf(t);
    qw += w;
    const list = post.get(t);
    if (!list || list.length > 6000) continue;                                   // very common words do not select candidates
    for (const id of list) acc.set(id, (acc.get(id) || 0) + w);
  }
  let best = null;
  for (const [id, part] of acc) {
    if (part < qw * 0.55) continue;
    const pt = new Set(D.phrases[id].split(' '));
    let inter = 0, pw = 0;
    for (const t of pt) { const w = idf(t); pw += w; if (q.includes(t)) inter += w; }
    const score = inter / (qw + pw - inter);
    if (!best || score > best.score) best = { score, id };
  }
  if (!best || best.score < 0.78) return null;
  // the words that differ must not carry the meaning: pronouns and question words have to agree
  const pt = new Set(D.phrases[best.id].split(' '));
  const KEY = /^(i|me|my|you|your|we|he|she|they|it|what|who|where|when|why|how|which|not|no|never|can|do|is|are|am|will|should|much|many|long|old|far|often|did|was|were|have|has|does|could|would)$/;
  for (const t of q) if (KEY.test(t) && !pt.has(t)) return null;
  for (const t of pt) if (KEY.test(t) && !q.includes(t)) return null;
  const diff = [...q.filter((t) => !pt.has(t)), ...[...pt].filter((t) => !q.includes(t))];
  if (diff.some((t) => !STOP.has(t) && !FILLER.has(t) && !ADDRESS.has(t) && idf(t) > 5.5)) return null;
  return { intent: D.intents[D.owners[best.id]], phrase: D.phrases[best.id], score: best.score };
}

let SENSE = null;
/** The common-sense store (large; loaded on first use). */
export function commonsense() {
  if (!SENSE) SENSE = readJson('commonsense.json');
  return SENSE;
}

/** Numbers for self-description. */
export function stats() {
  const D = dialogue();
  let facts = 0, things = 0;
  try { const m = readJson('meta.json'); facts = m.facts; things = m.things; } catch { /* meta is optional */ }
  return { intents: D.meta.intents, patterns: D.meta.patterns, replies: D.meta.replies, facts, things };
}
