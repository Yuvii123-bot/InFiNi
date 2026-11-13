// Infinity LLM in the browser client: the real public/app.js and public/learning.js, driven through a fake DOM against
// the real server, with the fixture model and a synthetic web. Offline.

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

test('chat client and learning dashboard with a model loaded', async () => {
  process.env.LOG_LEVEL = 'silent';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infini-ui-'));
  fs.cpSync(path.join(HERE, 'fixtures', 'llm'), root, { recursive: true });
  const TOKEN = 'ui-test-admin-token-123456';
  const app = createApp(fakeConfig({ INFINI_LLM: '1', INFINI_LLM_DIR: root, INFINI_LLM_MIN_LOGPROB: '-50', INFINI_LLM_MIN_AGREEMENT: '0', INFINI_ADMIN_TOKEN: TOKEN, INFINI_LEARNING_SCHEDULER: '0' }));
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dom = installDom(`http://127.0.0.1:${server.address().port}`);
  const session = new Map();
  globalThis.sessionStorage = { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) };
  globalThis.matchMedia = () => ({ matches: false });
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await import('../public/app.js');
    await sleep(80);
    const waitIdle = async (max = 30000) => { const t = Date.now(); await sleep(30); while (!$('stopBtn').hidden && Date.now() - t < max) await sleep(40); await sleep(30); };
    const ask = async (q) => { $('q').value = q; await $('askForm').fire('submit'); await waitIdle(); };
    const lastBot = () => dom.find($('thread'), '.msg').filter((m) => m.classList.contains('bot')).pop();

    // a chat message: written by the model, labelled with its version and size
    await ask('hello there');
    let bot = lastBot();
    const origin = dom.text(dom.find(bot, '.origin')[0]);
    assert.match(origin, /Written by Infinity LLM m0001 from its own weights \([\d,]+ parameters\) · \d+ tokens/);
    assert.ok(dom.text(dom.find(bot, '.answer')[0]).length > 0);
    assert.equal(dom.find(bot, '.stream').length, 0, 'the streaming box is replaced by the final answer');
    assert.equal(dom.find(bot, '.src').length, 0, 'no sources are claimed for a generated reply');

    // the second turn carries the first as context
    const bodies = [];
    const f = globalThis.fetch; globalThis.fetch = (url, opts) => { if (String(url).endsWith('/api/ask')) bodies.push(JSON.parse(opts.body)); return f(url, opts); };
    await ask('how are you');
    assert.equal(bodies[0].history.length, 1);
    assert.equal(bodies[0].history[0][0], 'hello there');
    assert.equal(bodies[0].settings.neural, true);

    // a question about itself: from the records, with exact figures, labelled as not generated
    await ask('how many parameters do you have');
    bot = lastBot();
    assert.match(dom.text(dom.find(bot, '.answer')[0]), /language model|Infinity LLM/);
    assert.match(dom.text(dom.find(bot, '.origin')[0]), /built-in rules: questions about the assistant itself/);

    // a factual question: the pipeline's cited answer, with the model's chosen sentences in a marked box above it
    await ask('What is the capital of Nepal?');
    bot = lastBot();
    const box = dom.find(bot, '.neural-answer')[0];
    assert.ok(box, 'the model\'s paragraph is marked');
    assert.match(dom.text(dom.find(box, '.neural-tag')[0]), /Infinity LLM m0001 · chosen from the sources below/);
    const chosen = dom.text(dom.find(box, 'p')[0]);
    assert.match(chosen, /Kathmandu|Nepal/);
    assert.ok(dom.find(box, '.cite').length >= 1 || /\[\d\]|\d/.test(chosen), 'it carries a citation');
    assert.ok(dom.find(bot, '.src').length >= 2 || /2 sources|sources/i.test(dom.text(bot)), 'the sources are still listed');

    // switched off by the user: the rules answer, nothing is streamed
    bodies.length = 0;
    const s = JSON.parse(localStorage.getItem('infini.settings') || '{}'); s.neural = false; localStorage.setItem('infini.settings', JSON.stringify(s));
    globalThis.fetch = f;

    // ---- the learning dashboard ----
    await import('../public/learning.js');
    await sleep(300);
    const dash = $('dash');
    const text = dom.text(dash);
    assert.match(text, /answering: m0001/);
    assert.match(text, /The model that answers/);
    assert.match(text, /Parameters\s*[\d,]+/);
    assert.match(text, /Model versions/);
    assert.match(text, /Promotion gate/);
    assert.match(text, /Controls/);
    assert.match(text, /test fixture: promoted by tools\/llm\/make-fixture\.mjs, not by the gate/, 'the history says how this model became production');
    assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/);
    // controls: wrong token is refused and said so; the right one pauses learning
    const input = dom.find(dash, 'input').find((i) => i.attrs.type === 'password');
    const button = (label) => dom.find($('dash'), 'button').find((b) => dom.text(b) === label);
    input.value = 'wrong-token-wrong-token'; await input.fire('input');
    await button('Check token').click(); await sleep(150);
    assert.match(dom.text($('adminMsg')), /valid admin token is required/);
    const again = dom.find($('dash'), 'input').find((i) => i.attrs.type === 'password');
    again.value = TOKEN; await again.fire('input');
    await button('Check token').click(); await sleep(200);
    assert.match(dom.text($('adminMsg')), /token is accepted/);
    await button('Pause learning').click(); await sleep(250);
    assert.ok(button('Resume learning'), 'the dashboard shows the paused state');
    assert.match(dom.text($('dash')), /paused/);
    await button('Resume learning').click(); await sleep(250);
    assert.ok(button('Pause learning'));
  } finally {
    await new Promise((r) => server.close(r));
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
