// INFINI AI — brain: everyday common sense.
// Two layers: a hand-written core (certain) and a long tail taken from WordNet and ConceptNet (answered with a hedge).
// A "no" is only given when something says so: an explicit negative, a class the thing cannot belong to, or a contrary property.
// When nothing is known the question goes to the web.

import { commonsense, known } from './store.js';
import { singular } from './normalize.js';
import { NUMWORDS } from './lexicon.js';

const DETS = new Set('a an the some any all most every its their his her my your our this that these those'.split(' '));
const PRON = /^(you|your|yours|u|i|me|my|mine|we|us|our|it|its|this|that|these|those|he|him|his|she|her|they|them|their|there|here|someone|somebody|anyone|anybody|everyone|everybody|nobody|something|anything|everything|nothing|who|what|which)$/;
const PARTICLE = new Set('up down out off over around away back along about'.split(' '));
const PREP = new Set('to in on at during when and or for with than as if but because like of by from into while that which under near inside through without'.split(' '));
const ADVERBS = new Set('fast well high far quickly slowly easily really very too also much lot alot long hard a'.split(' '));
const MASS = new Set(`water fire ice steam snow rain air wind grass sand soil mud gold silver iron steel copper aluminium aluminum glass wood paper plastic rubber cotton wool silk leather petrol gasoline electricity oxygen smoke
 sugar salt honey rice wheat bread milk cheese butter yogurt yoghurt curd chocolate ice cream tea coffee juice dal bhat meat money blood hair skin lightning thunder football soccer cricket basketball volleyball tennis badminton chess
 bamboo coral corn maize spinach garlic food fruit furniture metal bacteria noodles cake pizza momo glasses scissors`.split(/\s+/).join(' ').replace(/ice cream/, 'ice_cream').replace(/dal bhat/, 'dal_bhat').split(' ').map((x) => x.replace('_', ' ')));
const UNIQUE = { sun: 'the Sun', moon: 'the Moon', earth: 'the Earth', sky: 'the sky', sea: 'the sea', pluto: 'Pluto', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', mercury: 'Mercury', venus: 'Venus', uranus: 'Uranus', neptune: 'Neptune' };
const COLORS = new Set('red orange yellow green blue indigo violet purple pink brown black white grey gray golden silver silvery colourless colorless clear transparent'.split(' '));
const TASTES = new Set('sweet sour salty bitter spicy'.split(' '));
const STATES = new Set('solid liquid gas'.split(' '));
const EXCLUSIVE = [['mammal', 'bird', 'fish', 'reptile', 'amphibian', 'insect', 'arachnid'], ['animal', 'plant', 'fungus'], ['star', 'planet', 'moon'], ['solid', 'liquid', 'gas']];
const BIO = new Set('animal plant bird fish mammal reptile amphibian insect arachnid fungus tree flower person human'.split(' '));
const FROM = new Set('milk egg wool wood meat honey smoke silk leather cotton'.split(' '));
const PLANT_FOOD = /^(grass|hay|leaves|leaf|plants|plant|vegetables|vegetable|fruit|fruits|bamboo|seeds|grain|nuts|carrots|bananas|bark)$/;
const MEAT_FOOD = /^(meat|animals|animal|fish|mice|mouse|birds|bird|insects|insect|seals|deer|zebras|chicken|beef|flesh|humans|people)$/;

let IDX = null;
function prep() {
  if (IDX) return IDX;
  const S = commonsense();
  const canon = (phrase) => String(phrase).toLowerCase().replace(/[^a-z0-9 -]/g, ' ').split(/\s+/).filter((t) => t && !DETS.has(t)).map((t) => singular(t, known)).join(' ');
  const things = new Map();                                   // canonical name -> thing
  const parseItem = (text) => { const m = text.match(/^(.*?)\((\d+)\)$/); const t = (m ? m[1] : text).trim(); return { text: t, n: m ? Number(m[2]) : null, canon: canon(t) }; };
  for (const [name, raw] of Object.entries(S.core.things)) {
    const t = { name, key: canon(name) };
    for (const [k, list] of Object.entries(raw)) t[k] = list.map(parseItem);
    things.set(t.key, t);
  }
  const alias = new Map();
  for (const [a, name] of Object.entries(S.core.alias)) alias.set(canon(a), canon(name));
  IDX = { S, canon, things, alias };
  return IDX;
}
const thingOf = (key) => { const I = prep(); return I.things.get(key) || I.things.get(I.alias.get(key)) || null; };

/** Core classes of a thing, nearest first (walks "isa" within the hand-written core). */
function classesOf(thing) {
  const out = [], seen = new Set([thing.key]);
  let frontier = [thing];
  for (let d = 0; d < 6 && frontier.length; d++) {
    const next = [];
    for (const t of frontier) for (const c of t.isa || []) {
      const ct = thingOf(c.canon);
      if (ct && !seen.has(ct.key)) { seen.add(ct.key); out.push(ct); next.push(ct); }
    }
    frontier = next;
  }
  return out;
}
/** Names of every class a thing belongs to (core chain + tail taxonomy), canonical. */
function classNames(key) {
  const I = prep();
  const out = new Set();
  const t = thingOf(key);
  if (t) { for (const c of t.isa || []) out.add(c.canon); for (const ct of classesOf(t)) { out.add(ct.key); for (const c of ct.isa || []) out.add(c.canon); } for (const p of t.is || []) out.add(p.canon); }
  const tail = I.S.tail.isa[key];
  if (tail) for (const c of tail.split('|')) out.add(I.canon(c));
  return out;
}
const tailList = (rel, key) => { const v = prep().S.tail[rel][key]; return v ? v.split('|') : []; };

// ---------------------------------------------------------------------------------------------------------------------
// wording
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const article = (w) => (/^(a|e|i|o|u)/.test(w) && !/^(uni|use|usu|eu|one)/.test(w) ? 'an' : 'a');
const pluralize = (w) => {
  const parts = w.split(' '); let h = parts.pop();
  if (/^(fish|sheep|deer|people|scissors|glasses|species|aircraft)$/.test(h)) { /* unchanged */ } else if (h === 'person' || h === 'human being') h = 'people'; else if (h === 'man') h = 'men'; else if (h === 'woman') h = 'women'; else if (h === 'child') h = 'children';
  else if (h === 'mouse') h = 'mice'; else if (h === 'goose') h = 'geese'; else if (h === 'foot') h = 'feet'; else if (h === 'tooth') h = 'teeth'; else if (h === 'wolf') h = 'wolves'; else if (h === 'leaf') h = 'leaves'; else if (h === 'knife') h = 'knives';
  else if (/[^aeiou]y$/.test(h)) h = h.slice(0, -1) + 'ies'; else if (/(s|x|z|ch|sh)$/.test(h)) h += 'es'; else h += 's';
  return [...parts, h].join(' ');
};
/** "a dog", "water", "the Sun" */
function np(name) {
  if (name && typeof name === 'object') return name.echo || np(name.name);
  if (UNIQUE[name]) return UNIQUE[name];
  if (MASS.has(name) || /s$/.test(name) && !/(ss|us|is)$/.test(name) && name !== 'bus') return name;
  return `${article(name)} ${name}`;
}
const NP = (name) => cap(np(name));
const CLASS_MASS = new Set('food furniture clothing equipment money cutlery poultry meat produce'.split(' '));
const cnp = (c) => (CLASS_MASS.has(c) || /^(a|an|the) /.test(c) ? c : `${article(c)} ${c}`);
const numWord = (n) => (n >= 0 && n <= 12 ? NUMWORDS[n] : String(n));
const join = (arr, word = 'and') => (arr.length <= 1 ? arr.join('') : arr.length === 2 ? `${arr[0]} ${word} ${arr[1]}` : `${arr.slice(0, -1).join(', ')} ${word} ${arr[arr.length - 1]}`);
const itemText = (it) => (it.n != null ? `${numWord(it.n)} ${it.text.replace(/^(a|an|one|two|three|four) /, '')}` : it.text);
const be = (name0) => { const name = name0 && typeof name0 === 'object' ? (name0.echo || name0.name) : name0; return beOf(name); };
const beOf = (name) => (/s$/.test(name) && !/(ss|us|is)$/.test(name) && !MASS.has(name) || name === 'people' ? 'are' : 'is');

// ---------------------------------------------------------------------------------------------------------------------
// matching a queried phrase against a list of facts
const stripParticles = (c) => c.split(' ').filter((t) => !PARTICLE.has(t)).join(' ');
function phraseMatch(q, fact) {
  if (!q || !fact) return false;
  const a = stripParticles(q), b = stripParticles(fact);
  if (a === b) return true;
  if (b.startsWith(a + ' ')) { const rest = b.slice(a.length + 1).split(' '); if (PREP.has(rest[0])) return true; }
  if (a.startsWith(b + ' ')) { const rest = a.slice(b.length + 1).split(' '); if (rest.every((t) => ADVERBS.has(t))) return true; }
  return false;
}
const findFact = (list, q) => (list || []).find((it) => phraseMatch(q, it.canon)) || null;
/** head-noun match for "has": "ear" matches "long ears", "four legs" matches "legs(4)". */
function findPart(list, q) {
  const qt = q.split(' ').filter((t) => !/^\d+$/.test(t) && !NUMWORDS.includes(t));
  if (!qt.length) return null;
  const head = qt[qt.length - 1];
  return (list || []).find((it) => { const t = it.canon.split(' '); return t[t.length - 1] === head && qt.slice(0, -1).every((m) => t.includes(m)); }) || null;
}
function leadingNumber(q) {
  const t = q.split(' ')[0];
  if (/^\d+$/.test(t)) return Number(t);
  const i = NUMWORDS.indexOf(t);
  return i >= 0 ? i : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// subject finding
/** Longest known thing at the start of `tokens`. Returns {key, name, core, rest[]} or null. */
function splitSubject(tokens, { needRest = true, maxLen = 3 } = {}) {
  const I = prep();
  let toks = tokens.slice(), det = '';
  while (toks.length && DETS.has(toks[0])) { det = toks[0]; toks = toks.slice(1); }
  if (!toks.length || PRON.test(toks[0])) return null;
  for (let n = Math.min(maxLen, toks.length - (needRest ? 1 : 0)); n >= 1; n--) {
    if (DETS.has(toks[n - 1])) continue;
    const key = I.canon(toks.slice(0, n).join(' '));
    if (!key) continue;
    const core = thingOf(key);
    if (core || I.S.tail.isa[key] || I.S.tail.can[key] || I.S.tail.is[key] || I.S.tail.has[key] || I.S.tail.used[key] || I.S.tail.at[key]) {
      const rest = toks.slice(n);
      const said = toks.slice(0, n).join(' ');
      return { key: core ? core.key : key, name: core ? core.name : key, core, rest, said, echo: core ? null : (/^(a|an|the)$/.test(det) ? `${det} ${said}` : said) };
    }
  }
  return null;
}
const wholeSubject = (text) => { const t = text.split(' ').filter(Boolean); const s = splitSubject(t, { needRest: false, maxLen: 4 }); return s && !s.rest.length ? s : null; };

// ---------------------------------------------------------------------------------------------------------------------
// answers
const sure = (text, extra = {}) => ({ text, sure: true, ...extra });
const likely = (text, extra = {}) => ({ text, sure: false, ...extra });
const WEB = { web: true };

function capability(subj, vq) {
  const I = prep();
  const t = subj.core;
  if (t) {
    let f = findFact(t.cannot, vq);
    if (f) { const can = t.key === 'human' ? [] : (t.can || []).slice(0, 3).map((x) => x.text); return sure(`No. ${NP(t.name)} can't ${f.text}.${can.length ? ` It can ${join(can)}, though.` : ''}`); }
    f = findFact(t.can, vq);
    if (f) return sure(`Yes. ${NP(t.name)} can ${f.text}.`);
    for (const c of classesOf(t)) {
      f = findFact(c.cannot, vq);
      if (f) return sure(`No. ${NP(t.name)} is ${np(c.name)}, and ${pluralize(c.name)} can't ${f.text}.`);
      f = findFact(c.can, vq);
      if (f) return sure(`Yes, as a rule. ${NP(t.name)} is ${np(c.name)}, and ${pluralize(c.name)} can ${f.text}.`);
    }
  }
  if (tailList('cannot', subj.key).some((x) => phraseMatch(vq, I.canon(x)))) return likely(`My common-sense notes say no: ${np(subj)} can't do that.`);
  if (tailList('can', subj.key).some((x) => phraseMatch(vq, I.canon(x)))) return likely(`Yes, as far as my common-sense notes go: ${np(subj)} can ${subj.rest.join(' ')}.`);
  if (!t) for (const cname of tailList('isa', subj.key)) {
    const c = thingOf(I.canon(cname));
    if (!c) continue;
    let f = findFact(c.cannot, vq);
    if (f) return likely(`Most likely not. ${NP(subj)} is ${np(c.name)}, and ${pluralize(c.name)} can't ${f.text}.`);
    f = findFact(c.can, vq);
    if (f) return likely(`Most likely yes. ${NP(subj)} is ${np(c.name)}, and most ${pluralize(c.name)} can ${f.text}.`);
  }
  return WEB;
}

function possession(subj, oq) {
  const I = prep();
  const asked = leadingNumber(oq);
  const t = subj.core;
  const say = (owner, it, via) => {
    if (asked != null && it.n != null && asked !== it.n) return sure(`No. ${NP(owner)} has ${itemText(it)}, not ${numWord(asked)}.`);
    return sure(via ? `Yes. ${NP(subj.name)} is ${np(via)}, and ${pluralize(via)} have ${itemText(it)}.` : `Yes. ${NP(owner)} has ${itemText(it)}.`);
  };
  if (t) {
    let f = findPart(t.hasnot, oq);
    if (f) return sure(`No. ${NP(t.name)} has no ${f.text.replace(/^(a|an|the) /, '')}.`);
    f = findPart(t.has, oq);
    if (f) return say(t.name, f, null);
    for (const c of classesOf(t)) {
      f = findPart(c.hasnot, oq);
      if (f) return sure(`No. ${NP(t.name)} is ${np(c.name)}, and ${pluralize(c.name)} have no ${f.text.replace(/^(a|an|the) /, '')}.`);
      f = findPart(c.has, oq);
      if (f) return say(t.name, f, c.name);
    }
  }
  const tl = tailList('has', subj.key).map((x) => ({ text: x, canon: I.canon(x), n: null }));
  const f = findPart(tl, oq);
  if (f) return likely(`Yes, as far as my common-sense notes go: ${np(subj)} has ${f.text}.`);
  if (!t) for (const cname of tailList('isa', subj.key)) {
    const c = thingOf(I.canon(cname));
    if (!c) continue;
    let g = findPart(c.hasnot, oq);
    if (g) return likely(`Most likely not. ${NP(subj)} is ${np(c.name)}, and ${pluralize(c.name)} have no ${g.text.replace(/^(a|an|the) /, '')}.`);
    g = findPart(c.has, oq);
    if (g) return likely(`Most likely yes. ${NP(subj)} is ${np(c.name)}, and ${pluralize(c.name)} have ${itemText(g)}.`);
  }
  return WEB;
}

function howMany(subj, oqRaw, label = null) {
  const I = prep();
  const t = subj.core;
  const oq = I.canon(oqRaw);
  const noun = pluralize(oq.split(' ').pop());
  if (t) {
    let f = findPart(t.has, oq);
    if (f && f.n != null) return sure(`${label ? cap(label) : NP(t.name)} has ${itemText(f)}.`);
    if (findPart(t.hasnot, oq)) return sure(`None. ${NP(t.name)} has no ${noun}.`);
    for (const c of classesOf(t)) {
      f = findPart(c.has, oq);
      if (f && f.n != null) return sure(`${cap(numWord(f.n))}. ${NP(t.name)} is ${np(c.name)}, and ${pluralize(c.name)} have ${itemText(f)}.`);
      if (findPart(c.hasnot, oq)) return sure(`None. ${NP(t.name)} is ${np(c.name)}, and ${pluralize(c.name)} have no ${noun}.`);
    }
  }
  for (const x of tailList('has', subj.key)) {                    // "eight legs", "88 keys"
    const c = I.canon(x), n = leadingNumber(c);
    if (n != null && c.split(' ').pop() === oq.split(' ').pop()) return likely(`${NP(subj)} has ${x}, according to my common-sense notes.`);
  }
  if (!t) for (const cname of tailList('isa', subj.key)) {
    const c = thingOf(I.canon(cname));
    const f = c && findPart(c.has, oq);
    if (f && f.n != null) return likely(`Most likely ${numWord(f.n)}. ${NP(subj)} is ${np(c.name)}, and ${pluralize(c.name)} have ${itemText(f)}.`);
  }
  return WEB;
}

function mainClass(subj) {
  const t = subj.core;
  if (t && t.isa && t.isa.length) return t.isa[0].text;
  const tl = tailList('isa', subj.key);
  return tl.length ? tl[0] : '';
}
function membership(subj, cq) {
  const I = prep();
  const t = subj.core;
  const c = I.canon(cq);
  if (!c) return WEB;
  if (t) {
    const neg = (t.isnot || []).find((x) => x.canon === c || x.canon.startsWith(c + ' '));
    if (neg) { const mc = (t.isa || [])[0] || (t.is || []).find((x) => /^(a|an|the) /.test(x.text)); return sure(`No. ${NP(t.name)} is not ${neg.text}${mc ? `; it is ${cnp(mc.text)}` : ''}.`); }
    if ((t.isa || []).some((x) => x.canon === c)) return sure(`Yes. ${NP(t.name)} is ${cnp(cq)}.`);
    const viaIs = (t.is || []).find((x) => x.canon === c);
    if (viaIs) return sure(`Yes. ${NP(t.name)} is ${cnp(viaIs.text)}.`);
    for (const ct of classesOf(t)) {
      if (ct.key === c || (ct.isa || []).some((x) => x.canon === c)) { const first = (t.isa[0] || {}).text || ct.name; return sure(I.canon(first) === c ? `Yes. ${NP(t.name)} is ${cnp(cq)}.` : `Yes. ${NP(t.name)} is ${cnp(first)}, and that makes it ${cnp(cq)}.`); }
      const cneg = (ct.isnot || []).find((x) => x.canon === c);
      if (cneg) return sure(`No. ${NP(t.name)} is ${cnp(ct.name)}, and ${pluralize(ct.name)} are not ${pluralize(cq)}.`);
    }
    const loose = (t.is || []).find((x) => x.canon.endsWith(' ' + c) && x.canon.split(' ').length <= 4);
    if (loose) return sure(`Yes, in a sense. ${NP(t.name)} is ${loose.text}.`);
  }
  const names = classNames(subj.key);
  if (names.has(c)) return (t ? sure : likely)(`Yes. ${NP(subj)} is a kind of ${cq}.`);
  for (const set of EXCLUSIVE) {
    if (!set.includes(c)) continue;
    const mine = set.find((x) => x !== c && names.has(x));
    if (mine) return (t ? sure : likely)(`No. ${NP(subj)} is ${cnp(mine)}, not ${cnp(cq)}.`);
  }
  if (BIO.has(c) && names.size) {
    const mc = mainClass(subj);
    return likely(`No, not as far as I know. ${NP(subj)} is ${mc ? `a kind of ${mc}` : `not ${cnp(cq)}`}.`);
  }
  return WEB;
}

const deinflect = (w) => (w.length > 5 && /est$/.test(w) ? [w.slice(0, -3), w.slice(0, -2), w.slice(0, -4)] : w.length > 4 && /er$/.test(w) ? [w.slice(0, -2), w.slice(0, -1)] : []);
function sameQuality(p, fact) {
  const I = prep();
  if (phraseMatch(p, fact)) return true;
  const syn = I.S.words.syn;
  if ((syn[p] || []).includes(fact) || (syn[fact] || []).includes(p)) return true;
  const ft = fact.split(' ');
  if (ft.length <= 6 && ft.some((w) => w === p || deinflect(w).includes(p))) return ft.length > 1 && !ft.includes('not') && (ft[0] === 'the' || ft.some((w) => deinflect(w).includes(p)) || ft[ft.length - 1] === p && ft.length <= 2);
  return false;
}
function property(subj, pq) {
  const I = prep();
  const t = subj.core;
  const p = I.canon(pq);
  if (!p) return WEB;
  const opp = [...(I.S.words.opp[p] || []), ...((I.S.tail.opp[p] || '').split('|').filter(Boolean))];
  const check = (th, owner, via) => {
    const neg = (th.isnot || []).find((x) => phraseMatch(p, x.canon) || x.canon === p);
    if (neg) {
      const pos = (th.is || []).find((x) => opp.includes(x.canon)) || (COLORS.has(p) ? (th.color || [])[0] : null);
      return sure(`No. ${NP(owner)} ${be(owner)} not ${neg.text}${pos ? `; it ${be(owner)} ${pos.text}` : ''}.`);
    }
    const all = [...(th.is || []), ...(th.color || [])];
    const yes = all.find((x) => sameQuality(p, x.canon));
    if (yes) return sure(via ? `Yes, as a rule. ${NP(owner)} is ${np(via)}, and ${pluralize(via)} are ${yes.text}.` : `Yes. ${NP(owner)} ${be(owner)} ${yes.text}.`);
    const contrary = all.find((x) => opp.includes(x.canon));
    if (contrary) return sure(`No. ${NP(owner)} ${be(owner)} ${contrary.text}, not ${pq}.`);
    const fam = COLORS.has(p) ? COLORS : TASTES.has(p) ? TASTES : STATES.has(p) ? STATES : null;
    if (fam) {
      const mine = (fam === COLORS && th.color && th.color.length ? th.color : all).find((x) => x.canon.split(' ').some((w) => fam.has(w)));
      if (mine && mine.canon.split(' ').includes(p)) return sure(via ? `Yes, as a rule. ${NP(owner)} is ${np(via)}, and ${pluralize(via)} are ${mine.text}.` : `Yes. ${NP(owner)} ${be(owner)} ${mine.text}.`);
      if (mine) return sure(`${fam === COLORS ? 'Not usually' : 'No'}. ${NP(owner)} ${be(owner)} ${mine.text}.`);
    }
    return null;
  };
  if (t) {
    const own = check(t, t.name, null);
    if (own) return own;
    for (const c of classesOf(t)) { const r = check(c, t.name, c.name); if (r) return r; }
  }
  if (tailList('isnot', subj.key).some((x) => phraseMatch(p, I.canon(x)))) return likely(`My common-sense notes say no: ${np(subj)} ${be(subj)} not ${pq}.`);
  const ty = tailList('is', subj.key).find((x) => phraseMatch(p, I.canon(x)));
  if (ty) return likely(`Yes, as far as my common-sense notes go: ${np(subj)} ${be(subj)} ${ty}.`);
  if (!t) for (const cname of tailList('isa', subj.key)) { const c = thingOf(I.canon(cname)); if (c) { const r = check(c, subj.echo || subj.name, c.name); if (r) return { ...r, sure: false, text: r.text.replace(/^Yes, as a rule\./, 'Most likely yes.').replace(/^No\./, 'Most likely not.') }; } }
  return WEB;
}

function alive(subj) {
  const t = subj.core;
  const names = classNames(subj.key);
  if (t) {
    const neg = (t.isnot || []).find((x) => /\b(alive|living thing)\b/.test(x.canon));
    if (neg) return sure(`No. ${NP(t.name)} ${be(t.name)} not ${neg.text}.`);
    for (const c of classesOf(t)) { const cn = (c.isnot || []).find((x) => /\balive\b/.test(x.canon)); if (cn) return sure(`No. ${NP(t.name)} is ${np(c.name)}, and ${pluralize(c.name)} are not alive.`); }
  }
  if (names.has('living thing') || names.has('animal') || names.has('plant') || names.has('organism')) { const mc = mainClass(subj); return (t ? sure : likely)(`Yes. ${NP(subj)} is a living thing${mc && mc !== 'living thing' ? `: it is ${cnp(mc)}` : ''}.`); }
  if (names.size) return likely(`No, not as far as I know. ${NP(subj)} is not a living thing.`);
  return WEB;
}
function edible(subj, byYou) {
  const t = subj.core;
  const names = classNames(subj.key);
  const aside = byYou ? ' People can, that is. I have no mouth.' : '';
  if (t && (t.isnot || []).some((x) => /\bedible\b/.test(x.canon))) return sure(`No. ${NP(t.name)} ${be(t.name)} not something to eat.`);
  if (['food', 'fruit', 'vegetable', 'grain', 'drink', 'edible fruit', 'dish', 'dessert', 'meat', 'bread'].some((c) => names.has(c))) return (t ? sure : likely)(`Yes. ${NP(subj)} ${be(subj)} food.${aside}`);
  if (t && ((t.isnot || []).some((x) => /\balive\b/.test(x.canon)) || classesOf(t).some((c) => (c.isnot || []).some((x) => /\balive\b/.test(x.canon))))) return sure(`No. ${NP(t.name)} ${be(t.name)} not food.`);
  return WEB;
}

function listAnswer(subj, rel) {
  const t = subj.core;
  const own = t && t[rel] && t[rel].length ? t[rel] : null;
  const s = NP(subj), b = be(subj);
  if (rel === 'color') {
    if (own) return sure(`${s} ${b} ${own[0].text}.`);
    const cols = tailList('is', subj.key).filter((x) => COLORS.has(x));
    return cols.length ? likely(`As far as my common-sense notes go, ${np(subj)} ${b} ${join(cols.slice(0, 3), 'or')}.`) : WEB;
  }
  if (rel === 'eats') return own ? sure(`${s} eats ${join(own.map((x) => x.text))}.`) : WEB;
  if (rel === 'sound') return own ? sure(`The sound ${np(subj.name)} makes is a ${join(own.map((x) => x.text), 'or')}.`) : WEB;
  if (rel === 'young') return own ? sure(`A young ${subj.name} is called ${join(own.map((x) => np(x.text)), 'or')}.`) : WEB;
  if (rel === 'group') return own ? sure(`A group of ${pluralize(subj.name)} is called a ${join(own.map((x) => x.text), 'or')}.`) : WEB;
  if (rel === 'male' || rel === 'female') return own ? sure(`A ${rel} ${subj.name} is called ${np(own[0].text)}.`) : WEB;
  if (rel === 'needs') { const c = own || (t && (classesOf(t).find((x) => x.needs) || {}).needs); return c ? sure(`${s} needs ${join(c.map((x) => x.text))}.`) : WEB; }
  if (rel === 'gives') return own ? sure(`${s} gives us ${join(own.map((x) => x.text))}.`) : WEB;
  if (rel === 'used') {
    if (own) return sure(`${s} ${b} used for ${join(own.slice(0, 5).map((x) => x.text))}.`);
    if (t && t.can && t.can.length) return sure(`${s} can ${join(t.can.slice(0, 4).map((x) => x.text))}.`);
    const tl = tailList('used', subj.key);
    const ing = tl.filter((x) => /^\w+ing\b/.test(x));
    const pick = [];
    for (const x of ing.length ? ing : tl) { const head = x.split(' ').pop(); if (!pick.some((y) => y.split(' ').pop() === head || y.split(' ')[0] === x.split(' ')[0])) pick.push(x); if (pick.length === 3) break; }
    return pick.length ? likely(`From my common-sense notes: people use ${np(subj)} for ${join(pick)}.`) : WEB;
  }
  if (rel === 'made') {
    if (own) return sure(FROM.has(subj.name) ? `${s} comes from ${join(own.map((x) => x.text))}.` : `${s} ${b} made from ${join(own.map((x) => x.text))}.`);
    const tl = tailList('made', subj.key);
    return tl.length ? likely(`As far as my common-sense notes go, ${np(subj)} ${b} made of ${join(tl.slice(0, 3), 'or')}.`) : WEB;
  }
  if (rel === 'at') {
    if (own) return sure(`${s} ${b} usually found in ${join(own.slice(0, 5).map((x) => x.text))}.`.replace(/found in (the wrist|the feet|the head|the hands|the face|the mouth|the chest|the belly|underground)/, 'found $1').replace('found the', 'found on the').replace('found on the mouth', 'found in the mouth').replace('found on the chest', 'found in the chest').replace('found on the belly', 'found in the belly'));
    const tl = tailList('at', subj.key);
    return WEB;                                            // crowd-sourced places read badly; the web does this better
  }
  if (rel === 'can') {
    if (own) return sure(`${s} can ${join(own.slice(0, 6).map((x) => x.text))}.`);
    const tl = tailList('can', subj.key).filter((x) => x.split(' ').length <= 3);
    return tl.length ? likely(`From my common-sense notes: ${np(subj)} can ${join(tl.slice(0, 4))}.`) : WEB;
  }
  if (rel === 'has') {
    if (own) return sure(`${s} has ${join(own.slice(0, 7).map(itemText))}.`);
    const tl = tailList('has', subj.key);
    return tl.length ? likely(`From my common-sense notes: ${np(subj)} has ${join(tl.slice(0, 5))}.`) : WEB;
  }
  return WEB;
}

const DIM = {
  bigger: ['size', 1, 'bigger'], larger: ['size', 1, 'larger'], taller: ['size', 1, 'taller'], longer: ['size', 1, 'longer'], smaller: ['size', -1, 'smaller'], shorter: ['size', -1, 'shorter'], tinier: ['size', -1, 'smaller'],
  heavier: ['weight', 1, 'heavier'], lighter: ['weight', -1, 'lighter'], faster: ['speed', 1, 'faster'], quicker: ['speed', 1, 'faster'], slower: ['speed', -1, 'slower'], hotter: ['temp', 1, 'hotter'], warmer: ['temp', 1, 'warmer'], colder: ['temp', -1, 'colder'], cooler: ['temp', -1, 'cooler'],
  biggest: ['size', 1, 'biggest'], largest: ['size', 1, 'largest'], tallest: ['size', 1, 'tallest'], longest: ['size', 1, 'longest'], smallest: ['size', -1, 'smallest'], shortest: ['size', -1, 'shortest'],
  heaviest: ['weight', 1, 'heaviest'], lightest: ['weight', -1, 'lightest'], fastest: ['speed', 1, 'fastest'], slowest: ['speed', -1, 'slowest'], hottest: ['temp', 1, 'hottest'], coldest: ['temp', -1, 'coldest'],
};
function magnitude(dim, phrase) {
  const I = prep();
  const table = I.S.words[dim];
  const toks = phrase.split(' ').filter((t) => !DETS.has(t));
  const raw = toks.join(' ');
  if (raw in table) return { v: table[raw], name: raw };
  const key = I.canon(phrase);
  if (key in table) return { v: table[key], name: key };
  const al = I.alias.get(key);
  if (al && al in table) return { v: table[al], name: al };
  return null;
}
function compare(aText, bText, word, yesNo) {
  const d = DIM[word];
  if (!d) return null;
  const [dim, dir, label] = d;
  const A = magnitude(dim, aText), B = magnitude(dim, bText);
  if (!A || !B) return WEB;
  const ratio = dim === 'temp' ? (Math.abs(A.v - B.v) >= 15 ? 99 : 1) : Math.max(A.v, B.v) / Math.max(1e-30, Math.min(A.v, B.v));
  const need = dim === 'size' ? 1.6 : dim === 'weight' ? 2 : dim === 'speed' ? 1.35 : 2;
  if (ratio < need) return WEB;                                                          // too close for rough numbers
  const aWins = dir > 0 ? A.v > B.v : A.v < B.v;
  const w = aWins ? A : B, l = aWins ? B : A;
  const usually = ratio < 3 ? `${NP(w.name)} ${be(w.name)} usually ${label} than ${np(l.name)}.` : `${NP(w.name)} ${be(w.name)} ${label} than ${np(l.name)}.`;
  if (yesNo) return sure(aWins ? `Yes. ${usually}` : `No. ${usually}`);
  return sure(usually);
}
function superlative(items, word) {
  const d = DIM[word];
  if (!d || items.length < 2) return null;
  const [dim, dir, label] = d;
  const vals = items.map((x) => magnitude(dim, x));
  if (vals.some((v) => !v)) return WEB;
  const sorted = vals.slice().sort((a, b) => (dir > 0 ? b.v - a.v : a.v - b.v));
  const ratio = dim === 'temp' ? (Math.abs(sorted[0].v - sorted[1].v) >= 15 ? 99 : 1) : Math.max(sorted[0].v, sorted[1].v) / Math.max(1e-30, Math.min(sorted[0].v, sorted[1].v));
  if (ratio < 1.5) return WEB;
  return sure(`Of those, ${np(sorted[0].name)} ${be(sorted[0].name)} the ${label}.`);
}

function opposite(word) {
  const I = prep();
  const w = word.trim();
  const cur = I.S.words.opp[w];
  if (cur && cur.length) return sure(cur.length > 1 ? `The opposite of “${w}” is “${cur[0]}”. Depending on the sense, it can also be ${join(cur.slice(1).map((x) => `“${x}”`), 'or')}.` : `The opposite of “${w}” is “${cur[0]}”.`);
  const tl = (I.S.tail.opp[w] || '').split('|').filter(Boolean);
  if (tl.length) return likely(`The opposite of “${w}” is “${tl[0]}”.${tl.length > 1 ? ` Other senses: ${join(tl.slice(1).map((x) => `“${x}”`))}.` : ''}`);
  const m = w.match(/^(un|in|im|dis|non|ir|il)([a-z]{3,})$/);
  if (m && known(m[2])) return likely(`The opposite of “${w}” is “${m[2]}”.`);
  return WEB;
}
function synonym(word) {
  const I = prep();
  const w = word.trim();
  const cur = I.S.words.syn[w];
  if (cur && cur.length) return sure(`Another word for “${w}” is “${cur[0]}”.${cur.length > 1 ? ` Others: ${join(cur.slice(1).map((x) => `“${x}”`))}.` : ''}`);
  const tl = (I.S.tail.syn[w] || '').split('|').filter((x) => x && x !== w);
  if (tl.length) return likely(`Words close in meaning to “${w}”: ${join(tl.slice(0, 4).map((x) => `“${x}”`))}. Which one fits depends on the sense you mean.`);
  return WEB;
}

/** "which animal can fly", "which bird cannot fly", "which animal has a trunk", "which is the largest animal" */
function reverse(cls, rel, phrase) {
  const I = prep();
  const q = I.canon(phrase);
  const qt = q.split(' ').filter((t) => !PREP.has(t) && t !== 'not');
  if (!qt.length) return null;
  const c = I.canon(cls);
  const hits = [];
  for (const t of I.things.values()) {
    if (c && c !== 'thing' && c !== 'creature' && !(t.key === c ? false : classNames(t.key).has(c) || (c === 'animal' && classNames(t.key).has('living thing') && !classNames(t.key).has('plant')))) continue;
    const list = t[rel] || [];
    const f = rel === 'has' ? findPart(list, q) : list.find((x) => phraseMatch(q, x.canon) || (rel === 'is' && qt.every((w) => x.canon.split(' ').some((y) => y === w || deinflect(y).includes(w) || deinflect(w).includes(y) || y === w + 'est'))) || (rel === 'sound' && x.canon.split(' ').includes(qt[0])));
    if (f) hits.push({ t, f });
  }
  if (!hits.length) return WEB;
  if (rel === 'is' && hits.length <= 3) return sure(hits.map((h) => `${NP(h.t.name)} ${be(h.t.name)} ${h.f.text}.`).join(' '));
  const names = hits.slice(0, 6).map((h) => np(h.t.name));
  const listed = hits.length > 6 ? `${names.join(', ')} and others` : join(names);
  const verb = { can: 'can', cannot: "can't", has: 'has', hasnot: 'has no', eats: 'eats', sound: 'makes the sound', at: 'is found in', gives: 'gives', is: 'is' }[rel] || rel;
  const obj = rel === 'has' ? itemText(hits[0].f) : hits[0].f.text;
  if (hits.length === 1) return sure(`${cap(names[0])} ${verb} ${obj}.`);
  return sure(`From what I know: ${listed}. Each of them ${verb} ${rel === 'has' ? hits[0].f.text : obj}.`);
}

// ---------------------------------------------------------------------------------------------------------------------
const CMP = 'bigger|larger|taller|longer|smaller|shorter|tinier|heavier|lighter|faster|quicker|slower|hotter|warmer|colder|cooler';
const SUP = 'biggest|largest|tallest|longest|smallest|shortest|heaviest|lightest|fastest|slowest|hottest|coldest';
const stripDet = (s) => s.split(' ').filter((t) => !DETS.has(t)).join(' ');

/**
 * Try to answer an everyday common-sense question.
 * @returns {{text:string,sure:boolean}|{web:true}|null}  null = not a common-sense question at all
 */
export function answer(text) {
  const I = prep();
  let m;
  const subj = (s) => wholeSubject(s);
  const viaSubject = (s, fn) => { const x = subj(s); return x ? fn(x) : WEB; };

  // opposites and synonyms
  if ((m = text.match(/^(?:what is |what s |what are |tell me |give me |say |do you know )?(?:the |an |a )?(?:opposite|antonym|opposite word|opposite meaning|antonyms)(?: word)? (?:of|for|to) (?:the word )?([a-z]+(?: [a-z]+)?)$/)) || (m = text.match(/^([a-z]+) (?:opposite|antonym|ka opposite|ko opposite)(?: word)?(?: kya hai| k ho)?$/)) || (m = text.match(/^what is opposite (?:of|to) ([a-z]+)$/))) return opposite(stripDet(m[1]));
  if ((m = text.match(/^(?:what is |what s |what are |tell me |give me |say |do you know )?(?:a |an |the |some )?(?:another word|other word|other words|different word|synonym|synonyms|similar word|similar words|same meaning word)(?: word)? (?:for|of|to|as) (?:the word )?([a-z]+)$/)) || (m = text.match(/^([a-z]+) (?:synonym|synonyms)$/)) || (m = text.match(/^what word means the same as ([a-z]+)$/))) return synonym(m[1]);

  // comparisons
  if ((m = text.match(new RegExp(`^(?:which|what|who) (?:is|are|one is|animal is|weighs|runs|goes|moves|of these is) (${CMP}|more)(?: in size)? (.+?) or (.+)$`))) || (m = text.match(new RegExp(`^(?:which|what|who) (?:one )?(?:is|are) (${CMP}) between (.+?) and (.+)$`)))) return compare(m[2], m[3], m[1] === 'more' ? 'heavier' : m[1], false);
  if ((m = text.match(new RegExp(`^(.+?) or (.+?) (?:which|who|what)(?: one)? is (${CMP})$`)))) return compare(m[1], m[2], m[3], false);
  if ((m = text.match(new RegExp(`^(?:is|are) (.+?) (${CMP}) than (.+)$`)))) return compare(m[1], m[3], m[2], true);
  if ((m = text.match(new RegExp(`^(?:which|what|who) (?:is|are) (?:the )?(${SUP}) (?:of these |among |out of |between )?(.+ (?:or|and) .+)$`)))) { const items = m[2].split(/ (?:or|and) /).flatMap((x) => x.split(/ (?=(?:a|an|the) )/)).map((x) => x.trim()).filter(Boolean); if (items.length >= 2) return superlative(items, m[1]); }

  // counting parts
  if ((m = text.match(/^how many (.+?) (?:does|do|did|has|have|are on|are in|are there on|are there in|on|in|is on|is in) (.+?)(?: have| has| got| possess)?$/))) {
    const team = / (team|side)$/.test(m[2]);
    const s = subj(m[2].replace(/ (team|side)$/, ''));
    if (s) return howMany(s, m[1], team ? `a ${s.name} team` : null);
    if (subj(m[1])) return WEB;
    return null;
  }

  // one-relation questions
  if ((m = text.match(/^what (?:color|colour) (?:is|are) (.+)$/)) || (m = text.match(/^what is the (?:color|colour) of (.+)$/)) || (m = text.match(/^(.+) (?:is|are) (?:what|which) (?:color|colour)$/)) || (m = text.match(/^which (?:color|colour) (?:is|are) (.+)$/)) || (m = text.match(/^(?:color|colour) of (.+)$/))) return viaSubject(m[1], (s) => listAnswer(s, 'color'));
  if ((m = text.match(/^what (?:do|does|did) (.+?) (?:eat|eats|feed on|like to eat)$/)) || (m = text.match(/^what is the food of (.+)$/))) return viaSubject(m[1], (s) => listAnswer(s, 'eats'));
  if ((m = text.match(/^what (?:sound|noise) (?:do|does) (.+?) (?:make|makes)$/)) || (m = text.match(/^what (?:do|does) (?:a |an |the )?(.+?) say$/)) || (m = text.match(/^what is the (?:sound|cry|call) of (.+)$/)) || (m = text.match(/^how (?:do|does) (.+?) sound$/)) || (m = text.match(/^(?:sound|cry) of (.+)$/))) { const s = subj(m[1]); return s ? listAnswer(s, 'sound') : (/ say$/.test(text) ? null : WEB); }
  if ((m = text.match(/^what (?:is|are) (.+?) (?:used|good|useful|meant) for$/)) || (m = text.match(/^what (?:do|does) (?:we|you|people|i|they|one) use (.+?) for$/)) || (m = text.match(/^what is the (?:use|purpose|function|job|work) of (.+)$/)) || (m = text.match(/^why (?:do|does) (?:we|you|people|i) (?:use|need) (.+)$/)) || (m = text.match(/^(?:use|uses) of (.+)$/)) || (m = text.match(/^what (?:can|do) (?:you|we|i|people) do with (.+)$/))) return viaSubject(m[1], (s) => listAnswer(s, 'used'));
  if ((m = text.match(/^what (?:is|are) (.+?) made (?:of|from|out of|up of|with)$/)) || (m = text.match(/^what (?:material )?(?:is|are) (.+?) made$/)) || (m = text.match(/^where (?:do|does) (.+?) come from$/)) || (m = text.match(/^what (?:do|does) (.+?) come from$/))) { const s = subj(m[1]); if (!s) return WEB; const r = listAnswer(s, 'made'); return r.web && / come from$/.test(text) ? WEB : r; }
  if ((m = text.match(/^where (?:do|does|did) (.+?) (?:live|stay|sleep|grow|work)$/)) || (m = text.match(/^where (?:is|are) (.+?) (?:found|kept|usually|normally|usually found|stored)$/)) || (m = text.match(/^where (?:can|do|would|could) (?:i|you|we|one) (?:find|see) (.+)$/)) || (m = text.match(/^(?:what|where) is the (?:home|house|habitat) of (.+)$/))) return viaSubject(m[1], (s) => listAnswer(s, 'at'));
  if ((m = text.match(/^what (?:is|are) (?:a|the) (?:baby|young|young one|young ones|child|children|offspring) (?:of )?(.+?) called$/)) || (m = text.match(/^what (?:do|would) (?:you|we|they) call (?:a|the) (?:baby|young|young one|child) (?:of )?(.+)$/)) || (m = text.match(/^what is (?:a|the) baby (.+?)(?: called)?$/)) || (m = text.match(/^(?:baby|young one|young ones|young) of (.+)$/)) || (m = text.match(/^what is (?:the )?(?:young one|young|baby|offspring) of (.+?)(?: called)?$/)) || (m = text.match(/^what is a (.+?) baby called$/))) return viaSubject(m[1], (s) => listAnswer(s, 'young'));
  if ((m = text.match(/^what (?:is|do you call|do we call) a (?:group|bunch|collection) of (.+?)(?: called)?$/)) || (m = text.match(/^(?:collective noun|group name) (?:for|of) (.+)$/))) return viaSubject(m[1], (s) => listAnswer(s, 'group'));
  if ((m = text.match(/^what is (?:a|the) (male|female) (.+?) called$/)) || (m = text.match(/^what (?:do|would) (?:you|we) call a (male|female) (.+)$/))) return viaSubject(m[2], (s) => listAnswer(s, m[1]));
  if ((m = text.match(/^what can (.+?) do$/))) { const s = subj(m[1]); return s ? listAnswer(s, 'can') : null; }
  if ((m = text.match(/^what (?:do|does) (.+?) have$/))) { const s = subj(m[1]); return s ? listAnswer(s, 'has') : null; }
  if ((m = text.match(/^what (?:do|does) (.+?) need(?: to (?:live|grow|survive))?$/))) { const s = subj(m[1]); return s ? listAnswer(s, 'needs') : null; }
  if ((m = text.match(/^what (?:do|does) (.+?) give(?: us)?$/)) || (m = text.match(/^what do we get from (.+)$/))) { const s = subj(m[1]); return s ? listAnswer(s, 'gives') : null; }
  if ((m = text.match(/^what (?:do|does) (.+?) do$/))) { const s = subj(m[1]); if (!s || !s.core) return null; const r = s.core.can && s.core.can.length ? listAnswer(s, 'can') : listAnswer(s, 'used'); return r.web ? null : r; }

  // which animal ...
  if ((m = text.match(/^(?:which|what) (animal|bird|fish|insect|mammal|reptile|fruit|vegetable|planet|metal|flower|thing|creature|food|vehicle|instrument|sport|sea animal|big cat) (.+)$/))) {
    const cls = m[1], rest = m[2];
    let r;
    if ((r = rest.match(/^(?:can not|cannot|can t|cant|does not|do not) (.+)$/))) return reverse(cls, 'cannot', r[1]);
    if ((r = rest.match(/^can (.+)$/))) return reverse(cls, 'can', r[1]);
    if ((r = rest.match(/^(?:has|have) no (.+)$/))) return reverse(cls, 'hasnot', r[1]);
    if ((r = rest.match(/^(?:has|have|has got) (.+)$/))) return reverse(cls, 'has', r[1]);
    if ((r = rest.match(/^(?:says|goes|makes the sound|makes a|sounds like) (.+?)(?: sound)?$/))) return reverse(cls, 'sound', r[1]);
    if ((r = rest.match(/^(?:eats|eat) (.+)$/))) return reverse(cls, 'eats', r[1]);
    if ((r = rest.match(/^(?:lives|live|is found) (?:in|on|at) (.+)$/))) return reverse(cls, 'at', r[1]);
    if ((r = rest.match(/^(?:gives|give) (?:us )?(.+)$/))) return reverse(cls, 'gives', r[1]);
    if ((r = rest.match(/^(?:is|are) (?:called |known as )?(.+)$/))) return reverse(cls, 'is', r[1]);
    if ((r = rest.match(/^(lays eggs|gives milk|barks|roars|meows|flies|swims|hops|stings|hoots|quacks|moos|neighs|howls|croaks|buzzes|hisses)$/))) return reverse(cls, 'can', singular(r[1].split(' ')[0], known) + (r[1].includes(' ') ? ' ' + r[1].split(' ').slice(1).join(' ') : ''));
    return WEB;
  }
  if ((m = text.match(new RegExp(`^(?:which|what) is the (${SUP}) (animal|bird|land animal|cat|bear|planet|mammal|fish)(?: in the world| on earth| on land)?$`)))) return reverse(m[2].includes('animal') ? 'animal' : m[2], 'is', `${m[1]} ${m[2]}`);

  // yes/no questions about a thing
  if ((m = text.match(/^(?:can|could) (.+)$/))) {
    const toks = m[1].split(' ');
    if (/^(you|u|we|i|people|humans|human|person|someone|anyone|one)$/.test(toks[0]) && /^(eat|drink)$/.test(toks[1] || '') && toks.length > 2) { const s = subj(toks.slice(2).join(' ')); return s ? (toks[1] === 'eat' ? edible(s, /^(you|u)$/.test(toks[0])) : WEB) : (/^(you|u)$/.test(toks[0]) ? null : WEB); }
    const s = splitSubject(toks);
    if (!s) return PRON.test(toks.find((t) => !DETS.has(t)) || '') ? null : WEB;
    if (s.rest[0] === 'be' && s.rest[1] === 'eaten') return edible(s, false);
    return capability(s, I.canon(s.rest.join(' ')));
  }
  if ((m = text.match(/^(?:do|does|did) (.+)$/))) {
    const toks = m[1].split(' ');
    const s = splitSubject(toks);
    if (!s) return PRON.test(toks.find((t) => !DETS.has(t)) || '') ? null : WEB;
    const v = s.rest[0], obj = s.rest.slice(1).join(' ');
    if (/^(have|has|got|possess)$/.test(v) && obj) return possession(s, I.canon(obj));
    if (/^(eat|eats)$/.test(v) && obj && s.core) {
      const o = I.canon(obj);
      if ((s.core.eats || []).some((x) => x.canon.split(' ').some((w) => o.split(' ').includes(w)))) return sure(`Yes. ${NP(s.name)} eats ${join(s.core.eats.map((x) => x.text))}.`);
      const diet = (s.core.is || []).find((x) => /herbivore|carnivore/.test(x.canon));
      if (diet && /herbivore/.test(diet.canon) && MEAT_FOOD.test(obj.split(' ').pop())) return sure(`No. ${NP(s.name)} is a herbivore${s.core.eats ? `; it eats ${join(s.core.eats.map((x) => x.text))}` : ''}.`);
      if (diet && /carnivore/.test(diet.canon) && PLANT_FOOD.test(obj.split(' ').pop())) return sure(`Not as a rule. ${NP(s.name)} is a carnivore${s.core.eats ? `; it eats ${join(s.core.eats.map((x) => x.text))}` : ''}.`);
      return WEB;
    }
    if (/^(live|lives)$/.test(v) && /^(in|on|at|under) /.test(obj)) { const o = I.canon(obj.replace(/^(in|on|at|under) /, '')); if (s.core && (s.core.at || []).some((x) => x.canon === o || x.canon.endsWith(' ' + o))) return sure(`Yes. ${NP(s.name)} is usually found in ${join(s.core.at.slice(0, 4).map((x) => x.text))}.`); return WEB; }
    return capability(s, I.canon(s.rest.join(' ')));
  }
  if ((m = text.match(/^(?:is|are|was|were) (.+)$/))) {
    const toks = m[1].split(' ');
    const s = splitSubject(toks);
    if (!s) return PRON.test(toks.find((t) => !DETS.has(t)) || '') ? null : WEB;
    const rest = s.rest.join(' ');
    let r;
    if ((r = rest.match(/^made (?:of|from|out of|up of|with) (.+)$/))) {
      const o = I.canon(r[1]);
      const made = s.core && s.core.made ? s.core.made : tailList('made', s.key).map((x) => ({ text: x, canon: I.canon(x) }));
      if (!made.length) return WEB;
      const hit = made.find((x) => x.canon.split(' ').some((w) => o.split(' ').includes(w)));
      const what = join(made.map((x) => x.text));
      return (s.core ? sure : likely)(hit ? `Yes. ${NP(s.name)} ${be(s.name)} made from ${what}.` : `No. ${NP(s.name)} ${be(s.name)} made from ${what}.`);
    }
    if ((r = rest.match(/^used (?:for|to|as|in) (.+)$/))) { const o = I.canon(r[1].replace(/ing\b/g, '')); const used = s.core && s.core.used ? s.core.used : []; const hit = used.find((x) => x.canon.replace(/ing\b/g, '').split(' ').some((w) => w.length > 2 && o.split(' ').some((y) => y.startsWith(w.slice(0, Math.max(3, w.length - 1)))))); return hit ? sure(`Yes. ${NP(s.name)} ${be(s.name)} used for ${join(used.map((x) => x.text))}.`) : WEB; }
    if (/^(alive|living|a living thing|living thing|living or non living|living or nonliving|dead|non living|a living being|living being)$/.test(rest)) return alive(s);
    if (/^(edible|eatable|safe to eat|food|good to eat|something you can eat)$/.test(rest)) return edible(s, false);
    if ((r = rest.match(/^(?:a|an) (?:kind|type|sort|form|species) of (.+)$/))) return membership(s, stripDet(r[1]));
    if ((r = rest.match(/^(?:a|an|the) (.+)$/))) { const c = r[1]; const cc = I.canon(c); const prop = property(s, c); if (!prop.web && (COLORS.has(cc) || TASTES.has(cc))) return prop; const mem = membership(s, c); return mem.web ? (prop.web ? WEB : prop) : mem; }
    if (!rest) return null;
    // plural class ("are spiders insects") or a quality ("is fire hot")
    const rc = I.canon(rest);
    if (thingOf(rc) || /s$/.test(rest) && I.S.tail.isa[rc]) { const mem = membership(s, rc); if (!mem.web) return mem; }
    const prop = property(s, rest);
    if (!prop.web) return prop;
    const mem = membership(s, rc);
    return mem.web ? WEB : mem;
  }
  return null;
}

/** Things the brain can describe from its core (for tests and for the "about" text). */
export function coreSize() { const I = prep(); return { things: I.things.size, meta: I.S.meta }; }
