// Developer tool: how many of the 1,200 CLINC150 out-of-scope utterances (mostly knowledge questions and
// device commands) does the brain answer by itself instead of sending them to the web?
//   node tools/brain/dev/oos.mjs [filter] [limit]
import { createBrain } from '../../../engine/brain/index.js';
import fs from 'node:fs';
const brain = createBrain({});
const d = JSON.parse(fs.readFileSync(new URL('../sources/clinc150.json', import.meta.url), 'utf8'));
const byIntent = {}; const rows = [];
const t0 = Date.now();
for (const q of d.oos) {
  const r = brain.respond({ question: q, state: null, tz: 'Asia/Katmandu', now: Date.UTC(2026, 10, 12, 15, 57), rand: () => 0.3, health: { resting: 0 } });
  if (r.handled) { byIntent[r.intent] = (byIntent[r.intent] || 0) + 1; rows.push(`[${r.intent}] ${q}`); }
}
console.log(`out-of-scope ${d.oos.length}, answered by the brain ${rows.length}, ${Date.now() - t0} ms`);
console.log(Object.entries(byIntent).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
const show = process.argv[2] ? rows.filter((r) => r.includes(process.argv[2])) : rows;
console.log(show.slice(0, +(process.argv[3] || 0)).join('\n'));
