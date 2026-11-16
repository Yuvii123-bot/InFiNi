// Real client and API with a fixture model and a synthetic web; no external network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { fakeConfig } from './helpers/fake-web.mjs';
import { installDom } from './helpers/fake-dom.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
test('combined mode searches, selects cited evidence, handles fallbacks and is reachable in the client', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infini-combined-'));
  fs.cpSync('test/fixtures/llm', root, { recursive: true });
  const app = createApp(fakeConfig({ INFINI_LLM: '1', INFINI_LLM_DIR: root, INFINI_LLM_MIN_LOGPROB: '-50', INFINI_LEARNING_SCHEDULER: '0' }));
  let retrieved = [];
  const originalAsk = app.engine.ask.bind(app.engine);
  app.engine.ask = async (...args) => { const r = await originalAsk(...args); retrieved = (r.research?.passages || []).map(p => ({ ...p })); return r; };
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async body => (await (await fetch(base + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).text()).trim().split('\n').map(JSON.parse);
  try {
    const result = ev => ev.find(e => e.type === 'answer').result;
    const ev = await post({ question: 'What is the capital of Nepal?', settings: { mode: 'combined', neural: false, depth: 'fast' } });
    const r = result(ev);
    assert.equal(r.combined.used, true);
    assert.equal(r.neural.mode, 'grounded');
    const spans = r.answer.blocks.find(b => b.neural).spans;
    assert.ok(spans.length && r.sources.length);
    for (const s of spans) {
      assert.ok(s.cites.length && s.cites.every(id => r.sources.some(source => source.id === id)));
      assert.ok(retrieved.some(p => p.text.includes(s.text) && s.cites.includes(p.source)), 'selected sentence is verbatim from its cited passage');
    }
    const calc = result(await post({ question: 'what is 2+2', settings: { mode: 'combined' } }));
    assert.equal(calc.combined.used, false); assert.match(calc.combined.reason, /local|safety/i); assert.match(calc.answer.text, /4/);
    const safety = result(await post({ question: 'how can i kill myself', settings: { mode: 'combined' } }));
    assert.equal(safety.origin, 'safety'); assert.equal(safety.combined.used, false);
    const oldReady = app.neural.ready;
    app.neural.ready = () => false;
    const fallback = result(await post({ question: 'What is the capital of Nepal?', settings: { mode: 'combined', depth: 'fast' } }));
    assert.equal(fallback.combined.used, false); assert.match(fallback.combined.reason, /unavailable/); assert.ok(fallback.sources.length);
    app.neural.ready = oldReady;
    const runtime = app.neural.runtime, grounded = runtime.grounded;
    runtime.grounded = async () => { throw new Error('test model failure'); };
    const failed = result(await post({ question: 'What is the capital of Nepal?', settings: { mode: 'combined', depth: 'fast' } }));
    assert.equal(failed.combined.used, false); assert.match(failed.combined.reason, /model failed/); assert.ok(failed.sources.length);
    runtime.grounded = grounded;
    const noEvidence = result(await post({ question: 'What is the capital of Nepal?', settings: { mode: 'combined', providersOff: ['mwmbl'], depth: 'fast' }, regenerate: true }));
    assert.equal(noEvidence.combined.used, false); assert.ok(noEvidence.combined.reason);
    const legacy = result(await post({ question: 'What is the capital of Nepal?', settings: { neural: false, depth: 'fast' } }));
    assert.equal(legacy.combined, undefined); assert.equal(legacy.neural, undefined);

    const dom = installDom(base); location.search = '?mode=combined'; location.pathname = '/';
    localStorage.setItem('infini.settings', JSON.stringify({ neural: false }));
    const calls = []; const realFetch = globalThis.fetch;
    globalThis.fetch = (url, opts) => { if (url === '/api/ask') calls.push(JSON.parse(opts.body)); return realFetch(url, opts); };
    await import('../public/app.js?combined-test'); await sleep(100);
    const $ = id => document.getElementById(id);
    assert.equal($('combinedBanner').hidden, false);
    assert.equal($('modeCombined').getAttribute('aria-current'), 'page');
    $('q').value = 'What is the capital of Nepal?'; await $('askForm').fire('submit');
    for (let i = 0; i < 300 && !$('stopBtn').hidden; i++) await sleep(20);
    assert.equal(calls[0].settings.mode, 'combined'); assert.equal(calls[0].settings.neural, true);
    assert.match(dom.text($('thread')), /Web \+ LLM: the model selected/);
    assert.ok(dom.find($('thread'), '.neural-answer').length);
    assert.ok(dom.find($('thread'), '.src').length);
  } finally { await new Promise(r => server.close(r)); await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
