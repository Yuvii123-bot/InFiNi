// INFINI AI — research benchmark (live retrieval). Runs a few deep and research-depth questions one after another and
// records what really happened: pages read, abstracts taken in, sites, results screened, time, memory, drafts, sections.
// Every figure is counted by the engine or measured here; nothing is estimated. The numbers depend on the network
// address the run comes from (which search services answer it) and on the day (services have outages and allowances).
// Usage: node bench/research.js [--only <n>]   → bench/results/research.{json,md}
import fs from 'node:fs';
import { createEngine, loadConfig } from '../engine/index.js';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const only = Number(arg('--only', 0));
const ITEMS = [
  { depth: 'auto', q: 'Do deep research on the health effects of microplastics', field: 'medicine' },
  { depth: 'auto', q: 'Do deep research on the impact of remote work on productivity', field: 'social science' },
  { depth: 'auto', q: 'Do deep research on solid-state batteries', field: 'technology' },
  { depth: 'deep', q: 'Is intermittent fasting good for weight loss?', field: 'medicine, yes/no' },
  { depth: 'deep', q: 'Why did the Roman Empire fall?', field: 'history, why' },
].filter((_, i) => !only || i + 1 === only);

const cfg = loadConfig();
const engine = createEngine(cfg);
const rows = [];
for (const item of ITEMS) {
  const t0 = Date.now();
  let peak = 0, firstDraft = 0, drafts = 0, progress = 0;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 250);
  let r = null, err = '';
  try {
    r = await engine.ask({ question: item.q, settings: { depth: item.depth } }, { onEvent: (ev) => { if (ev.type === 'draft') { drafts++; if (!firstDraft) firstDraft = Date.now() - t0; } else if (ev.type === 'progress') progress++; } });
  } catch (e) { err = String(e && e.message); }
  clearInterval(timer);
  peak = Math.max(peak, process.memoryUsage().rss);
  if (!r) { rows.push({ q: item.q, error: err }); console.log(`✗ ${item.q} — ${err}`); continue; }
  const run = r.run || {}, T = r.classification ? r.classification.totals : {}, C = r.research ? r.research.counts : {};
  const by = {};
  for (const s of (r.research && r.research.searches) || []) { const e = (by[s.provider] = by[s.provider] || { ok: 0, failed: 0, results: 0 }); if (s.ok) { e.ok++; e.results += s.results || 0; } else e.failed++; }
  const facet = (id) => { const f = r.classification && r.classification.facets.find((x) => x.id === id); return f ? f.values.slice(0, 6).map((v) => `${v.label} ${v.count}`).join(', ') : ''; };
  const row = {
    q: item.q, field: item.field, asked: item.depth, used: r.depth ? r.depth.used : '', limited: (r.depth && r.depth.limited) || '',
    seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), firstDraftSeconds: firstDraft ? Number((firstDraft / 1000).toFixed(1)) : null, drafts, progressEvents: progress,
    rounds: run.rounds || 1, pagesRead: C.pagesFetched || 0, pagesFailed: C.pagesFailed || 0, abstracts: run.abstracts || 0, documents: T.documents || 0, fullText: T.fullText || 0, sites: T.sites || 0, origins: T.origins || 0,
    screened: T.screened || 0, searches: C.searches || 0, megabytes: Number(((C.bytes || 0) / 1048576).toFixed(1)), linksFollowed: run.linksFollowed || 0, stopped: run.stopped || '',
    confidence: r.confidence ? `${r.confidence.label} ${Math.round(r.confidence.score * 100)}%` : '', cited: r.sources.length, statements: C.claims || 0,
    sections: run.subtopics || [], report: run.report || null, tally: (r.answer.blocks.find((b) => b.type === 'tally') || null),
    failures: T.failures || {}, providers: by, kinds: facet('source'), documentsByKind: facet('doc'), studies: facet('study'),
    resultKB: Math.round(JSON.stringify(r).length / 1024), peakRssMB: Math.round(peak / 1048576), lead: r.answer.text.replace(/\s+/g, ' ').slice(0, 260),
  };
  rows.push(row);
  console.log(`✓ ${item.q}\n   ${row.used} · ${row.seconds} s · ${row.pagesRead} pages read (${row.pagesFailed} not readable) · ${row.abstracts} abstracts · ${row.documents} documents · ${row.sites} sites · ${row.screened} screened · ${row.cited} cited · ${row.confidence} · peak ${row.peakRssMB} MB`);
}
const st = engine.status();
engine.close();
const keys = Object.entries(cfg.keys || {}).filter(([, v]) => v).map(([k]) => k);
const out = { date: new Date().toISOString(), version: st.version, node: process.version, searchKeysConfigured: keys, contactConfigured: st.contactConfigured, budget: { maxPages: cfg.research.maxPages, maxSeconds: cfg.research.maxSeconds, concurrency: cfg.research.concurrency }, rows };
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/research.json', import.meta.url), JSON.stringify(out, null, 2));
const ok = rows.filter((r) => !r.error);
const md = [
  `# Research benchmark — ${out.date.slice(0, 16)}Z`, '',
  `Version ${out.version} · ${out.node} · search keys configured: ${keys.length ? keys.join(', ') : 'none (keyless services only)'} · budget of a research run: up to ${cfg.research.maxPages} pages, ${cfg.research.maxSeconds} s, ${cfg.research.concurrency} pages at a time.`, '',
  'Every figure is counted by the engine or measured by this script. “Pages read” are pages whose text was fetched and read; an abstract delivered by a scholarly index is counted as an abstract, never as a page. The page budget is a ceiling: a run ends earlier when new searches stop bringing new material.', '',
  '| Question | Depth used | Time | First draft | Rounds | Pages read | Not readable | Abstracts | Documents kept | Sites | Results screened | Cited | Confidence | Peak memory |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...ok.map((r) => `| ${r.q} | ${r.used} | ${r.seconds} s | ${r.firstDraftSeconds == null ? '–' : r.firstDraftSeconds + ' s'} | ${r.rounds} | ${r.pagesRead} | ${r.pagesFailed} | ${r.abstracts} | ${r.documents} | ${r.sites} | ${r.screened} | ${r.cited} | ${r.confidence} | ${r.peakRssMB} MB |`),
  '', '## Details', '',
  ...ok.flatMap((r) => [`### ${r.q}`, '', `- Ended because: ${r.stopped || 'n/a'}. Searches: ${r.searches}. Data read: ${r.megabytes} MB. Links followed from pages: ${r.linksFollowed}. Result size: ${r.resultKB} kB.`,
    `- Search services: ${Object.entries(r.providers).map(([p, v]) => `${p} ${v.ok} ok${v.failed ? `/${v.failed} failed` : ''} (${v.results} results)`).join('; ')}.`,
    `- Pages that could not be read: ${Object.entries(r.failures).map(([k, v]) => `${v} × ${k}`).join('; ') || 'none'}.`,
    `- Kind of source: ${r.kinds}.`, `- Kind of document: ${r.documentsByKind}.`, r.studies ? `- Study design: ${r.studies}.` : '',
    r.sections.length ? `- Report sections: ${r.sections.join(' · ')}${r.report ? ` (figures ${r.report.figures}, dated statements ${r.report.timeline}, still uncertain ${r.report.uncertain}, differences ${r.report.differences})` : ''}.` : '- Report sections: none.',
    r.tally ? `- Count of how the sources lean: ${r.tally.yes} yes, ${r.tally.no} no, ${r.tally.qualified} qualified, of ${r.tally.sources} independent sources.` : '',
    `- Start of the answer: “${r.lead}”`, ''].filter((x) => x !== '')),
  ...rows.filter((r) => r.error).map((r) => `- FAILED: ${r.q} — ${r.error}`),
].join('\n');
fs.writeFileSync(new URL('./results/research.md', import.meta.url), md + '\n');
console.log(`\n${ok.length}/${rows.length} runs completed → bench/results/research.md`);
