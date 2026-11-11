// INFINI AI — text utilities shared by every engine subsystem.
// Pure functions, zero dependencies, runs in Node and in browsers.

export const STOPWORDS = new Set((
  "a about above after again against all am an and any are aren't as at be because been before being below " +
  "between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each " +
  "few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself " +
  "him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't " +
  "my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd " +
  "she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's " +
  "these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll " +
  "we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't " +
  "would wouldn't you you'd you'll you're you've your yours yourself yourselves also just will shall may might must " +
  "us one ones per via etc eg ie vs whether however thus therefore hence yet still even ever much many get got"
).split(/\s+/));

// Characters that must never reach a user: control chars, zero-width chars, bidi overrides
// (used for hidden-text and "trojan source" style manipulation of retrieved content).
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g;

export function cleanText(s) {
  if (!s) return '';
  s = String(s).replace(UNSAFE_CHARS, '');
  try { s = s.normalize('NFC'); } catch { /* ignore */ }
  return s.replace(/[ \t\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

export function squash(s) { return cleanText(s).replace(/\s+/g, ' '); }

const WORD_RE = /c\+\+|[cf]#|\p{L}[\p{L}\p{M}\p{N}]*(?:[.'’][\p{L}\p{N}]+)*|\p{N}+(?:[.,]\p{N}+)*/giu;

/** Lower-cased word tokens for information retrieval (hyphens split, possessives stripped). */
export function tokenize(text) {
  if (!text) return [];
  const out = [];
  const m = String(text).toLowerCase().match(WORD_RE);
  if (!m) return out;
  for (let t of m) {
    t = t.replace(/[’']s$/, '').replace(/’/g, "'");
    if (t) out.push(t);
  }
  return out;
}

/** Tokens with original casing and offsets — used by the linguistic engine. */
export function tokenizeFull(text) {
  const out = [];
  const re = /c\+\+|[cf]#|\p{L}[\p{L}\p{M}\p{N}]*(?:[.'’\-][\p{L}\p{N}]+)*|\p{N}+(?:[.,:/]\p{N}+)*%?|[^\s\p{L}\p{N}]/giu;
  let m;
  while ((m = re.exec(text))) {
    const t = m[0];
    const kind = /^\p{L}/u.test(t) ? 'word' : /^\p{N}/u.test(t) ? 'num' : 'punct';
    out.push({ t, l: t.toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + t.length, kind, cap: /^\p{Lu}/u.test(t) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Porter stemmer (M.F. Porter, 1980) — lightweight morphological conflation, ~2 KB.
// ---------------------------------------------------------------------------------------------
const step2list = { ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble', alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive', fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log' };
const step3list = { icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '' };
const c = '[^aeiou]', v = '[aeiouy]', C = c + '[^aeiouy]*', V = v + '[aeiou]*';
const mgr0 = new RegExp('^(' + C + ')?' + V + C);
const meq1 = new RegExp('^(' + C + ')?' + V + C + '(' + V + ')?$');
const mgr1 = new RegExp('^(' + C + ')?' + V + C + V + C);
const s_v = new RegExp('^(' + C + ')?' + v);
const cvc = new RegExp('^' + C + v + '[^aeiouwxy]$');

function porter(w) {
  let stem, fp, re, re2;
  const firstch = w[0];
  if (firstch === 'y') w = 'Y' + w.slice(1);
  re = /^(.+?)(ss|i)es$/; re2 = /^(.+?)([^s])s$/;
  if (re.test(w)) w = w.replace(re, '$1$2'); else if (re2.test(w)) w = w.replace(re2, '$1$2');
  re = /^(.+?)eed$/; re2 = /^(.+?)(ed|ing)$/;
  if (re.test(w)) { fp = re.exec(w); if (mgr0.test(fp[1])) w = w.slice(0, -1); }
  else if (re2.test(w)) {
    fp = re2.exec(w); stem = fp[1];
    if (s_v.test(stem)) {
      w = stem;
      if (/(at|bl|iz)$/.test(w)) w += 'e';
      else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
      else if (cvc.test(w)) w += 'e';
    }
  }
  re = /^(.+?)y$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp[1]; if (s_v.test(stem)) w = stem + 'i'; }
  re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
  if (re.test(w)) { fp = re.exec(w); if (mgr0.test(fp[1])) w = fp[1] + step2list[fp[2]]; }
  re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
  if (re.test(w)) { fp = re.exec(w); if (mgr0.test(fp[1])) w = fp[1] + step3list[fp[2]]; }
  re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/; re2 = /^(.+?)(s|t)(ion)$/;
  if (re.test(w)) { fp = re.exec(w); if (mgr1.test(fp[1])) w = fp[1]; }
  else if (re2.test(w)) { fp = re2.exec(w); stem = fp[1] + fp[2]; if (mgr1.test(stem)) w = stem; }
  re = /^(.+?)e$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp[1]; if (mgr1.test(stem) || (meq1.test(stem) && !cvc.test(stem))) w = stem; }
  if (/ll$/.test(w) && mgr1.test(w)) w = w.slice(0, -1);
  if (firstch === 'y') w = 'y' + w.slice(1);
  return w;
}

const stemCache = new Map();
export function stem(word) {
  if (word.length < 3 || !/^[a-z]+$/.test(word)) return word;
  let s = stemCache.get(word);
  if (s === undefined) {
    s = porter(word);
    if (stemCache.size > 50000) stemCache.clear();
    stemCache.set(word, s);
  }
  return s;
}

/** Stemmed content terms (stopwords removed). */
export function terms(text) {
  const out = [];
  for (const t of tokenize(text)) if (!STOPWORDS.has(t) && t.length > 1) out.push(stem(t));
  return out;
}
export function termSet(text) { return new Set(terms(text)); }

// ---------------------------------------------------------------------------------------------
// Sentence segmentation (rule based; abbreviation- and initial-aware)
// ---------------------------------------------------------------------------------------------
const ABBR = new Set(('mr mrs ms dr prof sr jr st vs etc inc ltd co corp no nos fig figs eq al gen col lt sgt capt rev hon gov sen rep  c ca approx est fl cf viz al' +
  'pres mt ft jan feb mar apr jun jul aug sep sept oct nov dec approx est dept univ vol vols pp ed eds ca cf e.g i.e u.s u.k u.n a.m p.m ' +
  'ph.d b.c a.d u.s.a viz op cit ibid resp incl min max').split(' '));

export function splitSentences(text) {
  const out = [];
  if (!text) return out;
  const re = /([.!?]+)(["'”’)\]]*)(\s+|$)/g;
  let start = 0, m;
  while ((m = re.exec(text))) {
    const end = m.index + m[1].length + m[2].length;
    const next = text.charAt(re.lastIndex);
    if (m[1] === '.') {
      const before = text.slice(Math.max(start, m.index - 24), m.index);
      const w = ((before.match(/([\p{L}.]+)$/u) || [])[1] || '').toLowerCase();
      if (ABBR.has(w)) continue;
      if (w.length === 1 && /\p{Lu}/u.test(before.slice(-1)) && next) continue;       // initials: "J. K. Rowling"
      if (next && /\p{Ll}/u.test(next)) continue;                                     // lower-case continuation
      if (/^\s*\d{1,3}$/.test(text.slice(start, m.index))) continue;                  // "1. Install …"
    }
    const s = text.slice(start, end).trim();
    if (s) out.push(s);
    start = re.lastIndex;
    if (m[3] === '') break;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Similarity, hashing, misc helpers
// ---------------------------------------------------------------------------------------------
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export function overlap(a, b) {            // containment of the smaller set in the larger
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  return inter / s.size;
}
export function shingles(tokens, n = 4) {
  const out = new Set();
  for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(' '));
  return out;
}
export function hash(str) {                // FNV-1a, 32 bit, base36
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
export function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function truncate(s, n) {
  if (!s || s.length <= n) return s || '';
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—\s]+$/, '') + '…';
}
export function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
export function uniq(arr, key = (x) => x) {
  const seen = new Set(), out = [];
  for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}
export function clamp(x, lo = 0, hi = 1) { return x < lo ? lo : x > hi ? hi : x; }

// Registrable-domain approximation (no public-suffix list download: a compact rule covers the common cases).
const SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'mil', 'nom', 'ne', 'or', 'go', 'gob', 'res', 'info']);
export function hostOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
export function registrable(host) {
  host = (host || '').toLowerCase().replace(/^www\./, '');
  const p = host.split('.');
  if (p.length <= 2) return host;
  const tld = p[p.length - 1], sld = p[p.length - 2];
  if (tld.length === 2 && SLD.has(sld)) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}
export function domainOf(url) { return registrable(hostOf(url)); }

/** Canonical form of a URL for de-duplication (drops fragments, tracking params, trailing slash). */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|ref_|trk$|igshid|spm$|cmpid)/i.test(k)) u.searchParams.delete(k);
    let s = u.protocol + '//' + u.hostname.toLowerCase().replace(/^www\./, '') + (u.port ? ':' + u.port : '') + u.pathname.replace(/\/+$/, '') + (u.search || '');
    return s;
  } catch { return url; }
}

// Flesch reading ease — used to prefer simpler evidence when the user asks for a simpler explanation.
function syllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}
export function readingEase(text) {
  const words = tokenize(text);
  if (!words.length) return 0;
  const sents = Math.max(1, splitSentences(text).length);
  let syl = 0;
  for (const w of words) syl += syllables(w);
  return 206.835 - 1.015 * (words.length / sents) - 84.6 * (syl / words.length);
}
