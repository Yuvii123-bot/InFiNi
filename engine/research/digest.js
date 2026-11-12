// INFINI AI — page digests.
// A research run reads far more pages than can be kept whole in memory or ranked sentence by sentence each round.
// Right after a page is extracted it is therefore measured against the question, and only its opening paragraphs and
// the blocks that bear on the question are kept (each remembering where it stood in the page). A page that never
// touches the topic is recorded as "read, not relevant" and its text is dropped.

import { docPassages, stemsOf, relationCue, relationStems } from '../rank/rank.js';

const GENERIC_HEADING = /^(introduction|intro|overview|background|abstract|summary|conclusions?|discussion|results?|methods?|methodology|materials and methods|references|related|related (articles|posts|stories|content|topics)|see also|further reading|external links|notes|footnotes|contents|table of contents|about|about (us|the author|this article)|contact|share|comments?|leave a (reply|comment)|faqs?|frequently asked questions|key takeaways|takeaways|bottom line|the bottom line|final thoughts|in conclusion|acknowledge?ments|funding|funding (information|statement|sources?)|author contributions|authors?[’']? contributions?|contributions|credit authorship contribution statement|declarations?|declaration of (competing )?interests?|ethics( statement| approval)?|ethical (approval|considerations)|informed consent|consent for publication|institutional review board statement|publisher[’']?s note|additional information|rights and permissions|about this article|cite this article|author information|authors and affiliations|corresponding authors?|conflicts? of interest|competing interests|data availability|supplementary (material|information)|abbreviations|keywords|highlights|more (from|on|stories)|read more|recommended|popular|latest|newsletter|subscribe|sources|citations|disclaimer|what to know|what you need to know)$/i;

/**
 * Measure a page against the weighted vocabulary of the question.
 * model: { terms: Map(stem → weight) — the question's terms (and, at low weight, sub-topic terms), core: Set of the
 *          stems that must carry the score, focus: Set(stems of the topic) }
 * Returns { rel 0..1, blocks (kept, in page order, each with .pos), outline: [headings], stats }.
 */
export function digestDoc(doc, model, { keep = 8, lead = 2, floor = 0.34 } = {}) {
  const { terms, focus } = model;
  let coreTotal = 0;
  for (const [st, w] of terms) if (model.core.has(st)) coreTotal += w;
  coreTotal = coreTotal || 1;
  const titleSet = new Set(stemsOf(doc.title || ''));
  // rel: the passage states the asked relation in other words ("X causes …" for a question about the effects of X)
  const cover = (set, extra, rel = false) => { let got = 0; for (const [st, w] of terms) { if (set.has(st)) got += model.core.has(st) ? w : 0.5 * w; else if (rel && model.relStems.has(st)) got += 0.75 * w; else if (extra && model.core.has(st) && extra.has(st)) got += 0.5 * w; } return Math.min(1.25, got / coreTotal); };
  const passages = docPassages(doc, 0);
  const outline = [];
  for (const b of doc.blocks || []) if (b.type === 'heading' && b.level <= 3 && b.text && b.text.length <= 90 && !GENERIC_HEADING.test(b.text.trim()) && outline.length < 40) outline.push({ text: b.text, level: b.level });
  const stats = { passages: passages.length, paragraphs: 0, lists: 0, tables: 0, code: 0, orderedLists: 0, questions: 0, chars: 0, numbers: 0, firstPerson: 0, quotes: 0 };
  let topicSeen = !focus.size, best = 0;
  const scored = passages.map((p) => {
    const set = new Set(stemsOf(p.text));
    const head = new Set(stemsOf(p.heading));
    stats.chars += p.text.length;
    if (p.type === 'p') { stats.paragraphs++; if (/\b(I|we|my|our)\b/.test(p.text)) stats.firstPerson++; if (/["“][^"”]{20,}["”]/.test(p.text)) stats.quotes++; if (/\d/.test(p.text)) stats.numbers++; }
    else if (p.type === 'list') { stats.lists++; if (p.block.ordered) stats.orderedLists++; }
    else if (p.type === 'table') stats.tables++;
    else if (p.type === 'code') stats.code++;
    if (/\?\s*$/.test(p.heading || '')) stats.questions++;
    if (!topicSeen) { let all = true; for (const f of focus) if (!set.has(f) && !head.has(f)) { all = false; break; } if (all) topicSeen = true; }
    let named = focus.size > 0 && !!model.relCue;
    if (named) for (const f of focus) if (!set.has(f) && !head.has(f) && !titleSet.has(f)) { named = false; break; }
    const cov = cover(set, new Set([...head, ...titleSet]), named && model.relCue.test(p.text));
    if (cov > best) best = cov;
    return { p, cov };
  });
  const titleCov = cover(titleSet, null);
  // a page is relevant when some passage covers the question well; a title that matches is worth something by itself
  let rel = Math.max(best, 0.6 * titleCov + 0.4 * best);
  if (!topicSeen) rel *= 0.5;                                    // the topic is never named in full anywhere on the page
  rel = Math.min(1, rel);
  if (rel < floor) return { rel, blocks: [], outline, stats, offTopic: true };
  const bar = Math.max(0.3, best * 0.5);
  const chosen = new Set();
  scored.filter((x) => x.p.type === 'p').slice(0, lead).forEach((x) => chosen.add(x));
  [...scored].sort((a, b) => b.cov - a.cov).filter((x) => x.cov >= bar).slice(0, keep).forEach((x) => chosen.add(x));
  const blocks = scored.filter((x) => chosen.has(x)).map((x) => ({ ...x.p.block, pos: x.p.order }));
  return { rel, blocks, outline, stats, offTopic: false };
}

/** The weighted vocabulary used for digests: the terms of every part of the question, plus sub-topic terms at low weight. */
export function digestModel(parts, extra = null) {
  const terms = new Map(), core = new Set(), focus = new Set();
  for (const p of parts) {
    for (const t of p.terms) { if (t.weight >= 0.5) { terms.set(t.stem, Math.max(terms.get(t.stem) || 0, t.weight)); core.add(t.stem); } }
    for (const t of p.expansions || []) if (!terms.has(t.stem)) terms.set(t.stem, Math.min(0.6, t.weight));
    for (const st of stemsOf(p.focus || '')) focus.add(st);
  }
  if (extra) for (const [st, w] of extra) if (!terms.has(st)) terms.set(st, w);
  const attribute = parts[0] && ['list', 'attribute', 'person', 'place', 'time', 'quantity', 'entity'].includes(parts[0].answerType) ? parts[0].attribute || '' : '';
  const relCue = attribute ? relationCue(attribute) : null;
  const relStems = relCue ? relationStems(attribute) : new Set();
  return { terms, core, focus, relCue, relStems };
}

export { GENERIC_HEADING };
