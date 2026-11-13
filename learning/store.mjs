// INFINITY LLM — learning: where things live on disk, and the configuration.
//
//   <state>/config.json        overrides set from the dashboard (resources, sources, schedule)
//   <state>/state.json         what the learning engine is doing right now
//   <state>/registry.json      every model version, which one is in production, promotion and rollback history
//   <state>/tokenizer.json     the vocabulary (fixed once the first model is trained)
//   <state>/corpus/            documents.jsonl (accepted, with provenance), rejected.jsonl (why not), seen.json
//   <state>/datasets/dNNNN/    token shards + dataset.json (one immutable version per cycle)
//   <state>/runs/cNNNN/        training checkpoint, metrics.jsonl, status.json
//   <state>/models/mNNNN/      exported weights, checkpoint, evaluation
//   <state>/cycles.jsonl       one line per finished cycle; events.jsonl: the log
//   <repo>/model/              the published copy that ships with the app (read-only hosts load this)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLED = path.join(REPO, 'model');

export function stateDir(env = process.env) { return path.resolve(env.INFINI_LLM_DIR || path.join(REPO, 'data', 'llm')); }
export function paths(root = stateDir()) {
  const p = (...a) => path.join(root, ...a);
  return { root, config: p('config.json'), state: p('state.json'), registry: p('registry.json'), tokenizer: p('tokenizer.json'), corpus: p('corpus'), docs: p('corpus', 'documents.jsonl'), rejected: p('corpus', 'rejected.jsonl'), seen: p('corpus', 'seen.json'), datasets: p('datasets'), runs: p('runs'), models: p('models'), cycles: p('cycles.jsonl'), events: p('events.jsonl'), lock: p('worker.lock'), control: p('control.json'), worker: p('worker.json'), supervisor: p('supervisor.lock'), pending: p('corpus', 'pending.json'), channel: p('channel') };
}

export function readJSON(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);                       // readers see the old file or the new one, never half of one
}
export function appendLine(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + '\n'); }
export function readLines(file, { last = 0 } = {}) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  let lines = text.split('\n').filter(Boolean);
  if (last > 0) lines = lines.slice(-last);
  const out = [];
  for (const l of lines) { try { out.push(JSON.parse(l)); } catch { /* a line cut short by a crash is skipped */ } }
  return out;
}
export const nowISO = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
export const nextId = (prefix, existing) => prefix + String(existing.reduce((m, id) => Math.max(m, Number(String(id).slice(prefix.length)) || 0), 0) + 1).padStart(4, '0');
export function listDirs(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; } }
export function copyDir(from, to, names) { fs.mkdirSync(to, { recursive: true }); for (const n of names) if (fs.existsSync(path.join(from, n))) fs.copyFileSync(path.join(from, n), path.join(to, n)); }

export const DEFAULTS = {
  // the model: decided from the measured hardware (python -m llm.hw); "auto" asks llm.hw at bootstrap
  model: { preset: 'auto', vocab_size: 4096, norm: 'rmsnorm', dropout: 0.0 },
  train: { batch_size: 32, grad_accum: 1, lr: 1e-3, min_lr: 1e-4, warmup_steps: 100, weight_decay: 0.05, optimizer: 'adamw', precision: 'auto', device: 'auto', eval_interval: 200, eval_windows: 48, log_interval: 20, save_interval: 50 },   // a checkpoint every 50 steps (under a minute of work): what a power cut can cost
  cycle: {
    auto: false,                 // run cycles on a schedule inside the web server (the dashboard can switch this)
    intervalMinutes: 360,
    maxNewDocs: 120,             // documents fetched per cycle
    minNewDocs: 5,               // fewer accepted new documents than this: no training this cycle
    bootstrapSeconds: 1500,      // training time of the first model
    trainSeconds: 420,           // training time of an incremental cycle
    incrementalLr: 4e-4,         // lower rate when continuing from an approved model
    maxPasses: 1.5,              // an incremental cycle reads its training data at most this many times
    maxCaution: 3,               // after a candidate that generalised worse, the next cycle trains more carefully (see cycle.mjs)
    anchorL2: 1e-4,              // pull towards the approved weights (regularisation against forgetting)
    evalWindows: 96,
  },
  // the always-on worker (learning/worker.mjs): discovery never stops, training starts by itself when enough new text is in
  worker: {
    discoverDocs: 40,            // documents fetched per discovery round
    discoverPauseSeconds: 60,    // pause between discovery rounds (politeness towards the sources, on top of per-host rate limits)
    trainWhenNewDocs: 60,        // start a training cycle as soon as this many new verified documents are waiting ...
    trainAfterMinutes: 45,       // ... or after this long, if at least cycle.minNewDocs are waiting
    idleSeconds: 300,            // pause when the sources have nothing new at all
    heartbeatSeconds: 10,
    backoffSeconds: 15,          // after a crash: wait 15 s, then 30 s, 60 s, ... up to backoffMaxSeconds
    backoffMaxSeconds: 900,
    stallMinutes: 30,            // a child process that reports nothing for this long is killed and the step repeated
    publishSeconds: 120,         // how often the status is published while nothing else changes
    keepModels: 6,               // model versions kept with weights and checkpoint (production and its predecessor always are)
    keepDatasets: 2, keepRuns: 3,
  },
  dialogue: { conversations: 30000 },     // conversations generated with the rule-based brain as the teacher (the base curriculum)
  // share of training windows drawn from each kind of data
  mixture: { dialogue: 0.34, fresh: 0.33, replay: 0.33, groundedShare: 0.55 },
  gate: {
    maxLossRegression: 0.0,      // candidate's validation loss must be at most production's + this (same held-out windows)
    maxAnchorRegression: 0.05,   // on the conversation data the first model was trained on (forgetting check)
    maxProbeDrop: 0.04,          // behaviour probes (reply match, evidence choice, search decision) may not fall by more
    minProbeFloor: { chat: 0.15, grounded: 0.4, route: 0.7 },   // absolute floors for the very first model
    minLearnRatio: 0.6,          // first model: validation loss must be below this share of ln(vocabulary), the loss of a uniform guess
    maxRepetition: 0.35,         // share of sampled replies that fall into loops
    parityRequired: true,        // the exported weights must reproduce PyTorch's logits in the JS engine
    benchmarkRequired: true,     // the fixed benchmark (learning/benchmark/v1.json) must have been run on the candidate
    maxBenchmarkDrop: 0.03,      // its score (mean accuracy of four categories, chance 0.5) may not fall by more than this
    maxBenchmarkLossRegression: 0.05,   // loss on the benchmark's own passages (general English never trained on) may not rise by more
    memorizationRequired: false, // refuse to promote when the dataset carries no memorization probe
    maxVerbatim: 0.15,           // share of trained passages the candidate continues word for word (16 of 24 tokens)
    maxVerbatimExcess: 0.1,      // ... and how much more often than for passages it has never seen
    maxGeneralizationGap: 0.6,   // loss on unseen passages minus loss on trained ones (nats per token)
    maxGapGrowth: 0.15,          // ... measured against production on the same passages, the gap may grow by this much
    maxGapCeiling: 1.0,          // ... and never beyond this, whatever production's own gap is
    maxWebRegression: 0.05,      // held-out document text may not be read worse than by production (nats per token)
    minImprovement: 0.002,       // a candidate must improve the held-out loss by at least this much ...
    minBenchmarkGain: 0.01,      // ... or the benchmark score by this much; "not worse" is not enough to replace production
  },
  resources: { threads: 0, nice: 10, duty: 1.0, maxTrainRssMb: 2200, minFreeMb: 500, maxCorpusMb: 400, python: '' },
  quality: { minChars: 500, maxChars: 400000, languages: ['en'], minScore: 0.55, maxDomainShare: 0.4, nearDupHamming: 4 },
  // licences a document must carry to be used for training (anything else is recorded and left out)
  licences: ['CC0-1.0', 'PDM', 'CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-2.5', 'CC-BY-2.0', 'CC-BY-SA-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-2.5', 'MIT', 'Apache-2.0', 'BSD-3-Clause', 'US-GOV-PD'],
  // where training text comes from. "web": topics → the existing search engine → pages (licence read from each page).
  // "github": text collections in public repositories (licence read from the repository and from each document).
  sources: [
    { id: 'web', type: 'web', enabled: true, perCycle: 40, topics: ['Nepal', 'Kathmandu', 'Mount Everest', 'Himalayas', 'solar system', 'photosynthesis', 'water cycle', 'human heart', 'Internet', 'computer', 'democracy', 'climate', 'electricity', 'gravity', 'atom', 'cell (biology)', 'ocean', 'volcano', 'language', 'mathematics'] },
    // random articles of openly licensed wikis (CC BY-SA, stated in the sites' terms of use), read through their own API
    { id: 'simplewiki', type: 'mediawiki', enabled: true, site: 'https://simple.wikipedia.org', publisher: 'Simple English Wikipedia', perCycle: 30, minBytes: 3000 },
    { id: 'wikibooks', type: 'mediawiki', enabled: true, site: 'https://en.wikibooks.org', publisher: 'Wikibooks', perCycle: 10, minBytes: 4000 },
    { id: 'wikivoyage', type: 'mediawiki', enabled: true, site: 'https://en.wikivoyage.org', publisher: 'Wikivoyage', perCycle: 10, minBytes: 4000 },
    { id: 'factbook', type: 'github', enabled: true, repo: 'factbook/factbook.json', include: '^[a-z-]+/[a-z]{2}\\.json$', format: 'factbook', publisher: 'The World Factbook (CIA), via factbook/factbook.json', quality: 0.86, trusted: true, perCycle: 30 },
    { id: 'openstax-physics', type: 'github', enabled: true, repo: 'openstax/osbooks-physics', include: '^modules/m\\d+/index\\.cnxml$', licenceFrom: 'collections/physics.collection.xml', format: 'cnxml', publisher: 'OpenStax Physics (Rice University)', quality: 0.86, trusted: true, perCycle: 40 },
    // off: its licence is CC BY-NC-SA, which the allow-list refuses. Kept as a worked example of a source that is not usable.
    { id: 'openstax-psychology', type: 'github', enabled: false, repo: 'openstax/osbooks-psychology', include: '^modules/m\\d+/index\\.cnxml$', licenceFrom: 'collections/psychology-2e.collection.xml', format: 'cnxml', publisher: 'OpenStax Psychology 2e (Rice University)', quality: 0.86, trusted: true, perCycle: 10 },
  ],
};

function merge(a, b) {
  if (Array.isArray(b) || b === null || typeof b !== 'object') return b === undefined ? a : b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const k of Object.keys(b)) out[k] = merge(out[k], b[k]);
  return out;
}
/** Defaults ← learning/config.json (in the repository) ← <state>/config.json (set from the dashboard). */
export function loadConfig(root = stateDir()) {
  let cfg = merge(DEFAULTS, readJSON(path.join(REPO, 'learning', 'config.json'), {}) || {});
  cfg = merge(cfg, readJSON(paths(root).config, {}) || {});
  if (!cfg.resources.threads) cfg.resources.threads = Math.max(1, os.cpus().length);
  return cfg;
}
export function saveConfigPatch(root, patch) { const p = paths(root).config; const next = merge(readJSON(p, {}) || {}, patch); writeJSON(p, next); return next; }

export function pythonPath(cfg, env = process.env) {
  const cands = [cfg.resources.python, env.INFINI_PYTHON, path.join(REPO, '.venv', 'bin', 'python'), path.join(REPO, '..', '.venv', 'bin', 'python'), 'python3'].filter(Boolean);
  for (const c of cands) { if (!c.includes(path.sep) || fs.existsSync(c)) return c; }
  return 'python3';
}
export function logEvent(root, type, data = {}) { const ev = { t: nowISO(), type, ...data }; appendLine(paths(root).events, ev); return ev; }
