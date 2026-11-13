// INFINITY LLM — learning: verification. A document is not believed because it exists, and a statement is not believed
// because it is repeated. What counts is agreement between *independent* origins (different publishers), the standing
// of the source, and the absence of contradiction. The result is a score, not a yes/no: uncertainty stays on the record.

import { classifySource, detectConflicts } from '../engine/evidence/evidence.js';
import { termSet, jaccard, domainOf } from '../engine/util/text.js';
import { goodSentences } from './process.mjs';

/** Statements that can be checked: sentences that carry a number or a year. */
function checkable(doc, max = 24) {
  const out = [];
  for (const p of doc.paras) for (const s of goodSentences(p.text)) { if (/\d/.test(s)) out.push(s); if (out.length >= max) return out; }
  return out;
}
export const originOf = (doc) => doc.origin || doc.publisher || domainOf(doc.url);

/**
 * Compare the checkable statements of `docs` with each other and with `known` (earlier accepted documents).
 * Adds doc.verification = { status, score, sourceQuality, corroborated, disputed: [{text, against, kind, detail}] }.
 * Disputed sentences are listed so the dataset builder can leave them out; nothing is silently "resolved".
 */
export function verifyDocuments(docs, known = [], { minScore = 0.55 } = {}) {
  const all = [...known, ...docs];
  const claims = [];
  for (const d of all) for (const s of (d._claims || (d._claims = checkable(d)))) claims.push({ text: s, stems: termSet(s), origin: originOf(d), doc: d });
  // candidate pairs through an inverted index on rarer terms, so the comparison stays near-linear
  const index = new Map();
  claims.forEach((c, i) => { for (const t of c.stems) { if (t.length < 4) continue; let l = index.get(t); if (!l) index.set(t, (l = [])); l.push(i); } });
  const pairSeen = new Set(), support = new Map(), disputes = new Map(), claimFor = new Map(), claimAgainst = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const list of index.values()) {
    if (list.length < 2 || list.length > 60) continue;
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const a = list[x], b = list[y];
      if (claims[a].origin === claims[b].origin) continue;         // the same publisher agreeing with itself proves nothing
      const key = a * 1e7 + b;
      if (pairSeen.has(key)) continue;
      pairSeen.add(key);
      const sim = jaccard(claims[a].stems, claims[b].stems);
      if (sim < 0.5) continue;
      const conflict = detectConflicts([claims[a], claims[b]]);
      if (conflict.length) {
        for (const [me, other] of [[a, b], [b, a]]) { const l = disputes.get(claims[me].doc) || []; l.push({ text: claims[me].text, against: claims[other].doc.url, kind: conflict[0].kind, detail: conflict[0].detail, _c: me }); disputes.set(claims[me].doc, l); bump(claimAgainst, me); }
      } else if (sim >= 0.6) { for (const me of [a, b]) { bump(support, claims[me].doc); bump(claimFor, me); } }
    }
  }
  for (const d of docs) {
    const src = classifySource(d.publisherUrl || d.url, {});
    const sourceQuality = typeof d.sourceQuality === 'number' ? d.sourceQuality : src.quality;
    const corroborated = support.get(d) || 0;
    // A contradicted statement that more independent sources support than oppose weighs less than one that stands alone
    // against the others. Either way it is listed, and the dataset builder leaves every listed sentence out.
    let weight = 0, outweighed = 0;
    const disputed = (disputes.get(d) || []).map(({ _c, ...x }) => { const f = claimFor.get(_c) || 0, ag = claimAgainst.get(_c) || 0; if (f > ag) weight += 0.25; else { weight += 1; outweighed++; } return { ...x, supportedBy: f, contradictedBy: ag }; }).slice(0, 20);
    const nClaims = Math.max(1, d._claims.length);
    const licenceClarity = d.licence && d.licence.basis === 'declared' ? 1 : d.licence && d.licence.id ? 0.8 : 0;
    let score = 0.5 * sourceQuality + 0.15 * licenceClarity + 0.2 * (d.textQuality ?? 0.8) + 0.15 * Math.min(1, corroborated / 3);
    score -= Math.min(0.3, 0.6 * weight / nClaims);
    score = Math.max(0, Math.min(1, +score.toFixed(3)));
    const status = outweighed && outweighed >= corroborated ? 'disputed' : corroborated > 0 ? 'corroborated' : 'single-source';
    // a single unknown website with nobody agreeing is held back until something independent supports it
    const admitted = score >= minScore && (status === 'corroborated' || (status === 'single-source' && (d.trusted || sourceQuality >= 0.78)) || (status === 'disputed' && d.trusted && score >= minScore + 0.05));
    d.verification = { status, score, sourceQuality: +sourceQuality.toFixed(2), category: d.sourceCategory || src.category, corroborated, checkable: d._claims.length, disputed, admitted, reason: admitted ? '' : status === 'single-source' ? 'no independent source supports it yet and the source is not a vetted one' : status === 'disputed' ? 'other sources contradict it' : `verification score ${score} is below ${minScore}` };
  }
  for (const d of all) delete d._claims;
  return docs;
}
