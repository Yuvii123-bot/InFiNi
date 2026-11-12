#!/usr/bin/env node
// INFINI AI — command-line interface. `node cli.js "Why do stars shine?"` or `node cli.js` for an interactive session.
import readline from 'node:readline';
import { createEngine, loadConfig } from './engine/index.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const depth = flag('--depth') || 'balanced';
const json = has('--json'), quiet = has('--quiet'), verbose = has('--verbose');
if (has('--help') || has('-h')) { console.log('Usage: infini [--depth fast|balanced|deep] [--json] [--quiet] [--verbose] ["question"]\nWithout a question an interactive session starts (follow-ups keep their context).'); process.exit(0); }
const engine = createEngine(loadConfig());
let TZ = ''; try { TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* the brain then uses UTC */ }
const c = process.stdout.isTTY ? { dim: '\x1b[2m', b: '\x1b[1m', r: '\x1b[0m', g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m' } : { dim: '', b: '', r: '', g: '', y: '', c: '' };

export function render(result) {
  const out = [];
  const sp = (spans) => spans.map((s) => (s.strong ? c.b + s.text + c.r : s.text) + (s.cites && s.cites.length ? c.c + s.cites.map((n) => `[${n}]`).join('') + c.r : '')).join(' ').replace(/ +([.,;:])/g, '$1');
  for (const b of result.answer.blocks) {
    if (b.type === 'paragraph') out.push(sp(b.spans));
    else if (b.type === 'heading') out.push(`\n${c.b}${b.text}${c.r}`);
    else if (b.type === 'list') out.push(b.items.map((it, i) => `${'  '.repeat((it.depth || 0) + 1)}${b.ordered ? i + 1 + '.' : '•'} ${sp(it.spans)}`).join('\n'));
    else if (b.type === 'table') out.push([b.header, ...b.rows].map((r) => '  ' + r.map((x, i) => String(x).slice(0, 46).padEnd(i ? 46 : 26)).join(' ')).join('\n') + (b.cites ? ` ${c.c}${b.cites.map((n) => `[${n}]`).join('')}${c.r}` : ''));
    else if (b.type === 'code') out.push(c.dim + b.text.split('\n').map((l) => '    ' + l).join('\n') + c.r + (b.cites ? ` ${c.c}${b.cites.map((n) => `[${n}]`).join('')}${c.r}` : ''));
    else if (b.type === 'note') out.push(`${c.y}Note: ${b.text}${c.r}`);
  }
  if (result.confidence) out.push(`\n${c.b}${result.confidence.label}${c.r} (${Math.round(result.confidence.score * 100)}%)${result.confidence.caps && result.confidence.caps.length ? ` — capped: ${result.confidence.caps.join('; ')}` : ''}`);
  if (result.sources.length) out.push(`${c.b}Sources${c.r}\n` + result.sources.map((s) => `  [${s.id}] ${s.title} — ${s.domain} · ${s.category} · ${s.evidenceLevel}${s.published ? ' · ' + s.published.slice(0, 10) : s.modified ? ' · updated ' + s.modified.slice(0, 10) : ''}\n      ${s.url}`).join('\n'));
  if (result.kind === 'brain' && result.suggestions && result.suggestions.length) out.push(`${c.dim}You could say: ${result.suggestions.join('  ·  ')}${c.r}`);
  if (result.unavailable.length) out.push(`${c.dim}Unavailable: ${result.unavailable.map((u) => `${u.domain} (${u.error})`).join('; ')}${c.r}`);
  return out.join('\n');
}

async function run(question, context) {
  const result = await engine.ask({ question, context, settings: { depth }, tz: TZ }, {
    onEvent: (ev) => {
      if (json || quiet) return;
      if (ev.type === 'stage' && ev.stage === 'understanding' && ev.detail && ev.detail.brain) return;      // a chat reply: nothing was searched
      if (ev.type === 'stage' && ev.status === 'start' && ev.stage === 'understanding') return;              // instant; only a rewording is worth a line
      if (ev.type === 'stage' && ev.status === 'start') process.stderr.write(`${c.dim}▸ ${ev.stage}${ev.round > 1 ? ' (round ' + ev.round + ')' : ''}…${c.r}\n`);
      else if (ev.type === 'stage' && ev.stage === 'understanding' && ev.detail.rewrites.length) process.stderr.write(`${c.dim}  understood as: ${ev.detail.resolved}${c.r}\n`);
      else if (ev.type === 'search') process.stderr.write(`${c.dim}  ${ev.ok ? '✓' : '✗'} ${ev.label}: ${String(ev.query).slice(0, 70)} → ${ev.ok ? ev.results + ' results' : ev.error} (${ev.ms} ms)${c.r}\n`);
      else if (ev.type === 'fetch') process.stderr.write(`${c.dim}  ${ev.ok ? '✓' : '✗'} read ${ev.url.slice(0, 80)} ${ev.ok ? `(${ev.blocks} blocks, ${Math.round(ev.bytes / 1024)} kB, ${ev.ms} ms${ev.fromCache ? ', cached' : ''})` : '— ' + ev.error}${c.r}\n`);
      else if (ev.type === 'note') process.stderr.write(`${c.dim}  ${ev.text}${c.r}\n`);
      else if (verbose && ev.type === 'stage' && ev.status === 'done') process.stderr.write(`${c.dim}  ${JSON.stringify(ev.detail).slice(0, 400)}${c.r}\n`);
    },
  });
  if (json) console.log(JSON.stringify(result, null, 2)); else console.log('\n' + render(result) + `\n${c.dim}(${result.elapsedMs} ms)${c.r}\n`);
  return result;
}

if (args.length) { await run(args.join(' '), {}); engine.close(); }
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you › ' });
  let context = {};
  console.log(`${c.b}INFINI AI${c.r} — chat comes from a built-in brain, facts from live retrieval; there is no language model. Say hello or ask a question (/new to reset, /quit to exit).`);
  rl.prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (q === '/quit' || q === '/exit') break;
    if (q === '/new') { context = {}; console.log('New conversation.'); } else if (q) { try { context = (await run(q, context)).context; } catch (e) { console.error('Error:', e.message); } }
    rl.prompt();
  }
  engine.close();
}
