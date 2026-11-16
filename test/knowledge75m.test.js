import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const hash = x => crypto.createHash('sha256').update(x).digest('hex');
test('knowledge shards are deterministic and document-separated with source attribution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infini-knowledge-'));
  try {
    const fb = path.join(root, 'factbook'), ph = path.join(root, 'physics');
    fs.mkdirSync(path.join(fb, 'europe'), { recursive: true });
    fs.mkdirSync(path.join(ph, 'collections'), { recursive: true });
    let modules = '';
    for (let i = 0; i < 50; i++) {
      const file = String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26) + '.json';
      fs.writeFileSync(path.join(fb, 'europe', file), JSON.stringify({ Government: { 'Country name': { 'conventional short form': { text: `Test Country ${i}` } } }, Geography: { Background: { text: `This is a sufficiently long test country description for entry ${i} with geography.` } } }));
      const id = 'm' + (10000 + i); modules += `<col:module document="${id}"/>`;
      fs.mkdirSync(path.join(ph, 'modules', id), { recursive: true });
      fs.writeFileSync(path.join(ph, 'modules', id, 'index.cnxml'), `<document><title>Test science ${i}</title><content><para>A sufficiently long educational physics paragraph for example document number ${i}.</para></content></document>`);
    }
    fs.writeFileSync(path.join(ph, 'collections', 'physics.collection.xml'), `<md:license url="http://creativecommons.org/licenses/by/4.0/"/>${modules}`);
    const out1 = path.join(root, 'out1'), out2 = path.join(root, 'out2');
    for (const out of [out1, out2]) {
      const r = spawnSync(process.execPath, ['learning/knowledge75m-dataset.mjs', fb, ph, out], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    }
    const m = JSON.parse(fs.readFileSync(path.join(out1, 'dataset.json')));
    const sources = JSON.parse(fs.readFileSync(path.join(out1, 'sources.json'))).files;
    assert.equal(sources.length, 100);
    assert.equal(new Set(sources.map(s => s.url)).size, sources.length);
    assert.ok(m.shards.every(s => s.tokens > 0 && s.documents > 0));
    assert.equal(m.sources.physics.licence, 'CC-BY-4.0');
    assert.match(m.sources.physics.attribution, /OpenStax/);
    for (const file of fs.readdirSync(out1)) assert.equal(hash(fs.readFileSync(path.join(out1, file))), hash(fs.readFileSync(path.join(out2, file))), file);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
