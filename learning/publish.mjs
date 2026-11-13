// INFINITY LLM — learning: getting an approved model, and the worker's status, from the machine that trains to the
// machines that serve.
//
// The worker writes a "model channel": channel.json (which version is in production, with the checksum of each file),
// the three files of that version under versioned names, snapshot.json (everything the dashboard shows) and status.json
// (the worker's heartbeat). The channel is copied to a directory (a shared volume, or the repository's model/ folder)
// and/or uploaded as assets of a GitHub release. A serving process (engine/neural/channel.js) reads channel.json,
// downloads a new version, checks every checksum and the model's self-test, and only then starts answering with it.
// Only weights and records travel through the channel. Nothing in it is used to write a reply.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, readJSON, writeJSON, readLines, nowISO, loadConfig } from './store.mjs';
import { loadRegistry, modelDir } from './registry.mjs';
import { snapshot } from './cycle.mjs';

const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export const CHANNEL_FORMAT = 'infinity-channel/1';

/**
 * Write the channel into <state>/channel and return what is in it. `model: false` refreshes the records (and the model
 * too if production changed since the last time); `model: 'never'` refreshes the records and nothing else.
 */
export function buildChannel(root, { model = true } = {}) {
  const P = paths(root), reg = loadRegistry(root);
  fs.mkdirSync(P.channel, { recursive: true });
  const files = [];
  const prev = readJSON(path.join(P.channel, 'channel.json'), null);
  let channel = prev;
  if (reg.production && model !== 'never' && (model || !prev || prev.version !== reg.production)) {
    const id = reg.production, dir = modelDir(root, id), card = reg.models[id] || {};
    const entry = {};
    for (const [key, name] of [['model', 'model.json'], ['tokenizer', 'tokenizer.json'], ['weights', 'weights.bin']]) {
      const out = `${id}.${name}`;
      fs.copyFileSync(path.join(dir, name), path.join(P.channel, out));
      fs.chmodSync(path.join(P.channel, out), 0o644);               // published files are meant to be read by others
      entry[key] = { name: out, sha256: sha256File(path.join(P.channel, out)), bytes: fs.statSync(path.join(P.channel, out)).size };
      files.push(out);
    }
    channel = {
      format: CHANNEL_FORMAT, version: id, published: nowISO(), sequence: ((prev && prev.sequence) || 0) + (prev && prev.version === id ? 0 : 1), previous: reg.previous || null, files: entry,
      model: { id, parent: card.parent || null, params: card.params, step: card.step, tokens_seen: card.tokens_seen, val_loss: card.val_loss ?? null, benchmark: card.benchmark || null, promotedAt: card.promotedAt || card.importedAt || null, cycle: card.cycle || null },
      last: reg.history.length ? reg.history[reg.history.length - 1] : null,
    };
    writeJSON(path.join(P.channel, 'channel.json'), channel);
  }
  // records for the dashboard: no paths of this machine, and clearly marked as coming from a worker elsewhere
  const worker = readJSON(P.worker, null);
  const abs = path.resolve(root) + path.sep;
  const snap = { ...snapshot(root), host: { trainingCapable: false, remoteWorker: true }, worker, published: nowISO() };
  writeJSON(path.join(P.channel, 'snapshot.json'), withoutPaths(snap, abs));
  writeJSON(path.join(P.channel, 'status.json'), { published: nowISO(), production: reg.production, previous: reg.previous, worker: worker ? { state: worker.state, activity: worker.activity, heartbeat: worker.heartbeat, started: worker.started, uptimeSeconds: worker.uptimeSeconds, session: worker.session } : null, status: snap.status });
  files.push('snapshot.json', 'status.json');
  if (channel) files.push('channel.json');                       // always last: it is the pointer, the files it names must already be there
  return { dir: P.channel, files, channel, keep: versionsToKeep(root) };
}
function versionsToKeep(root) { const reg = loadRegistry(root); const cfg = loadConfig(root); const ids = Object.keys(reg.models).sort(); return [...new Set([reg.production, reg.previous, ...ids.slice(-cfg.worker.keepModels)].filter(Boolean))]; }

/** Copy the channel to a directory. Files are written under a temporary name and renamed, the pointer last. */
export function publishDir(built, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of built.files) { const tmp = path.join(dest, `.${f}.tmp`); fs.copyFileSync(path.join(built.dir, f), tmp); fs.chmodSync(tmp, 0o644); fs.renameSync(tmp, path.join(dest, f)); }
  for (const f of fs.readdirSync(dest)) { const m = /^(m\d+)\.(model\.json|tokenizer\.json|weights\.bin)$/.exec(f); if (m && !built.keep.includes(m[1])) fs.rmSync(path.join(dest, f), { force: true }); }
  return { target: 'directory', dest, files: built.files.length, version: built.channel && built.channel.version };
}

// ---------- GitHub release as the channel (public repositories serve release assets to anyone, without a token) ----------
function gh({ token, api = 'https://api.github.com', uploads = 'https://uploads.github.com', fetchImpl = fetch }) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'infinity-llm-worker', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const call = async (method, url, { body = null, type = 'application/json', accept = null, ok = [200, 201, 204] } = {}) => {
    const res = await fetchImpl(url, { method, headers: { ...headers, ...(accept ? { Accept: accept } : {}), ...(body != null ? { 'Content-Type': type } : {}) }, body: body == null ? undefined : (type === 'application/json' ? JSON.stringify(body) : body), redirect: 'follow' });
    if (!ok.includes(res.status)) { const text = await res.text().catch(() => ''); throw Object.assign(new Error(`GitHub ${method} ${new URL(url).pathname} → ${res.status} ${text.slice(0, 160)}`), { status: res.status }); }
    return res;
  };
  return { call, api: api.replace(/\/+$/, ''), uploads: uploads.replace(/\/+$/, '') };
}
async function ensureRelease(c, repo, tag, { title, notes, target }) {
  try { return await (await c.call('GET', `${c.api}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`)).json(); }
  catch (e) { if (e.status !== 404) throw e; }
  return (await c.call('POST', `${c.api}/repos/${repo}/releases`, { body: { tag_name: tag, name: title || tag, body: notes || '', prerelease: true, ...(target ? { target_commitish: target } : {}) } })).json();
}
async function listAssets(c, repo, id) { const out = []; for (let page = 1; page <= 5; page++) { const list = await (await c.call('GET', `${c.api}/repos/${repo}/releases/${id}/assets?per_page=100&page=${page}`)).json(); out.push(...list); if (list.length < 100) break; } return out; }

/**
 * Upload files as assets of a release (created when missing). Versioned files that are already there with the same
 * size are not uploaded again; the others are replaced. `keep` lists the model versions whose files stay.
 */
export async function publishGithub({ dir, files, repo, tag, token, api, uploads, fetchImpl, title = '', notes = null, keep = null, target = '' }) {
  if (!repo || !token) throw new Error('publishing to GitHub needs a repository (owner/name) and a token');
  const c = gh({ token, api, uploads, fetchImpl });
  const rel = await ensureRelease(c, repo, tag, { title, notes: notes || '', target });
  const assets = await listAssets(c, repo, rel.id);
  const byName = new Map(assets.map((a) => [a.name, a]));
  let uploaded = 0, skipped = 0, removed = 0;
  for (const f of files) {
    const full = path.join(dir, f), size = fs.statSync(full).size, old = byName.get(f);
    if (old && /^m\d+\./.test(f) && old.size === size && old.state === 'uploaded') { skipped++; continue; }
    if (old) await c.call('DELETE', `${c.api}/repos/${repo}/releases/assets/${old.id}`, { ok: [204, 404] });
    await c.call('POST', `${c.uploads}/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(f)}`, { body: fs.readFileSync(full), type: 'application/octet-stream' });
    uploaded++;
  }
  if (keep) for (const a of assets) { const m = /^(m\d+)\./.exec(a.name); if (m && !keep.includes(m[1])) { await c.call('DELETE', `${c.api}/repos/${repo}/releases/assets/${a.id}`, { ok: [204, 404] }); removed++; } }
  if (notes != null) await c.call('PATCH', `${c.api}/repos/${repo}/releases/${rel.id}`, { body: { body: String(notes).slice(0, 120000), ...(title ? { name: title } : {}) } });
  return { target: 'github', repo, tag, uploaded, skipped, removed, url: `https://github.com/${repo}/releases/download/${tag}/` };
}
/** Download one asset of a release to a file. Returns null when the release or the asset does not exist. */
export async function fetchGithubAsset({ repo, tag, name, token, api, fetchImpl, to }) {
  const c = gh({ token, api, fetchImpl });
  let rel;
  try { rel = await (await c.call('GET', `${c.api}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`)).json(); } catch (e) { if (e.status === 404) return null; throw e; }
  const asset = (await listAssets(c, repo, rel.id)).find((a) => a.name === name);
  if (!asset) return null;
  const res = await c.call('GET', `${c.api}/repos/${repo}/releases/assets/${asset.id}`, { accept: 'application/octet-stream' });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  return { file: to, bytes: fs.statSync(to).size, updated: asset.updated_at };
}

/** A copy of the records in which no string names a place on this machine: the state directory is cut out of every
    string, and any other absolute path (a publishing directory, a Python interpreter) is replaced by its last part. */
export function withoutPaths(value, stateDir) {
  const clean = (str) => {
    let t = stateDir ? str.split(stateDir).join('') : str;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;                     // an address on the web is not a path here
    t = t.replace(/(^|[\s"'(=:,])((?:\/|[A-Za-z]:\\)(?:[\w.@+~-]+[\/\\])+)([\w.@+~-]*)/g, (m, pre, dirs, last) => (/^([A-Za-z]:\\|\/(home|root|Users|tmp|var|opt|srv|mnt|data|app|workspace|github|runner|etc|usr|private)[\/\\])/.test(dirs) ? `${pre}${last || '…'}` : m));
    return t;
  };
  const walk = (v) => (typeof v === 'string' ? clean(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  return walk(value);
}

/**
 * Is there newer code than the commit this worker runs? Used by hosts where the worker lives in sessions (GitHub
 * Actions): a session that learns a fix was pushed ends early, and the next session runs the fixed code.
 * @returns the new commit's id, or null (same commit, or the question could not be answered)
 */
export async function newerCommit({ repo, ref, sha, env = process.env, fetchImpl = fetch }) {
  if (!repo || !ref || !sha) return null;
  const token = env.INFINI_PUBLISH_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || '';
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetchImpl(`${env.INFINI_GITHUB_API || 'https://api.github.com'}/repos/${repo}/commits/${encodeURIComponent(ref)}`, { headers: { accept: 'application/vnd.github.sha', 'user-agent': 'infinity-llm-worker', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: ctrl.signal });
    if (!res.ok) return null;
    const head = (await res.text()).trim();
    return /^[0-9a-f]{40}$/.test(head) && head !== sha ? head : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

function sourceSummary(root) {
  try { const src = (snapshot(root).corpus || {}).sources || {}; return Object.fromEntries(Object.entries(src).map(([k, v]) => [k, { accepted: v.accepted, rejected: v.rejected, domains: v.domains, last: v.last }])); } catch { return null; }
}
/** A short human-readable status (shown as the text of the release, and readable through the API). */
export function statusNotes(root) {
  const P = paths(root), reg = loadRegistry(root), w = readJSON(P.worker, null) || {}, st = readJSON(P.state, {}) || {};
  const card = reg.production ? reg.models[reg.production] || {} : {};
  const lines = [
    '**Infinity LLM — model channel** (written by the learning worker; do not edit)', '',
    `- production model: \`${reg.production || 'none'}\`${card.params ? ` (${card.params.toLocaleString('en-US')} parameters, step ${card.step})` : ''}; previous stable: \`${reg.previous || 'none'}\``,
    `- held-out loss: ${card.val_loss ?? 'n/a'}; fixed benchmark: ${card.benchmark ? card.benchmark.score : 'n/a'}`,
    `- worker: ${w.state || 'unknown'}, ${w.activity || ''}; heartbeat ${w.heartbeat || 'n/a'}; session ${w.session || 'n/a'}; starts ${w.starts ?? 'n/a'}`,
    `- last cycle: ${st.lastCycle ? `${st.lastCycle.id} ${st.lastCycle.outcome} at ${st.lastCycle.finished}` : 'none yet'}`,
    `- ${st.message || ''}`, '', '```json', JSON.stringify({ t: nowISO(), production: reg.production, previous: reg.previous, worker: { state: w.state, activity: w.activity, heartbeat: w.heartbeat, uptimeSeconds: w.uptimeSeconds, starts: w.starts, recoveries: w.recoveries, childFailures: w.childFailures, totals: w.totals, lastError: (w.errors || []).slice(-1)[0] || null }, lastCycle: st.lastCycle || null, lastDiscovery: st.lastDiscovery || null, caution: st.caution || 0, lastRecovery: w.lastRecovery || null, resources: w.resources || null, lastStep: w.lastStep || null, sources: sourceSummary(root), discovery: readLines(path.join(root, 'discovery.jsonl'), { last: 2 }).map((r) => ({ round: r.round, collected: r.collected, accepted: r.accepted, rejected: r.rejected, reasons: r.reasons, bySource: r.bySource, errors: r.errors })), cycles: readLines(P.cycles, { last: 4 }).map((c) => ({ id: c.id, outcome: c.outcome, seconds: c.seconds, plan: c.plan || null, message: String(c.message || '').slice(0, 400) })), history: reg.history.slice(-8) }), '```',
  ];
  return lines.join('\n');
}

/** Publish to every target the environment names. Never throws: a failed upload is reported and tried again later. */
export async function publishAll(root, { env = process.env, model = true, fetchImpl = undefined } = {}) {
  const built = buildChannel(root, { model });
  const results = [];
  // a records-only publication leaves the pointer and the model files alone (replacing the pointer would make it
  // unavailable for a moment); when the channel was rebuilt for a new version, everything goes out regardless
  const files = model !== 'never' && (model || built.files.some((f) => /^m\d+\./.test(f))) ? built.files : built.files.filter((f) => f !== 'channel.json' && !/^m\d+\./.test(f));
  if (env.INFINI_PUBLISH_DIR) { try { results.push(publishDir({ ...built, files }, path.resolve(env.INFINI_PUBLISH_DIR))); } catch (e) { results.push({ target: 'directory', error: String(e && e.message).slice(0, 200) }); } }
  if (env.INFINI_PUBLISH_GITHUB) {
    try { results.push(await publishGithub({ dir: built.dir, files, repo: env.INFINI_PUBLISH_GITHUB, tag: env.INFINI_PUBLISH_TAG || 'infinity-model', token: env.INFINI_PUBLISH_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN, api: env.INFINI_GITHUB_API || undefined, uploads: env.INFINI_GITHUB_UPLOADS || undefined, fetchImpl, title: 'Infinity LLM model channel', notes: statusNotes(root), keep: built.keep, target: env.INFINI_PUBLISH_TARGET || '' })); }
    catch (e) { results.push({ target: 'github', error: String(e && e.message).slice(0, 240) }); }
  }
  return { version: built.channel && built.channel.version, results };
}

/** Store the whole state as one archive in a GitHub release (hosts without a permanent disk). */
export async function pushState(root, { env = process.env, fetchImpl = undefined } = {}) {
  const repo = env.INFINI_STATE_GITHUB, tag = env.INFINI_STATE_TAG || 'infinity-state';
  if (!repo) throw new Error('INFINI_STATE_GITHUB (owner/repository) is not set');
  const { packState } = await import('./persist.mjs');
  const dir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'infinity-pack-'));
  try {
    const p = packState(root, path.join(dir, 'state.tar.gz'));
    const r = await publishGithub({ dir, files: ['state.tar.gz'], repo, tag, token: env.INFINI_PUBLISH_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN, api: env.INFINI_GITHUB_API || undefined, uploads: env.INFINI_GITHUB_UPLOADS || undefined, fetchImpl, title: 'Infinity LLM learning state', notes: `Archive of the learning worker's state directory (corpus records, model versions, checkpoints, history). Written by the worker; a new session restores it and continues.\n\nLast stored: ${nowISO()} · ${(p.bytes / 2 ** 20).toFixed(1)} MB · sha256 ${p.sha256}`, target: env.INFINI_PUBLISH_TARGET || '' });
    return { stored: true, bytes: p.bytes, sha256: p.sha256, repo, tag, uploaded: r.uploaded };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
