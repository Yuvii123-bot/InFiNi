// INFINI AI — brain: careful spelling repair for a message that is being passed on to web search.
// The rule is to never make a question worse, so only slips that are almost certainly slips are repaired:
//   · chat shorthand and mistyped little words in the opening of a question   ("wat r black holes", "waht is", "what si a")
//   · a non-word that is one typical slip away from exactly one common word   ("conputer", "presidnet", "goverment")
// Left alone: real words, rare words and names (a guard list built from WordNet and a frequency list), capitalised
// words and acronyms, short words in the topic ("teh tarik", "vitamin b", "canva"), anything with digits, and every case
// where two corrections are equally possible. The app shows what was understood and offers the original spelling.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAT } from './lexicon.js';
import { vocab } from './store.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');

/** Little words a question opens with; shorthand is expanded only into these, and only before the topic starts. */
const FRAME = new Set(('what who whom whose where when why how which is are was were am do does did can could would should will shall ' +
  'the a an to of in on at for from about with by and or me us you i we it they this that these those there many much long old far big tall often ' +
  'please tell define explain describe show give find list name mean means meaning not if be been have has had your my').split(' '));
const WH = /^(what|who|where|when|why|how|which)$/;
const SUBJ = /^(you|we|they|there|these|those)$/;
const AUX = /^(do|did|can|could|would|should|will|are|have|had|were)$/;          // "do u", but not "what does u mean"
const CONTINUES = /^(about|you|your|the|this|that|these|those|and|they)$/;       // shorthand for these may sit before the topic: "tell me abt black holes"
const COMMON = 12000;                                   // a repair may only produce one of the most frequent words

/** vocab.txt is written in order of frequency, so a word's position is its rank. Common words by first letter and length. */
let RANKED = null;
function common(initial, length) {
  if (!RANKED) {
    RANKED = new Map();
    let n = 0;
    for (const w of vocab()) { if (n++ >= COMMON) break; if (w.length < 6) continue; const k = w[0] + w.length; let a = RANKED.get(k); if (!a) RANKED.set(k, (a = [])); a.push(w); }
  }
  return RANKED.get(initial + length) || [];
}

/** Real but uncommon words and names that sit one slip away from a common word ("cation", "linux"): never repaired. */
let GUARD = null;
function guarded(w) {
  if (!GUARD) { try { GUARD = new Set(fs.readFileSync(path.join(DIR, 'spell-guard.txt'), 'utf8').split('\n')); } catch { GUARD = new Set(); } }
  return GUARD.has(w);
}

/**
 * How the typed word `w` could have come from the intended word `v` by one typical slip:
 * 'swap' (two neighbouring letters exchanged), 'drop' (one letter left out), 'wrong' (one letter replaced),
 * 'double' (a letter typed twice); '' when it is none of these.
 */
export function slip(w, v) {
  const n = w.length, m = v.length;
  if (n === m) {
    let i = 0;
    while (i < n && w[i] === v[i]) i++;
    if (i === n) return '';
    if (w.slice(i + 1) === v.slice(i + 1)) return 'wrong';
    return i + 1 < n && w[i] === v[i + 1] && w[i + 1] === v[i] && w.slice(i + 2) === v.slice(i + 2) ? 'swap' : '';
  }
  if (n + 1 === m) { let i = 0; while (i < n && w[i] === v[i]) i++; return w.slice(i) === v.slice(i + 1) ? 'drop' : ''; }
  if (n === m + 1) {
    let i = 0;
    while (i < m && w[i] === v[i]) i++;
    if (w.slice(i + 1) !== v.slice(i)) return '';
    const doubled = i > 0 && w[i] === w[i - 1] && w[i + 1] !== w[i] && (i < 2 || w[i - 2] !== w[i]);          // exactly two, not "bbb"
    return doubled ? 'double' : '';
  }
  return '';
}

/**
 * The one common word that the non-word `w` is a slip of, ignoring the guard list; '' if none or several.
 * Only longer words (short non-words are too often names: "canva", "flickr", "venmo"), only with the same first letter,
 * and only letters exchanged, left out or doubled. A wrong letter is not repaired here: one letter is also all that
 * separates many real words and names from a common word ("sportage", "creased"), so those repairs come from a list.
 */
export function slipTarget(w) {
  const n = w.length;
  if (n < 7 || !/^[a-z]+$/.test(w)) return '';
  let best = '';
  for (const len of [n, n + 1, n - 1]) for (const v of common(w[0], len)) {
    const kind = slip(w, v);
    if (!kind || kind === 'wrong') continue;
    if (best) return '';
    best = v;
  }
  return best;
}

const wordFix = (w) => (vocab().has(w) || guarded(w) ? '' : slipTarget(w));

/** Listed misspellings (as opposed to abbreviations): a longer non-word that maps to one real word. */
let LISTED = null;
function listed(w) {
  if (!LISTED) {
    LISTED = new Map();
    for (const [from, to] of CHAT) if (from.length >= 6 && /^[a-z]+$/.test(to) && !vocab().has(from) && vocab().has(to)) LISTED.set(from, to);
  }
  return LISTED.get(w) || '';
}

/** The one frame word that the non-word `w` is a slip of, or ''. The shorter the word, the fewer kinds of slip count ("pho", "diy", "tel"). */
function frameFix(w) {
  const n = w.length;
  if (n < 3 || vocab().has(w) || guarded(w)) return '';
  let best = '';
  for (const f of FRAME) {
    if (f.length < 3 || Math.abs(f.length - n) > 1) continue;
    const kind = slip(w, f);
    if (!kind || (kind === 'wrong' && n < 5) || (kind !== 'swap' && n < 4)) continue;
    if (best) return '';
    best = f;
  }
  return best;
}

const NO_NEED = /^(whats|whos|pls|plz|plss|plzz|cannot)$/;                               // the web pipeline already reads these as they are
const frameShorthand = (w) => (w.length >= 2 && !NO_NEED.test(w) && CHAT.has(w) && CHAT.get(w).split(' ').every((x) => FRAME.has(x)) ? CHAT.get(w) : '');

/**
 * @param {string} raw the message as typed
 * @returns {string} the message with its spelling repaired, or '' when nothing needed repair
 */
export function repairForWeb(raw) {
  const parts = String(raw).split(/([\p{L}\p{N}]+(?:['’][\p{L}]+)*)/u);          // odd indexes are words
  const idx = [];
  for (let i = 1; i < parts.length; i += 2) idx.push(i);
  if (idx.length < 2 || idx.length > 40) return '';
  const lower = (k) => (k < idx.length ? parts[idx[k]].toLowerCase() : '');
  const allCaps = !/[a-z]/.test(raw);                                             // "WHAT IS A CONPUTER": capitals carry no information
  let changed = false, inFrame = true, prev = '';
  for (let k = 0; k < idx.length; k++) {
    const pi = idx[k], word = parts[pi], w = word.toLowerCase();
    const plain = /^[a-z]+$/.test(w);
    const last = k === idx.length - 1;
    const nameLike = !allCaps && ((k > 0 && /^\p{Lu}/u.test(word)) || (word.length > 1 && word.length <= 5 && word === word.toUpperCase()));
    let fix = '';
    if (inFrame && !last && plain && !nameLike) {
      if (FRAME.has(w)) { prev = w; continue; }
      const next = lower(k + 1);
      const nextInFrame = FRAME.has(next) || next === 'r' || next === 'u' || !!frameShorthand(next);
      if (w === 'r') fix = WH.test(prev) || SUBJ.test(prev) ? 'are' : '';
      else if (w === 'u') fix = AUX.test(prev) ? 'you' : '';
      else if (w === 'y') fix = k === 0 && /^(is|are|do|does|did|was|were|can)$/.test(next) ? 'why' : '';
      else if (w === 'si') fix = WH.test(prev) || /^(it|this|that|there)$/.test(prev) ? 'is' : '';          // "what si a ...", but not "the si unit"
      else if (frameShorthand(w) && (nextInFrame || (k > 0 && w.length >= 3 && !vocab().has(w) && CONTINUES.test(frameShorthand(w))))) fix = frameShorthand(w);   // "wat is ...", "tell me abt ..."; not "wat arun", "what is wot"
      else fix = frameFix(w);
      if (fix) { parts[pi] = allCaps ? fix.toUpperCase() : fix; changed = true; prev = fix.split(' ').pop(); continue; }
    }
    inFrame = false;
    if (!plain || nameLike) continue;
    fix = listed(w) || wordFix(w);
    if (fix) { parts[pi] = allCaps ? fix.toUpperCase() : fix; changed = true; }
  }
  return changed ? parts.join('').replace(/\s+/g, ' ').trim() : '';
}
