// Developer tool: replay messages through the brain and print what it does.
//   node tools/brain/dev/chat.mjs "hi" "how are you" --- "tell me a joke" "more"
//   "---" starts a new conversation; "--fresh" as first argument makes every message its own conversation;
//   "@web high nepal" simulates a web answer (confidence, topic) in between.
import { createBrain } from '../../../engine/brain/index.js';
const brain = createBrain({ version: '2.0.0', creator: 'an independent developer' });
let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const args = process.argv.slice(2);
const fresh = args[0] === '--fresh'; if (fresh) args.shift();
let state = null;
const t0 = Date.now();
for (const q of args) {
  if (q === '---') { state = null; console.log('--- new conversation'); continue; }
  if (q.startsWith('@web ')) { const [, lvl, topic] = q.split(' '); state = { ...(state || {}), expect: null, last: { k: 'web', lvl, pct: 83, n: 5, t: (topic || '').replace(/_/g, ' ') } }; console.log(`   (web answer about ${topic}, ${lvl})`); continue; }
  const r = brain.respond({ question: q, state, tz: process.env.TZ_TEST === 'none' ? '' : (process.env.TZ_TEST || 'Asia/Katmandu'), now: Date.UTC(2026, 10, 12, 15, 57), country: 'Nepal', rand, health: { resting: 0 }, strict: process.env.STRICT === '1' });
  state = fresh ? null : r.state;
  if (r.handled) console.log(`${q.padEnd(40)} ▸ [${r.intent}${r.origin !== 'conversation' ? '/' + r.origin : ''}] ${r.text}${r.suggestions.length ? '   ⟨' + r.suggestions.join(' | ') + '⟩' : ''}${r.state.expect ? '   {?' + r.state.expect.t + '}' : ''}`);
  else console.log(`${q.padEnd(40)} ▸ WEB${r.question ? ' q="' + r.question + '"' : ''}${r.preface ? ' preface="' + r.preface + '"' : ''}`);
}
console.error(`${args.length} messages in ${Date.now() - t0} ms`);
