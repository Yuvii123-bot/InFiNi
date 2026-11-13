// INFINI AI — the vocabulary of the answers (research runs).
// When many sources have been read, the sentences that match the question best share a vocabulary the question did not
// contain: for "health effects of microplastics" it is inflammation, oxidative stress, ingestion, toxicity and so on.
// Words that recur across independent sources there, and are not everyday or generic academic words, are the key terms.
// They are used for two things, both by rule: a sentence that names several of them is preferred to one that only
// repeats the question ("more research on the health effects is needed"), and they are offered as sub-topics.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STOPWORDS, stem, tokenize } from '../util/text.js';

const GENERIC = new Set(('study studies studied research researchers researched review reviews reviewed paper papers article articles report reports reported result results resulted finding findings found evidence data analysis analyses method methods approach approaches ' +
  'effect effects impact impacts potential potentially possible possibly increase increased increasing decrease decreased level levels high higher low lower large small significant significantly important importance major main common commonly different various several many ' +
  'include includes including included such also however therefore although thus moreover furthermore according based related associated due using used use uses show shows shown showed suggest suggests suggested indicate indicates indicated demonstrate demonstrated ' +
  'recent recently current currently present presence new novel future further additional previous previously first second well known understanding understand knowledge information overview summary introduction conclusion conclusions discussion background abstract ' +
  'year years time number numbers amount range type types kind form forms part parts role case cases example examples area areas field terms term way ways need needs needed concern concerns issue issues problem problems question questions factor factors process processes ' +
  'human humans people person world global worldwide environment environmental system systems source sources group groups point change changes work works total average overall general particular especially mainly often may might could can will would should must ' +
  'adverse negative positive harmful detrimental deleterious beneficial severe serious substantial considerable numerous multiple diverse widespread ubiquitous emerging growing rising highlight highlights highlighted emphasize emphasized reveal revealed reveals observed observe exhibit exhibited ' +
  'one two three four five ten among between within across through during after before since while when where which that this these those there their they them than then into onto from with without about over under more most less least very much each every both either other others another same').split(/\s+/).map((w) => stem(w)));

let STEM_RANK = null;
/** Position of a word in the built-in frequency list (everyday English, most frequent first), by stem. */
function stemRank(st) {
  if (!STEM_RANK) {
    STEM_RANK = new Map();
    try {
      const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'brain', 'data', 'vocab.txt');
      const words = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < words.length; i++) { const w = words[i]; if (w.length < 3) continue; const k = stem(w); if (!STEM_RANK.has(k)) STEM_RANK.set(k, i + 1); }
    } catch { /* without the list every word counts as uncommon */ }
  }
  return STEM_RANK.get(st) || 0;
}
/** 0.15 (an everyday word) … 1 (not among the 31,000 most frequent everyday words). */
const OPENS_WITH_GAP = /^(?:however,? |yet,? |but,? |still,? |to date,? |so far,? |at present,? |currently,? )?(?:(?:very |relatively |comparatively |surprisingly )?(?:little|less|not much|nothing) is (?:\w+ly |yet |still )?known|it (?:is|remains) (?:still |yet |currently |largely |also )?(?:unclear|unknown|uncertain|not (?:yet |well |fully |currently )?(?:known|clear|understood))|there (?:is|are|remains?|has been|have been) (?:still |currently |only |very )?(?:limited|little|scarce|scant|insufficient|no|few|a lack of|a paucity of) )/i;

export function rarity(st) {
  const r = stemRank(st);
  if (!r) return 1;
  return Math.max(0.15, Math.min(1, Math.log10(r + 1) / 4.4));
}

/**
 * Key terms of the best-matching sentences. ranked.sentences: best first; docs[di].group / origin identify independent sources.
 * Returns { terms: Map(stem → weight 0..1), list: [{stem, word, weight, origins}], norm } or null when there is too little material.
 */
export function keyTerms(ranked, docs, qm, { max = 40, pool = 500, minShare = 0.05 } = {}) {
  const S = ranked.sentences;
  if (S.length < 30) return null;
  const top = S[0].score;
  const originOf = (di) => (docs[di].group != null ? `g${docs[di].group}` : docs[di].origin);
  const origins = new Map();          // stem → Set(origin)
  const objects = new Map();          // stem → Set(origin) where the word stands on the answering side of the sentence
  const forms = new Map();            // stem → Map(word → count)
  const nears = new Map();            // stem → Set(origin) where the word stands directly beside the topic's name
  const focusSet = new Set(tokenize(String((qm.part && qm.part.focus) || '')).filter((w) => !STOPWORDS.has(w)).map(stem));
  const all = new Set();
  // "What are the effects / causes / risks / uses of X?": in a sentence that states the relation, what follows the relating
  // word names the answer ("… can cause inflammation, oxidative stress and …"); what precedes it mostly describes the topic.
  const sided = !!qm.relCue;
  let n = 0;
  for (const s of S) {
    if (n >= pool || s.score < top * 0.3) break;
    if (s.proc || s.gap || s.intro || /\?\s*$/.test(s.text) || docs[s.di].offTopic) continue;
    n++;
    const o = originOf(s.di);
    all.add(o);
    let cut = -1;
    if (sided) { const m = qm.relCue.exec(s.text) || ENUM_CUE.exec(s.text); if (m) cut = m.index + m[0].length; }
    const objSide = cut >= 0 ? new Set(tokenize(s.text.slice(cut)).map(stem)) : null;
    // words that stand directly beside the topic's name ("microplastic pollution", "exposure to microplastics", "MPs exposure")
    // describe the topic rather than answer the question about it
    const raw = s.text.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
    const topicLike = raw.map((t) => { const l = t.toLowerCase().replace(/[’']s$/, ''); return focusSet.has(stem(l)) || l.split('-').some((x) => focusSet.has(stem(x))) || /^[A-Z]{2,5}s?$/.test(t); });
    const beside = new Set();
    raw.forEach((t, i) => {
      if (topicLike[i]) return;
      if (topicLike[i - 1] || topicLike[i + 1] || (topicLike[i + 2] && /^(?:of|to|from|by|with|in)$/i.test(raw[i + 1] || ''))) beside.add(stem(t.toLowerCase()));
    });
    for (const w of tokenize(s.text)) {
      if (w.length < 4 || w.length > 24 || STOPWORDS.has(w) || !/^[a-z][a-z-]*$/.test(w)) continue;
      const st = stem(w);
      if (qm.terms.has(st) && qm.terms.get(st).core) continue;
      if (GENERIC.has(st)) continue;
      let set = origins.get(st); if (!set) origins.set(st, (set = new Set()));
      set.add(o);
      if (beside.has(st)) { let nb = nears.get(st); if (!nb) nears.set(st, (nb = new Set())); nb.add(o); }
      if (objSide && objSide.has(st)) { let ob = objects.get(st); if (!ob) objects.set(st, (ob = new Set())); ob.add(o); }
      let f = forms.get(st); if (!f) forms.set(st, (f = new Map()));
      f.set(w, (f.get(w) || 0) + 1);
    }
  }
  const N = all.size;
  if (N < 6) return null;
  const need = Math.max(3, Math.ceil(N * minShare));
  const list = [];
  for (const [st, set] of origins) {
    if (set.size < need) continue;
    const share = set.size / N;
    const obj = objects.has(st) ? objects.get(st).size : 0;
    let weight = Math.sqrt(Math.min(1, share * 2)) * rarity(st) ** 3;
    if (sided) weight *= 0.55 + 0.9 * (obj / set.size);          // a word that mostly stands where the answers stand outweighs one that describes the topic
    if (weight < 0.12) continue;
    const word = [...forms.get(st)].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    list.push({ stem: st, word, weight: Math.min(1, weight), origins: set.size, obj, near: nears.has(st) ? nears.get(st).size : 0 });
  }
  list.sort((a, b) => b.weight - a.weight);
  const kept = list.slice(0, max);
  if (kept.length < 5) return null;
  const terms = new Map(kept.map((k) => [k.stem, k.weight]));
  const norm = kept.slice(0, 5).reduce((a, k) => a + k.weight, 0) || 1;
  return { terms, list: kept, norm, origins: N, sided };
}

/**
 * Prefer sentences that carry the answers' vocabulary. Each sentence gets `sal` (0..1); its score is raised by up to 60 %.
 * A sentence that states the asked relation in other words ("X causes …") and names key terms counts as addressing the question.
 */
const ENUM_CUE = /\b(?:includ(?:e|es|ed|ing)|such as|namely|ranging from|e\.g\.|for example|for instance)\b/i;
const PLAIN_MODIFIER = new Set('early earlier late later ancient medieval modern former old new great greater entire whole northern southern eastern western central upper lower imperial classical contemporary present future original first second last final real true so-called both many most some all any each every other another such only main major minor same'.split(' '));

export function applySalience(ranked, docs, qm, opts) {
  if (ranked.salience !== undefined) return ranked.salience;
  const keys = keyTerms(ranked, docs, qm, opts);
  ranked.salience = keys;
  if (!keys) { for (const s of ranked.sentences) s.gapOnly = !!s.gap; return null; }
  // Is the page about this, or does it only mention it? Judged from its title: the share of the title's own words that
  // belong to the question or to the answers' vocabulary ("Nursing students' awareness of …" shares little).
  const fit = docs.map((d) => {
    if (d.entity || d.structured) return 1;
    const st = [...new Set(tokenize(d.title || '').filter((w) => w.length >= 3 && !STOPWORDS.has(w)).map(stem))].filter((x) => !GENERIC.has(x));
    if (st.length < 3) return 1;
    let hit = 0;
    for (const x of st) if (qm.terms.has(x) || keys.terms.has(x)) hit++;
    return 0.62 + 0.38 * Math.min(1, hit / st.length / 0.5);
  });
  // "the Holy Roman Empire" when the Roman Empire was asked about: the topic's name inside a longer proper name that the
  // answering sources hardly use. ("Western Roman Empire" is used by many of them, so it belongs to the answers' vocabulary.)
  const focusText = String((qm.part && qm.part.focus) || '').trim();
  let longerName = null;
  if (focusText.length >= 4 && /^[\p{L}\p{N} .'’-]+$/u.test(focusText)) longerName = new RegExp(`\\b([A-Z][a-z]{2,})\\s+${focusText.replace(/[.]/g, '\\.').replace(/\s+/g, '\\s+')}\\b`, 'gi');
  // "Health effects of particulate matter are …" when the health effects of microplastics were asked about: the asked
  // property is stated of something else, and the sentence does not name the topic. What follows "of" is compared with
  // the question, the answers' vocabulary and short forms in capitals ("MPs").
  const attrWords = tokenize(String((qm.part && qm.part.attribute) || '')).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const attrHead = attrWords.length && focusText ? attrWords[attrWords.length - 1].replace(/(?:ies|es|s)$/, '') : '';
  const ofOther = attrHead.length >= 4 ? new RegExp(`\\b${attrHead}[a-z]{0,3}\\s+(?:of|from)\\s+(?:the\\s+|an?\\s+|these\\s+|this\\s+|such\\s+|its\\s+|their\\s+)?([\\p{L}][\\p{L}-]*)(?:\\s+([\\p{L}][\\p{L}-]*))?`, 'iu') : null;
  const focusStems = [...new Set(tokenize(focusText).filter((w) => !STOPWORDS.has(w)).map(stem))];
  const ownWord = (w) => { if (!w) return false; const st = stem(w.toLowerCase()); return qm.terms.has(st) || keys.terms.has(st) || GENERIC.has(st) || /^[A-Z]{2,}s?$/.test(w) || PLAIN_MODIFIER.has(w.toLowerCase()) || /^(?:long|short|chronic|acute|prolonged|dietary|oral|daily|regular|early|maternal|prenatal|occupational|low|high|excess|excessive)(?:-term)?$/i.test(w); };
  // A question about health asks, unless it says otherwise, about people: findings in fish, mice or cell cultures are evidence
  // but rank below statements about humans or about no particular organism.
  const HEALTH_Q = /\b(?:health|healthy|unhealthy|safe|safety|harmful|dangerous|toxic|disease|diseases|illness|cancer|symptoms?|side effects?|risks?|treatment|treatments|therapy|diet|diets|dieting|nutrition|medical|medicine|mortality|life expectancy|pregnan\w+|mental|weight|obesity|obese|fasting|exercise|sleep|vitamins?|supplements?|drugs?|medications?|vaccines?|blood pressure|cholesterol|diabetes|heart|stroke|dementia|alzheimer\w*|depression|anxiety|allerg\w+|asthma|pain|infections?|virus|covid\w*|flu|smoking|vaping|alcohol|caffeine|sugar|salt|keto\w*|vegan|vegetarian|longevity|ageing|aging)\b/i;
  const NONHUMAN = /\b(?:fish|fishes|zebrafish|mice|mouse|murine|rats?|rodents?|rabbits?|pigs?|piglets?|chickens?|poultry|livestock|cattle|cows?|sheep|dogs?|cats?|birds?|seabirds?|turtles?|whales?|dolphins?|seals?|mussels?|oysters?|clams?|bivalves?|shrimps?|prawns?|crabs?|crustaceans?|copepods?|daphnia|plankton|zooplankton|phytoplankton|algae|microalgae|corals?|invertebrates?|earthworms?|worms?|nematodes?|insects?|bees|honeybees?|larvae|larval|tadpoles?|amphibians?|reptiles?|wildlife|biota|fauna|flora|marine (?:life|organisms?|animals?|species|biota|ecosystems?)|aquatic (?:life|organisms?|animals?|species|biota|ecosystems?|environments?)|freshwater|seawater|ecosystems?|ecological|soil|soils|crops?|plants|seedlings?|animal models?|in animals|animal stud(?:y|ies))\b/i;
  const HUMAN = /\b(?:humans?|people|persons?|patients?|adults?|children|child|infants?|babies|women|men|mothers?|pregnan\w+|workers?|consumers?|individuals|volunteers|participants|population|public health|our bod(?:y|ies)|the body|human bod(?:y|ies)|placenta|breast milk|blood|epidemiolog\w+|clinical)\b/i;
  const qText = String((qm.part && (qm.part.core || qm.part.text)) || '');
  const peopleAsked = HEALTH_Q.test(qText) && !NONHUMAN.test(qText) && !/\b(?:animals?|pets?|veterinar\w+|environment\w*|ecolog\w+|species|organisms?)\b/i.test(qText);
  for (const s of ranked.sentences) {
    if (ofOther && s.score > 0 && !focusStems.every((f) => s.stems.has(f))) {
      const m = ofOther.exec(s.text);
      if (m && !ownWord(m[1]) && !ownWord(m[2])) { s.otherEntity = true; s.score *= 0.45; }
    }
    if (peopleAsked && s.score > 0 && NONHUMAN.test(s.text) && !HUMAN.test(s.text)) { s.nonHuman = true; s.score *= 0.62; }
    if (longerName && s.score > 0) {
      longerName.lastIndex = 0;
      let m, own = false, foreign = false;
      const bare = new RegExp(`\\b${focusText.replace(/[.]/g, '\\.').replace(/\s+/g, '\\s+')}\\b`, 'gi');
      const total = (s.text.match(bare) || []).length;
      let prefixed = 0;
      while ((m = longerName.exec(s.text))) {
        if (!/^[A-Z]/.test(m[1])) continue;                               // the regular expression ignores case for the topic itself; the word before it must be capitalised
        const w = m[1].toLowerCase(), st = stem(w);
        if (m.index === 0 || STOPWORDS.has(w) || PLAIN_MODIFIER.has(w) || qm.terms.has(st) || keys.terms.has(st)) { own = true; continue; }
        prefixed++; foreign = true;
      }
      if (foreign && !own && prefixed >= total) { s.otherEntity = true; s.score *= 0.45; }
    }
    const ws = [];
    for (const st of s.stems) { const w = keys.terms.get(st); if (w) ws.push(w); }
    ws.sort((a, b) => b - a);
    const sal = ws.length ? Math.min(1, ws.slice(0, 5).reduce((a, b) => a + b, 0) / keys.norm) : 0;
    s.sal = sal;
    // "… linked to respiratory disease and inflammation, but it is not known whether …" still reports findings;
    // "Little is presently known about the benefits and the challenges of …" does not, however many of the answers' words follow
    s.gapOnly = !!s.gap && (OPENS_WITH_GAP.test(s.text) || !(s.rel && sal >= 0.3));
    s.score *= (sal > 0 ? 1 + 0.6 * sal : 0.8) * fit[s.di] * (s.intro ? 0.55 : 1);          // none of the answers' vocabulary at all: probably about something else; "… has attracted growing attention" opens a text and reports nothing
    if (s.rel && sal >= 0.25 && s.predCov < 0.6) s.predCov = 0.6;
  }
  ranked.sentences.sort((a, b) => b.score - a.score);
  return keys;
}
