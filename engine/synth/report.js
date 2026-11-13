// INFINI AI — research report sections (extractive).
// When many sources have been read, the answer is extended with sections built by rule: what the sources say on each
// sub-topic found in the material, figures they report, dated statements in order, and places where they differ.
// As everywhere in this engine, each statement is a sentence quoted from a source and carries its citation.

import { mmr, simSets, stemsOf } from '../rank/rank.js';
import { detectConflicts } from '../evidence/evidence.js';
import { findDates } from '../util/dates.js';
import { figuresAgree } from './synth.js';
import { aspectMatcher } from '../research/aspects.js';

/**
 * Agreement between independent sources. For the best-ranked sentences, count how many independent origins state the
 * same thing (near-identical wording, same figures); statements with broad support move up.
 * `groups` identifies an origin: docs[di].group when origin groups were computed, else docs[di].origin.
 */
export function applyConsensus(ranked, docs, { top = 260, pool = 2600, minSim = 0.5 } = {}) {
  if (ranked.consensus) return ranked;
  ranked.consensus = true;
  const S = ranked.sentences;
  if (S.length < 8) return ranked;
  const cand = S.slice(0, pool), head = Math.min(top, cand.length);
  const originOf = (di) => (docs[di].group != null ? `g${docs[di].group}` : docs[di].origin);
  const index = new Map();
  cand.forEach((s, i) => { for (const st of s.stems) { let a = index.get(st); if (!a) index.set(st, (a = [])); a.push(i); } });
  const cut = Math.max(60, cand.length / 5);                       // a term found in a fifth of all sentences says nothing about sameness
  for (let i = 0; i < head; i++) {
    const s = cand[i];
    const shared = new Map();
    for (const st of s.stems) { const a = index.get(st); if (!a || a.length > cut) continue; for (const j of a) if (j !== i) shared.set(j, (shared.get(j) || 0) + 1); }
    const origins = new Set([originOf(s.di)]);
    const also = [];
    for (const [j, n] of shared) {
      if (n < 3) continue;
      const t = cand[j];
      const o = originOf(t.di);
      if (origins.has(o) || simSets(s.stems, t.stems) < minSim || !figuresAgree(s.text, t.text)) continue;
      origins.add(o); also.push(t.di);
    }
    s.support = origins.size;
    s.supporters = also.slice(0, 12);
  }
  for (let i = 0; i < head; i++) { const s = cand[i]; if (s.support > 1) s.score *= 1 + 0.08 * Math.min(6, s.support - 1); }
  S.sort((a, b) => b.score - a.score);
  return ranked;
}

/** Is this four-digit number used as a year ("in 1986", "March 2020", "1990s") — and not as a quantity ("1300 mA h", "2000 patients")? */
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
export function yearInContext(text, year) {
  const y = String(year);
  // a date word before the year settles it: "in 1986", "since 2010", "March 2020", "15 June 2018", "the 1990s"
  const strong = new RegExp(`\\b(?:in|since|by|from|until|till|before|after|during|around|circa|${MONTHS})\\.?,?\\s+(?:the\\s+)?(?:early\\s+|late\\s+|mid-?\\s*)?${y}(?:s\\b|\\b)|\\b(?:summer|winter|spring|autumn|fall|end|beginning|start|turn)\\s+of\\s+${y}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?,\\s+${y}\\b|\\b${y}s\\b`, 'i');
  if (strong.test(text)) return true;
  // a unit or a counted thing after the number makes it a quantity: "1300 mA h", "2000 patients", "1500 cycles"
  const quantity = new RegExp(`\\b${y}\\s*(?:(?!s\\b)[a-zµμΩ°%]{1,4}\\b(?<!\\b(?:and|or|to|by|the|was|were|is|in|on|at|as|for|with|when))|[×x*/=±]|\\s[a-z]{3,}s\\b)`, 'i');
  if (quantity.test(text)) return false;
  // otherwise: a number that stands like a year — in brackets, in a range, before punctuation, or after "and"/"to" in a span of years
  return new RegExp(`(?:[(\\[–—-]\\s?|\\b(?:and|to|between|year|years)\\s+)${y}\\b|\\b${y}(?:[–-]\\d{2,4}\\b|\\s*[,;:).\\]])`, 'i').test(text);
}

const FIGURE = /(?:\d[\d,.]*\s?(?:%|percent|per cent|million|billion|trillion|thousand|times|-?fold|µm|μm|nm|mm|cm|km|kg|mg|µg|μg|ng|tonnes?|tons|°C|°F|years?|months?|people|adults|children|patients|participants|particles|deaths|cases|species|countries|studies|GW|MW|kWh|TWh|ppm|ppb)\b|[$€£]\s?\d)/i;
const span = (text, cites = []) => ({ text, cites });

// "… is investigated at 25 °C at several loading weights": the figure describes how a study was set up, not what it found
const SETUP = /\b(?:is|are|was|were|has been|have been) (?:\w+ly )?(?:investigated|studied|examined|explored|evaluated|analy[sz]ed|assessed|characteri[sz]ed|tested|measured|monitored|compared|conducted|carried out|performed|collected|recruited|enrolled|sampled|prepared|synthesi[sz]ed|fabricated)\b(?![^.;]{0,60}\b(?:found|showed|revealed|resulted|increased|decreased|reduced|rose|fell)\b)/i;
const OPEN_ISSUE = /\b(?:remains?|still|yet|unclear|unknown|unresolved|unsolved|open (?:questions?|problems?|challenges?|issues?)|little is known|poorly understood|whether|bottlenecks?|obstacles?|hurdles?|barriers?|challenges? (?:remain|persist|include|facing|for|of|in))\b/i;
const BARE_CALL = /\b(?:areas?|aspects?|topics?|questions?|issues?|gaps?) (?:that|which|where) (?:\w+ )?(?:need|needs|require|requires|warrant|warrants|deserve|deserves)\b|\b(?:need|needs|call|calls|necessity|importance) (?:for|of) (?:further|more|additional|future|continued) (?:research|stud(?:y|ies)|investigations?|work|exploration)\b|\b(?:further|more|additional|future|continued) (?:research|stud(?:y|ies)|investigations?|work) (?:is|are|will be|would be|remains?|should|must|needs?) /i;
const STATES_GAP = /\blittle is (?:\w+ )?known\b|\b(?:un(?:clear|known|certain|explored|resolved)|poorly understood|not (?:yet |currently |fully |well |completely |clearly ){0,2}(?:understood|known|established|clear|elucidated|characteri[sz]ed|defined)|inconclusive|insufficient|scarce|limited|lacking|no (?:\w+ )?(?:evidence|data|consensus|established)|whether|how much|how far|to what extent|in (?:its|their) infancy|early[- ]stages?)\b/i;

/** The figures of a sentence as comparable keys: "5 mm" and "5mm" → "5mm", "10 μg/mL" → "10µg". */
const FIGURE_ALL = new RegExp(FIGURE.source, 'gi');
export function figureKeys(text) {
  const out = new Set();
  for (const m of String(text).match(FIGURE_ALL) || []) out.add(m.toLowerCase().replace(/\s+/g, '').replace(/,/g, '').replace(/μ/g, 'µ').replace(/percent|percent/g, '%').replace(/(?<=[a-z])s$/, ''));
  return [...out];
}

/**
 * Sections for one part of the question. `env` is the composing environment of the main answer (so that nothing is
 * quoted twice and every statement is recorded as a claim).
 * opts: { aspects: [{label, stems}], budget: {sections, perSection}, mode: 'deep' | 'research', docs }
 * Returns { blocks, sections: [{label, statements, origins, index}], figures, timeline, differences }.
 */
export function composeReport(part, env, { aspects = [], budget, mode, docs }) {
  const ranked = env.ranked;
  const out = { blocks: [], sections: [], figures: 0, timeline: 0, differences: 0, gaps: 0 };
  if (!ranked.sentences.length || !budget || !budget.sections) return out;
  const top = ranked.sentences[0].score;
  const focus = [...env.qm.focus];
  const titleSets = new Map();
  const titleOf = (di) => { let t = titleSets.get(di); if (!t) { t = new Set(stemsOf(docs[di].title || '')); titleSets.set(di, t); } return t; };
  const onTopic = (s) => !focus.length || focus.every((f) => s.stems.has(f)) || docs[s.di].entity || focus.every((f) => titleOf(s.di).has(f));
  const usable = (s) => (s.type === 'p' || (s.type === 'list' && s.text.length >= 60)) && !s.dangling && s.text.length >= 50 && s.text.length <= 420 && !/[?:]\s*$/.test(s.text) && !env.used.has(`${s.pi}:${s.si}`) && onTopic(s);
  const all = ranked.sentences.filter((s) => s.score >= top * 0.16).slice(0, 3000).filter(usable);
  const pool = all.filter((s) => !s.gapOnly && !s.proc);
  const originOf = (di) => (docs[di].group != null ? `g${docs[di].group}` : docs[di].origin);
  const heads = new Map();
  const headOf = (s) => { let h = heads.get(s.heading); if (!h) { h = new Set(stemsOf(s.heading || '')); heads.set(s.heading, h); } return h; };

  // ---- one section per sub-topic that has evidence from at least two independent sources ----
  const sections = [];
  aspects.forEach((a, index) => {
    const match = aspectMatcher(a);
    const has = (s) => match(s.stems) || (s.cov >= 0.3 && match(s.stems, headOf(s)));       // in the sentence itself, or in the sentence and the heading it stands under
    const cands = pool.filter(has);
    const origins = new Set(cands.map((s) => originOf(s.di)));
    if (cands.length >= 2 && origins.size >= 2) sections.push({ a, index, cands, origins: origins.size });
  });
  sections.sort((x, y) => y.origins - x.origins || y.cands.length - x.cands.length);
  for (const sec of sections.slice(0, budget.sections)) {
    // A sentence that is quoted already, or stands word for word on another site, is not quoted again. Where there is a
    // choice, neither is one that repeats an earlier statement in other words, nor a second one from a source already quoted.
    const sorted = sec.cands.map((s) => s).sort((x, y) => y.score * (1 + 0.08 * ((y.support || 1) - 1)) - x.score * (1 + 0.08 * ((x.support || 1) - 1)));
    const free = (s) => !env.taken(s);
    const novel = (s) => free(s) && !env.quoted.some((q) => q.di === s.di) && !env.repeats(s);
    const picks = mmr(sorted, budget.perSection + 2, { maxPerDoc: 1, dupSim: 0.5, filter: novel, same: env.sameFinding });
    if (picks.length < budget.perSection) for (const s of mmr(sorted, budget.perSection + 2, { maxPerDoc: 1, dupSim: 0.5, filter: free })) if (!picks.includes(s)) picks.push(s);
    const items = [];
    const add = (s) => { const sp = env.quote(s); if (sp) items.push({ spans: [sp] }); };
    for (const s of picks) { if (items.length >= budget.perSection) break; if (novel(s)) add(s); }
    for (const s of picks) { if (items.length >= budget.perSection) break; if (free(s)) add(s); }
    if (items.length < 2) continue;
    out.blocks.push({ type: 'heading', text: sec.a.label, level: 2, subtopic: true }, { type: 'list', ordered: false, items });
    out.sections.push({ label: sec.a.label, statements: items.length, origins: sec.origins, index: sec.index, from: sec.a.source });
  }

  if (mode === 'research') {
    // ---- figures ----
    if (!['quantity', 'time'].includes(part.answerType)) {
      const cand = pool.filter((s) => FIGURE.test(s.text) && s.cov >= 0.45 && s.directCov >= 0.5 && !s.intro && !s.nonHuman && !s.otherEntity && !SETUP.test(s.text) && !env.used.has(`${s.pi}:${s.si}`));
      // A figure that a large share of the sources repeat is part of the topic's definition ("smaller than 5 mm"), not a finding:
      // a sentence is listed for a figure of its own.
      const figs = new Map(), share = new Map();
      for (const s of cand) { const keys = figureKeys(s.text); figs.set(s, keys); const o = originOf(s.di); for (const k of keys) { let set = share.get(k); if (!set) share.set(k, (set = new Set())); set.add(o); } }
      const sourcesWithFigures = new Set(cand.map((s) => originOf(s.di))).size;
      const stock = (k) => share.get(k).size >= Math.max(4, Math.ceil(sourcesWithFigures * 0.12));
      const nums = cand.filter((s) => figs.get(s).some((k) => !stock(k)));
      if (new Set(nums.map((s) => originOf(s.di))).size >= 3) {
        const items = [], shown = new Set();
        for (const s of mmr(nums, 10, { maxPerDoc: 1, dupSim: 0.5 })) {
          if (items.length >= 4) break;
          const own = figs.get(s).filter((k) => !stock(k));
          if (own.every((k) => shown.has(k))) continue;                    // the same figure is not listed twice
          const sp = env.quote(s);
          if (sp) { items.push({ spans: [sp] }); for (const k of own) shown.add(k); }
        }
        if (items.length >= 3) { out.blocks.push({ type: 'heading', text: 'Figures the sources report', level: 2 }, { type: 'list', ordered: false, items }); out.figures = items.length; }
      }
    }
    // ---- dated statements, in order ----
    if (part.answerType !== 'time') {
      const thisYear = new Date(env.ctx.now || Date.now()).getUTCFullYear();
      const byYear = new Map();
      for (const s of pool) {
        if (s.score < top * 0.25 || env.used.has(`${s.pi}:${s.si}`)) continue;
        const ds = findDates(s.text).filter((d) => d.year >= 1000 && d.year <= thisYear && yearInContext(s.text, d.year));
        if (ds.length !== 1 || !/\b(was|were|began|started|founded|introduced|discovered|invented|published|launched|passed|banned|adopted|signed|announced|reported|first|became|established|created|coined|approved|released|ended|died|born|occurred|emerged)\b/i.test(s.text)) continue;
        const y = ds[0].year;
        if (!byYear.has(y) || byYear.get(y).score < s.score) byYear.set(y, s);
      }
      if (byYear.size >= 4) {
        const chosen = [...byYear].sort((a, b) => b[1].score - a[1].score).slice(0, 8).sort((a, b) => a[0] - b[0]);
        const items = [];
        for (const [y, s] of chosen) { const sp = env.quote(s); if (sp) items.push({ spans: [span(`${y} — `, []), sp] }); }
        if (items.length >= 4 && new Set(chosen.map(([, s]) => originOf(s.di))).size >= 2) { out.blocks.push({ type: 'heading', text: 'Dated statements, in order', level: 2 }, { type: 'list', ordered: false, items }); out.timeline = items.length; }
      }
    }
  }

  // ---- what the sources say is not known yet ----
  // about the asked matter itself, not about a neighbouring one — and saying what is not known, not merely that more study is wanted
  const gaps = all.filter((s) => s.gapOnly && !s.proc && s.directCov >= 0.6 && s.predCov >= 0.5 && s.text.length <= 300 && !(BARE_CALL.test(s.text) && !STATES_GAP.test(s.text)));
  // with a question about something ("is X good for Y?") these are the limits of what is known about it; for a topic on its own they are its open questions
  const asksAbout = !!part.attribute || ['yesno', 'reason', 'mechanism', 'quantity', 'time', 'person', 'place', 'comparison'].includes(part.answerType);
  if (!asksAbout) for (let i = gaps.length - 1; i >= 0; i--) if (!OPEN_ISSUE.test(gaps[i].text)) gaps.splice(i, 1);
  if (new Set(gaps.map((s) => originOf(s.di))).size >= 2) {
    const items = [];
    gaps.sort((x, y) => (y.support || 1) - (x.support || 1) || y.score - x.score);          // the best-supported statements first
    const taken = [];
    for (const s of gaps) {
      if (items.length >= (mode === 'research' ? 3 : 2)) break;
      if (taken.some((c) => c.di === s.di || simSets(c.stems, s.stems) >= 0.45)) continue;
      const sp = env.quote(s);
      if (sp) { taken.push(s); items.push({ spans: [sp] }); }
    }

    if (items.length >= 2) { out.blocks.push({ type: 'heading', text: asksAbout ? 'What the sources say is still uncertain' : 'Open questions the sources name', level: 2 }, { type: 'list', ordered: false, items }); out.gaps = items.length; }
  }

  // ---- where sources differ ----
  const sample = ranked.sentences.filter((s) => s.score >= top * 0.3 && s.type === 'p' && !s.dangling && !s.proc && s.text.length >= 50 && s.text.length <= 360 && !/\?\s*$/.test(s.text) && onTopic(s)).slice(0, 90);
  const conflicts = detectConflicts(sample.map((s) => ({ text: s.text, stems: s.stems, origin: originOf(s.di) })), { minSim: 0.55 });
  const shown = new Set();
  const items = [];
  for (const c of conflicts.sort((x, y) => y.sim - x.sim)) {
    if (items.length >= (mode === 'research' ? 3 : 2)) break;
    const A = sample[c.a], B = sample[c.b];
    if (shown.has(A) || shown.has(B) || (c.kind !== 'negation' && figuresAgree(A.text, B.text))) continue;
    const a = env.used.has(`${A.pi}:${A.si}`) ? null : env.quote(A), b = env.used.has(`${B.pi}:${B.si}`) ? null : env.quote(B);
    if (!a || !b) continue;
    shown.add(A); shown.add(B);
    items.push({ spans: [a, span('— but another source: ', []), b] });
  }
  if (items.length) {
    out.blocks.push({ type: 'heading', text: 'Where the sources differ', level: 2 }, { type: 'list', ordered: false, items }, { type: 'note', tone: 'warn', text: 'These pairs were picked by rule: two sources make closely matching statements that differ in a figure, a date or a negation. Read both passages before relying on either.' });
    out.differences = items.length;
  }
  return out;
}
