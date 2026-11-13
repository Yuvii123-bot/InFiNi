// The learning dashboard as a visitor of a serving-only deployment sees it: the real public/learning.js in a fake DOM,
// against the real server, which reads the worker's records from a model channel. Offline.
//
// test/fixtures/worker/snapshot.json is a real one: published by the always-on worker during its first run (two refused
// candidates, one promotion, one worker killed in the middle of a cycle and replaced). The model files in the test
// channel are the repository's published model under that snapshot's version name — this test is about what the page
// shows from the records, not about the weights.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { installDom } from './helpers/fake-dom.mjs';
import { fakeConfig } from './helpers/fake-web.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('learning dashboard: worker, discovery, candidate against production and the fixed benchmark, from the records a worker publishes', async () => {
  process.env.LOG_LEVEL = 'silent';
  const snap = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'worker', 'snapshot.json'), 'utf8'));
  const id = snap.registry.production;
  snap.worker.heartbeat = new Date(Date.now() - 20_000).toISOString();           // as if published twenty seconds ago
  snap.worker.state = 'running';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infini-ui-channel-'));
  const files = {};
  for (const [key, name] of [['model', 'model.json'], ['tokenizer', 'tokenizer.json'], ['weights', 'weights.bin']]) {
    const out = `${id}.${name}`;
    fs.copyFileSync(path.join(REPO, 'model', 'current', name), path.join(dir, out));
    files[key] = { name: out, sha256: sha(path.join(dir, out)), bytes: fs.statSync(path.join(dir, out)).size };
  }
  fs.writeFileSync(path.join(dir, 'channel.json'), JSON.stringify({ format: 'infinity-channel/1', version: id, published: new Date().toISOString(), sequence: 2, previous: snap.registry.previous, files }));
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snap));
  const cfg = fakeConfig({ INFINI_LLM: '1', INFINI_LLM_DIR: path.join(dir, 'no-state'), INFINI_LEARNING: '0', INFINI_LEARNING_SCHEDULER: '0', INFINI_MODEL_CHANNEL: 'https://channel.test/live', INFINI_MODEL_CHANNEL_DIR: path.join(dir, 'received') });
  cfg.fetchImpl = async (url) => { const f = path.join(dir, path.basename(new URL(url).pathname)); return fs.existsSync(f) ? new Response(fs.readFileSync(f), { status: 200 }) : new Response('', { status: 404 }); };
  const app = createApp(cfg);
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dom = installDom(`http://127.0.0.1:${server.address().port}`);
  const session = new Map();
  globalThis.sessionStorage = { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) };
  globalThis.matchMedia = () => ({ matches: false });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await import('../public/learning.js');
    let text = '';
    for (let i = 0; i < 100 && !/Learning worker/.test(text); i++) { await sleep(100); text = dom.text(document.getElementById('dash')); }
    assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/);

    // the worker: alive, what it does, what it has done, what went wrong and how it recovered
    assert.match(text, /always-on worker/);
    assert.match(text, /Learning worker/);
    assert.match(text, /alive · /);
    assert.match(text, new RegExp(`Heartbeat\\s*(\\d+ s|just now|less than a minute)`), 'the age of the last heartbeat is shown');
    assert.match(text, /Recoveries\s*1\s*restarts after an unclean end/);
    assert.match(text, /Last recovery .*ended without shutting down.*cycle c0006 is unfinished .* will be continued/);
    assert.match(text, /Discovery rounds/);
    assert.match(text, new RegExp(`Cycles\\s*${snap.worker.totals.cycles}\\s*${snap.worker.totals.promoted} promoted · ${snap.worker.totals.rejected} rejected`));
    assert.match(text, /Resource usage/);
    assert.match(text, /Errors/);

    // discovery: what waits, and every source with what it delivered and what was turned away
    assert.match(text, /Waiting for training/);
    assert.match(text, /factbook\s*github\s*\d+\s*\d+/);
    assert.match(text, /openstax-physics\s*github\s*\d+\s*\d+/);
    assert.match(text, /simplewiki\s*mediawiki/);

    // candidate against production, measured on the same data
    assert.match(text, /Current and candidate model/);
    assert.match(text, new RegExp(`In production\\s*${id}`));
    assert.match(text, /Measured on the same data/);
    assert.match(text, /Held-out loss/);
    assert.match(text, /Benchmark score/);
    assert.match(text, /Loss gap unseen − trained/);
    assert.match(text, /Training caution: level \d/);

    // the fixed benchmark, per version
    assert.match(text, /Fixed benchmark/);
    assert.match(text, /176 items and 16 passages/);
    for (const m of snap.benchmark.models) assert.match(text, new RegExp(`${m.id}(production|previous|rejected|candidate)${(m.score * 100).toFixed(1)}%`), `benchmark row of ${m.id}`);
    assert.ok(snap.benchmark.models.length >= 4 && new Set(snap.benchmark.models.map((m) => m.id)).size === snap.benchmark.models.length, 'one row per model version');

    // history: refusals with their reasons and the promotion are all there
    assert.match(text, /m0003 rejected.*fixed benchmark text is not read worse/);
    assert.match(text, /m0005 promoted/);

    // a serving-only host: the page says where the records come from, and offers no training controls that could not work
    assert.match(text, /separate worker|records that worker publishes/);
    const status = await (await fetch(`http://127.0.0.1:${server.address().port}/api/llm/status`)).json();
    assert.equal(status.learning.host.remoteWorker, true);
    assert.equal(status.learning.worker.alive, true);
    assert.equal(status.learning.host.channel.version, id);
    assert.equal(status.model.version, id);
    assert.doesNotMatch(JSON.stringify(status), /\/home\/|data\/llm\//, 'no path of the worker machine reaches a visitor');
  } finally { server.close(); await app.close(); }
});
