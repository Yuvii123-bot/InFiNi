// INFINI AI — brain: turns informal chat text ("heyyy hw r u??") into plain tokens ("hey how are you").
// Deterministic string rules only. `known(word)` is supplied by the caller (pattern vocabulary + general word list).

import { CHAT, FILLER, ADDRESS, EMOJI, EMOTICONS, EMOJI_WORD } from './lexicon.js';

const CONTRACTIONS = [
  [/\bcan't\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/\bshan't\b/g, 'shall not'], [/\bain't\b/g, 'is not'], [/\by'all\b/g, 'you all'], [/\blet's\b/g, 'let us'], [/\bc'mon\b/g, 'come on'], [/\bma'am\b/g, 'madam'],
  [/n't\b/g, ' not'], [/'re\b/g, ' are'], [/'ve\b/g, ' have'], [/'ll\b/g, ' will'], [/\bi'm\b/g, 'i am'], [/'m\b/g, ' am'], [/\b(i|you|he|she|we|they|it|that|who|what|there)'d\b/g, '$1 would'],
  [/\b(it|he|she|that|what|who|where|when|why|how|there|here|this|everything|something|nothing|everyone|someone|name|one)'s\b/g, '$1 is'],
  [/'s\b/g, ''], [/s'(?=\s|$)/g, 's'],
];
const LAUGH = /^(?:a*(?:ha){2,}h*a*|(?:he){2,}h*|(?:hi){2,}h*|(?:ho){2,}|b?w?a(?:ha){2,}|l+o+l+(?:ol)*z*|lul+|(?:ja){2,}|k{3,}|x+d+|ahah+a*|hah+|heh+)$/;
const PICTO = /\p{Extended_Pictographic}/u;

/** Collapse letter runs ("heyyyy" → "hey", "goood" → "good"). Prefers a known word; two letters win over one when both exist. */
function squeeze(w, known) {
  if (!/(.)\1/.test(w) || known(w)) return w;
  if (/(.)\1\1/.test(w)) {
    const two = w.replace(/(.)\1{2,}/g, '$1$1');
    if (known(two)) return two;
    const one = w.replace(/(.)\1+/g, '$1');
    if (known(one)) return one;
    const mixed = two.replace(/(.)\1$/, '$1');
    if (known(mixed)) return mixed;
    return two;
  }
  const tail = w.replace(/(.)\1$/, '$1');                 // "heyy", "byee", "thankss"
  return tail !== w && known(tail) ? tail : w;
}

/**
 * @returns {{raw:string,text:string,tokens:string[],question:boolean,exclaim:number,emoji:string[],onlyEmoji:boolean,hasUrl:boolean,caps:string[]}}
 */
export function normalize(raw, known = () => false) {
  let s = String(raw == null ? '' : raw).normalize('NFKC').slice(0, 600);
  const hasUrl = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i.test(s);
  const caps = (s.match(/\b[A-Z][a-z]{1,20}\b/g) || []).slice(0, 12);          // capitalised words, used to recognise names
  const emoji = [];
  for (const [re, cls] of EMOTICONS) s = s.replace(re, (m, lead) => { emoji.push(cls); return lead || ' '; });
  let out = '';
  for (const ch of s) {
    if (EMOJI.has(ch)) { emoji.push(EMOJI.get(ch)); out += ' '; }
    else if (PICTO.test(ch) || ch === '\uFE0F' || ch === '\u200D' || (ch >= '\u{1F3FB}' && ch <= '\u{1F3FF}')) out += ' ';
    else out += ch;
  }
  s = out.toLowerCase().replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"');
  const question = /\?/.test(s);
  const exclaim = (s.match(/!/g) || []).length;
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  s = s.replace(/'/g, '').replace(/(\d)[,](?=\d{3}\b)/g, '$1').replace(/[^\p{L}\p{N}+\-*/=%.^]+/gu, ' ').replace(/(^|\s)[.\-*/=%^+]+(?=\s|$)/g, ' ').replace(/([a-z])[.]+(?=\s|$)/g, '$1').replace(/[.]{2,}/g, ' ');
  let tokens = [];
  const words = s.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let w = words[i].replace(/^[-+*/=.^%]+(?=[a-z])|(?<=[a-z])[-+*/=.^%]+$/g, '');
    if (!w) continue;
    if (/^[a-z]+(?:-[a-z]+)+$/.test(w) && !known(w)) { words.splice(i + 1, 0, ...w.split('-')); continue; }
    if (/^[a-z]+$/.test(w)) {
      if (LAUGH.test(w) && w !== 'hi' && w !== 'ho' && w !== 'he') w = 'lol';
      else if (!CHAT.has(w)) w = squeeze(w, (x) => CHAT.has(x) || known(x));
      if (w === 'ya') w = words.length === 1 ? 'yes' : 'you';
      else if (w === 'm' && tokens[tokens.length - 1] === 'i') w = 'am';
      else if (w === 'y' && (words.length === 1 || /^(not|so|is|are|do|did|you|u|r)$/.test(words[i + 1] || ''))) w = 'why';
      else if (w === 'n' && i > 0 && i < words.length - 1) w = 'and';
      else if (CHAT.has(w)) w = CHAT.get(w);
    }
    for (const part of w.split(' ')) if (part) tokens.push(part);
  }
  if (tokens.length >= 2 && tokens.every((t) => /^(ha|he|ho|hah|heh|hee|lol)$/.test(t))) tokens = ['lol'];          // "ha ha ha"
  tokens = tokens.filter((t, i) => i === 0 || t !== tokens[i - 1] || /^\d/.test(t) || t === 'ram' || t === 'radhe');          // "hi hi hi" → "hi" (but "ram ram" is a greeting, "ram" a name)
  const onlyEmoji = !tokens.length && emoji.length > 0;
  if (onlyEmoji) tokens = (EMOJI_WORD[emoji[0]] || 'nice').split(' ');
  return { raw: String(raw == null ? '' : raw), text: tokens.join(' '), tokens, question, exclaim, emoji, onlyEmoji, hasUrl, caps };
}

/** Token variants to try when matching: the message as written, without filler words, and without vocatives at either end. */
export function variants(tokens) {
  const seen = new Set(), out = [];
  const add = (t) => { if (!t.length) return; const k = t.join(' '); if (!seen.has(k)) { seen.add(k); out.push(t); } };
  add(tokens);
  const noFill = tokens.filter((t) => !FILLER.has(t));
  add(noFill);
  for (const base0 of [tokens, noFill]) {
    let base = base0;
    { // "... my good friend", "... dear sir"
      let k = base.length;
      if (k > 1 && ADDRESS.has(base[k - 1])) { k--; while (k > 1 && /^(my|dear|old|little|good|sweet|best|lovely|dearest|great|kind|young)$/.test(base[k - 1])) k--; if (k < base.length - 1 && k >= 1) { base = base.slice(0, k); add(base); } }
    }
    { // "i think you are wrong", "honestly that was great"
      const s = base.join(' ').replace(/^(?:(?:i think|i feel like|i believe|i guess|i suppose|i feel|it seems like|it seems|seems like|looks like|it looks like|i would say|i must say|i have to say|to be honest|no offense but|no offence but|in my opinion|personally|i mean|you know what|you know|i said|i say|i told you|by the way|just so you know|for the record|let me tell you|i just wanted to say|i wanted to say|i want to say|i just want to say) )+(?:that )?/, '');
      if (s && s !== base.join(' ')) { const h = s.split(' '); add(h); if (h.length > 1 && ADDRESS.has(h[h.length - 1])) add(h.slice(0, -1)); }
    }
    let t = base;
    if (t.length > 1 && ADDRESS.has(t[t.length - 1])) { t = t.slice(0, -1); add(t); }
    if (t.length > 1 && ADDRESS.has(t[t.length - 1])) { t = t.slice(0, -1); add(t); }
    if (base.length > 1 && ADDRESS.has(base[0])) { add(base.slice(1)); if (t !== base && t.length > 1) add(t.slice(1)); }
  }
  return out;
}

/** Damerau–Levenshtein distance with an early exit above `max`. */
export function editDistance(a, b, max = 2) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[m];
}

const IRREGULAR = new Map(Object.entries({ children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose', oxen: 'ox', people: 'person', lice: 'louse', dice: 'die', cacti: 'cactus', fungi: 'fungus', leaves: 'leaf', wolves: 'wolf', knives: 'knife', lives: 'life', wives: 'wife', shelves: 'shelf', halves: 'half', calves: 'calf', thieves: 'thief', loaves: 'loaf', hooves: 'hoof', elves: 'elf', scarves: 'scarf', dwarves: 'dwarf', selves: 'self', potatoes: 'potato', tomatoes: 'tomato', heroes: 'hero', echoes: 'echo', mosquitoes: 'mosquito', volcanoes: 'volcano', buses: 'bus', gases: 'gas', lenses: 'lens', horses: 'horse', houses: 'house', noses: 'nose', roses: 'rose', cases: 'case', bases: 'base', vases: 'vase', phones: 'phone', shoes: 'shoe', toes: 'toe', movies: 'movie', cookies: 'cookie', zombies: 'zombie', pies: 'pie', ties: 'tie', cheeses: 'cheese', geese2: 'goose', bees: 'bee', trees: 'tree', knees: 'knee', eyes: 'eye', axes: 'axe', oases: 'oasis', pennies: 'penny', monkeys: 'monkey', mouses: 'mouse', sheep: 'sheep', fish: 'fish', deer: 'deer', species: 'species', series: 'series' }));
const KEEP_S = new Set('gas bus lens plus yes this his is was has does always perhaps news its us as thus less across chaos canvas atlas bias christmas mathematics maths physics economics politics athletics tennis chess glasses scissors pants trousers jeans shorts clothes pajamas pyjamas binoculars pliers tongs headphones goggles stairs thanks congratulations mumps measles diabetes rabies means riches surroundings outskirts belongings earnings savings mars venus uranus jesus texas paris wales athens cactus fungus virus bonus campus circus focus genius octopus status surplus walrus hippopotamus platypus rhinoceros iris tennis crisis basis analysis oasis thesis diagnosis emphasis kiss boss class glass grass dress cross loss mass pass business address success process princess happiness darkness illness compass mess chess guess stress press gross moss bass brass dennis alias pancreas lotus cosmos albatross sunglasses eyeglasses leggings tights overalls swimming trunks alms odds remains customs goods'.split(' '));

/** Light singular form for common-sense lookups ("birds" → "bird", "wolves" → "wolf", "flies" → "fly"). `known` (optional) vetoes results that are not words. */
export function singular(w, known = null) {
  if (IRREGULAR.has(w)) return IRREGULAR.get(w);
  if (w.length < 4 || KEEP_S.has(w) || !w.endsWith('s') || /(ss|us|is|ous|ics)$/.test(w)) return w;
  let out;
  if (/[^aeiou]ies$/.test(w) && w.length > 4) out = w.slice(0, -3) + 'y';
  else if (/(ches|shes|sses|xes|zzes)$/.test(w)) out = w.slice(0, -2);
  else out = w.slice(0, -1);
  if (known && !known(out)) { if (/es$/.test(w) && known(w.slice(0, -2))) return w.slice(0, -2); return known(w) ? w : out; }
  return out;
}
