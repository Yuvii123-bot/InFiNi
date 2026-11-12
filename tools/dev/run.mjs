#!/usr/bin/env node
// INFINI AI — development runner: asks the engine one question directly (no server) and prints what happened.
//
//   node tools/dev/run.mjs <depth> "<question>" [--full]
//
// Environment:
//   REPLAY=<name>   record every HTTP answer under .cache/replay/<name>/ and replay it on the next run
//                   (answers that are not recorded yet are fetched live and recorded; failures are recorded too)
//   VERBOSE=1       run statistics, search services, classification
//   FIND=<regex>    show ranked sentences that match, with their flags and source
//   KEYS=<n>        show the n strongest words of the answers' vocabulary
//   DUMP=<n>        show the n best-ranked sentences
// The replay directory is a cache: it is not part of the repository.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createEngine, loadConfig } = await import(path.join(root, 'engine', 'index.js'));

export function replayTransport(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const stats = { hits: 0, misses: 0 };
  const file = (u, request) => path.join(dir, crypto.createHash('sha1').update(`${request.method || 'GET'} ${u.toString()} ${request.body ? request.body.toString('utf8') : ''}`).digest('hex') + '.json');
  const transport = async (u, request, send) => {
    const f = file(u, request);
    if (fs.existsSync(f)) {
      stats.hits++;
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.name = j.error.name || 'Error'; throw e; }
      return { status: j.status, headers: j.headers, body: Buffer.from(j.body, 'base64'), truncated: !!j.truncated };
    }
    stats.misses++;
    try {
      const res = await send();
      fs.writeFileSync(f, JSON.stringify({ url: u.toString(), status: res.status, headers: res.headers, body: res.body.toString('base64'), truncated: !!res.truncated }));
      return res;
    } catch (e) {
      if (e && e.code !== 'aborted') fs.writeFileSync(f, JSON.stringify({ url: u.toString(), error: { message: e.message, code: e.code, name: e.name } }));
      throw e;
    }
  };
  return { transport, stats };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [depth = 'auto', question = '', ...rest] = process.argv.slice(2);
  if (!question) { console.error('usage: node tools/dev/run.mjs <auto|fast|balanced|deep|research> "<question>" [--full]'); process.exit(2); }
  const full = rest.includes('--full');
  const cfg = loadConfig(process.env);
  let rp = null;
  if (process.env.REPLAY) { rp = replayTransport(path.join(root, '.cache', 'replay', process.env.REPLAY)); cfg.http.transport = rp.transport; }
  const engine = createEngine(cfg);
  const wantInspect = ['DUMP', 'FIND', 'KEYS'].some((k) => process.env[k]);
  let X = null;
  const t0 = Date.now();
  const counts = {}, stages = [], drafts = [];
  let lastProgress = null;
  const r = await engine.ask({ question, settings: { depth }, tz: process.env.TZ_NAME || 'Asia/Katmandu' }, { inspect: wantInspect ? (x) => { X = x; } : null, onEvent: (ev) => {
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    if (ev.type === 'stage' && ev.status === 'done') stages.push(`${ev.stage}${ev.round ? '#' + ev.round : ''}:${ev.ms}ms`);
    if (ev.type === 'draft') drafts.push(Date.now() - t0);
    if (ev.type === 'progress') lastProgress = ev;
    if (ev.type === 'note' && process.env.VERBOSE) console.log(`   note: ${String(ev.text).slice(0, 200)}`);
  } });
  const mem = process.memoryUsage();
  const textOf = (blocks) => (blocks || []).map((b) => {
    const spans = (sp) => (sp || []).map((s) => s.text + (s.cites && s.cites.length ? ' ' + s.cites.map((c) => `[${c}]`).join('') : '')).join(' ');
    if (b.type === 'heading') return `\n${b.text}\n`;
    if (b.type === 'paragraph') return spans(b.spans);
    if (b.type === 'list') return b.items.map((i) => `• ${spans(i.spans)}`).join('\n');
    if (b.type === 'note') return `Note: ${b.text}`;
    if (b.type === 'table') return `[table ${b.rows ? b.rows.length : 0} rows]`;
    return b.text || '';
  }).join('\n');
  console.log(`Q: ${question}`);
  console.log(`   kind=${r.kind} depth=${JSON.stringify(r.depth || null)} elapsed=${Date.now() - t0} ms  rss=${Math.round(mem.rss / 1048576)} MB heap=${Math.round(mem.heapUsed / 1048576)} MB`);
  console.log(`   events: ${JSON.stringify(counts)} drafts ${drafts.length}${drafts.length ? ` first draft at ${drafts[0]} ms` : ''}`);
  if (process.env.VERBOSE) console.log(`   stages: ${stages.join(' ')}`);
  console.log(`   confidence: ${r.confidence ? `${r.confidence.label} ${Math.round((r.confidence.score || 0) * 100)}%` : '-'} · cited sources ${(r.sources || []).length}`);
  if (r.run) console.log(`   run: ${JSON.stringify(r.run)}`);
  if (r.tally) console.log(`   tally: ${JSON.stringify(r.tally)}`);
  if (process.env.VERBOSE) {
    if (r.research && r.research.counts) console.log(`   counts: ${JSON.stringify(r.research.counts)} timings ${JSON.stringify(r.research.timings || {})}`);
    if (r.classification) {
      console.log(`   classification totals: ${JSON.stringify(r.classification.totals)}`);
      for (const f of r.classification.facets || []) console.log(`     facet ${f.id}: ${f.values.slice(0, 8).map((v) => `${v.label}=${v.count}${v.cited ? `(${v.cited} cited)` : ''}`).join(', ')}`);
      console.log(`     timeline: ${JSON.stringify((r.classification.timeline || []).slice(-12))} items ${(r.classification.items || []).length} unread ${(r.classification.unread || []).length}`);
    }
    const by = new Map();
    for (const s of (r.research && r.research.searches) || []) { const e = by.get(s.provider) || { ok: 0, fail: 0, results: 0, errs: new Set() }; if (s.ok) e.ok++; else { e.fail++; if (s.error) e.errs.add(String(s.error).slice(0, 70)); } e.results += s.results || 0; by.set(s.provider, e); }
    for (const [p, e] of by) console.log(`   search ${p}: ok=${e.ok} fail=${e.fail} results=${e.results}${e.errs.size ? ` [${[...e.errs].slice(0, 2).join(' / ')}]` : ''}`);
    if (lastProgress) console.log(`   last progress: ${JSON.stringify({ ...lastProgress, subtopics: undefined, latest: undefined })}`);
  }
  console.log(`   json size of result: ${JSON.stringify(r).length} bytes\n`);
  const text = textOf(r.answer && r.answer.blocks);
  console.log(full ? text : text.slice(0, 1500));
  if (rp) console.log(`\n   replay cache: ${JSON.stringify(rp.stats)}`);
  if (X && process.env.DUMP) {
    const S = X.ranks[0].ranked.sentences;
    console.log(`\n=== top sentences (${S.length}) ===`);
    for (const s of S.slice(0, Number(process.env.DUMP) || 40)) console.log(`${s.score.toFixed(3)} cov=${s.cov.toFixed(2)} d=${s.directCov.toFixed(2)} p=${s.predCov.toFixed(2)} sup=${s.support || 1} sal=${(s.sal || 0).toFixed(2)}${s.gap ? ' GAP' : ''}${s.proc ? ' PROC' : ''}${s.intro ? ' INTRO' : ''}${s.dangling ? ' dang' : ''}${s.nonHuman ? ' nonhuman' : ''}${s.otherEntity ? ' other' : ''} [${X.docs[s.di].domain}${X.docs[s.di].partial ? ' abs' : ''}] ${s.text.slice(0, 230)}`);
  }
  if (X && process.env.FIND) {
    const re = new RegExp(process.env.FIND, 'i');
    let n = 0;
    for (const s of X.ranks[0].ranked.sentences) { if (!re.test(s.text)) continue; if (n++ >= 5) break; const d = X.docs[s.di]; console.log(`\n=== FIND === type=${s.type} len=${s.text.length} score=${s.score.toFixed(3)} gap=${!!s.gap} gapOnly=${!!s.gapOnly} proc=${!!s.proc} intro=${!!s.intro} dang=${!!s.dangling} nonHuman=${!!s.nonHuman} other=${!!s.otherEntity} cov=${s.cov.toFixed(2)} d=${s.directCov.toFixed(2)} p=${s.predCov.toFixed(2)} sal=${(s.sal || 0).toFixed(2)}\n   doc: ${d.url} provider=${d.provider} partial=${!!d.partial}\n   text: ${JSON.stringify(s.text.slice(0, 500))}`); }
  }
  if (X && process.env.KEYS) { const k = X.ranks[0].ranked.salience; console.log('\n=== key terms === sided', k && k.sided, 'origins', k && k.origins, '\n' + (k ? k.list.slice(0, Number(process.env.KEYS) || 60).map((t) => `${t.word} w=${t.weight.toFixed(2)} o=${t.origins} obj=${t.obj}`).join(' | ') : 'none')); }
  engine.close();
}
