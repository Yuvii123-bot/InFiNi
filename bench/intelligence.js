// INFINI AI — intelligence benchmark (live retrieval).
// 12 categories × 3 items, each scored 0..1 on nine dimensions by AUTOMATIC PROXIES (regular expressions and counters).
// This is not human grading: "support" means an expected key term appears in the answer, nothing more.
// Since 2.0.0 a question may be answered by the built-in brain (kind "brain": no search, no citations by design).
// Such an item is scored on support, hallucination, uncertainty and usefulness only; the retrieval dimensions are
// left out of the averages for it, and the number of brain-answered items is reported.
// Usage: node bench/intelligence.js [--only category] [--depth balanced]   → bench/results/intelligence.{json,md}
import fs from 'node:fs';
import { createEngine, loadConfig } from '../engine/index.js';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const only = arg('--only', ''), depth = arg('--depth', 'balanced');
const Q = (cat, q, expect, opts = {}) => ({ cat, q: Array.isArray(q) ? q : [q], expect, ...opts });
const ITEMS = [
  Q('factual', 'What is the capital of Nepal?', /Kathmandu/i, { type: 'attribute' }),
  Q('factual', 'Who wrote Pride and Prejudice?', /Jane Austen/i, { type: 'person' }),
  Q('factual', 'How tall is Mount Everest?', /8[,.]?8(4[89]|50)|29[,.]?03\d/i, { type: 'quantity' }),
  Q('current', 'What happened in Nepal today?', null, { type: 'news', news: true }),
  Q('current', 'Who is the president of Nepal?', /Paudel|Poudel/i, { type: 'person' }),
  Q('current', 'Latest news about artificial intelligence', null, { type: 'news', news: true }),
  Q('science', 'Why do stars shine?', /fusion/i, { type: 'reason' }),
  Q('science', 'Why is the sky blue?', /scatter/i, { type: 'reason' }),
  Q('science', 'How does photosynthesis work?', /light|chlorophyll|carbon dioxide/i, { type: 'mechanism' }),
  Q('history', 'When did World War II end?', /1945/, { type: 'time' }),
  Q('history', 'Who was the first person to walk on the Moon?', /Armstrong/i, { type: 'person' }),
  Q('history', 'Why did the Roman Empire fall?', /invasion|barbarian|Germanic|decline|economic|migration/i, { type: 'reason' }),
  Q('technology', 'What is quantum computing?', /qubit|superposition|quantum (state|mechanic|comput)/i, { type: 'definition' }),
  Q('technology', 'How does a blockchain work?', /block|ledger|hash/i, { type: 'mechanism' }),
  Q('technology', 'What is the difference between TCP and UDP?', /connection|reliab/i, { type: 'comparison' }),
  Q('programming', 'How to remove duplicates from an array in JavaScript?', /Set|filter|indexOf/, { type: 'procedure' }),
  Q('programming', 'What does the map method do in JavaScript?', /new array|calling|function/i, {}),
  Q('programming', 'How do I reverse a string in Python?', /\[::-1\]|reversed/, { type: 'procedure' }),
  Q('comparison', 'Compare Python and Rust', /typing|programming language|paradigm/i, { type: 'comparison' }),
  Q('comparison', 'What is the difference between a virus and a bacterium?', /cell|host|living|organism/i, { type: 'comparison' }),
  Q('comparison', 'Compare the Atlantic Ocean and the Pacific Ocean', /largest|area|deep/i, { type: 'comparison' }),
  Q('multi-hop', 'Who invented the telephone and when was he born?', /1847/, {}),
  Q('multi-hop', 'What is the population of the capital of Nepal?', /Kathmandu[\s\S]*\d{3}[,.]?\d{3}/i, {}),
  Q('multi-hop', 'When was the author of Pride and Prejudice born?', /1775/, {}),
  Q('follow-up', ['Who invented the telephone?', 'When was he born?'], /1847/, { type: 'time' }),
  Q('follow-up', ['What is the capital of Nepal?', 'What is the population there?'], /\d{3}[,.]?\d{3}/, {}),
  Q('follow-up', ['Why do stars shine?', 'Explain the answer more simply.'], /fusion|energy|light/i, { type: 'reason' }),
  Q('ambiguous', 'Compare these two programming languages.', null, { abstain: 'clarification' }),
  Q('ambiguous', 'What is Mercury?', /planet|element|several meanings|I read/i, { type: 'definition', note: /several meanings|I read|Other meanings/i }),
  Q('ambiguous', 'When was he born?', null, { abstain: 'clarification' }),
  Q('conflicting', 'Who invented the telephone?', /Bell[\s\S]*(Meucci|Gray|Reis)|(Meucci|Gray|Reis)[\s\S]*Bell/i, { type: 'person' }),
  Q('conflicting', 'Was Alexander Graham Bell the first person to invent the telephone?', /disput|credited|controvers|qualified|different directions/i, { type: 'yesno' }),
  Q('conflicting', 'Is Pluto a planet?', /dwarf planet/i, { type: 'yesno' }),
  Q('unanswerable', 'What did Zorblax Quimbleton say about the 2031 Mars treaty?', null, { abstain: 'insufficient' }),
  Q('unanswerable', 'What is the phone number of the owner of the blue house on Elm Street in Springfield?', null, { abstain: 'insufficient' }),
  Q('unanswerable', 'Who will win the 2040 World Cup?', null, { abstain: 'insufficient', orNote: /cannot predict/i }),
].filter((x) => !only || x.cat === only);

const engine = createEngine(loadConfig());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitBudget = async () => { for (let i = 0; i < 40 && engine.status().wikimediaBudget < 6; i++) await sleep(3000); };
const rows = [];
for (const item of ITEMS) {
  let context = {}, r = null, err = '';
  try { for (const q of item.q) { await waitBudget(); r = await engine.ask({ question: q, context, settings: { depth } }); context = r.context; } } catch (e) { err = e.message; }
  if (!r) { rows.push({ cat: item.cat, q: item.q.join(' → '), error: err, scores: Object.fromEntries(DIMS().map((d) => [d, 0])) }); continue; }
  const text = r.answer.text, R = r.research || { searches: [], fetches: [], passages: [], counts: {} };
  const level = r.confidence ? r.confidence.level : 'none';
  const abstained = r.kind === 'clarification' || level === 'insufficient' || /could not verify this/i.test(text);
  const factoid = ['person', 'time', 'place', 'quantity', 'attribute'].includes(item.type) || item.cat === 'multi-hop' || item.cat === 'follow-up';
  const opening = item.cat === 'multi-hop' ? text : text.slice(0, factoid ? 360 : 700);          // the fact must be in the opening, not buried further down
  const matched = item.expect ? item.expect.test(opening) : null;
  const origins = new Set(r.sources.map((s) => s.origin)).size;
  const newsOk = item.news ? r.sources.filter((s) => s.published && Date.now() - Date.parse(s.published) < 8 * 86400000).length >= 2 : null;
  const good = item.abstain ? (abstained || (item.orNote ? item.orNote.test(text) : false)) : item.news ? !!newsOk : !!matched;
  // citations: every quoted statement must be found verbatim in the passage stored for its source
  const pass = R.passages || [];
  const valid = pass.filter((p) => { const s = r.sources.find((x) => x.id === p.source); return s && /^https?:\/\//.test(s.url) && (s.evidenceLevel === 'structured' || s.passages.some((x) => x.claim === p.text || x.text.includes(p.text.slice(0, 60)))); }).length;
  const searchOps = R.searches.length, searchOk = R.searches.filter((s) => s.ok && s.results > 0).length;
  const fetched = R.fetches.filter((f) => f.ok).length, failed = R.fetches.filter((f) => !f.ok).length;
  const isBrain = r.kind === 'brain';
  const typeOk = item.abstain === 'clarification' ? r.kind === 'clarification' : isBrain ? !!good : item.type ? (r.interpretation && r.interpretation.parts.some((p) => p.answerType === item.type)) : true;
  const confident = level === 'high' || level === 'medium';
  const scores = {
    understanding: typeOk ? 1 : 0,
    queries: item.abstain === 'clarification' ? 1 : searchOps ? searchOk / searchOps : 0,
    sources: item.abstain ? 1 : !r.sources.length ? 0 : 0.5 + 0.5 * Math.min(1, origins / 2),
    extraction: fetched + failed ? fetched / (fetched + failed) : 1,
    support: good ? 1 : 0,
    citations: item.abstain ? 1 : pass.length ? valid / pass.length : (r.sources.length ? 1 : 0),
    hallucination: item.abstain ? (good ? 1 : 0) : (good || !confident ? 1 : 0),          // confidently presenting an answer that misses the expected fact = 0
    uncertainty: item.abstain ? (good ? 1 : 0) : good ? 1 : (!confident ? 1 : 0),
    usefulness: item.abstain ? (good ? 1 : 0) : good ? (item.news || item.expect.test(text.slice(0, 260)) ? 1 : 0.6) : (item.expect && item.expect.test(text) ? 0.3 : 0),
  };
  if (isBrain) {                                                       // nothing was searched or cited, and an answer given from memory that misses the fact is a plain failure
    scores.queries = scores.sources = scores.extraction = scores.citations = null;
    scores.hallucination = scores.uncertainty = good ? 1 : 0;
  }
  rows.push({ cat: item.cat, q: item.q.join(' → '), kind: r.kind, level, score: r.confidence ? r.confidence.score : null, ms: r.elapsedMs, sources: r.sources.length, origins, pages: fetched, searchOps, good, scores, lead: text.replace(/\s+/g, ' ').slice(0, 220) });
  console.log(`${good ? 'ok  ' : 'MISS'} [${item.cat}] ${item.q.join(' → ').slice(0, 70)} | ${isBrain ? 'brain' : level} | ${r.elapsedMs} ms | ${text.replace(/\s+/g, ' ').slice(0, 90)}`);
}
function DIMS() { return ['understanding', 'queries', 'sources', 'extraction', 'support', 'citations', 'hallucination', 'uncertainty', 'usefulness']; }
const dims = DIMS();
const avg = (all) => { const xs = all.filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; };
const cats = [...new Set(rows.map((r) => r.cat))];
const byCat = cats.map((c) => { const rs = rows.filter((r) => r.cat === c); return { cat: c, n: rs.length, ...Object.fromEntries(dims.map((d) => [d, avg(rs.map((r) => r.scores[d]))])), ms: Math.round(avg(rs.map((r) => r.ms || 0))) }; });
const overall = Object.fromEntries(dims.map((d) => [d, avg(rows.map((r) => r.scores[d]))]));
const brainRows = rows.filter((r) => r.kind === 'brain');
const out = { date: new Date().toISOString(), version: engine.status().version, depth, node: process.version, contactConfigured: engine.status().contactConfigured, n: rows.length, answeredByBrain: brainRows.length, overall, byCat, rows, latency: { medianMs: rows.map((r) => r.ms || 0).sort((a, b) => a - b)[Math.floor(rows.length / 2)], maxMs: Math.max(...rows.map((r) => r.ms || 0)) } };
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/intelligence.json', import.meta.url), JSON.stringify(out, null, 1));
const pct = (x) => (x * 100).toFixed(0) + '%';
const md = [`# Intelligence benchmark — ${out.date.slice(0, 16)}Z`, '', `Version ${out.version} · depth: ${depth} · ${rows.length} items · scoring by automatic proxies (see bench/intelligence.js) · Wikimedia contact configured: ${out.contactConfigured}`, '',
  `Answered by the built-in brain without a search (no citations by design; left out of the retrieval columns): ${brainRows.length ? brainRows.map((r) => `“${r.q}”`).join(', ') : 'none'}.`, '',
  `| Category | n | ${dims.join(' | ')} | avg ms |`, `|---|---|${dims.map(() => '---').join('|')}|---|`,
  ...byCat.map((c) => `| ${c.cat} | ${c.n} | ${dims.map((d) => pct(c[d])).join(' | ')} | ${c.ms} |`),
  `| **overall** | ${rows.length} | ${dims.map((d) => `**${pct(overall[d])}**`).join(' | ')} | ${Math.round(avg(rows.map((r) => r.ms || 0)))} |`, '',
  '## Items', '', '| ✓ | Category | Question | Confidence | ms | Start of answer |', '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.good ? '✓' : '✗'} | ${r.cat} | ${r.q.replace(/\|/g, '/')} | ${r.kind === 'brain' ? 'brain' : r.level || ''} | ${r.ms || ''} | ${(r.lead || r.error || '').replace(/\|/g, '/').slice(0, 150)} |`)].join('\n');
fs.writeFileSync(new URL('./results/intelligence.md', import.meta.url), md + '\n');
console.log('\n' + byCat.map((c) => `${c.cat.padEnd(13)} support ${pct(c.support)}  halluc-avoid ${pct(c.hallucination)}  ${c.ms} ms`).join('\n'));
console.log(`OVERALL support ${pct(overall.support)} · hallucination avoidance ${pct(overall.hallucination)} · citations ${pct(overall.citations)} · median ${out.latency.medianMs} ms · answered by the brain ${brainRows.length} of ${rows.length}`);
engine.close();
