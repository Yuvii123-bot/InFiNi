// Infinity LLM — learning dashboard. Every number on this page is read from /api/llm/status, which reads the files the
// training system wrote (checkpoints, metric logs, the model registry, the corpus records). Nothing is simulated here.

const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const S = (tag, attrs, ...kids) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); for (const kid of kids.flat()) if (kid != null) el.append(kid); return el; };
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—');
const fix = (n, d = 3) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—');
const pct = (n) => (typeof n === 'number' && Number.isFinite(n) ? (n * 100).toFixed(1) + '%' : '—');
const when = (t) => { if (!t) return '—'; const d = new Date(t); return Number.isNaN(+d) ? String(t) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const dur = (s) => (typeof s !== 'number' ? '—' : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(1)} h`);
const kv = (pairs) => h('dl', { class: 'kv' }, pairs.filter(Boolean).map(([k, v, small]) => h('div', null, h('dt', { text: k }), h('dd', null, String(v), small ? h('small', { text: ' ' + small }) : null))));
const card = (title, sub, ...kids) => h('section', { class: 'card' }, h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, ...kids);
const table = (head, rows) => h('div', { class: 'tbl-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, head.map((c) => h('th', { class: typeof c === 'object' ? 'num' : null, text: typeof c === 'object' ? c.n : c })))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: typeof head[i] === 'object' ? 'num' : null }, c && typeof c === 'object' && 'nodeType' in c ? c : String(c ?? '—'))))))));
const pill = (text, cls) => h('span', { class: 'pill ' + (cls || ''), text });
const OUTCOME = { promoted: ['promoted', 'ok'], rejected: ['rejected by the gate', 'warn'], 'no-new-data': ['no new data', ''], paused: ['paused', 'warn'], postponed: ['postponed', 'warn'], 'training-unavailable': ['training unavailable', 'warn'] };
const STATUS = { production: 'ok', previous: '', experimental: 'run', rejected: 'warn', 'rolled-back': 'warn', archived: '' };

let token = sessionStorage.getItem('infini.admin') || '';
let data = null, timer = null, adminMsg = null, formDirty = false;

async function load() {
  try {
    const res = await fetch('/api/llm/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 429 ? 'Too many requests; retrying shortly.' : `The server answered ${res.status}.`);
    data = await res.json();
  } catch (e) { if (!data) $('dash').replaceChildren(h('p', { class: 'l-wait', text: `Could not load the learning records: ${e.message}` })); }
  if (data && !formDirty) { try { render(); } catch (e) { $('dash').replaceChildren(h('p', { class: 'l-wait', text: `The learning records were loaded but could not be displayed: ${e.message}` })); } }
  clearTimeout(timer);
  const running = data && data.learning && data.learning.status && data.learning.status.state === 'running';
  timer = setTimeout(load, running ? 4000 : 20000);
  if (timer && typeof timer.unref === 'function') timer.unref();         // under Node (the tests) the poll must not keep the process alive
}

function lossChart(curve, registry) {
  const pts = curve.filter((p) => typeof p.loss === 'number' && typeof p.step === 'number');
  if (pts.length < 2) return h('p', { class: 'muted small', text: 'No training steps have been logged yet.' });
  const W = 860, H = 280, L = 44, R = 12, T = 10, B = 28;
  const xs = pts.map((p) => p.step), ys = pts.flatMap((p) => [p.loss, p.val_loss]).filter((v) => typeof v === 'number');
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.max(0, Math.floor(Math.min(...ys) * 2) / 2), y1 = Math.min(Math.ceil(Math.max(...ys) * 2) / 2, Math.max(...ys));
  const X = (v) => L + (W - L - R) * (v - x0) / Math.max(1, x1 - x0), Y = (v) => T + (H - T - B) * (1 - (v - y0) / Math.max(1e-9, y1 - y0));
  const svg = S('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Training loss and validation loss by optimizer step' });
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4; svg.append(S('line', { class: 'gridl', x1: L, x2: W - R, y1: Y(v), y2: Y(v) }), Object.assign(S('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end' }), { textContent: v.toFixed(2) })); }
  for (let i = 0; i <= 5; i++) { const v = Math.round(x0 + (x1 - x0) * i / 5); svg.append(Object.assign(S('text', { x: X(v), y: H - 8, 'text-anchor': 'middle' }), { textContent: num(v) })); }
  svg.append(S('line', { class: 'axis', x1: L, x2: W - R, y1: H - B, y2: H - B }));
  // where each model version was cut
  for (const m of Object.values(registry.models || {})) if (typeof m.step === 'number' && m.step > x0 && m.step <= x1) svg.append(S('line', { class: 'mark', x1: X(m.step), x2: X(m.step), y1: T, y2: H - B }), Object.assign(S('text', { x: X(m.step) - 4, y: T + 10, 'text-anchor': 'end' }), { textContent: m.id }));
  const runs = [...new Set(pts.map((p) => p.run))];
  for (const run of runs) {
    const rp = pts.filter((p) => p.run === run);
    svg.append(S('path', { class: 'train', d: rp.map((p, i) => `${i ? 'L' : 'M'}${X(p.step).toFixed(1)} ${Y(Math.min(p.loss, y1)).toFixed(1)}`).join(' ') }));
    const vp = rp.filter((p) => typeof p.val_loss === 'number');
    if (vp.length) svg.append(S('path', { class: 'val', d: vp.map((p, i) => `${i ? 'L' : 'M'}${X(p.step).toFixed(1)} ${Y(Math.min(p.val_loss, y1)).toFixed(1)}`).join(' ') }), ...vp.map((p) => S('circle', { class: 'valdot', cx: X(p.step), cy: Y(Math.min(p.val_loss, y1)), r: 2.4 })));
  }
  return h('div', null, svg, h('div', { class: 'legend' }, h('span', null, h('i', { class: 'a' }), 'training loss (each logged step)'), h('span', null, h('i', { class: 'b' }), 'validation loss (held-out text)'), h('span', { text: 'dashed lines: where a model version was saved' })));
}

async function admin(action, extra = {}) {
  adminMsg = { ok: null, text: 'Working…' }; renderAdminMsg();
  try {
    const res = await fetch('/api/llm/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...extra }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || `The server answered ${res.status}.`);
    adminMsg = { ok: true, text: action === 'check' ? 'The token is accepted.' : `Done: ${action}${body.production ? ` → production is now ${body.production}` : ''}${body.started ? ` (${body.started} started)` : ''}.` };
    if (action === 'check') sessionStorage.setItem('infini.admin', token);
    formDirty = false;
    await load();
  } catch (e) { adminMsg = { ok: false, text: e.message }; if (/token/i.test(e.message)) sessionStorage.removeItem('infini.admin'); }
  renderAdminMsg();
}
function renderAdminMsg() { const el = $('adminMsg'); if (el && adminMsg) { el.className = adminMsg.ok === false ? 'msg-bad' : 'msg-ok'; el.textContent = adminMsg.text; } }

function adminCard(L) {
  const host = L.host || {};
  if (!host.trainingCapable) return card('Controls', null, h('div', { class: 'note-box', text: `Training does not run on this host: ${host.reason || 'not available'}.${host.snapshotOf ? ` These records were published on ${when(host.snapshotOf)}.` : ''}` }));
  if (!host.adminConfigured) return card('Controls', null, h('div', { class: 'note-box', text: 'The controls are disabled: this server has no admin token. Set INFINI_ADMIN_TOKEN (16 characters or more) in its environment and restart it.' }));
  const cfg = L.config || {}, c = cfg.cycle || {}, r = cfg.resources || {};
  const tok = h('input', { type: 'password', placeholder: 'Admin token', autocomplete: 'off', 'aria-label': 'Admin token' }); tok.value = token;
  tok.addEventListener('input', () => { token = tok.value.trim(); });
  const dirty = () => { formDirty = true; };
  const n = (label, value, step) => { const i = h('input', { type: 'number', step: step || '1' }); i.value = value ?? ''; i.addEventListener('input', dirty); return [h('label', { class: 'f' }, label, i), i]; };
  const [autoL, auto] = (() => { const i = h('input', { type: 'checkbox' }); i.checked = !!c.auto; i.addEventListener('change', dirty); return [h('label', { class: 'c' }, i, 'Run cycles automatically'), i]; })();
  const [ivL, iv] = n('Minutes between cycles', c.intervalMinutes), [mdL, md] = n('New documents per cycle', c.maxNewDocs), [tsL, ts] = n('Training seconds per cycle', c.trainSeconds);
  const [thL, th] = n('CPU threads for training', r.threads), [dtL, dt] = n('Share of time training (0.1–1)', r.duty, '0.1'), [mmL, mm] = n('Memory limit for training (MB)', r.maxTrainRssMb);
  const srcRows = (cfg.sources || []).map((s) => { const i = h('input', { type: 'checkbox' }); i.checked = s.enabled; i.addEventListener('change', dirty); return { s, i, el: h('label', { class: 'c' }, i, `${s.id} (${s.type === 'web' ? 'web search' : s.type === 'mediawiki' ? String(s.site || '').replace(/^https?:\/\//, '') : s.repo || s.type})`) }; });
  const web = (cfg.sources || []).find((s) => s.type === 'web');
  const topics = h('textarea', { 'aria-label': 'Topics for web discovery, one per line' }); topics.value = web && web.topics ? web.topics.join('\n') : ''; topics.addEventListener('input', dirty);
  const save = () => admin('configure', { settings: { cycle: { auto: auto.checked, intervalMinutes: Number(iv.value), maxNewDocs: Number(md.value), trainSeconds: Number(ts.value) }, resources: { threads: Number(th.value), duty: Number(dt.value), maxTrainRssMb: Number(mm.value) }, sources: srcRows.map(({ s, i }) => ({ id: s.id, enabled: i.checked, ...(s.type === 'web' ? { topics: topics.value.split('\n') } : {}) })) } });
  const st = L.status || {}, reg = L.registry || {};
  const b = (text, fn, cls) => h('button', { class: 'btn small ' + (cls || ''), type: 'button', text, onclick: fn });
  return h('section', { class: 'card admin' }, h('h2', { text: 'Controls' }), h('p', { class: 'sub', text: 'Protected: every action is checked against the server\'s admin token. The token is kept for this browser tab only.' }),
    h('div', { class: 'row' }, tok, b('Check token', () => admin('check'))),
    h('div', { class: 'row' }, st.paused ? b('Resume learning', () => admin('resume'), 'primary') : b('Pause learning', () => admin('pause')), b('Start a learning cycle now', () => admin('start'), 'primary'), b('Evaluate the production model', () => admin('evaluate')),
      b(reg.previous ? `Roll back to ${reg.previous}` : 'Roll back (no earlier model)', () => { if (!reg.previous) return; const reason = prompt(`Roll back from ${reg.production} to ${reg.previous}? Reason (kept in the history):`, ''); if (reason !== null) admin('rollback', { reason }); }, 'danger')),
    h('p', { id: 'adminMsg', class: 'msg-ok' }),
    h('div', { class: 'row' }, autoL, ivL, mdL, tsL), h('div', { class: 'row' }, thL, dtL, mmL),
    h('div', { class: 'row' }, h('span', { class: 'muted small', text: 'Sources:' }), ...srcRows.map((x) => x.el)),
    web ? h('label', { class: 'f' }, 'Topics for web discovery (one per line)', topics) : null,
    h('div', { class: 'row' }, b('Save settings', save, 'primary'), formDirty ? b('Discard changes', () => { formDirty = false; render(); }) : null));
}

const ago = (s) => (typeof s !== 'number' ? '—' : s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${(s / 3600).toFixed(1)} h ago` : `${Math.round(s / 86400)} days ago`);
const mb = (n) => (typeof n !== 'number' ? '—' : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`);

/** The always-on worker: is it alive, what is it doing, how long has it run, what went wrong, what does it use. */
function workerCard(L) {
  const w = L.worker, host = L.host || {};
  if (!w) return card('Learning worker', 'The process that keeps learning when nobody is here.', h('div', { class: 'note-box', text: host.trainingCapable ? 'No worker has run on this machine yet. Start one with "node learning/worker.mjs" (or the container and service files in deploy/); it then discovers, trains, evaluates and publishes by itself.' : 'No worker has published its status yet. The worker is a separate process (deploy/ and docs/WORKER.md); this site shows its records once it publishes them.' }));
  const r = w.resources || {}, t = w.totals || {};
  const state = w.alive ? pill(`alive · ${w.activity || 'working'}`, 'run') : w.state === 'stopped' ? pill('stopped', 'warn') : pill('no heartbeat', 'bad');
  const errs = (w.errors || []).slice(-6).reverse();
  return card('Learning worker', 'A separate long-running process. It discovers, trains, evaluates and publishes without anyone visiting this page.',
    h('div', { class: 'banner' }, state, w.session ? pill(`session ${w.session}`) : null, h('span', { class: 'muted small', text: `${w.detail || ''}${w.nextAction ? ` · ${w.nextAction}` : ''}` })),
    kv([
      ['Heartbeat', ago(w.heartbeatAgeSeconds), when(w.heartbeat)], ['Uptime', dur(w.uptimeSeconds), `this run, since ${when(w.started)}`], ['Total uptime', dur(t.uptimeSeconds), `${num(w.starts)} starts since ${when(w.firstStarted)}`],
      ['Recoveries', num(w.recoveries), 'restarts after an unclean end'], ['Failed steps', num(w.childFailures), `${num(w.consecutiveFailures)} in a row now`], ['Discovery rounds', num(t.discoveryRounds)],
      ['Documents', `${num(t.documentsAccepted)} verified`, `${num(t.documentsCollected)} collected · ${num(t.documentsRejected)} rejected`], ['Cycles', num(t.cycles), `${num(t.promoted)} promoted · ${num(t.rejected)} rejected`],
      w.lastStep ? ['Last step', `${w.lastStep.kind}: ${w.lastStep.outcome}`, `${dur(w.lastStep.seconds)} · ${when(w.lastStep.started)}`] : null,
      w.lastPublish ? ['Last published', w.lastPublish.version || '—', `${when(w.lastPublish.t)} · ${(w.lastPublish.targets || []).map((x) => `${x.target}${x.ok ? '' : ' failed'}`).join(', ') || 'no target configured'}`] : null,
      ['Runs on', w.where || w.host || '—', `${w.platform || ''} · Node ${w.node || ''}`],
    ]),
    h('h3', { class: 'h3', text: 'Resource usage' }),
    kv([['Processor load', fix(r.load1, 2), `${num(r.cpus)} cores`], ['Memory free', mb(r.memFreeMb), `of ${mb(r.memTotalMb)}`], ['Worker memory', mb(r.workerRssMb)], ['Current step', r.stepRssMb ? mb(r.stepRssMb) : '—', r.trainerRssMb ? `trainer ${mb(r.trainerRssMb)}` : ''], ['Disk free', mb(r.diskFreeMb)], ['Learning state', mb(r.stateMb), 'on disk']]),
    h('h3', { class: 'h3', text: 'Errors' }),
    errs.length ? h('ul', { class: 'events' }, errs.map((e) => h('li', null, h('time', { text: when(e.t) }), `${e.where}: ${e.message}`))) : h('p', { class: 'muted small', text: 'No errors recorded.' }),
    w.lastRecovery ? h('p', { class: 'small muted', text: `Last recovery ${when(w.lastRecovery.t)}: ${(w.lastRecovery.found || []).join('; ')}` }) : null);
}

/** Discovery: what is waiting to be learned, and what each source delivered. */
function discoveryCard(L) {
  const d = L.discovery || {}, corpus = L.corpus || {}, src = corpus.sources || {}, conf = (L.config && L.config.sources) || [];
  const ids = [...new Set([...conf.map((c) => c.id), ...Object.keys(src)])];
  const frac = d.trainAt ? Math.min(1, (d.waiting || 0) / d.trainAt) : 0;
  const bar = h('div', { class: 'bar' }, h('i')); bar.firstChild.style.width = (frac * 100).toFixed(1) + '%';
  const rounds = [...(d.rounds || [])].reverse().slice(0, 8);
  return card('Discovery', 'Sources are read continuously. Every document is kept with its origin and licence, or rejected with the reason.',
    kv([['Waiting for training', `${num(d.waiting)} documents`, d.trainAt ? `a cycle starts at ${num(d.trainAt)}, or at ${num(d.minNewDocs)} after ${num(d.trainAfterMinutes)} min` : ''], ['Collected in total', num((corpus.documents || 0) + (corpus.rejected || 0))], ['Verified', num(corpus.documents), `from ${num(corpus.domains)} sites`], ['Rejected', num(corpus.rejected), Object.entries(corpus.rejectedByStage || {}).map(([k, v]) => `${k} ${v}`).join(' · ')]]),
    bar,
    ids.length ? table(['Source', 'Kind', { n: 'Verified' }, { n: 'Rejected' }, 'Last delivered'], ids.map((id) => { const c = conf.find((x) => x.id === id) || {}, x = src[id] || {}; return [id + (c.enabled === false ? ' (off)' : ''), c.type || '—', num(x.accepted || 0), num(x.rejected || 0), x.last ? when(x.last) : 'nothing yet']; })) : null,
    rounds.length ? h('details', null, h('summary', { class: 'small muted', text: `Latest discovery rounds (${rounds.length})` }), table(['Round', 'Finished', { n: 'Collected' }, { n: 'Verified' }, { n: 'Rejected' }, 'Unreachable'], rounds.map((x) => [x.round, when(x.finished), num(x.collected), num(x.accepted), num(x.rejected), (x.errors || []).map((e) => String(e).split(':')[0]).join(', ') || '—']))) : null);
}

/** Which model answers, which one is being built, and what happened to the last candidate. */
function candidateCard(L, reg) {
  const c = L.candidate || {}, cur = c.current, last = c.last, st = L.status || {};
  const prod = reg.production ? reg.models[reg.production] : null;
  const ev = last && last.evaluation;
  const rows = ev && ev.production ? [
    ['Held-out loss', fix(ev.candidate.val_loss), fix(ev.production.val_loss)],
    ...(ev.candidate.groups && ev.candidate.groups.web && ev.production.groups && ev.production.groups.web ? [['Held-out document text', fix(ev.candidate.groups.web.val_loss), fix(ev.production.groups.web.val_loss)], ['Held-out conversation', fix(ev.candidate.groups.dialogue.val_loss), fix(ev.production.groups.dialogue.val_loss)]] : []),
    ['Benchmark score', ev.candidate.benchmark ? pct(ev.candidate.benchmark.score) : '—', ev.production.benchmark ? pct(ev.production.benchmark.score) : '—'],
    ['Benchmark text loss', ev.candidate.benchmark ? fix(ev.candidate.benchmark.passageLoss) : '—', ev.production.benchmark ? fix(ev.production.benchmark.passageLoss) : '—'],
    ['Reply match (F1)', pct(ev.candidate.probes.chatF1), pct(ev.production.probes.chatF1)],
    ['Evidence choice', pct(ev.candidate.probes.grounded), pct(ev.production.probes.grounded)],
    ...(ev.candidate.memorization ? [['Recited training text', pct(ev.candidate.memorization.verbatimTrained), '—'], ['Loss gap unseen − trained', fix(ev.candidate.memorization.gap), ev.production.memorization ? fix(ev.production.memorization.gap) : '—']] : []),
  ] : null;
  return card('Current and candidate model', 'A candidate answers nobody until it has passed every check against the model in production.',
    kv([['In production', reg.production || '—', prod ? `step ${num(prod.step)} · since ${when(prod.promotedAt || prod.importedAt || prod.created)}` : ''], ['Previous stable', reg.previous || '—', reg.previous ? 'kept for rollback' : 'none on this machine'],
      ['Candidate now', cur ? (cur.id || `being trained (${cur.cycle})`) : 'none', cur ? `phase: ${cur.phase || st.phase || 'evaluate'}` : 'the worker is collecting data'],
      last ? ['Last candidate', last.id, `${last.cycle} · ${when(last.finished)}`] : null, last ? ['Decision', last.passed ? 'promoted' : 'rejected', last.comparedWith ? `compared with ${last.comparedWith}` : 'first model'] : null]),
    last && !last.passed ? h('p', { class: 'small muted', text: `Failed: ${last.failed.join('; ')}` }) : null,
    h('p', { class: 'small muted', text: `Training caution: level ${num(c.caution || 0)}. Each candidate refused for generalising worse halves the learning rate and shortens the next cycle; each promotion relaxes it by one level.${last && last.plan ? ` The last candidate was trained at level ${last.plan.caution}: learning rate ${last.plan.lr}, ${last.plan.passes} passes over the data, ${num(last.plan.steps)} steps.` : ''}` }),
    rows ? table(['Measured on the same data', { n: last.id }, { n: last.comparedWith || 'production' }], rows) : null);
}

/** The fixed benchmark: the same items for every version, so the rows can be compared directly. */
function benchmarkCard(L, reg) {
  const rows = (L.benchmark && L.benchmark.models) || [];
  return card('Fixed benchmark', 'The same 176 items and 16 passages for every model version; none of them is ever trained on. Each item is a pair, so guessing scores 50%.',
    rows.length ? table(['Version', 'Status', { n: 'Score' }, { n: 'Language' }, { n: 'Knowledge' }, { n: 'Reasoning' }, { n: 'Conversation' }, { n: 'Text loss' }], [...rows].reverse().map((m) => [m.id, pill(m.status || '—', STATUS[m.status] || ''), pct(m.score), pct(m.language), pct(m.knowledge), pct(m.reasoning), pct(m.conversation), fix(m.passageLoss)]))
      : h('p', { class: 'muted small', text: 'The benchmark is run on the candidate and on the production model in every cycle; no cycle has finished since it was introduced.' }));
}

function render() {
  const M = data.model || {}, L = data.learning || {};
  const st = L.status || {}, reg = L.registry || { models: {}, history: [] }, tr = st.training, corpus = L.corpus, hw = L.hardware || {}, totals = L.totals || {};
  const prod = reg.production ? reg.models[reg.production] : null;
  const out = [];
  // ---- status ----
  const stateCls = st.state === 'running' ? 'run' : st.state === 'paused' ? 'warn' : st.state === 'idle' ? 'ok' : '';
  out.push(h('section', { class: 'card' }, h('div', { class: 'banner' }, pill(st.state === 'running' ? `running: ${st.phase || ''}` : st.state || 'unknown', stateCls), M.available ? pill(`answering: ${M.version}`, 'ok') : pill('no model loaded', 'bad'), st.mode === 'worker' || (L.worker && L.worker.alive) ? pill('always-on worker', 'ok') : st.auto ? pill(`automatic · next ${when(st.nextRunAt)}`) : pill(L.worker ? 'worker not running' : 'manual cycles', L.worker ? 'warn' : ''), h('span', { class: 'muted small', text: st.message || '' })),
    kv([['Last completed cycle', when(st.lastSuccess), 'ran to the end, whether its candidate was promoted or rejected'], ['Cycles run', num(totals.cycles), `${num(totals.promoted)} promoted · ${num(totals.rejected)} rejected`], st.lastError ? ['Last problem', when(st.lastError.t), st.lastError.message] : null, L.host && !L.host.trainingCapable ? ['This host', 'serves only', 'training runs elsewhere'] : null])));
  out.push(workerCard(L));
  out.push(h('div', { class: 'grid2' }, discoveryCard(L), candidateCard(L, reg)));
  out.push(benchmarkCard(L, reg));
  // ---- model ----
  out.push(card('The model that answers', M.available ? 'A neural network trained by this project from random weights. No pretrained weights, no outside model or API.' : `Infinity LLM is not loaded: ${M.reason || 'unknown reason'}.`,
    M.available ? kv([['Version', M.version, M.source === 'bundled' ? 'published copy' : 'live'], ['Parameters', num(M.parameters)], ['Architecture', `${M.layers} layers · ${M.heads} heads · width ${M.width}`, M.architecture], ['Context', `${num(M.context)} tokens`], ['Vocabulary', num(M.vocabulary), 'byte-pair tokens'], ['Training steps', num(M.trainedSteps)], ['Tokens trained on', num(M.trainedTokens)], ['Training time', dur(prod && prod.train_seconds)], ['Validation loss', fix(M.validationLoss), M.validationLoss ? `perplexity ${Math.exp(M.validationLoss).toFixed(1)}` : ''], ['Weights', M.precision === 'f16' ? '16-bit floats' : '32-bit floats', prod && prod.weightsBytes ? `${(prod.weightsBytes / 1048576).toFixed(2)} MB` : ''], ['Inference self-test', M.selfTest && M.selfTest.ok ? 'passed' : 'failed', M.selfTest ? `max difference ${M.selfTest.maxDiff}` : ''], ['Generated since start', `${num(M.served.chats)} chat replies · ${num(M.served.grounded)} evidence choices`, M.served.tokensPerSecond ? `${num(M.served.tokensPerSecond)} tokens/s` : ''], ['Replies accepted', M.served.checked ? `${num(M.served.accepted)} of ${num(M.served.checked)} (${Math.round(M.served.acceptedShare * 100)}%)` : 'none checked yet', 'a generated reply is shown only when it agrees with the rule-based reply to the same message; the others are replaced by the rule-based reply']]) : null));
  // ---- training now ----
  if (tr) {
    const frac = tr.of ? Math.min(1, tr.step / tr.of) : 0;
    const bar = h('div', { class: 'bar' }, h('i')); bar.firstChild.style.width = (frac * 100).toFixed(1) + '%';
    out.push(card(`Training now · cycle ${st.cycle}`, 'The chat keeps answering from the production model while this runs in a separate, low-priority process.', bar,
      kv([['Step', `${num(tr.step)} of ${num(tr.of)}`], ['Training loss', fix(tr.loss)], ['Validation loss', fix(tr.val_loss)], ['Learning rate', tr.lr != null ? Number(tr.lr).toExponential(2) : '—'], ['Tokens this run', num(tr.tokens)], ['Throughput', `${num(tr.tokPerS)} tokens/s`], ['Elapsed', dur(tr.elapsedS)], tr.rssMb ? ['Memory', `${num(Math.round(tr.rssMb))} MB`] : null])));
  }
  // ---- curve ----
  out.push(card('Loss over training', 'Lower is better. Validation text is never used for training.', lossChart(L.curve || [], reg)));
  // ---- evaluation ----
  const lastGate = [...(L.cycles || [])].reverse().find((c) => c.gate);
  let pr = prod && prod.probes;
  // a later re-evaluation of the same model can hold measurements that did not exist when it was promoted
  const reEval = pr && [...(L.evaluations || [])].reverse().find((e) => e.model === prod.id && e.probes);
  if (reEval && pr.chatAccepted == null && reEval.probes.chatAccepted != null) pr = { ...pr, chatAccepted: reEval.probes.chatAccepted };
  out.push(h('div', { class: 'grid2' },
    card('How the production model measures', prod ? `Measured on held-out data of ${prod.evaluatedOn || prod.dataset}. These are test results, not claims.` : 'No production model yet.',
      pr ? table(['Test', { n: 'Result' }, 'What it means'], [
        ['Validation loss', fix(prod.val_loss), 'average surprise per token on unseen text'],
        ['Reply match (F1)', pct(pr.chatF1), 'word overlap with the expected reply to unseen phrasings'],
        ['Reply match (exact)', pct(pr.chatExact), 'reply identical to an expected one'],
        ...(pr.chatAccepted != null ? [['Replies that pass the reply check', pct(pr.chatAccepted), 'share of generated replies that would be shown; the rest are replaced by the rule-based reply']] : []),
        ['Evidence choice', pct(pr.grounded), `picks the sentence that answers the question (chance: ${pct(pr.groundedChance)})`],
        ['Search decision', pct(pr.route), 'chat versus look-it-up, decided by the model'],
        ['Looping replies', pct(pr.repetition), 'sampled replies that repeat themselves'],
        ['Inference speed', `${num(pr.tokensPerSecond)} tok/s`, 'in the JavaScript engine that serves the chat'],
      ]) : null),
    card('Promotion gate', lastGate ? `Cycle ${lastGate.id}: candidate ${lastGate.model} ${lastGate.gate.pass ? 'passed every check and was promoted' : 'failed and was not deployed'}${lastGate.gate.comparedWith ? ` (compared with ${lastGate.gate.comparedWith})` : ''}.` : 'No candidate has been judged yet.',
      lastGate ? h('ul', { class: 'checks' }, lastGate.gate.checks.map((c) => h('li', null, h('span', { class: c.pass ? 'y' : 'n', text: c.pass ? '✓' : '✗' }), h('span', null, c.name, h('span', { class: 'muted small', text: ` — ${c.detail}` }))))) : null)));
  // ---- versions ----
  const models = Object.values(reg.models || {}).sort((a, b) => (a.id < b.id ? 1 : -1));
  out.push(card('Model versions', `Production: ${reg.production || '—'} · previous stable: ${reg.previous || '—'} · experimental: ${reg.experimental || '—'}. Each validation loss was measured on that version's own dataset, and later datasets hold more document text, so losses of different versions are not comparable; the gate compares both models on the same data (see Promotion gate).`,
    models.length ? table(['Version', 'Status', 'Built from', 'Dataset', { n: 'Step' }, { n: 'Tokens' }, { n: 'Val. loss' }, { n: 'Reply F1' }, { n: 'Evidence' }, { n: 'Search' }, 'Gate'], models.map((m) => [m.id, pill(m.status || '—', STATUS[m.status] || ''), m.parent || 'random weights', m.dataset || '—', num(m.step), num(m.tokens_seen), fix(m.val_loss), pct(m.probes && m.probes.chatF1), pct(m.probes && m.probes.grounded), pct(m.probes && m.probes.route), m.gate ? (m.gate.pass ? 'passed' : `failed: ${(m.gate.failed || []).join('; ')}`) : '—'])) : h('p', { class: 'muted small', text: 'No model has been trained yet.' })));
  // ---- cycles ----
  out.push(card('Learning cycles', 'Each cycle: find and read documents, filter and verify them, build a dataset, train a candidate, evaluate it, and promote it only if it passes the gate.',
    (L.cycles || []).length ? table(['Cycle', 'Finished', 'Outcome', { n: 'Collected' }, { n: 'Accepted' }, { n: 'Rejected' }, 'Dataset', { n: 'Train tokens' }, { n: 'Train time' }, 'Result'], [...L.cycles].reverse().map((c) => { const o = OUTCOME[c.outcome] || [c.outcome, 'bad']; const a = c.acquisition || {}; return [c.id, when(c.finished), pill(o[0], o[1]), num(a.collected), num(a.accepted), num(a.rejected), c.dataset || '—', num(c.training && c.training.tokens_seen), dur(c.training && c.training.cycle_seconds_total), c.message || '']; })) : h('p', { class: 'muted small', text: 'No cycle has finished yet.' })));
  // ---- data ----
  const obj = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${num(v)}`).join(' · ') || '—';
  const ds = L.datasets || [];
  out.push(h('div', { class: 'grid2' },
    card('Training data', 'Only documents with a licence that permits reuse are kept. Each one carries its source, licence, hash and verification record.',
      corpus ? kv([['Documents accepted', num(corpus.documents), `${num(corpus.train)} train · ${num(corpus.validation)} validation`], ['Characters', num(corpus.chars)], ['Rejected', num(corpus.rejected), `acceptance ${pct(corpus.acceptanceRate)}`], ['Verification score', fix(corpus.meanVerificationScore, 2), 'mean, 0–1'], ['Text quality', fix(corpus.meanTextQuality, 2), 'mean, 0–1'], ['Disputed statements', num(corpus.disputedStatements), 'left out of training']]) : h('p', { class: 'muted small', text: 'No documents collected yet.' }),
      corpus ? h('p', { class: 'small muted', text: `By licence — ${obj(corpus.byLicence)}` }) : null, corpus ? h('p', { class: 'small muted', text: `By source — ${obj(corpus.bySource)}` }) : null, corpus ? h('p', { class: 'small muted', text: `Verification — ${obj(corpus.byVerification)}` }) : null, corpus ? h('p', { class: 'small muted', text: `Rejected at — ${obj(corpus.rejectedByStage)}` }) : null),
    card('Dataset versions', 'One immutable version per cycle. Validation documents are split off by content hash and never enter training.',
      ds.length ? table(['Version', 'Cycle', { n: 'Train tokens' }, { n: 'Val. tokens' }, { n: 'Docs' }, 'Mixture', 'Leaks'], [...ds].reverse().map((d) => [d.version, d.cycle || '—', num(d.tokens.train), num(d.tokens.validation), `${num(d.documents.train)}+${num(d.documents.validation)}`, Object.entries(d.mixture || {}).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · '), d.integrity ? String(d.integrity.valDocumentsInTraining + d.integrity.valHashesInTraining + d.integrity.valPhrasingsInTraining + (d.integrity.benchmarkSentencesInTraining || 0)) : '—'])) : h('p', { class: 'muted small', text: 'No dataset built yet.' }))));
  // ---- resources ----
  const hd = hw.hardware || {}, bench = hw.bench || [], r = (L.config && L.config.resources) || {};
  out.push(card('Resources', hw.available === false ? `Training is not available here: ${hw.reason}` : 'Measured on the machine that trains.',
    kv([['Processor', hd.cpu_count ? `${hd.cpu_count} cores` : '—', (hd.cpu_simd || []).join(', ')], ['Memory', hd.memory_gb ? `${hd.memory_gb} GB` : '—'], ['Training device', hd.device || '—', hd.cuda ? 'CUDA' : hd.apple_silicon_mps ? 'Apple Silicon' : 'no GPU'], ['Precision', hd.precision || '—', hd.mixed_precision ? 'mixed precision' : ''], ['Framework', hd.torch ? `PyTorch ${hd.torch}` : '—'], ['Chosen size', prod ? prod.preset || '—' : hw.recommended_preset || '—'], ['Limits', `${r.threads || '—'} threads · nice ${r.nice ?? '—'}`, `duty ${r.duty ?? '—'} · ${num(r.maxTrainRssMb)} MB`]]),
    bench.length ? table(['Size', { n: 'Parameters' }, { n: 'Seconds per step' }, { n: 'Training tokens/s' }], bench.map((x) => [x.preset, num(x.params), x.seconds_per_step ?? x.error, num(x.tokens_per_second)])) : null));
  // ---- history + log ----
  out.push(h('div', { class: 'grid2' },
    card('Promotions and rollbacks', null, (reg.history || []).length ? h('ul', { class: 'events' }, [...reg.history].reverse().map((e) => h('li', null, h('time', { text: when(e.t) }), e.action === 'promote' ? `${e.to} promoted${e.from ? ` (replaced ${e.from})` : ''} — ${e.reason || ''}` : e.action === 'rollback' ? `rolled back from ${e.from} to ${e.to}${e.reason ? ` — ${e.reason}` : ''}` : `${e.model} rejected, ${e.kept || 'nothing'} kept — ${e.reason || ''}`))) : h('p', { class: 'muted small', text: 'Nothing yet.' })),
    card('Recent activity', null, (L.events || []).length ? h('ul', { class: 'events' }, [...L.events].reverse().map((e) => h('li', null, h('time', { text: when(e.t) }), e.text || e.message || [e.type, e.phase, e.action, e.outcome, e.cycle].filter(Boolean).join(' · ')))) : h('p', { class: 'muted small', text: 'Nothing yet.' }))));
  out.push(adminCard(L));
  $('dash').replaceChildren(...out);
  renderAdminMsg();
}
try { const t = JSON.parse(localStorage.getItem('infini.settings') || '{}').theme; const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); if (dark) document.documentElement.dataset.theme = 'dark'; } catch { /* default theme */ }
load();
