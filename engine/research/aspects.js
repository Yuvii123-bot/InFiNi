// INFINI AI — sub-topics ("aspects") of a research question, found in the material itself.
// Nothing here is invented: a sub-topic is a section heading of the encyclopedia article about the topic, a heading
// that pages from several independent sites share, or a phrase that keeps recurring in the most relevant sentences.
// Sub-topics drive the follow-up searches of a research run and become the sections of its report.

import { STOPWORDS, tokenize, stem, capitalize, squash } from '../util/text.js';
import { stemsOf } from '../rank/rank.js';
import { GENERIC_HEADING } from './digest.js';
import { rarity } from './salience.js';

const WEAK = new Set(('also many much however according including include includes such various used using use based new one two three first second may can could would should like well just even still often usually generally typically commonly known called said says say found show shows shown showed suggest suggests suggested ' +
  'study studies research researchers scientists experts article page site website source sources report reports reported data results result finding findings evidence review reviews paper papers author authors people person thing things way ways part parts type types kind kinds number numbers amount example examples ' +
  'year years time times day days today now recent recently current currently important significant major main common different several numerous within across among around due per made make makes making take takes taken get gets getting got see seen need needs needed help helps helped lead leads led cause causes caused ' +
  'high higher low lower large larger small smaller long short great good better best more most less least very really quite rather further another other others every each both either neither whether while although though because since therefore thus hence ' +
  'potential possible potentially possibly likely unlikely overall general specific particular certain various key similar related associated increased decreased reduced growing rising emerging existing available present previous future early late later prior total whole entire additional further direct indirect ' +
  'http https www com org html click read share subscribe copyright rights reserved privacy policy terms cookie cookies menu home search login sign').split(/\s+/));
// a phrase that opens with a verb in the third person ("improves employee", "reduces stress") is a piece of a sentence
const NOT_FIRST = new Set('improves increases reduces decreases causes leads affects helps makes shows provides offers allows enables requires includes remains becomes enhances boosts lowers raises prevents promotes contributes creates gives keeps brings means suggests indicates finds reveals appears seems tends occurs exists involves depends varies plays takes gets has have had can may might could should would will is are was were been being does did do using used use'.split(' '));
const NOT_LAST = new Set('beyond above below within without behind ahead alone together away along apart instead otherwise elsewhere everywhere anywhere somewhere thereafter afterwards onward onwards forth'.split(' '));
const okWord = (w) => w.length >= 3 && w.length <= 24 && !STOPWORDS.has(w) && !WEAK.has(w) && /^[a-z][a-z'-]*$/.test(w);
const SKIP_SECTION = /^(see also|references|external links|further reading|notes|bibliography|citations|sources|footnotes|works cited|explanatory notes|gallery|notes and references|in popular culture|popular culture|etymology|terminology|nomenclature|name|names|overview|background|introduction|definition|definitions|general|description|summary|other|others|miscellaneous|list|lists)$/i;

/**
 * Phrases (two or three words) that recur in the most relevant sentences and come from at least `minOrigins`
 * independent sources. sentences: [{text, di}], docs[di].origin; qStems: stems of the question (never a sub-topic by themselves).
 */
export function keyPhrases(sentences, docs, qStems, { max = 12, minOrigins = 2, taken = [], keys = null } = {}) {
  const found = new Map();      // stem key → {origins:Set, contexts:Set, count, forms:Map, n, beside}
  for (const s of sentences) {
    const origin = docs[s.di] ? docs[s.di].origin || s.di : s.di;
    const context = tokenize(s.text).slice(0, 9).join(' ');           // the same sentence copied from site to site is one context
    const seen = new Set();
    // a phrase does not run across a comma or a bracket: in "flexibility, autonomy, and retention" the first two words are neighbours in a list
    for (const words of String(s.text).split(/[,;:()[\]{}"“”«»]|\s[–—-]\s/).map((seg) => tokenize(seg))) for (let i = 0; i < words.length; i++) {
      for (let n = 2; n <= 3; n++) {
        if (i + n > words.length) break;
        const gram = words.slice(i, i + n);
        if (!okWord(gram[0]) || !okWord(gram[n - 1]) || (n === 3 && !(okWord(gram[1]) || /^(of|and|in|for|to|the)$/.test(gram[1])))) continue;
        if (gram.some((w) => /ly$/.test(w) && w.length > 4) || NOT_LAST.has(gram[n - 1]) || NOT_FIRST.has(gram[0])) continue;       // "widely acclaimed …", "… and beyond", "improves employee …" are not names of topics
        const stems = gram.filter((w) => !STOPWORDS.has(w)).map(stem);
        if (new Set(stems).size < stems.length || stems.every((st) => qStems.has(st))) continue;
        const key = stems.join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        let e = found.get(key);
        if (!e) { e = { key, stems, n, origins: new Set(), contexts: new Set(), count: 0, beside: 0, forms: new Map() }; found.set(key, e); }
        e.origins.add(origin); e.contexts.add(context); e.count++;
        // "western roman" before "empire": the phrase is a piece of a longer name that contains the topic itself
        const before = i > 0 ? stem(words[i - 1]) : '', after = i + n < words.length ? stem(words[i + n]) : '';
        if (qStems.has(before) || qStems.has(after)) e.beside++;
        const form = gram.join(' ');
        e.forms.set(form, (e.forms.get(form) || 0) + 1);
      }
    }
  }
  const cands = [...found.values()].filter((e) => e.origins.size >= minOrigins && e.contexts.size >= minOrigins && e.beside / e.count < 0.6).map((e) => {
    const fresh = e.stems.filter((st) => !qStems.has(st));
    const novel = fresh.length / e.stems.length;       // a phrase made mostly of the question's own words adds little
    // with the answers' vocabulary known: a sub-topic must be built on one of its terms ("oxidative stress", not "human health")
    const key = keys ? Math.max(0, ...fresh.map((st) => keys.get(st) || 0)) : 0.5;
    return { ...e, novel, key, score: Math.min(e.origins.size, e.contexts.size) * (e.n === 3 ? 1.2 : 1) * (0.4 + 0.6 * novel) * Math.log(2 + e.count) * (0.4 + key) };
    // "adverse effects", "western empire", "human health": a describing word attached to one of the question's own words is not a
    // sub-topic. "microplastic exposure", "health risks" are: there the new word is the head of the phrase (the last word).
  }).filter((e) => (e.novel > 0.5 || (e.novel === 0.5 && !qStems.has(e.stems[e.stems.length - 1]))) && (!keys || e.key >= 0.25)).sort((a, b) => b.score - a.score);
  const out = [], used = taken.map((t) => new Set(t));
  for (const c of cands) {
    if (out.length >= max) break;
    const novelStems = c.stems.filter((st) => !qStems.has(st));
    if (!novelStems.length || used.some((u) => novelStems.some((st) => u.has(st)))) continue;      // each sub-topic brings its own vocabulary
    used.push(new Set(novelStems));
    const label = [...c.forms].sort((a, b) => b[1] - a[1])[0][0];
    out.push({ label: capitalize(label), stems: novelStems, source: 'recurring phrase', support: c.origins.size, score: c.score });
  }
  return out;
}

const cleanHeading = (t) => squash(String(t || '')).replace(/^\s*(?:\d{1,2}(?:\.\d{1,2}){0,3}[.):]?\s+|[ivx]{1,4}[.)]\s+|step \d+[:.]?\s*|part \d+[:.]?\s*|chapter \d+[:.]?\s*)/i, '').replace(/[:?!.…]+$/, '').trim();
// the standard parts of a scientific paper: every article has them, so sharing them says nothing about the topic
const PAPER_PART = /^(?:(?:the |our )?(?:stud(?:y|ies)|materials?|methods?|methodology|materials? and methods?|methods? and materials?|patients? and methods?|subjects? and methods?|experimental(?: (?:section|design|procedures?|setup|methods?))?|study (?:design|area|population|selection|characteristics|limitations|participants)|participants|sample (?:collection|preparation|size)|sampling|data (?:collection|extraction|analysis|synthesis|sources?|availability(?: statement)?|sharing)|associated data|statistical analys[ei]s|statistics|analys[ei]s|results? and discussions?|results|findings|main (?:results|findings)|(?:primary |secondary |main |key |clinical |study |other )?outcomes?(?: measures?| and measures)?|outcome measures?|discussions?|general discussion|conclusions?(?: and (?:future )?(?:perspectives?|outlook|directions?|recommendations?|prospects?))?|concluding remarks|(?:future )?(?:perspectives?|outlook|directions?|prospects?|work|research(?: directions?)?)|recommendations?|limitations?|strengths? and limitations?|(?:literature )?search(?: strategy| methods?)?|literature review|(?:inclusion|exclusion|eligibility)(?: and exclusion)? criteria|quality assessment|risk of bias(?: assessment)?|ethic(?:s|al)(?: \w+){0,2}|supplementary (?:\w+ ?){1,2}|supporting information|appendix(?: \w)?|acknowledge?ments?|funding(?: \w+)?|author(?:s|s[’'])?(?: \w+){1,2}|conflicts? of interests?|competing interests?|declarations?(?: of \w+(?: \w+)?)?|abbreviations?|nomenclature|keywords?|highlights?|graphical abstract|abstract|introduction|background|objectives?|aims?(?: and objectives?)?|purpose|rationale|scope|summary|overview|footnotes?|notes?|references?|publisher[’']?s note|key (?:points?|messages?|findings)|significance(?: statement)?|practical implications|implications|case (?:presentation|report|description)|contributor information|article information|related (?:\w+ ?){1,2}|similar articles|cited by(?: other articles)?|links to \w+ databases|publication types|mesh terms|substances|grants? and funding|linkout(?: .*)?|full text (?:links|sources)|actions|share|page navigation|resources|permalink|copyright(?: .*)?)\s*)$/i;

const RELATION_WORD = new Set('challenge advantage disadvantage benefit drawback limitation risk danger hazard application cause consequence symptom treatment complication criticism controversy safety cost price side-effect prevention diagnosis'.split(' ').map((w) => stemsOf(w)[0]).filter(Boolean));

/** Headings that pages from several independent sites share. docs: [{outline:[{text, level}], origin, offTopic}] */
export function sharedHeadings(docs, qStems, { max = 10, minOrigins = 2, taken = [], keys = null } = {}) {
  const found = new Map();
  for (const d of docs) {
    if (d.offTopic || d.wrongSense || !d.outline) continue;
    const seen = new Set();
    for (const h of d.outline) {
      // a heading phrased as a question ("What are the benefits of …?", "How productive are remote workers") belongs to a FAQ, it does not name a sub-topic
      if (/\?\s*$/.test(String(h.text || '')) || /^\s*(?:\d+[.)]\s*)?(?:what|why|how|who|whom|whose|when|where|which|is|are|was|were|can|could|does|do|did|should|will|would)\b/i.test(String(h.text || ''))) continue;
      const text = cleanHeading(h.text);
      if (text.length < 4 || text.length > 60 || text.split(/\s+/).length > 7 || GENERIC_HEADING.test(text) || SKIP_SECTION.test(text) || PAPER_PART.test(text)) continue;
      const stems = [...new Set(stemsOf(text))].filter((st) => !qStems.has(st) && !WEAK.has(st));
      if (!stems.length || stems.length > 4) continue;
      if (keys && !stems.some((st) => (keys.get(st) || 0) >= 0.2)) continue;          // with the answers' vocabulary known: a heading must speak it
      const key = [...stems].sort().join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      let e = found.get(key);
      if (!e) { e = { key, stems, origins: new Set(), forms: new Map() }; found.set(key, e); }
      e.origins.add(d.origin || d.url);
      e.forms.set(text, (e.forms.get(text) || 0) + 1);
    }
  }
  const out = [], used = taken.map((t) => new Set(t));
  for (const e of [...found.values()].filter((x) => x.origins.size >= minOrigins).sort((a, b) => b.origins.size - a.origins.size)) {
    if (out.length >= max) break;
    if (used.some((u) => e.stems.some((st) => u.has(st)))) continue;
    used.push(new Set(e.stems));
    const label = [...e.forms].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    out.push({ label: capitalize(label), stems: e.stems, source: 'heading shared by several sites', support: e.origins.size, score: e.origins.size });
  }
  return out;
}

/**
 * Section headings of the encyclopedia article about the topic. When the question asks about one facet of the topic
 * ("health effects of …"), the sub-sections of the matching section are preferred to the article's top-level sections.
 */
export function articleSections(doc, qStems, attributeStems = new Set(), { max = 10, evidence = null } = {}) {
  if (!doc || !Array.isArray(doc.blocks)) return [];
  const heads = (doc.fullOutline || doc.blocks.filter((b) => b.type === 'heading')).map((b) => ({ text: cleanHeading(b.text), level: b.level, path: b.heading || '' })).filter((h) => h.text && !SKIP_SECTION.test(h.text) && h.text.length <= 70);
  const top = heads.filter((h) => h.level === 2);
  const stemSet = (t) => new Set(stemsOf(t));
  let chosen = top;
  if (attributeStems.size) {
    // "health effects": a section called "Human health" is closer to what was asked than one called "Effects on the
    // environment" — the qualifying word ("health") says more than the generic noun ("effects")
    const attr = [...attributeStems];
    const fitOf = (h) => { const st = stemSet(h.text); let f = 0; attr.forEach((a, k) => { if (st.has(a)) f += attr.length > 1 && k < attr.length - 1 ? 2 : 1; }); return f; };
    const matching = top.map((h) => ({ h, f: fitOf(h) })).filter((x) => x.f > 0).sort((a, b) => b.f - a.f);
    if (matching.length) {
      const best = matching.filter((m) => m.f === matching[0].f);
      const subs = [];
      for (const m of best) for (const h of heads) if (h.level === 3 && h.path.split(' › ').includes(m.h.text)) subs.push(h);
      const own = heads.filter((h) => h.level === 3 && fitOf(h) >= matching[0].f && !subs.includes(h));      // sub-sections elsewhere that name the facet themselves
      // the facet has a section of its own without sub-sections: the article has nothing finer to offer, and its other
      // sections are about other facets — sub-topics then come from the rest of the material
      chosen = subs.length + own.length >= 2 ? [...subs, ...own] : [];
    } else chosen = [];
  }
  // A question that asks something about the topic ("is X good for Y?", "why did X fall?") is not answered by the
  // article's table of contents: a section counts only when the best-matching sentences actually come from it.
  // evidence: Map(section heading → number of top-ranked sentences found under it)
  if (evidence) chosen = chosen.map((h) => ({ h, n: evidence.get(h.text) || 0 })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).map((x) => x.h);
  const out = [], used = [];
  for (const h of chosen) {
    if (out.length >= max) break;
    const stems = [...stemSet(h.text)].filter((st) => !qStems.has(st) && !WEAK.has(st));
    if (!stems.length || stems.length > 5 || used.some((u) => stems.every((st) => u.has(st)))) continue;
    used.push(new Set(stems));
    // a one-word everyday heading ("History", "Society") names a section, not a vocabulary: only text standing under such a heading belongs to it
    // — except a word that names a relation to the topic ("Challenges", "Advantages", "Applications"): a sentence that uses it says which relation it speaks of
    out.push({ label: h.text, stems, heading: stems.length === 1 && rarity(stems[0]) < 0.8 && !RELATION_WORD.has(stems[0]), source: `section of the Wikipedia article “${doc.title}”`, support: 1, score: 3 - out.length * 0.1 });
  }
  return out;
}

/**
 * Does a text (given as a set of stems) deal with a sub-topic? One- and two-word sub-topics need all their words; longer
 * ones need most of their weight, where uncommon words weigh more ("persistent organic pollutants" is not matched by "organic" alone).
 */
export function aspectMatcher(aspect) {
  const stems = aspect.stems || [];
  const w = stems.map((st) => rarity(st) ** 2);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const need = stems.length <= 2 ? 0.999 : 0.6;
  return (set, extra = null) => {
    if (aspect.heading) { if (!extra) return false; for (const st of stems) if (!extra.has(st)) return false; return true; }
    let got = 0;
    for (let i = 0; i < stems.length; i++) if (set.has(stems[i]) || (extra && extra.has(stems[i]))) got += w[i];
    return got / total >= need;
  };
}

/** Merge sub-topic lists (earlier lists win), dropping ones whose vocabulary is already covered. */
// "Immune function" and "Immune system", "Reproductive health" and "Reproductive disorders": one describing word with two general
// nouns names one sub-topic, not two. ("Energy density" and "Energy storage" stay apart: neither noun is general.)
const GENERAL_HEAD = new Set(stemsOf('system systems function functions response responses process processes activity health effect effects impact impacts issue issues problem problems disorder disorders disease diseases condition conditions level levels change changes mechanism mechanisms outcome outcomes damage'));
// "inflammation" and "inflammatory", "respiration" and "respiratory": one word family that the stemmer leaves apart
const family = (x, y) => x === y || (x.length >= 5 && y.startsWith(x) && /^(?:atori|ori|i|at|al)$/.test(y.slice(x.length))) || (y.length >= 5 && x.startsWith(y) && /^(?:atori|ori|i|at|al)$/.test(x.slice(y.length)));
const sameThing = (a, o) => {
  if (a.stems.every((st) => o.stems.some((x) => family(x, st))) || o.stems.every((st) => a.stems.some((x) => family(x, st)))) return true;
  if (a.stems.length !== 2 || o.stems.length !== 2) return false;
  const shared = a.stems.filter((st) => o.stems.includes(st));
  if (shared.length !== 1) return false;
  const restA = a.stems.find((st) => st !== shared[0]), restO = o.stems.find((st) => st !== shared[0]);
  return !GENERAL_HEAD.has(shared[0]) && GENERAL_HEAD.has(restA) && GENERAL_HEAD.has(restO);
};

export function mergeAspects(lists, { max = 10 } = {}) {
  const out = [];
  for (const list of lists) for (const a of list || []) {
    if (out.length >= max) return out;
    if (out.some((o) => sameThing(a, o))) continue;
    out.push({ ...a, stems: [...a.stems] });
  }
  return out;
}
