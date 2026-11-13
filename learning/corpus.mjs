// INFINITY LLM — learning: one acquisition pass. Collect → licence gate → clean → language → quality / spam / poisoning
// → duplicates → verification → corpus. Every document ends up in documents.jsonl (accepted, with its provenance) or in
// rejected.jsonl (with the reason); nothing is dropped without a trace.

import fs from 'node:fs';
import { collect } from './sources.mjs';
import { permitted } from './licence.mjs';
import { cleanBlocks, inspectText, languageOf, simhash, hamming, sha256 } from './process.mjs';
import { verifyDocuments } from './verify.mjs';
import { paths, readJSON, writeJSON, appendLine, readLines, nowISO } from './store.mjs';
import { domainOf, canonicalUrl } from '../engine/util/text.js';

export function loadCorpus(root) { return readLines(paths(root).docs); }
export function loadSeen(root) { const s = readJSON(paths(root).seen, null) || {}; return { urls: s.urls || {}, cursors: s.cursors || {}, frontier: s.frontier || [] }; }
/** Which side of the train/validation split a document is on: decided by its content hash, so it never changes. */
export const splitOf = (contentHash) => (parseInt(contentHash.slice(0, 8), 16) % 10 === 0 ? 'val' : 'train');

export async function acquire({ engine, cfg, root, cycle, signal = null, env = process.env, note = () => {}, maxDocs = cfg.cycle.maxNewDocs }) {
  const P = paths(root);
  fs.mkdirSync(P.corpus, { recursive: true });
  const st = loadSeen(root);
  const corpus = loadCorpus(root);
  const hashes = new Set(corpus.map((d) => d.contentHash));
  const sims = corpus.map((d) => d.simhash);
  const report = { collected: 0, accepted: 0, rejected: 0, reasons: {}, bySource: {}, tokensEstimate: 0, errors: [] };
  const reject = (c, stage, reason, extra = {}) => {
    report.rejected++; report.reasons[stage] = (report.reasons[stage] || 0) + 1;
    const bs = report.bySource[c.source] || (report.bySource[c.source] = { collected: 0, accepted: 0, rejected: 0 }); bs.rejected++;
    appendLine(P.rejected, { url: c.url, domain: domainOf(c.url), source: c.source, title: (c.title || '').slice(0, 160), collectedAt: c.collectedAt, cycle, stage, reason, licence: c.licence || null, ...extra });
    st.urls[c.url] = { t: c.collectedAt, status: 'rejected:' + stage, sha: c.sha || '' };
  };
  const pending = [];
  let left = maxDocs;
  for (const src of cfg.sources.filter((s) => s.enabled !== false)) {
    if (left <= 0 || (signal && signal.aborted)) break;
    let got = [];
    try { got = await collect(engine, src, st, Math.min(left, src.perCycle || left), { env, signal, note }); }
    catch (e) { const msg = `${src.id}: ${String(e && e.message).slice(0, 200)}`; report.errors.push(msg); note(`source unavailable — ${msg}`); continue; }
    left -= got.length;
    for (const c of got) {
      report.collected++;
      const bs = report.bySource[c.source] || (report.bySource[c.source] = { collected: 0, accepted: 0, rejected: 0 }); bs.collected++;
      if (c.error) { reject(c, c.error === 'not a document' ? 'format' : 'fetch', c.error); continue; }
      // the licence gate comes first: text that may not be used is not kept, not even for inspection
      if (c.optOut) { reject(c, 'opt-out', `the page asks not to be used for AI training (${c.optOut})`); continue; }
      if (!permitted(c.licence && c.licence.id, cfg.licences)) { reject(c, 'licence', c.licence && c.licence.id ? `licence ${c.licence.id} does not permit this use or is not on the allow-list` : 'no licence that permits reuse was found'); continue; }
      const paras = cleanBlocks(c.blocks);
      const text = paras.map((p) => p.text).join('\n');
      const lang = languageOf(text);
      if (!cfg.quality.languages.includes(lang)) { reject(c, 'language', `language detected: ${lang}`); continue; }
      const q = inspectText(paras, cfg.quality, { title: c.title });
      if (!q.ok) { reject(c, /AI system|machine-generated/.test(q.reasons.join(' ')) ? 'poisoning' : /spam|promotional|stuffing/.test(q.reasons.join(' ')) ? 'spam' : 'quality', q.reasons.join('; '), { stats: q.stats }); continue; }
      const contentHash = sha256(text);
      if (hashes.has(contentHash)) { reject(c, 'duplicate', 'identical text is already in the corpus'); continue; }
      const sh = simhash(text);
      const near = sims.findIndex((s) => s && hamming(s, sh) <= cfg.quality.nearDupHamming);
      if (near >= 0) { reject(c, 'near-duplicate', `almost identical to ${corpus[near] ? corpus[near].url : 'a document collected in this cycle'}`); continue; }
      hashes.add(contentHash); sims.push(sh);
      pending.push({ ...c, paras, contentHash, simhash: sh, lang, textQuality: q.score, stats: q.stats });
    }
  }
  // verification against everything already accepted and against each other
  verifyDocuments(pending, corpus, { minScore: cfg.quality.minScore });
  // no single unvetted website may dominate what a cycle learns from (limits what one poisoned site can do)
  const perDomain = new Map();
  const untrusted = pending.filter((d) => !d.trusted && d.verification.admitted).length;
  const accepted = [];
  for (const d of pending) {
    if (!d.verification.admitted) { reject(d, 'verification', d.verification.reason, { verification: { status: d.verification.status, score: d.verification.score } }); continue; }
    const dom = domainOf(d.url);
    if (!d.trusted) { const n = (perDomain.get(dom) || 0) + 1; if (untrusted >= 5 && n > Math.max(2, Math.ceil(untrusted * cfg.quality.maxDomainShare))) { reject(d, 'domain-cap', `more than ${Math.round(cfg.quality.maxDomainShare * 100)}% of this cycle's new documents would come from ${dom}`); continue; } perDomain.set(dom, n); }
    const rec = {
      id: 'doc_' + d.contentHash.slice(0, 16), url: d.url, canonicalUrl: canonicalUrl(d.url), domain: dom, source: d.source, publisher: d.publisher || '', title: (d.title || '').slice(0, 200), author: d.author || '', lang: d.lang,
      collectedAt: d.collectedAt, published: d.published || '', modified: d.modified || '', cycle,
      licence: d.licence, attribution: `${d.title || d.url} — ${d.publisher || dom} (${d.licence.id}) ${d.url}`,
      contentHash: d.contentHash, simhash: d.simhash, split: splitOf(d.contentHash),
      extraction: { ...d.extraction, paragraphs: d.paras.length, chars: d.stats.chars, discoveredBy: d.discoveredBy || d.sourceType, query: d.query || '' },
      quality: { text: d.textQuality, stats: d.stats },
      verification: { status: d.verification.status, score: d.verification.score, sourceQuality: d.verification.sourceQuality, category: d.verification.category, corroborated: d.verification.corroborated, checkable: d.verification.checkable, disputed: d.verification.disputed },
      weight: +(0.5 + d.verification.score / 2).toFixed(3),            // quality weighting: better-verified text is sampled more often
      paras: d.paras,
    };
    appendLine(P.docs, rec);
    st.urls[d.url] = { t: d.collectedAt, status: 'accepted', sha: d.sha || '' };
    accepted.push(rec);
    report.accepted++; report.bySource[d.source].accepted++;
    report.tokensEstimate += Math.round(d.stats.chars / 3.6);
    // new topics for later cycles: names that the accepted text keeps mentioning
    if (d.sourceType === 'web') {
      const names = new Map();
      for (const m of d.paras.map((p) => p.text).join(' ').matchAll(/\b([A-Z][a-z]{3,}(?: [A-Z][a-z]{3,}){0,2})\b/g)) names.set(m[1], (names.get(m[1]) || 0) + 1);
      for (const [n, k] of [...names].sort((a, b) => b[1] - a[1]).slice(0, 3)) if (k >= 4 && !st.frontier.includes(n) && st.frontier.length < 400) st.frontier.push(n);
    }
  }
  writeJSON(P.seen, st);
  report.finished = nowISO();
  return { accepted, report };
}

/** Counts for the dashboard, straight from the files. */
export function corpusStats(root) {
  const docs = loadCorpus(root);
  const rejected = readLines(paths(root).rejected);
  const by = (list, f) => { const m = {}; for (const x of list) { const k = f(x) || '—'; m[k] = (m[k] || 0) + 1; } return m; };
  const mean = (l) => (l.length ? +(l.reduce((a, b) => a + b, 0) / l.length).toFixed(3) : null);
  return {
    documents: docs.length, train: docs.filter((d) => d.split === 'train').length, validation: docs.filter((d) => d.split === 'val').length,
    chars: docs.reduce((a, d) => a + ((d.quality && d.quality.stats && d.quality.stats.chars) || 0), 0),
    byLicence: by(docs, (d) => d.licence && d.licence.id), bySource: by(docs, (d) => d.source), byVerification: by(docs, (d) => d.verification && d.verification.status),
    meanVerificationScore: mean(docs.map((d) => d.verification.score)), meanTextQuality: mean(docs.map((d) => d.quality.text)),
    disputedStatements: docs.reduce((a, d) => a + ((d.verification.disputed || []).length), 0),
    rejected: rejected.length, rejectedByStage: by(rejected, (r) => r.stage),
    acceptanceRate: docs.length + rejected.length ? +(docs.length / (docs.length + rejected.length)).toFixed(3) : null,
    lastCollected: docs.length ? docs[docs.length - 1].collectedAt : null,
  };
}
