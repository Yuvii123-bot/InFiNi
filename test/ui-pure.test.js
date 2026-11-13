// The Infinity LLM page (public/llm.html + llm.js) driven through a fake DOM against the real server and the published
// model. Offline. Checks that the page talks to the pure-model endpoint only, shows exactly what the model generated,
// carries the conversation as context, and that both pages offer the switch between the two modes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { installDom } from './helpers/fake-dom.mjs';
import { fakeConfig } from './helpers/fake-web.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(path.dirname(HERE), 'public');

test('Infinity LLM page: only the model endpoint is used, replies are shown as generated, context is carried', async () => {
  process.env.LOG_LEVEL = 'silent';
  const cfg = fakeConfig({ INFINI_LLM: '1', INFINI_LLM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'infini-uip-')), INFINI_LEARNING_SCHEDULER: '0' });
  const app = createApp(cfg);
  let engineCalls = 0; const ask = app.engine.ask.bind(app.engine); app.engine.ask = (...a) => { engineCalls++; return ask(...a); };
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dom = installDom(`http://127.0.0.1:${server.address().port}`);
  const session = new Map();
  globalThis.sessionStorage = { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) };
  globalThis.matchMedia = () => ({ matches: false });
  // record every request the page makes, and what the server sent back on the chat endpoint
  const requests = [], served = [];
  const pageFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    requests.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    const res = await pageFetch(url, opts);
    if (String(url) === '/api/llm/chat' && res.ok) res.clone().text().then((raw) => served.push(raw.trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.type === 'answer'))).catch(() => {});
    return res;
  };
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const idle = async (max = 30000) => { const t = Date.now(); await sleep(20); while (!$('pStop').hidden && Date.now() - t < max) await sleep(25); await sleep(40); };
  const say = async (q) => { $('pInput').value = q; await $('pForm').fire('submit'); await idle(); };
  const bots = () => dom.find($('pThread'), '.msg').filter((m) => m.classList.contains('bot'));
  const users = () => dom.find($('pThread'), '.bubble').map((b) => dom.text(b));
  try {
    await import('../public/llm.js');
    await sleep(150);
    // the page says which network answers, and that nothing else does
    const info = app.neural.info();
    assert.match(dom.text($('pModel')), new RegExp(`Infinity LLM ${info.version} · 1,344,640 parameters`));
    assert.match(dom.text($('pFine')), /no web search, no prepared replies, no outside model/);
    assert.match(dom.text($('pThread')), /Nothing else answers in this mode/);
    assert.match(dom.text($('pThread')), /very small/);
    assert.equal(dom.find($('pThread'), '.p-try')[0].children.length, 4);

    // first message: the reply on the page is exactly the text the model endpoint generated
    await say('hello');
    assert.deepEqual(users(), ['hello']);
    assert.equal(bots().length, 1);
    assert.ok(served[0] && served[0].text.length > 0);
    assert.equal(dom.text(dom.find(bots()[0], '.p-text')[0]), served[0].text.replace(/\s+/g, ' ').trim());
    assert.match(dom.text(dom.find(bots()[0], '.p-tag')[0]), new RegExp(`^Infinity LLM ${info.version}$`));
    assert.match(dom.text(dom.find(bots()[0], '.p-meta')[0]), /tokens? generated · .*context: none \(first message\) · variety 0\.6/);
    assert.equal($('pInput').value, '');
    assert.equal(requests.filter((r) => r.url === '/api/llm/chat')[0].body.history.length, 0);

    // second and third message: the earlier turns go back to the model as context, exactly as they were generated
    await say('my name is Sam');
    await say('what is my name?');
    const chats = requests.filter((r) => r.url === '/api/llm/chat');
    assert.equal(chats.length, 3);
    assert.deepEqual(chats[1].body.history, [['hello', served[0].text]]);
    assert.deepEqual(chats[2].body.history, [['hello', served[0].text], ['my name is Sam', served[1].text]]);
    assert.equal(served[2].contextTurns, 2);
    assert.match(dom.text(dom.find(bots()[2], '.p-meta')[0]), /context: 2 of 2 earlier turns/);
    assert.match(dom.text($('pCtx')), /3 turns in this chat/);
    assert.deepEqual(bots().map((b) => dom.text(dom.find(b, '.p-text')[0])), served.map((a) => a.text.replace(/\s+/g, ' ').trim()));

    // the variety control changes the temperature that is sent; 0 means the most likely token every time
    $('pTemp').value = '0'; await $('pTemp').fire('input');
    assert.equal(dom.text($('pTempOut')), '0.0');
    await say('good night');
    assert.equal(requests.filter((r) => r.url === '/api/llm/chat')[3].body.temperature, 0);
    const first = served[3].text;
    // "Generate again" asks the model again for the same turn with the same context (same text at variety 0)
    const regen = dom.find($('pThread'), '.p-regen');
    assert.equal(regen.length, 1, 'only the last reply can be generated again');
    await regen[0].click(); await idle();
    assert.equal(requests.filter((r) => r.url === '/api/llm/chat')[4].body.history.length, 3);
    assert.equal(served[4].text, first);
    assert.equal(bots().length, 4);

    // the chat is kept for this tab only, without anything the page itself wrote
    const kept = JSON.parse(session.get('infini.pure.chat'));
    assert.deepEqual(kept.turns.map((t) => [t.u, t.a]), [['hello', served[0].text], ['my name is Sam', served[1].text], ['what is my name?', served[2].text], ['good night', first]]);
    assert.equal(kept.temp, 0);

    // a failure is shown as a notice from the page, never as a reply from the model, and is not sent back as context
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => { if (String(url) === '/api/llm/chat') { requests.push({ url: String(url), body: JSON.parse(opts.body) }); return new Response(JSON.stringify({ error: 'llm_unavailable', message: 'Infinity LLM is not available: no model.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }); } return realFetch(url, opts); };
    await say('are you there?');
    assert.equal(bots().length, 4, 'no model reply was added');
    assert.match(dom.text(dom.find($('pThread'), '.p-notice').pop()), /No reply was generated: Infinity LLM is not available/);
    globalThis.fetch = realFetch;
    await say('thanks');
    const lastReq = requests.filter((r) => r.url === '/api/llm/chat').pop();
    assert.deepEqual(lastReq.body.history.map((t) => t[0]), ['hello', 'my name is Sam', 'what is my name?', 'good night'], 'the failed turn is not part of the context');

    // New chat: the context is gone
    await $('pNew').click();
    assert.equal(bots().length, 0);
    assert.deepEqual(JSON.parse(session.get('infini.pure.chat')).turns, []);
    await say('hello again');
    assert.equal(requests.filter((r) => r.url === '/api/llm/chat').pop().body.history.length, 0);

    // Enter sends, Shift+Enter does not
    $('pInput').value = 'one more';
    await $('pInput').fire('keydown', { key: 'Enter', shiftKey: true }); await sleep(30);
    assert.equal(bots().length, 1);
    await $('pInput').fire('keydown', { key: 'Enter', shiftKey: false }); await idle();
    assert.equal(bots().length, 2);

    // this page used the model endpoints and nothing else; the Internet engine was never asked
    assert.deepEqual([...new Set(requests.map((r) => r.url))].sort(), ['/api/llm/chat', '/api/llm/status']);
    assert.equal(engineCalls, 0);
  } finally { await new Promise((r) => server.close(r)); await app.close(); }
});

test('both pages show the mode switch, and the new page is built for small screens', () => {
  const index = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'), pure = fs.readFileSync(path.join(PUB, 'llm.html'), 'utf8');
  const css = fs.readFileSync(path.join(PUB, 'llm.css'), 'utf8'), appCss = fs.readFileSync(path.join(PUB, 'app.css'), 'utf8');
  // Internet mode page: a visible "Infinity LLM" button in the top bar and a link in the sidebar; its own client is untouched
  assert.match(index, /<nav class="mode-switch"[^>]*>\s*<a class="on" href="\/"[^>]*>Internet AI<\/a>\s*<a id="openPure" href="\/llm\.html"[^>]*>Infinity LLM<\/a>/);
  assert.match(index, /id="openPureSide"[^>]*href="\/llm\.html"/);
  assert.equal((index.match(/class="link-btn"/g) || []).length, 3, 'the sidebar footer keeps its three links (a fourth pushed "About" off the drawer)');
  assert.match(index, /<script type="module" src="\/app\.js">/);
  // pure page: the same switch with the other side lit, its own script, and no trace of the Internet client
  assert.match(pure, /<nav class="mode-switch"[^>]*>\s*<a href="\/"[^>]*>Internet AI<\/a>\s*<a class="on" href="\/llm\.html"[^>]*>Infinity LLM<\/a>/);
  assert.match(pure, /<script src="\/llm\.js" type="module">/);
  assert.doesNotMatch(pure, /app\.js|depthBtn|askForm/);
  assert.doesNotMatch(pure, /<script(?![^>]*src=)|\sstyle=|\son[a-z]+=/, 'no inline script, style or handler (the content security policy forbids them)');
  // mobile: scales to the device, respects the notch and the home bar, fills the visible viewport, no zoom on focus
  assert.match(pure, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /#pInput \{[^}]*font-size: 16px/);
  assert.match(css, /@media \(max-width: 519px\)/);
  assert.match(css, /body\.pure \.send \{[^}]*width: 40px; height: 40px/);
  assert.match(appCss, /\.mode-switch a \{[^}]*min-height: 30px/);
  // the service worker ships the new page
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  for (const f of ['/llm.html', '/llm.js', '/llm.css']) assert.ok(sw.includes(`'${f}'`), f);
});
