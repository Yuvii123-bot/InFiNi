// INFINI AI — resource benchmark: startup, memory, CPU, throughput, latency by stage, data volume, cache effect, footprint.
// Usage: node --expose-gc bench/resources.js [--offline]   → bench/results/resources.{json,md}
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const offline = process.argv.includes('--offline');
const mb = (b) => Number((b / 1048576).toFixed(1));
const out = { date: new Date().toISOString(), node: process.version, cpu: os.cpus()[0].model, cores: os.cpus().length, totalRamMB: Math.round(os.totalmem() / 1048576) };

// 1) cold start of the engine in a fresh process (import + construct)
const cold = [];
for (let i = 0; i < 5; i++) {
  const r = spawnSync(process.execPath, ['-e', `const t=performance.now();import('${ROOT}/engine/index.js').then(m=>{const e=m.createEngine();const ms=performance.now()-t;console.log(JSON.stringify({ms,rss:process.memoryUsage().rss,heap:process.memoryUsage().heapUsed}));e.close();})`], { encoding: 'utf8' });
  cold.push(JSON.parse(r.stdout));
}
out.coldStart = { engineImportMs: Number((cold.map((c) => c.ms).sort((a, b) => a - b)[2]).toFixed(1)), rssMB: mb(cold[2].rss), heapMB: mb(cold[2].heap) };
// 2) server: time from spawn to first successful /api/health
const port = 18000 + Math.floor(Math.random() * 1000);
const t0 = performance.now();
const child = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), LOG_LEVEL: 'silent', HOST: '127.0.0.1' }, stdio: 'ignore' });
let up = 0;
for (let i = 0; i < 200 && !up; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) up = performance.now() - t0; } catch { await new Promise((r) => setTimeout(r, 15)); } }
const rssOf = (pid) => { try { return Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) * 1024; } catch { return 0; } };
out.server = { readyMs: Math.round(up), idleRssMB: mb(rssOf(child.pid)) };

// 3) footprint
const size = (dir) => { let n = 0, files = 0; for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { const s = size(p); n += s.n; files += s.files; } else { n += fs.statSync(p).size; files++; } } return { n, files }; };
const engAll = size(path.join(ROOT, 'engine')), brainData = size(path.join(ROOT, 'engine/brain/data')), srv = size(path.join(ROOT, 'server')), pub = size(path.join(ROOT, 'public'));
const eng = { n: engAll.n - brainData.n, files: engAll.files - brainData.files };          // code only; the brain's data files are reported separately
const clientJs = fs.statSync(path.join(ROOT, 'public/app.js')).size, clientCss = fs.statSync(path.join(ROOT, 'public/app.css')).size;
out.footprint = { engineKB: Math.round(eng.n / 1024), engineFiles: eng.files, brainDataKB: Math.round(brainData.n / 1024), brainDataFiles: brainData.files, serverKB: Math.round(srv.n / 1024), publicKB: Math.round(pub.n / 1024), clientJsKB: Math.round(clientJs / 1024), clientCssKB: Math.round(clientCss / 1024), runtimeDependencies: Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies || {}).length, nodeModules: fs.existsSync(path.join(ROOT, 'node_modules')) };
// 3b) the built-in brain in a fresh process: first replies (they load the data), steady-state speed, memory
{
  const script = `const rss=()=>process.memoryUsage().rss;const {createBrain}=await import('${ROOT}/engine/brain/index.js');const {repairForWeb}=await import('${ROOT}/engine/brain/spell.js');const b=createBrain({version:'bench'});const now=Date.now(),tz='Asia/Katmandu';
let t=performance.now();b.respond({question:'hello',now,tz});const first=performance.now()-t;const r1=rss();
t=performance.now();b.respond({question:'can a penguin fly',now,tz});const sense=performance.now()-t;
t=performance.now();repairForWeb('what si a quantum conputer');const spell=performance.now()-t;
const msgs=['hi','how are you','what is your name','tell me a joke','can a fish swim','what time is it','thanks','my name is ram','what is my name','who made you','why is the sky blue','roll a dice','bye'];
let state=null,n=0;t=performance.now();for(let i=0;i<40;i++)for(const m of msgs){const r=b.respond({question:m,state,now,tz});state=r.state;n++;}
const per=(performance.now()-t)/n;console.log(JSON.stringify({first,sense,spell,per,n,r1,r2:rss(),heap:process.memoryUsage().heapUsed}));`;
  const runs = [];
  for (let i = 0; i < 3; i++) { const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }); runs.push(JSON.parse(r.stdout)); }
  const med = (k) => runs.map((x) => x[k]).sort((a, b) => a - b)[1];
  out.brain = { firstChatReplyMs: Math.round(med('first')), firstCommonSenseReplyMs: Math.round(med('sense')), firstSpellingRepairMs: Number(med('spell').toFixed(1)), avgReplyMs: Number(med('per').toFixed(2)), repliesTimed: runs[0].n, rssAfterFirstReplyMB: mb(med('r1')), rssAllDataMB: mb(med('r2')), heapAllDataMB: mb(med('heap')) };
}

// 4) CPU-bound throughput (offline, deterministic input)
const { extractPage } = await import('../engine/extract/readable.js');
const { analyze } = await import('../engine/nlp/analyze.js');
const { queryModel, rankEvidence } = await import('../engine/rank/rank.js');
const para = 'Stars shine because nuclear fusion in their cores converts hydrogen into helium and releases energy, which travels outward for thousands of years before leaving the surface as visible light. ';
const html = `<html><head><title>Stars</title></head><body><nav>${'<a href="/x">link</a>'.repeat(200)}</nav><article>${Array.from({ length: 900 }, (_, i) => `<h2>Section ${i}</h2><p>${para.repeat(3)} Note ${i}.</p><ul><li>item one ${i}</li><li>item two ${i}</li></ul>`).join('')}</article><footer>© site</footer></body></html>`;
let t = performance.now(); let page;
for (let i = 0; i < 5; i++) page = extractPage(html, 'https://example.org/stars');
const exMs = (performance.now() - t) / 5;
out.extraction = { inputKB: Math.round(html.length / 1024), msPerPage: Number(exMs.toFixed(1)), mbPerSec: Number((html.length / 1048576 / (exMs / 1000)).toFixed(1)), blocks: page.blocks.length };
t = performance.now();
for (let i = 0; i < 2000; i++) analyze('Can AI agents autonomously operate websites, and what security risks does that create?');
out.analysis = { usPerQuestion: Math.round(((performance.now() - t) / 2000) * 1000) };
const docs = Array.from({ length: 8 }, (_, i) => ({ title: 'Stars ' + i, url: `https://e${i}.org/`, quality: 0.6, origin: 'e' + i, blocks: page.blocks.slice(i * 100, i * 100 + 300) }));
t = performance.now();
const ranked = rankEvidence(docs, queryModel(analyze('Why do stars shine?').parts[0]));
out.ranking = { sentences: ranked.sentences.length, passages: ranked.passages.length, ms: Number((performance.now() - t).toFixed(1)) };

// 5) live questions through the running server: latency by stage, data volume, CPU, memory, cache effect
if (!offline) {
  const ask = async (question, regenerate = false) => {
    const s = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, regenerate }) });
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    const a = lines.find((l) => l.type === 'answer');
    return { wallMs: Math.round(performance.now() - s), r: a ? a.result : null };
  };
  const cpuOf = (pid) => { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) * 10; } catch { return 0; } };   // ms at 100 Hz
  out.live = [];
  for (const q of ['Why do stars shine?', 'What is the capital of Nepal?', 'What happened in Nepal today?']) {
    await new Promise((r) => setTimeout(r, 22000));                          // stay inside the unidentified Wikimedia limit
    const c0 = cpuOf(child.pid);
    const first = await ask(q);
    const c1 = cpuOf(child.pid);
    const again = await ask(q);                                              // same question: temporary cache should serve the pages
    const c = first.r && first.r.research ? first.r.research.counts : {};
    const c2 = again.r && again.r.research ? again.r.research.counts : {};
    out.live.push({ q, coldMs: first.wallMs, warmMs: again.wallMs, cpuMs: c1 - c0, stages: first.r && first.r.research ? first.r.research.timings : {}, searches: c.searches, pages: c.pagesFetched, kB: Math.round((c.bytes || 0) / 1024), cachedPagesOnRepeat: c2.cacheHits || 0, confidence: first.r && first.r.confidence ? first.r.confidence.level : '' });
    console.log(q, '→', first.wallMs, 'ms cold,', again.wallMs, 'ms warm');
  }
  out.server.rssAfterQuestionsMB = mb(rssOf(child.pid));
  const st = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
  out.cache = st.cache;
}
child.kill();
fs.mkdirSync(path.join(ROOT, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench/results/resources.json'), JSON.stringify(out, null, 1));
const L = out.live || [];
fs.writeFileSync(path.join(ROOT, 'bench/results/resources.md'), [`# Resource benchmark — ${out.date.slice(0, 16)}Z`, '', `Machine: ${out.cores} × ${out.cpu}, ${out.totalRamMB} MB RAM, Node ${out.node}, no GPU.`, '',
  '| Measure | Result |', '|---|---|',
  `| Engine cold start (import + construct, fresh process, median of 5) | ${out.coldStart.engineImportMs} ms |`, `| Process memory after engine start | ${out.coldStart.rssMB} MB RSS (${out.coldStart.heapMB} MB JS heap) |`,
  `| Server ready (spawn → first /api/health 200) | ${out.server.readyMs} ms |`, `| Server memory idle | ${out.server.idleRssMB} MB RSS |`, out.server.rssAfterQuestionsMB ? `| Server memory after ${L.length * 2} questions | ${out.server.rssAfterQuestionsMB} MB RSS |` : null,
  `| Question analysis (two-part question) | ${out.analysis.usPerQuestion} µs |`, `| HTML parse + extraction | ${out.extraction.mbPerSec} MB/s (${out.extraction.inputKB} kB page in ${out.extraction.msPerPage} ms → ${out.extraction.blocks} blocks) |`,
  `| Ranking | ${out.ranking.sentences} sentences / ${out.ranking.passages} passages in ${out.ranking.ms} ms |`,
  `| Built-in brain, fresh process (median of 3) | first chat reply ${out.brain.firstChatReplyMs} ms (loads the conversation data) · first common-sense reply ${out.brain.firstCommonSenseReplyMs} ms (loads the fact base) · then ${out.brain.avgReplyMs} ms per reply (${out.brain.repliesTimed} replies) |`,
  `| Brain memory | ${out.brain.rssAfterFirstReplyMB} MB RSS after the first reply · ${out.brain.rssAllDataMB} MB RSS with all data loaded (${out.brain.heapAllDataMB} MB JS heap) |`,
  `| Code size | engine ${out.footprint.engineKB} kB in ${out.footprint.engineFiles} files · brain data ${out.footprint.brainDataKB} kB in ${out.footprint.brainDataFiles} files · server ${out.footprint.serverKB} kB · client JS ${out.footprint.clientJsKB} kB + CSS ${out.footprint.clientCssKB} kB (unminified) |`,
  `| Runtime dependencies | ${out.footprint.runtimeDependencies} (node_modules present: ${out.footprint.nodeModules}) |`].filter(Boolean).join('\n') +
  (L.length ? '\n\n## Live questions\n\n| Question | Cold | Repeat (cached) | Server CPU | Searches | Pages | Data read | Pages from cache on repeat | Stage times (ms) |\n|---|---|---|---|---|---|---|---|---|\n' + L.map((x) => `| ${x.q} | ${x.coldMs} ms | ${x.warmMs} ms | ${x.cpuMs} ms | ${x.searches} | ${x.pages} | ${x.kB} kB | ${x.cachedPagesOnRepeat} | ${Object.entries(x.stages).map(([k, v]) => `${k} ${v}`).join(', ')} |`).join('\n') : '') + '\n');
console.log(JSON.stringify({ coldStart: out.coldStart, server: out.server, brain: out.brain, extraction: out.extraction, analysis: out.analysis, ranking: out.ranking, footprint: out.footprint }));
