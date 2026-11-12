#!/usr/bin/env node
// INFINI AI — development aid: how are these messages understood? (No network: every request fails at once.)
//   node tools/dev/phrasings.mjs "message 1" "message 2" …
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createEngine, loadConfig } = await import(path.join(root, 'engine', 'index.js'));
const cfg = loadConfig({ ...process.env, LOG_LEVEL: 'silent' });
cfg.http.transport = async () => { const e = new Error('offline'); e.code = 'offline'; throw e; };
const engine = createEngine(cfg);
for (const q of process.argv.slice(2)) {
  const r = await engine.ask({ question: q, settings: { depth: 'auto' }, tz: 'Asia/Katmandu' }, {});
  const first = ((r.answer && r.answer.text) || '').replace(/\s+/g, ' ').slice(0, 110);
  console.log(`${q}\n   → kind=${r.kind}${r.brain ? ` brain=${r.brain.intent}` : ''} depth=${r.depth ? r.depth.used : "-"}${r.interpretation && r.interpretation.rewrites && r.interpretation.rewrites.length ? ` | reworded to “${r.interpretation.rewrites[0].to}” (${r.interpretation.rewrites[0].reason})` : ""}${r.kind !== 'retrieval' ? ` | ${first}` : ''}`);
}
engine.close();
