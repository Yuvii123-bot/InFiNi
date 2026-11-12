// INFINI AI — fetch the large open datasets the common-sense build stage reads.
// They are not kept in the repository (about 520 MB to download, 16 MB + a few MB kept on disk).
//
//   node tools/brain/fetch-raw.mjs            → writes $BRAIN_RAW/wn/dict/* and $BRAIN_RAW/cn_en.tsv
//   node tools/brain/build.mjs commonsense    → rebuilds engine/brain/data/commonsense.json from them
//
// BRAIN_RAW defaults to /var/tmp/brain. Options: --only=wordnet | --only=conceptnet, --sample-mb=N (read only the
// first N MB of the ConceptNet dump: for a quick check of this script, not for a real build).
//
// Sources and licences (see engine/brain/data/NOTICE.md):
//   WordNet 3.1 database        https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz          (WordNet licence)
//   ConceptNet 5.7 assertions   https://s3.amazonaws.com/conceptnet/downloads/2019/edges/…   (CC BY-SA 4.0)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';

const RAW = process.env.BRAIN_RAW || '/var/tmp/brain';
const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : ''; };
const only = arg('only');
const sampleMb = Number(arg('sample-mb')) || 0;
const WORDNET = 'https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz';
const CONCEPTNET = 'https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz';
const UA = { 'User-Agent': 'InfiniAI-brain-build/2.0 (dataset download for an offline build)' };

fs.mkdirSync(RAW, { recursive: true });

async function wordnet() {
  const tgz = path.join(RAW, 'wn31.tar.gz');
  const res = await fetch(WORDNET, { headers: UA });
  if (!res.ok) throw new Error(`WordNet download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tgz));
  fs.mkdirSync(path.join(RAW, 'wn'), { recursive: true });
  execFileSync('tar', ['xzf', tgz, '-C', path.join(RAW, 'wn')]);
  const ok = fs.existsSync(path.join(RAW, 'wn/dict/data.noun'));
  console.log(`WordNet 3.1: ${(fs.statSync(tgz).size / 1e6).toFixed(1)} MB downloaded, extracted to ${path.join(RAW, 'wn/dict')}${ok ? '' : '  (data.noun is MISSING)'}`);
  if (!ok) process.exitCode = 1;
}

/**
 * ConceptNet rows are: uri \t /r/Relation \t /c/lang/start[/pos] \t /c/lang/end[/pos] \t {json: dataset, weight, …}.
 * Kept: English → English statements of the crowd-sourced Open Mind Common Sense dataset (/d/conceptnet/4/en),
 * written as: Relation \t start \t end \t weight \t dataset   (the format build.mjs reads).
 */
async function conceptnet() {
  const headers = { ...UA, ...(sampleMb ? { Range: `bytes=0-${sampleMb * 1024 * 1024 - 1}` } : {}) };
  const res = await fetch(CONCEPTNET, { headers });
  if (!res.ok) throw new Error(`ConceptNet download failed: HTTP ${res.status}`);
  const out = fs.createWriteStream(path.join(RAW, sampleMb ? 'cn_en.sample.tsv' : 'cn_en.tsv'));
  const gunzip = zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH });      // tolerate a cut-off sample
  const src = Readable.fromWeb(res.body);
  src.on('error', (e) => gunzip.destroy(e));
  src.pipe(gunzip);
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });
  let rows = 0, kept = 0;
  try {
    for await (const line of rl) {
      rows++;
      const p = line.split('\t');
      if (p.length < 5 || !p[2].startsWith('/c/en/') || !p[3].startsWith('/c/en/')) continue;
      let meta;
      try { meta = JSON.parse(p[4]); } catch { continue; }
      if (meta.dataset !== '/d/conceptnet/4/en') continue;
      kept++;
      out.write(`${p[1].slice(3)}\t${p[2].slice(6)}\t${p[3].slice(6)}\t${meta.weight ?? 1}\t${meta.dataset.slice(3)}\n`);
      if (rows % 2_000_000 === 0) console.log(`  … ${rows.toLocaleString('en-US')} rows read, ${kept.toLocaleString('en-US')} kept`);
    }
  } catch (e) { if (!sampleMb) throw e; }                                                // a sample ends mid-stream by design
  await new Promise((r) => out.end(r));
  console.log(`ConceptNet 5.7${sampleMb ? ` (first ${sampleMb} MB only)` : ''}: ${rows.toLocaleString('en-US')} rows read, ${kept.toLocaleString('en-US')} English common-sense statements kept → ${out.path}`);
}

if (only !== 'conceptnet') await wordnet();
if (only !== 'wordnet') await conceptnet();
