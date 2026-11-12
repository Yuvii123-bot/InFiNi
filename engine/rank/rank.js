// INFINI AI — passage and sentence ranking (non-neural).
// BM25-style lexical statistics computed on the fly from the pages retrieved for *this* question, weighted query
// terms from the question analysis, answer-type cue patterns, implicit-subject credit from headings/titles,
// pseudo-relevance feedback for vocabulary the question did not contain, and MMR for diverse selection.

import { terms as stemTerms, tokenize, stem, STOPWORDS, splitSentences, squash, jaccard } from '../util/text.js';

export const CUES = {
  reason: /\b(because|due to|caused by|causes?|caused|result(?:s|ed|ing)? (?:of|from|in)|as a result|therefore|thus|hence|so that|leads? to|led to|owing to|thanks to|in order to|generat(?:es|ed|ing)|produc(?:es|ed|ing)|releas(?:es|ed|ing)|powered by|driven by|explains?|reason|responsible for|arises? from|stems? from|attributed to|by (?:fusing|burning|converting|releasing|means of)|allows?|enables?|makes? it)\b/i,
  procedure: /^(?:\d+[.)]\s*)?(?:first|then|next|finally|start|begin|install|create|run|use|add|open|click|select|choose|configure|define|set|write|import|call|make|build|download|go to|navigate|enter|type|press|save|copy|connect|enable|deploy|test|pick|decide|identify|gather|train|design|plan|implement|give|equip|integrate)\b|\b(step \d|you (?:can|need|should|must|will)|to do this|make sure|be sure to)\b/i,
  definition: /\b(?:is|are|was|were) (?:a|an|the|one of|any|defined as|known as|called)\b|\brefers? to\b|\bis defined as\b|\bmeans\b|\bdescribes\b/i,
  comparison: /\b(whereas|while|unlike|compared (?:to|with)|in contrast|by contrast|on the other hand|than|both|differ(?:s|ence|ent)?|similar(?:ly|ity)?|in common|alike|versus|vs\.?|rather than|as opposed to|faster|slower|safer|simpler|easier|harder)\b/i,
  place: /\b(?:in|at|near|from|located|situated|found|lies|native to|across|throughout|capital|headquartered|based in)\b/i,
  person: /\b(?:by|invented|discovered|founded|created|written|wrote|developed|designed|built|led|credited|named after|patented|introduced|proposed|pioneered|awarded)\b/i,
  quantity: /\d/,
  time: /\b(?:1[0-9]{3}|20[0-9]{2})\b|\b(?:century|decade|BC|AD|BCE|CE)\b/,
  prediction: /\b(will|expected to|projected|forecasts?|predict(?:s|ed|ions?)?|estimate[sd]?|by (?:20[2-9]\d|2[1-9]\d\d)|likely to|could|may|might|in the (?:coming|next)|future|outlook|anticipate[sd]?)\b/i,
  recommendation: /\b(recommend(?:s|ed)?|should|best|ideal|suggest(?:s|ed)?|advis(?:e|ed|able)|consider|good (?:choice|option|idea)|worth|prefer(?:red)?|suitable|great for|better (?:for|to)|start with|tip)\b/i,
  list: /\b(include|includes|including|such as|types? of|kinds? of|for example|e\.g\.|among|consists? of|range from|namely|several|various|main|major|common)\b/i,
  mechanism: /\b(through|via|using|uses?|works? by|process|when|converts?|absorbs?|produces?|then|first|causes?|allows?|mechanism|function(?:s|ing)?|consists? of|step|stage|during|into|transfers?|triggers?|stimulates?|reacts?)\b/i,
  // what something does: it is the subject of an action
  function: /\b(creates?|returns?|calls?|executes?|runs?|adds?|appends?|inserts?|removes?|deletes?|converts?|iterates?|loops?|applies|transforms?|sorts?|filters?|combines?|joins?|splits?|checks?|tests?|finds?|searches|copies|merges?|sets?|gets?|allows?|lets?|enables?|provides?|performs?|produces?|generates?|takes?|accepts?|specifies|defines?|declares?|pauses?|stops?|starts?|waits?|sends?|receives?|reads?|writes?|opens?|closes?|stores?|loads?|prints?|displays?|regulates?|controls?|carries|pumps?|protects?|breaks? down|is used (?:to|for)|are used (?:to|for)|used to|responsible for)\b/i,
};
const TYPE_BOOST = { function: 0.15, reason: 0.45, procedure: 0.35, definition: 0.3, comparison: 0.3, place: 0.15, person: 0.2, quantity: 0.25, time: 0.3, prediction: 0.35, recommendation: 0.3, list: 0.25, mechanism: 0.25 };
const JUNK = /\b(click here|subscribe|sign up|sign in|log in|cookies?|privacy policy|terms of (?:use|service)|all rights reserved|read more|advertis|newsletter|share this|follow us|javascript (?:is|must be) (?:disabled|enabled)|loading\.\.\.|©)\b/i;
const DANGLING = /^(?:however|but|also|this|these|those|it|they|he|she|such|that|there|then|thus|therefore|moreover|furthermore|additionally|in addition|for example|for instance|similarly|instead|otherwise|meanwhile|as a result|nevertheless|hence|consequently|his|her|its|their|another|the latter|the former|both|some|others?|in contrast|on the other hand|as such|so)\b/i;
// "The liver is also …" continues an earlier statement, so it cannot open an answer.
// "If that hybrid path is what interests you, …" points back at text that will not be quoted.
const REFER_RE = /^(?:if|when|while|since|because|although|though|as|once|after|before|unless|given)\s+(?:this|that|these|those|it|they|he|she|such)\b/i;
const VERBISH = /\b(?:is|are|was|were|be|been|being|has|have|had|can|could|will|would|may|might|must|should|do|does|did|include[sd]?|supports?|contains?|consists?|provides?|offers?|creates?|returns?|allows?|makes?|means?|refers?|comprises?|became|become|becomes)\b/i;
/** True for a comma-separated run of short keyword phrases with no verb. */
export function isKeywordRun(text) {
  const segs = String(text).split(/\s*[,;|·•]\s*/).filter(Boolean);
  if (segs.length < 6) return false;
  const short = segs.filter((x) => x.split(/\s+/).length <= 4).length;
  return short / segs.length >= 0.8 && !VERBISH.test(text);
}
/** True for an editorial aside about the page rather than a statement about its subject: "(Note: This article describes ...". */
export function isAside(text) {
  const t = String(text).trim();
  if (/^\(/.test(t) && !/\)/.test(t)) return true;                                   // a bracket that opens the sentence and never closes
  return /^\(?\s*(?:note|please note|n\.b\.|nb|disclaimer|editor['’]?s note|author['’]?s note|update|updated|see also|read more|related|source|photo|image|credit)\s*[:—–-]\s/i.test(t) || /^\(?\s*this (?:article|page|post|section|guide|entry|story) (?:is about|describes|covers|discusses|explains|deals with|was (?:originally|first|last)|has been|needs|may|contains|includes)\b/i.test(t);
}
const ALSO_RE = /^(?:[\w'’()-]+ ){1,5}(?:is|are|was|were|can|may|has|have|will) also\b/i;
const OPINION = /\b(i think|i believe|i feel|in my opinion|imo|imho|personally|i would|i'd say|arguably|seems? to me|my favou?rite|i love|i hate|we believe|in our view|should(?:n't)? be|must be|best|worst|terrible|awesome|amazing|overrated|underrated)\b/i;
const HEDGE = /\b(may|might|could|possibly|perhaps|reportedly|allegedly|is said to|rumou?red|unconfirmed|claims?|claimed|according to|suggests?|appears? to|is thought to|is believed to|estimated|likely|probably)\b/i;

export const stemsOf = (text) => stemTerms(text);

/** Remove reference markers and pronunciation clutter so that extracted sentences read cleanly. */
export function cleanSentence(s) {
  return squash(String(s)
    .replace(/\[(?:\d{1,3}|citation needed|note \d+|[a-z]|edit|update|when\?|who\?|clarification needed|better source needed)\]/gi, '')
    .replace(/\s*\((?:[^()]*?(?:\/[^()\/]{2,}\/|ⓘ|listen|pronounced|pronunciation|IPA)[^()]*?)\)/g, (m) => { const keep = m.replace(/^[\s(]+|\)$/g, '').split(/;\s*/).filter((p) => !/\/[^\/]{2,}\/|ⓘ|listen|pronounced|pronunciation|IPA/.test(p)).join('; '); return keep ? ` (${keep})` : ''; })
    .replace(/\s+([,.;:!?])/g, '$1').replace(/\(\s*[;,]\s*/g, '(').replace(/\(\s*\)/g, ''));
}

/** Turn an extracted document into rankable passages (one per content block) with their sentences. */
export function docPassages(doc, di) {
  const out = [];
  let order = 0;
  for (const b of doc.blocks || []) {
    let text = '', sentences = [];
    if (b.type === 'p') { text = cleanSentence(b.text); sentences = splitSentences(text).filter((s) => s.length >= 25 && s.length <= 520); }
    else if (b.type === 'list') { sentences = b.items.map((i) => cleanSentence(i.text)).filter((s) => s.length >= 3 && s.length <= 520); text = sentences.join('\n'); }
    else if (b.type === 'table') {
      const hdr = b.header || [];
      sentences = (b.rows || []).slice(0, 60).map((r) => r.map((c, j) => (hdr[j] && r.length > 1 && j > 0 ? `${hdr[j]}: ${c}` : c)).filter(Boolean).join(r.length === 2 && !hdr.length ? ': ' : '; ')).map(cleanSentence).filter((s) => s.length >= 3 && s.length <= 400);
      text = (b.caption ? b.caption + '\n' : '') + sentences.join('\n');
    } else if (b.type === 'code') { text = b.text; }
    else continue;
    if (!text || (b.type === 'p' && text.length < 25)) continue;
    out.push({ di, order: order++, type: b.type, heading: b.heading || '', block: b, text, sentences, score: 0 });
  }
  return out;
}

/** Build the weighted query model for one part of the question. */
export function queryModel(part, extra = []) {
  const terms = new Map();
  for (const t of part.terms) terms.set(t.stem, { w: t.weight, core: t.weight >= 0.5, word: t.word, kind: t.kind });
  for (const t of part.expansions || []) if (!terms.has(t.stem)) terms.set(t.stem, { w: t.weight, core: false, word: t.word, of: t.of });
  for (const t of extra) if (!terms.has(t.stem)) terms.set(t.stem, { w: t.weight, core: false, word: t.word, learned: true });
  const focus = new Set(stemsOf(part.focus || ''));
  const properStems = new Set(part.entities.filter((e) => e.proper).flatMap((e) => stemsOf(e.text)));
  // the aspect asked about ("security risks of …", "capital of …") must be present, as the word itself or a listed synonym
  const required = new Set();
  if (part.attribute && ['list', 'attribute', 'person', 'place', 'time', 'quantity', 'entity'].includes(part.answerType)) {
    for (const st of stemsOf(part.attribute)) { required.add(st); for (const [k, t] of terms) if (t.of && stemsOf(t.of)[0] === st) required.add(k); }
  }
  // each ordinal/superlative of the question must be present too (as itself or a listed synonym)
  const requiredAll = (part.constraints || []).map((c) => { const st = stemsOf(c)[0] || c; const alts = new Set([st]); for (const [k, t] of terms) if (t.of && stemsOf(t.of)[0] === st) alts.add(k); return alts; });
  return { terms, focus, properStems, required, requiredAll, answerType: part.answerType, part };
}

/**
 * Rank all sentences of the retrieved documents against the query model.
 * Returns {passages, sentences (best first), idf, df, N}.
 */
export function rankEvidence(docs, qm, { now = Date.now(), fresh = null } = {}) {
  const passages = [];
  docs.forEach((d, di) => { for (const p of docPassages(d, di)) passages.push(p); });
  const N = Math.max(1, passages.length);
  const df = new Map();
  for (const p of passages) {
    p.stems = stemsOf(p.text);
    p.stemSet = new Set(p.stems);
    p.headSet = new Set(stemsOf(p.heading));
    for (const s of p.stemSet) df.set(s, (df.get(s) || 0) + 1);
  }
  const rawIdf = (s) => Math.log(1 + (N - (df.get(s) || 0) + 0.5) / ((df.get(s) || 0) + 0.5));
  let maxIdf = 0;
  for (const s of qm.terms.keys()) maxIdf = Math.max(maxIdf, rawIdf(s));
  const idf = (s) => Math.max(rawIdf(s), 0.22 * (maxIdf || 1));
  let coreTotal = 0;
  for (const [s, t] of qm.terms) if (t.core) coreTotal += t.w * idf(s);
  coreTotal = coreTotal || 1;
  const avgLen = passages.reduce((a, p) => a + p.stems.length, 0) / N || 1;
  const titleSets = docs.map((d) => new Set(stemsOf(d.title || '')));
  const type = qm.part.fn ? 'function' : qm.answerType === 'attribute' || qm.answerType === 'entity' || qm.answerType === 'description' || qm.answerType === 'news' || qm.answerType === 'yesno' ? null
    : qm.answerType === 'person' ? 'person' : qm.answerType;
  const cue = type && CUES[type];
  const boost = type ? TYPE_BOOST[type] || 0.2 : 0;
  const focusArr = [...qm.focus];
  const defLike = qm.answerType === 'definition' || !!qm.part.explain;
  const coreStems = [...qm.terms].filter(([, t]) => t.core).map(([s]) => s);
  const coreSet = new Set(coreStems);
  // predicate terms: what is asked *about* the focus (verb, attribute, other content words) and their listed synonyms
  const predTerms = [...qm.terms].filter(([s, t]) => t.core && !qm.focus.has(s));
  const predTotal = predTerms.reduce((a, [, t]) => a + t.w, 0);
  const synOf = new Map();
  for (const [s, t] of qm.terms) if (t.of) { const base = stemsOf(t.of)[0]; if (base) { if (!synOf.has(base)) synOf.set(base, []); synOf.get(base).push(s); } }

  // passage scores (BM25 with heading field)
  let maxP = 0;
  for (const p of passages) {
    const tf = new Map();
    for (const s of p.stems) if (qm.terms.has(s)) tf.set(s, (tf.get(s) || 0) + 1);
    let sc = 0;
    for (const [s, t] of qm.terms) {
      const f = tf.get(s) || 0;
      if (f) sc += t.w * idf(s) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * p.stems.length / avgLen));
      if (p.headSet.has(s)) sc += t.w * idf(s) * 0.6;
    }
    p.score = sc;
    if (sc > maxP) maxP = sc;
  }
  maxP = maxP || 1;

  const sentences = [];
  for (let pi = 0; pi < passages.length; pi++) {
    const p = passages[pi];
    const doc = docs[p.di];
    // topical prior: is this document about the thing asked about, or merely a neighbour that mentions it?
    const titleSet0 = titleSets[p.di];
    const allIn = focusArr.length > 0 && focusArr.every((f) => titleSet0.has(f));
    const topical = !focusArr.length ? 1 : doc.entity ? 1.15 : doc.kind === 'encyclopedia' ? (allIn && titleSet0.size === focusArr.length ? 1.1 : allIn ? (defLike ? 0.72 : 0.9) : (defLike ? 0.66 : 0.85)) : allIn ? 1.05 : 0.92;
    const prior = (0.75 + 0.5 * (doc.quality == null ? 0.5 : doc.quality)) * topical;
    const titleSet = titleSets[p.di];
    const ctxNorm = p.score / maxP;
    let recency = 1;
    if (fresh && doc.published) { const age = (now - Date.parse(doc.published)) / 86400000; if (Number.isFinite(age)) recency = age <= 2 ? 1.25 : age <= 8 ? 1.1 : age <= 40 ? 1 : 0.8; }
    for (let si = 0; si < p.sentences.length; si++) {
      const text = p.sentences[si];
      const st = stemsOf(text);
      if (st.length < 2 && p.type === 'p') continue;
      const set = new Set(st);
      let nameOnly = null;
      if (/\s\p{Lu}/u.test(text)) {                       // words used only inside a capitalised name/title ("The Stars Shine Down")
        const lowerUse = new Set(), capUse = new Set();
        let first = true;
        for (const m of text.matchAll(/[\p{L}][\p{L}\p{N}'’-]*/gu)) { const w = m[0]; (first || !/^\p{Lu}/u.test(w) ? lowerUse : capUse).add(stem(w.toLowerCase())); first = false; }
        nameOnly = new Set([...capUse].filter((x) => !lowerUse.has(x)));
      }
      let num = 0, direct = 0;
      for (const [s, t] of qm.terms) {
        let w = t.w * idf(s);
        if (set.has(s) && nameOnly && nameOnly.has(s) && t.kind !== 'proper' && !qm.properStems.has(s)) w *= 0.3;
        if (set.has(s)) { num += w; if (t.core) direct += w; }
        else if (t.core && (p.headSet.has(s) || titleSet.has(s))) num += 0.5 * w;          // implicit subject / section topic
      }
      if (num <= 0) continue;
      let prox = 1;
      if (coreStems.length >= 2) {
        const pos = [];
        let idx = 0;
        for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) { const k = stem(m[0].toLowerCase()); if (coreSet.has(k)) pos.push([idx, k]); idx++; }
        const kinds = new Set(pos.map((x) => x[1]));
        if (kinds.size >= 2) {
          let best = Infinity; const cnt = new Map(); let have = 0, l = 0;
          for (let r = 0; r < pos.length; r++) {
            cnt.set(pos[r][1], (cnt.get(pos[r][1]) || 0) + 1); if (cnt.get(pos[r][1]) === 1) have++;
            while (have === kinds.size) { best = Math.min(best, pos[r][0] - pos[l][0] + 1); const k = pos[l][1]; cnt.set(k, cnt.get(k) - 1); if (!cnt.get(k)) have--; l++; }
          }
          prox = 0.78 + 0.44 * Math.min(1, kinds.size / best);
        }
      }
      let cov = Math.min(1.2, num / coreTotal);
      const directCov = direct / coreTotal;
      const words = text.split(/\s+/).length;
      let lenPen = 1;
      if (p.type === 'p') lenPen = words < 6 ? 0.45 : words < 9 ? 0.8 : words > 60 ? 0.7 : words > 45 ? 0.88 : 1;
      let mult = 1;
      const cueHit = cue ? cue.test(text) : false;
      if (cueHit) mult += boost;
      let defHit = false;
      if (qm.answerType === 'mechanism' && /\b(process|mechanism|overview|how it works|function|operation|principle|stages?|steps?|cycle|reactions?|working)\b/i.test(p.heading)) mult += 0.3;
      if ((qm.answerType === 'definition' || qm.answerType === 'mechanism' || qm.part.explain || qm.part.fn) && focusArr.length) {
        const head = new Set(stemsOf(text.split(/\s+/).slice(0, 10 + focusArr.length).join(' ')));
        // a defining sentence opens with the subject; for "what does X do" it must also say what X does
        // (the sentence that opens a page may leave the verb to the sentence after it: "A CPU is the primary processor … Its circuitry executes …")
        const cueText = qm.part.fn && si === 0 && p.order === 0 ? p.text.slice(0, 420) : text.slice(0, 220);
        if (focusArr.every((f) => head.has(f)) && (qm.part.fn ? CUES.function : CUES.definition).test(cueText)) { mult += 0.55; defHit = true; }
        // what something does is stated where a page introduces it, not deep inside its details
        if (qm.part.fn) { if (p.order === 0) mult += 0.5; else if (p.order <= 2) mult += 0.35; else if (p.order <= 6) mult += 0.2; else if (p.order > 12) mult *= 0.85; }
        else if (p.order <= 2) mult += 0.18;
      }
      const dangling = p.type === 'p' && (DANGLING.test(text) || ALSO_RE.test(text) || REFER_RE.test(text));
      // a paragraph "sentence" with no end punctuation is a headline, caption or teaser rather than a statement
      if (p.type === 'p' && words < 14 && !/[.!?…"”’')\]]$/.test(text)) lenPen *= 0.55;
      // "map method, new array creation, callback function, …" is a tag line for search engines, not a statement
      if (p.type === 'p' && isKeywordRun(text)) lenPen *= 0.15;
      // "(Note: This article describes ..." is about the page, not about the subject
      if (isAside(text)) lenPen *= 0.2;
      if (dangling) mult *= si === 0 ? 0.9 : 0.72;
      if (/\?\s*$/.test(text)) mult *= 0.3;
      if (qm.required.size && ![...qm.required].some((r) => set.has(r))) mult *= 0.4;
      for (const alts of qm.requiredAll) if (![...alts].some((r) => set.has(r))) mult *= 0.35;
      if (JUNK.test(text)) mult *= 0.2;
      if (!/[a-z]{3,}/i.test(text)) mult *= 0.3;
      if (/\\displaystyle|\\[a-z]+\{|[a-z]{3,}[A-Z]:?=|[⟩⟨∑∫]|\^\{|_\{|[a-z]{4,}[A-Z]\b/.test(text)) mult *= 0.3;      // formula residue from markup
      if (p.type === 'list' && qm.answerType !== 'procedure' && qm.answerType !== 'list' && words < 5) mult *= 0.6;
      if (p.type === 'table') mult *= qm.answerType === 'attribute' || qm.answerType === 'quantity' || qm.answerType === 'time' || qm.answerType === 'place' || qm.answerType === 'person' ? 1.1 : 0.7;
      let predCov = 1;
      if (predTotal > 0) { let got = 0; for (const [s, t] of predTerms) got += set.has(s) ? t.w : (synOf.get(s) || []).some((x) => set.has(x)) ? 0.6 * t.w : 0; predCov = got / predTotal; }
      const score = cov * prox * (0.72 + 0.28 * ctxNorm) * lenPen * mult * prior * recency * (0.6 + 0.4 * Math.min(1, directCov * 1.6 + (titleSet.size && focusArr.some((f) => titleSet.has(f)) ? 0.4 : 0)));
      sentences.push({ text, di: p.di, pi, si, type: p.type, heading: p.heading, stems: set, score, cov, directCov, predCov, cueHit, defHit, dangling, order: p.order, opinion: OPINION.test(text), hedged: HEDGE.test(text) });
    }
  }
  sentences.sort((a, b) => b.score - a.score);
  return { passages, sentences, idf, df, N };
}

/** Pseudo-relevance feedback: salient vocabulary of the best evidence that the question itself did not contain. */
export function feedbackTerms(ranked, qm, k = 6) {
  const scores = new Map(), words = new Map();
  for (const s of ranked.sentences.slice(0, 14)) {
    for (const tok of tokenize(s.text)) {
      if (STOPWORDS.has(tok) || tok.length < 4 || /\d/.test(tok)) continue;
      const st = stem(tok);
      if (qm.terms.has(st)) continue;
      scores.set(st, (scores.get(st) || 0) + s.score);
      if (!words.has(st) || tok.length < words.get(st).length) words.set(st, tok);
    }
  }
  const out = [];
  for (const [st, sc] of scores) { const d = ranked.df.get(st) || 1; if (d >= 2 && d / ranked.N < 0.5) out.push({ stem: st, word: words.get(st), score: sc * ranked.idf(st) }); }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}

export const simSets = (a, b) => jaccard(a, b);

/** Maximal-marginal-relevance selection: relevant but not redundant, with a per-document cap. */
export function mmr(cands, k, { lambda = 0.74, maxPerDoc = 99, dupSim = 0.62, minScore = 0, filter = null } = {}) {
  const pool = cands.filter((c) => c.score >= minScore && (!filter || filter(c))).slice(0, 80);
  const chosen = [], perDoc = new Map();
  const top = pool.length ? pool[0].score : 1;
  while (chosen.length < k && pool.length) {
    let best = -1, bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if ((perDoc.get(c.di) || 0) >= maxPerDoc) continue;
      let maxSim = 0;
      for (const s of chosen) { const sim = simSets(c.stems, s.stems); if (sim > maxSim) maxSim = sim; }
      if (maxSim >= dupSim) continue;
      const val = lambda * c.score - (1 - lambda) * maxSim * top;
      if (val > bestVal) { bestVal = val; best = i; }
    }
    if (best < 0) break;
    const c = pool.splice(best, 1)[0];
    chosen.push(c);
    perDoc.set(c.di, (perDoc.get(c.di) || 0) + 1);
  }
  return chosen;
}

/** Sentences from *other* documents that state the same thing (used for corroboration and multi-source citations). */
export function corroborators(sentence, ranked, { minSim = 0.5, limit = 4 } = {}) {
  const out = [], seenDocs = new Set([sentence.di]);
  for (const s of ranked.sentences) {
    if (out.length >= limit) break;
    if (s === sentence || seenDocs.has(s.di) || s.score < sentence.score * 0.35) continue;
    const sim = simSets(sentence.stems, s.stems);
    if (sim >= minSim) { out.push({ sentence: s, sim }); seenDocs.add(s.di); }
  }
  return out;
}

/**
 * Share of the question's weighted terms found in a search-result title/snippet. In running text a common word that
 * appears only inside a capitalised name ("The Stars Shine Down") counts for little; titles are exempt (headline case).
 */
export function lexicalOverlap(title, snippet, weights) {
  let total = 0;
  for (const w of weights.values()) total += w;
  if (!total) return 0;
  const tset = new Set(stemsOf(title || ''));
  let ts = 0;
  for (const [k, w] of weights) if (tset.has(k)) ts += w;
  let ss = 0;
  if (snippet) {
    const lower = new Set(), cap = new Set();
    let first = true;
    for (const m of snippet.matchAll(/[\p{L}][\p{L}\p{N}'’-]*/gu)) { (first || !/^\p{Lu}/u.test(m[0]) ? lower : cap).add(stem(m[0].toLowerCase())); first = false; }
    for (const [k, w] of weights) ss += lower.has(k) ? w : cap.has(k) ? 0.3 * w : 0;
  }
  return Math.max(ss / total, (snippet ? 0.7 : 0.85) * ts / total);
}
