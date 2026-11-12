// INFINI AI — browser client. Vanilla ES modules, no framework, no build step.
// Replies come in two kinds: chat from the server's built-in brain (kind "brain") and cited answers built from live web pages.
// All retrieved text is inserted with textContent / text nodes (never innerHTML), so page content cannot inject markup.

const $ = (id) => document.getElementById(id);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
// Icons are inline SVG built with DOM calls: no glyph fonts (which render as empty boxes on many phones) and no markup strings.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', check: 'M5 12.5l4.5 4.5L19 7.5', chevron: 'M9 6l6 6-6 6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4', refresh: 'M20 12a8 8 0 1 1-2.34-5.66L20 8.7M20 4v4.7h-4.7', panel: 'M3 5h18v14H3zM15 5v14',
  bookmark: 'M6 4h12v17l-6-4-6 4z', up: 'M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2.3l-1.2 6a2 2 0 0 1-2 1.7H7',
  external: 'M14 5h5v5M19 5l-8 8M11 7H6v11h11v-5', follow: 'M6 5v6a3 3 0 0 0 3 3h9M14 10l4 4-4 4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z',
  quote: 'M6 7h4v5H6zM10 12c0 2.5-1.2 4-3.5 5M14 7h4v5h-4zM18 12c0 2.5-1.2 4-3.5 5', ban: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.7 5.7l12.6 12.6',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.7 2.2c-.7.4-1.2 1-1.2 1.8M12 17v.5',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 16h3', compare: 'M7 7h11l-3-3M17 17H6l3 3',
  steps: 'M10 6h10M10 12h10M10 18h10M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17', fact: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12l2.5 2.5 4.5-5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  chat: 'M4 5h16v11H10l-5 4v-4H4z', spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 14a4 4 0 0 0 7 0M9 9.5v.5M15 9.5v.5',
};
function icon(name, size = 16, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: `ico ${cls}`.trim() };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const normQ = (q) => q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const plain = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k[0] === '_' ? undefined : v)));     // drop DOM references before storing
const TIMEY = /\b(today|tonight|now|latest|current|currently|news|headlines|yesterday|this (week|month|year)|recent|recently|price|weather|score|live|update|updates)\b/i;

// ---------------- storage: localStorage for small things, IndexedDB for conversations and saved knowledge ----------------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable or full */ } },
};
const idb = (() => {
  const mem = { chats: new Map(), knowledge: new Map() };
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res) => {
    try {
      const r = indexedDB.open('infini-ai', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('chats', { keyPath: 'id' }); r.result.createObjectStore('knowledge', { keyPath: 'key' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch { res(null); }
  }));
  const run = async (store, mode, fn, fallback) => {
    const db = await open();
    if (!db) return fallback();
    return new Promise((res) => { try { const rq = fn(db.transaction(store, mode).objectStore(store)); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(undefined); } catch { res(fallback()); } });
  };
  return {
    all: (s) => run(s, 'readonly', (o) => o.getAll(), () => [...mem[s].values()]),
    get: (s, k) => run(s, 'readonly', (o) => o.get(k), () => mem[s].get(k)),
    put: (s, v) => run(s, 'readwrite', (o) => o.put(v), () => { mem[s].set(v.id || v.key, v); }),
    del: (s, k) => run(s, 'readwrite', (o) => o.delete(k), () => { mem[s].delete(k); }),
    clear: (s) => run(s, 'readwrite', (o) => o.clear(), () => { mem[s].clear(); }),
  };
})();

const DEFAULTS = { depth: 'balanced', theme: 'light', autoExpand: false, providersOff: [], feeds: [] };
const state = { chats: [], chat: null, busy: false, abort: null, settings: { ...DEFAULTS, ...LS.get('infini.settings', {}) }, learned: { domains: {}, providers: {}, vocab: {}, ...LS.get('infini.learned', {}) }, status: null, filter: '' };
const saveSettings = () => LS.set('infini.settings', state.settings);
const saveLearned = () => LS.set('infini.learned', state.learned);

function applyTheme() {
  const t = state.settings.theme === 'system' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : state.settings.theme;
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#111216' : '#ffffff');
}
let toastTimer = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); }
async function copyText(text, okMsg) { try { await navigator.clipboard.writeText(text); toast(okMsg); } catch { toast('Copy is not available in this browser'); } }

// ---------------- conversations ----------------
function newChat() { state.chat = { id: uid(), title: 'New chat', named: false, createdAt: Date.now(), updatedAt: Date.now(), context: {}, messages: [] }; renderAll(); closeNav(); $('q').focus(); }
async function saveChat() {
  const c = state.chat;
  if (!c || !c.messages.length) return;
  c.updatedAt = Date.now();
  await idb.put('chats', plain(c));
  const i = state.chats.findIndex((x) => x.id === c.id);
  const meta = { id: c.id, title: c.title, updatedAt: c.updatedAt, text: c.messages.map((m) => m.text || (m.result && m.result.answer.text) || '').join(' ').slice(0, 4000).toLowerCase() };
  if (i >= 0) state.chats[i] = meta; else state.chats.unshift(meta);
  state.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  renderChatList();
}
async function openChat(id) { if (state.busy) return toast('Wait for the current answer or press stop'); const c = await idb.get('chats', id); if (!c) return; state.chat = c; renderAll(); closeNav(); }
async function deleteChat(id) {
  if (!confirm('Delete this conversation? This cannot be undone.')) return;
  await idb.del('chats', id);
  state.chats = state.chats.filter((c) => c.id !== id);
  if (state.chat && state.chat.id === id) newChat(); else renderChatList();
}
async function renameChat(id) {
  const meta = state.chats.find((c) => c.id === id);
  const name = prompt('Rename conversation', meta ? meta.title : '');
  if (!name || !name.trim()) return;
  const c = state.chat && state.chat.id === id ? state.chat : await idb.get('chats', id);
  if (!c) return;
  c.title = name.trim().slice(0, 80); c.named = true;
  await idb.put('chats', plain(c));
  if (meta) meta.title = c.title;
  renderChatList(); $('chatTitle').textContent = state.chat.title;
}
function renderChatList() {
  const list = $('chatList');
  list.replaceChildren();
  const f = state.filter.trim().toLowerCase();
  const items = state.chats.filter((c) => !f || c.title.toLowerCase().includes(f) || (c.text || '').includes(f));
  if (!items.length) { list.append(h('div', { class: 'empty-hint', text: f ? 'No conversation matches.' : 'Your conversations are stored on this device and appear here.' })); return; }
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  let lastGroup = '';
  for (const c of items) {
    const group = c.updatedAt >= dayStart.getTime() ? 'Today' : c.updatedAt >= dayStart.getTime() - 6 * 86400000 ? 'Previous 7 days' : 'Earlier';
    if (group !== lastGroup) { list.append(h('div', { class: 'chat-group', text: group })); lastGroup = group; }
    list.append(h('div', { class: 'chat-item' + (state.chat && state.chat.id === c.id ? ' active' : '') },
      h('button', { class: 'title', type: 'button', title: c.title, onclick: () => openChat(c.id), text: c.title }),
      h('button', { class: 'mini', type: 'button', title: 'Rename', 'aria-label': 'Rename conversation', onclick: () => renameChat(c.id) }, icon('edit', 15)),
      h('button', { class: 'mini', type: 'button', title: 'Delete', 'aria-label': 'Delete conversation', onclick: () => deleteChat(c.id) }, icon('trash', 15))));
  }
}
const openNav = () => { $('app').classList.add('nav-open'); $('scrim').hidden = false; };
const closeNav = () => { $('app').classList.remove('nav-open'); $('scrim').hidden = true; };

// ---------------- rendering ----------------
const SUGGESTIONS = [['Chat', 'How are you today?', 'chat'], ['Explain', 'What is quantum computing?', 'bulb'], ['News', 'What happened in Nepal today?', 'news'], ['Common sense', 'Can a penguin fly?', 'fact'], ['How to', 'How do I build an AI agent?', 'steps'], ['Fun', 'Tell me a joke', 'smile']];
const TRUST = [['spark', 'Its own brain for chat'], ['globe', 'Live web for facts'], ['quote', 'Sources you can check']];
// where a reply of the built-in brain came from (shown under the reply; plain chat needs no label)
const ORIGIN = { memory: ['spark', 'From my built-in memory · no web search'], skill: ['spark', 'Worked out by a built-in skill · no web search'], commonsense: ['spark', 'From my built-in common sense · not checked on the web'] };
function renderAll() {
  $('chatTitle').textContent = state.chat.title;
  const thread = $('thread');
  thread.replaceChildren();
  if (!state.chat.messages.length) {
    thread.append(h('section', { class: 'welcome' },
      h('img', { class: 'hero-mark', src: '/icons/icon.svg', width: '64', height: '64', alt: '' }),
      h('h2', { text: 'Talk to me, or ask me anything.' }),
      h('p', { text: 'I chat, remember what you tell me and use everyday common sense on my own. For facts I search the live web and show my sources.' }),
      h('div', { class: 'trust' }, TRUST.map(([ic, t]) => h('span', null, icon(ic, 14), t))),
      h('div', { class: 'suggest' }, SUGGESTIONS.map(([k, q, ic]) => h('button', { type: 'button', onclick: () => ask(q) }, h('small', null, icon(ic, 15), k), q)))));
  } else for (const m of state.chat.messages) thread.append(m.role === 'user' ? userEl(m) : botEl(m));
  renderChatList();
  $('clearBtn').hidden = !state.chat.messages.length;
  if (state.chat.messages.length) scrollDown(true); else $('scroll').scrollTop = 0;      // the welcome screen starts at its top
}
const userEl = (m) => h('div', { class: 'msg user' }, h('div', { class: 'bubble', text: m.text }));
function scrollDown(force) { const s = $('scroll'); if (force || s.scrollHeight - s.scrollTop - s.clientHeight < 240) s.scrollTop = s.scrollHeight; }

const STAGES = [['understanding', 'Understanding the question'], ['planning', 'Planning the search'], ['searching', 'Searching sources'], ['reading', 'Reading pages'], ['comparing', 'Comparing evidence'], ['constructing', 'Constructing the answer']];
function stageMeta(name, d) {
  if (!d) return '';
  if (name === 'understanding') return d.parts && d.parts.length ? d.parts.map((p) => `${p.qtype} → ${p.answerType}`).join(' · ') : d.intent;
  if (name === 'planning') return `${(d.tasks || []).length} lookups planned · ${d.depth} depth`;
  if (name === 'searching') return `${d.ok ?? d.queries} of ${d.queries} searches returned · ${d.results ?? 0} results`;
  if (name === 'reading') return `${d.pages} page${d.pages === 1 ? '' : 's'} read${d.failed ? ` · ${d.failed} unavailable` : ''}`;
  if (name === 'comparing') return `${d.sentences} sentences · ${d.documents} documents · ${d.independentOrigins} independent origins`;
  if (name === 'constructing') return `${d.claims} cited statement${d.claims === 1 ? '' : 's'}`;
  return '';
}
/** Live activity panel. Shows only events the server really emitted; collapses to a one-line summary when done. */
function createActivity(open) {
  const rows = {};
  const stages = h('div', { class: 'stages' });
  for (const [name, label] of STAGES) {
    const meta = h('span', { class: 'meta' }), lines = h('ul', { class: 'stage-lines' });
    const row = h('div', { class: 'stage' }, h('span', { class: 'dot' }), h('div', null, h('span', { class: 'label', text: label }), meta, lines));
    rows[name] = { row, meta, lines };
    stages.append(row);
  }
  const summary = h('button', { class: 'activity-summary', type: 'button', hidden: true, onclick: () => el.classList.toggle('open') }, h('span', { class: 'chev' }, icon('chevron', 14)), h('span', { class: 'sum-text' }));
  const el = h('div', { class: 'activity' }, summary, stages);
  const line = (stage, text, fail) => { const r = rows[stage]; if (!r) return; if (r.lines.children.length < 40) r.lines.append(h('li', { class: fail ? 'fail' : '' }, icon(fail ? 'x' : 'check', 12, fail ? 'bad' : 'ok'), text)); };
  const api = {
    el,
    onEvent(ev) {
      if (ev.type === 'stage') {
        const r = rows[ev.stage]; if (!r) return;
        if (ev.status === 'start') { r.row.className = 'stage active'; if (ev.round > 1) r.meta.textContent = `round ${ev.round}`; }
        else { r.row.className = 'stage done'; r.meta.textContent = stageMeta(ev.stage, ev.detail) + (ev.round > 1 ? ` (round ${ev.round})` : ''); if (ev.stage === 'planning' && ev.detail) for (const t of (ev.detail.tasks || []).slice(0, 12)) r.lines.append(h('li', { text: '· ' + t.label })); }
      } else if (ev.type === 'search') line('searching', `${ev.label}: ${String(ev.query).slice(0, 90)} — ${ev.ok ? `${ev.results} result${ev.results === 1 ? '' : 's'}` : ev.error} (${ev.ms} ms)`, !ev.ok);
      else if (ev.type === 'fetch') line('reading', `${ev.domain}${ev.title ? ' — ' + ev.title.slice(0, 70) : ''} ${ev.ok ? `(${Math.max(1, Math.round(ev.bytes / 1024))} kB, ${ev.ms} ms${ev.fromCache ? ', cached' : ''})` : '— ' + ev.error}`, !ev.ok);
      else if (ev.type === 'note' && rows[ev.stage]) rows[ev.stage].lines.append(h('li', { text: '· ' + ev.text }));
    },
    finish(text) { el.classList.add('done'); if (open) el.classList.add('open'); summary.hidden = false; summary.querySelector('.sum-text').textContent = text; for (const r of Object.values(rows)) if (r.row.className === 'stage') r.row.hidden = true; },
  };
  return api;
}

function spansEl(spans, result) {
  const out = [];
  spans.forEach((s, i) => {
    if (!s.text && !(s.cites && s.cites.length)) return;
    const cls = [s.meta ? 'meta-span' : '', s.nature === 'hedged' || s.nature === 'opinion' ? 'hedged' : ''].join(' ').trim();
    if (s.text) out.push(s.strong ? h('strong', { class: cls || null, text: s.text }) : cls ? h('span', { class: cls, title: s.nature ? `The source states this as ${s.nature === 'opinion' ? 'an opinion' : 'likely/possible, not certain'}` : null, text: s.text }) : s.text);
    for (const c of s.cites || []) { const src = result.sources.find((x) => x.id === c); out.push(h('button', { class: 'cite', type: 'button', title: src ? `${src.title} — ${src.domain}` : 'Source', 'aria-label': `Source ${c}`, onclick: () => src && openSource(src, result), text: String(c) })); }
    if (i < spans.length - 1 && s.text && !/[\s(“]$/.test(s.text)) out.push(' ');
  });
  return out;
}
function answerEl(result) {
  const box = h('div', { class: 'answer' });
  for (const b of result.answer.blocks) {
    if (b.type === 'paragraph') box.append(h('p', null, spansEl(b.spans, result)));
    else if (b.type === 'heading') box.append(h('h3', { class: b.level === 2 ? 'part' : null, text: b.text }));
    else if (b.type === 'list') box.append(h(b.ordered ? 'ol' : 'ul', null, b.items.map((it) => h('li', { class: it.depth ? `d${Math.min(2, it.depth)}` : null }, spansEl(it.spans, result), (it.code || []).map((c) => h('pre', null, h('code', { text: c })))))));
    else if (b.type === 'table') box.append(h('div', { class: 'table-wrap' }, h('table', null, b.caption ? h('caption', null, b.caption, ' ', spansEl([{ text: '', cites: b.cites || [] }], result)) : null, h('thead', null, h('tr', null, b.header.map((c) => h('th', { text: c })))), h('tbody', null, b.rows.map((r) => h('tr', null, r.map((c) => h('td', { text: c }))))))));
    else if (b.type === 'code') { box.append(h('pre', null, h('code', { text: b.text }))); if (b.cites && b.cites.length) box.append(h('p', { class: 'code-cite' }, 'Code quoted from ', spansEl([{ text: '', cites: b.cites }], result))); }
    else if (b.type === 'note') box.append(h('div', { class: 'note' + (b.tone === 'warn' ? ' warn' : ''), text: b.text }));
  }
  return box;
}
function confidenceEl(conf) {
  if (!conf) return null;
  const panel = h('div', { class: 'factors', hidden: true },
    conf.factors.map((f) => h('div', { class: 'factor' }, h('span', { text: f.name }), (() => { const bar = h('div', { class: 'bar' }, h('i')); bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f.value)) * 100) + '%'; return bar; })(), h('span', { class: 'why', text: f.note }))),
    conf.caps && conf.caps.length ? h('div', { class: 'caps', text: 'Capped because: ' + conf.caps.join('; ') + '.' }) : null,
    h('div', { class: 'why', text: 'Confidence is computed by fixed rules from the factors above. It measures how well the sources support the answer, not whether the sources themselves are right.' }));
  const pill = h('button', { class: `conf ${conf.level}`, type: 'button', 'aria-expanded': 'false', onclick: () => { panel.hidden = !panel.hidden; pill.setAttribute('aria-expanded', String(!panel.hidden)); } }, h('span', { class: 'pip' }), conf.label, h('small', { text: `${Math.round(conf.score * 100)}% · why?` }));
  return h('div', null, pill, panel);
}
const EVID = { page: 'page text read', api: 'official API text', feed: 'publisher feed summary', structured: 'structured data' };
const favColor = (d) => { let x = 0; for (const ch of String(d)) x = (x * 31 + ch.charCodeAt(0)) % 997; return x % 6; };
function sourcesEl(result) {
  const n = result.sources.length;
  if (!n) return null;
  return h('div', { class: 'sources-wrap' },
    h('div', { class: 'block-head' }, icon('globe', 14), `${n} source${n === 1 ? '' : 's'}`, h('small', { text: 'open one to see the passages used' })),
    h('div', { class: 'sources', role: 'list', 'aria-label': 'Sources' }, result.sources.map((s) => h('button', { class: 'src', type: 'button', role: 'listitem', onclick: () => openSource(s, result) },
      h('span', { class: 'top' }, h('span', { class: `fav c${favColor(s.domain)}`, 'aria-hidden': 'true', text: String(s.domain || '?').replace(/^www\./, '').charAt(0).toUpperCase() }), h('span', { class: 'dom', text: s.domain }), h('span', { class: 'num', text: String(s.id) })),
      h('span', { class: 'ttl', text: s.title }),
      h('span', { class: 'tags' }, h('span', { class: 'tag ' + (s.sourceType === 'primary' ? 'primary' : s.sourceType === 'community' ? 'community' : ''), text: s.sourceType }), (s.published || s.modified) ? h('span', { class: 'tag', text: fmtDate(s.published || s.modified) }) : null, s.partial ? h('span', { class: 'tag', text: 'summary only' }) : null)))));
}

function botEl(m) {
  const body = h('div', { class: 'bot-body' });
  const el = h('div', { class: 'msg bot' }, h('div', { class: 'bot-head' }, h('img', { class: 'avatar', src: '/icons/mark.svg', width: '26', height: '26', alt: '' }), h('span', { class: 'bot-name', text: 'INFINI AI' })), body);
  m._el = el; m._body = body;
  if (m.status === 'working') return el;
  fillBot(m);
  return el;
}
function fillBot(m) {
  const body = m._body;
  body.replaceChildren();
  const r = m.result;
  if (m.cached) body.append(h('div', { class: 'cached-banner' }, icon('clock', 15), `From your saved knowledge (saved ${fmtDate(m.cached)}). It was not re-checked just now.`, h('button', { class: 'btn small', type: 'button', onclick: () => regenerate(m), text: 'Refresh from the web' })));
  if (m.events && m.events.length && r && (r.kind === 'retrieval' || r.kind === 'url')) {
    const act = createActivity(state.settings.autoExpand);
    for (const ev of m.events) act.onEvent(ev);
    const c = r.research ? r.research.counts : null;
    act.finish(c ? `Searched ${c.searches} source${c.searches === 1 ? '' : 's'} · read ${c.pagesFetched} page${c.pagesFetched === 1 ? '' : 's'} · ${(r.elapsedMs / 1000).toFixed(1)} s` : `Done in ${(r.elapsedMs / 1000).toFixed(1)} s`);
    body.append(act.el);
  }
  if (r && r.interpretation && r.interpretation.rewrites && r.interpretation.rewrites.length) {
    // a repaired spelling can be wrong (a name that looks like a slip): one tap searches for exactly what was typed
    const respelled = r.interpretation.rewrites.some((x) => /^spelling/.test(String(x.reason || '')));
    body.append(h('div', { class: 'understood' }, 'Understood as:', h('b', { text: r.interpretation.metaOf ? `${r.interpretation.rewrites[0].reason}: “${r.interpretation.resolved}”` : r.interpretation.resolved }),
      respelled && m.question ? h('button', { class: 'as-typed', type: 'button', text: 'Search as typed', title: `Search for “${String(m.question).slice(0, 120)}” exactly`, onclick: () => { if (!state.busy) run(m.question, { replace: m, context: m.contextBefore || {}, route: 'web' }); } }) : null));
  }
  if (m.status === 'error') body.append(h('div', { class: 'error-box', text: m.error || 'Something went wrong.' }));
  if (m.status === 'stopped') body.append(h('div', { class: 'note', text: 'Stopped. Retrieval was cancelled, so no answer was built.' }));
  const isBrain = !!r && r.kind === 'brain';
  if (r) {
    body.append(answerEl(r));
    if (isBrain && ORIGIN[r.origin]) body.append(h('div', { class: 'origin' }, icon(ORIGIN[r.origin][0], 13), ORIGIN[r.origin][1]));
    const conf = confidenceEl(r.confidence); if (conf) body.append(conf);
    const src = sourcesEl(r); if (src) body.append(src);
  }
  const acts = h('div', { class: 'actions' });
  const act = (ic, label, props) => h('button', { class: 'act', type: 'button', 'aria-label': label, ...props }, icon(ic, 16), h('span', { class: 'lbl', text: label }));
  if (r && r.answer.text) acts.append(act('copy', 'Copy', { onclick: () => copyText(r.answer.text + (r.sources.length ? '\n\nSources\n' + r.sources.map((s) => `[${s.id}] ${s.title} — ${s.url}`).join('\n') : ''), 'Answer copied') }));
  if (m.question && !isBrain) acts.append(act('refresh', m.status === 'done' ? 'Regenerate' : 'Retry', { title: 'Search again, bypassing temporary caches', onclick: () => regenerate(m) }));
  // the brain answered by itself: one tap sends the same message to the web instead, in case it misjudged
  if (m.question && isBrain && r.origin !== 'safety' && !(r.suggestions || []).some((t) => /^Search the web: /.test(String(t)))) acts.append(act('globe', 'Search the web instead', { title: 'Send this message to web search instead', onclick: () => { if (!state.busy) run(m.question, { replace: m, context: m.contextBefore || {}, route: 'web' }); } }));
  if (r && r.research) acts.append(act('panel', 'Research details', { onclick: () => openResearch(r) }));
  if (r && r.kind === 'retrieval' && r.confidence && r.confidence.level !== 'insufficient') {
    const key = normQ(r.interpretation && r.interpretation.resolved ? r.interpretation.resolved : m.question);
    const save = act('bookmark', m.saved ? 'Saved' : 'Save', { title: 'Keep this answer on this device and reuse it for the same question' });
    save.classList.toggle('on', !!m.saved);
    save.addEventListener('click', async () => {
      if (m.saved) { await idb.del('knowledge', key); m.saved = false; toast('Removed from saved knowledge'); }
      else { await idb.put('knowledge', { key, savedAt: Date.now(), question: m.question, result: JSON.parse(JSON.stringify(r)) }); m.saved = true; toast(r.timeSensitive ? 'Saved — but time-sensitive questions are always re-checked' : 'Saved to your knowledge cache'); }
      save.querySelector('.lbl').textContent = m.saved ? 'Saved' : 'Save'; save.setAttribute('aria-label', m.saved ? 'Saved' : 'Save'); save.classList.toggle('on', m.saved); saveChat();
    });
    acts.append(save);
    const vote = (good) => { for (const s of r.sources) { const d = (state.learned.domains[s.domain] = state.learned.domains[s.domain] || {}); d[good ? 'up' : 'down'] = Math.min(50, (d[good ? 'up' : 'down'] || 0) + 1); } saveLearned(); m.voted = good ? 'up' : 'down'; toast('Thanks — source history updated on this device'); up.classList.toggle('on', good); down.classList.toggle('on', !good); saveChat(); };
    const up = h('button', { class: 'act icon-only' + (m.voted === 'up' ? ' on' : ''), type: 'button', title: 'The sources were good', 'aria-label': 'Helpful', onclick: () => vote(true) }, icon('up', 16));
    const down = h('button', { class: 'act icon-only' + (m.voted === 'down' ? ' on' : ''), type: 'button', title: 'The sources were poor', 'aria-label': 'Not helpful', onclick: () => vote(false) }, icon('up', 16, 'flip'));
    acts.append(up, down);
  }
  if (acts.children.length) body.append(acts);
  // suggestion chips from the brain: tapping one sends its text as the next message
  if (isBrain && Array.isArray(r.suggestions) && r.suggestions.length) body.append(h('div', { class: 'chips' },
    r.suggestions.slice(0, 4).map((t) => { const text = String(t).slice(0, 300); const web = /^Search the web: /.test(text); return h('button', { class: 'chip' + (web ? ' web' : ''), type: 'button', onclick: () => ask(text) }, web ? icon('globe', 13) : null, h('span', { text })); })));
  // follow-up suggestions come from the server as fixed templates tied to sections of the pages it read
  if (r && Array.isArray(r.related) && r.related.length) body.append(h('div', { class: 'related' }, h('div', { class: 'block-head' }, icon('follow', 14), 'Related'),
    r.related.slice(0, 4).map((x) => h('button', { class: 'rel', type: 'button', title: x.basis ? `Suggested from ${x.basis}` : null, onclick: () => ask(String(x.question).slice(0, 300)) }, h('span', { text: String(x.question).slice(0, 300) }), icon('plus', 15)))));
}

// ---------------- drawer: source details and research panel ----------------
function openDrawer(title, nodes) { $('drawerTitle').textContent = title; $('drawerBody').replaceChildren(...nodes.filter(Boolean)); $('drawer').hidden = false; }
const closeDrawer = () => { $('drawer').hidden = true; };
function openSource(s, result) {
  const url = safeUrl(s.url);
  const previewBox = h('div', { class: 'preview-text' });
  const pv = h('button', { class: 'btn small', type: 'button', text: 'Preview page text' });
  pv.addEventListener('click', async () => {
    pv.disabled = true; pv.textContent = 'Loading…';
    try {
      const res = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Unavailable');
      previewBox.replaceChildren(h('div', { class: 'sec', text: 'Extracted page text (first part)' }), ...data.blocks.slice(0, 40).map((b) => b.type === 'heading' ? h('h4', { text: b.text }) : b.type === 'p' ? h('p', { text: b.text.slice(0, 900) }) : b.type === 'list' ? h('ul', null, b.items.slice(0, 12).map((it) => h('li', { text: it.text.slice(0, 300) }))) : null).filter(Boolean));
      pv.hidden = true;
    } catch (e) { previewBox.replaceChildren(h('div', { class: 'note warn', text: `This source is currently unavailable: ${e.message}` })); pv.disabled = false; pv.textContent = 'Try preview again'; }
  });
  const row = (k, v) => (v ? [h('dt', { text: k }), h('dd', null, v)] : []);
  openDrawer(`[${s.id}] ${s.title}`, [
    h('div', { class: 'pill-row' }, url ? h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, 'Open source', icon('external', 14)) : null, url ? h('button', { class: 'btn small', type: 'button', onclick: () => copyText(url, 'Link copied'), text: 'Copy link' }) : null, s.evidenceLevel !== 'structured' && url ? pv : null),
    h('dl', { class: 'kv' }, row('Address', url), row('Publisher', s.site), row('Author', s.author), row('Published', fmtDate(s.published)), row('Updated', fmtDate(s.modified)), row('Retrieved', new Date(s.retrievedAt).toLocaleString()),
      row('Kind', `${s.category} · ${s.sourceType} source`), row('Evidence', `${EVID[s.evidenceLevel] || s.evidenceLevel}${s.partial ? ' (summary or abstract only)' : ''}`), row('Quality score', `${s.quality} of 1 (rule-based estimate)`), row('Notes', (s.notes || []).join('; ')), row('Duplicate of', s.copyOf)),
    h('div', { class: 'sec', text: s.passages.length ? 'Passages this answer relies on' : 'No passage quoted directly' }),
    ...s.passages.map((p) => h('div', { class: 'passage' }, p.heading ? h('small', { text: p.heading }) : null, p.text)),
    previewBox,
  ]);
}
function openResearch(r) {
  const R = r.research, I = r.interpretation || { parts: [], rewrites: [] };
  const list = (items) => h('ul', { class: 'row-list' }, items);
  const nodes = [h('div', { class: 'sec', text: 'How the question was read' }),
    list(I.parts.map((p) => h('li', null, p.text, h('span', { class: 'sub', text: `type: ${p.qtype} → ${p.answerType}${p.focus ? ' · topic: ' + p.focus : ''}${p.keywords && p.keywords.length ? ' · keywords: ' + p.keywords.join(', ') : ''}` })))),
    I.rewrites.length ? list(I.rewrites.map((w) => h('li', null, `“${w.from}” → “${w.to}”`, h('span', { class: 'sub', text: w.reason })))) : null];
  if (R.plan) nodes.push(h('div', { class: 'sec', text: `Plan (${R.plan.depth})` }), list(R.plan.subquestions.map((s) => h('li', null, s.text, h('span', { class: 'sub', text: s.purpose })))), ...(R.plan.notes || []).map((n) => h('div', { class: 'note', text: n })));
  nodes.push(h('div', { class: 'sec', text: `Searches run (${R.searches.length})` }), list(R.searches.map((s) => h('li', { class: s.ok ? '' : 'fail' }, `${s.label}: ${s.query}`, h('span', { class: 'sub', text: s.ok ? `${s.results} results · ${s.ms} ms` : `failed — ${s.error}` })))));
  nodes.push(h('div', { class: 'sec', text: `Pages retrieved (${R.fetches.length})` }), list(R.fetches.map((f) => h('li', { class: f.ok ? '' : 'fail' }, f.title || f.url, h('span', { class: 'sub', text: f.ok ? `${f.domain} · ${f.blocks} blocks · ${Math.max(1, Math.round(f.bytes / 1024))} kB · ${f.ms} ms${f.fromCache ? ' · from temporary cache' : ''} · via ${f.via}` : `${f.domain} · unavailable — ${f.error}` })))));
  nodes.push(h('div', { class: 'sec', text: `Statements used (${R.passages.length})` }), list(R.passages.map((p) => h('li', null, p.text.slice(0, 320), h('span', { class: 'sub', text: `source [${p.source}]${p.alsoSupportedBy && p.alsoSupportedBy.length ? ' · also supported by ' + p.alsoSupportedBy.map((x) => `[${x}]`).join('') : ''} · ${p.nature} · ${p.temporal}` })))));
  if (R.graph) nodes.push(h('div', { class: 'sec', text: 'Evidence graph' }), h('div', { class: 'pill-row' }, Object.entries(R.graph.counts).map(([k, v]) => h('span', { class: 'tag', text: `${v} ${k}${v === 1 ? '' : 's'}` }))), h('div', { class: 'pill-row' }, Object.entries(R.graph.edgeCounts).map(([k, v]) => h('span', { class: 'tag', text: `${v} × ${k}` }))));
  if (r.consulted && r.consulted.length) nodes.push(h('div', { class: 'sec', text: `Also read, not cited (${r.consulted.length})` }), list(r.consulted.slice(0, 15).map((c) => h('li', null, c.title || c.url, h('span', { class: 'sub', text: `${c.domain}${c.published ? ' · ' + fmtDate(c.published) : ''}` })))));
  nodes.push(h('div', { class: 'sec', text: 'Timing' }), h('div', { class: 'pill-row' }, Object.entries(R.timings).map(([k, v]) => h('span', { class: 'tag', text: `${k} ${v} ms` })), h('span', { class: 'tag', text: `total ${r.elapsedMs} ms` }), R.counts ? h('span', { class: 'tag', text: `${Math.round(R.counts.bytes / 1024)} kB read` }) : null));
  openDrawer('Research details', nodes);
}

// ---------------- settings / about ----------------
function openModal(title, nodes) { $('modalTitle').textContent = title; $('modalBody').replaceChildren(...nodes.filter(Boolean)); $('modal').hidden = false; }
const closeModal = () => { $('modal').hidden = true; };
function seg(options, value, onPick) {
  const el = h('div', { class: 'seg', role: 'group' });
  for (const [val, label] of options) el.append(h('button', { type: 'button', class: val === value ? 'on' : '', text: label, onclick: (e) => { for (const b of el.children) b.classList.remove('on'); e.currentTarget.classList.add('on'); onPick(val); } }));
  return el;
}
async function openSettings() {
  if (!state.status) { try { state.status = await (await fetch('/api/status')).json(); } catch { state.status = null; } }
  const knowledge = await idb.all('knowledge');
  const S = state.settings;
  const prov = state.status ? state.status.providers.map((p) => {
    const cb = h('input', { type: 'checkbox', checked: p.configured && !S.providersOff.includes(p.id), disabled: !p.configured });
    cb.addEventListener('change', () => { S.providersOff = cb.checked ? S.providersOff.filter((x) => x !== p.id) : [...new Set([...S.providersOff, p.id])]; saveSettings(); });
    return h('label', { class: 'check' }, cb, h('span', null, p.label, h('small', { text: (p.configured ? '' : 'Not configured on this server. ') + p.note })));
  }) : [h('div', { class: 'note warn', text: 'Could not load the source list from the server.' })];
  const feeds = h('textarea', { class: 'input', rows: '2', placeholder: 'https://example.org/feed.xml (one per line)' });
  feeds.value = S.feeds.join('\n');
  feeds.addEventListener('change', () => { S.feeds = feeds.value.split(/\s+/).filter((u) => safeUrl(u)).slice(0, 4); saveSettings(); });
  const auto = h('input', { type: 'checkbox', checked: S.autoExpand });
  auto.addEventListener('change', () => { S.autoExpand = auto.checked; saveSettings(); });
  const nDomains = Object.keys(state.learned.domains).length, nVocab = Object.keys(state.learned.vocab).length;
  openModal('Settings', [
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Search depth' }), seg(DEPTHS, S.depth, (v) => { S.depth = v; saveSettings(); renderDepth(); }), h('small', { text: 'Fast reads about 3 pages, Balanced about 6, Deep about 10 and tries reformulated queries. Deeper is slower and uses more data.' })),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Appearance' }), seg([['light', 'Light'], ['dark', 'Dark'], ['system', 'System']], S.theme, (v) => { S.theme = v; saveSettings(); applyTheme(); })),
    h('div', { class: 'field' }, h('label', { class: 'check' }, auto, h('span', null, 'Show research activity expanded', h('small', { text: 'Otherwise it collapses to one line under each answer.' })))),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Sources' }), h('small', { text: 'Search providers are interchangeable; if one fails the next is tried. Untick any you do not want used.' }), ...prov),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Extra news feeds (RSS/Atom)' }), feeds, h('small', { text: 'Used for news questions in addition to the built-in publisher feeds.' })),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Memory and data on this device' }),
      h('small', { text: `Conversations: ${state.chats.length} · Saved knowledge: ${knowledge.length} answers you approved · Learned statistics: ${nDomains} sites, ${nVocab} terms. The server keeps only a temporary page cache (15 minutes, in memory); “Regenerate” bypasses it.` }),
      h('div', { class: 'pill-row' },
        h('button', { class: 'btn small', type: 'button', text: 'Clear saved knowledge', onclick: async () => { await idb.clear('knowledge'); toast('Saved knowledge cleared'); closeModal(); } }),
        h('button', { class: 'btn small', type: 'button', text: 'Clear learned statistics', onclick: () => { state.learned = { domains: {}, providers: {}, vocab: {} }; saveLearned(); toast('Learned statistics cleared'); closeModal(); } }),
        h('button', { class: 'btn small danger', type: 'button', text: 'Delete all conversations', onclick: async () => { if (!confirm('Delete every conversation stored on this device?')) return; await idb.clear('chats'); state.chats = []; closeModal(); newChat(); toast('All conversations deleted'); } }))),
    state.status ? h('small', { text: `Engine ${state.status.version} · language model: none${state.status.brain ? ` · built-in brain: ${Number(state.status.brain.patterns).toLocaleString()} phrasings, ${Number(state.status.brain.facts).toLocaleString()} common-sense facts` : ''} · Wikimedia API budget left this minute: ${state.status.wikimediaBudget}${state.status.contactConfigured ? '' : ' (operator contact not configured — lower limit applies)'}` }) : null,
  ]);
}
function openAbout() {
  const ul = (items) => h('ul', null, items.map((t) => h('li', { text: t })));
  openModal('About INFINI AI', [h('div', { class: 'about' },
    h('p', { text: 'INFINI AI has two parts: a small built-in brain for conversation, memory and everyday common sense, and a live web pipeline for knowledge. There is no large language model inside it and it calls none.' }),
    h('div', { class: 'sec', text: 'The built-in brain' }),
    ul(['It is made of rules and data, not a neural network: a database of everyday phrasings, prepared replies, a common-sense fact base and a few exact skills (clock, calendar, sums, dice, spelling).',
      'It understands casual typing, shorthand and typos, keeps track of the conversation, and remembers what you tell it (your name, what you like) for the current chat. That memory stays on this device.',
      'It never invents facts. When a message needs real knowledge it hands it to the web pipeline, and when it is unsure it says so and offers a web search.',
      'It is not conscious and has no feelings. It says so itself when asked.']),
    h('div', { class: 'sec', text: 'How a web answer is made' }),
    ul(['Understanding — rule-based language analysis classifies the question, finds its topic and resolves follow-ups such as “he” or “that”.', 'Planning — the question is split into sub-searches for different providers.', 'Searching — Wikipedia, Wikidata, a web search service, open web indexes, publisher news feeds and specialist sources are queried live, with automatic failover. A search service only supplies links: every page is then read by this app.', 'Reading — pages are fetched, cleaned of navigation and ads, and split into passages.', 'Comparing — passages are ranked, sources are checked for agreement, copies and contradictions.', 'Constructing — the answer is assembled from sentences found in the sources. Each one carries its citation.', 'Related questions — fixed question templates, offered only when a page that was just read has a section on that aspect.']),
    h('div', { class: 'sec', text: 'What it cannot do' }),
    ul(['It cannot write original essays, poems or code, translate, draw, or act on your device or accounts.', 'It cannot reason beyond what sources state. If the sources it can reach do not answer the question, it says “I could not verify this from the sources I found.”', 'It can be wrong: when sources are wrong, when the best page cannot be retrieved, or when its rules misread a message. A chat reply has a “Search the web instead” button for that case. Check the citations.', 'It “learns” only in a narrow sense: it stores which sites worked, words that co-occur with your topics, and answers you choose to save — all on this device, all clearable in Settings.']),
    h('div', { class: 'sec', text: 'Privacy' }),
    h('p', { text: 'Conversations, and what the brain remembers about you, live in this browser. Messages are sent to this app’s server, which answers them or queries public sources on your behalf; they are not sent to any AI provider. Your device’s time zone is sent with each message so that “what time is it” can be answered.' }),
    h('div', { class: 'sec', text: 'Open data inside the brain' }),
    h('p', { class: 'credits', text: 'This work includes data from ConceptNet 5, which was compiled by the Commonsense Computing Initiative. ConceptNet 5 is freely available under the Creative Commons Attribution-ShareAlike license (CC BY SA 3.0) from http://conceptnet.io. The included data was created by contributors to Commonsense Computing projects, contributors to Wikimedia projects, DBPedia, OpenCyc, Games with a Purpose, Princeton University’s WordNet, Francis Bond’s Open Multilingual WordNet, and Jim Breen’s JMDict.' }),
    h('p', { class: 'credits', text: 'It also uses WordNet 3.1 (Princeton University), example phrasings from Microsoft’s Personality Chat datasets (MIT License) and from the CLINC150 dataset (Larson et al., 2019, CC BY 3.0), and a word-frequency list derived from OpenSubtitles 2018 (FrequencyWords, CC BY-SA 4.0). Every reply is INFINI AI’s own text. ConceptNet’s data licence is now CC BY-SA 4.0, and the common-sense and vocabulary files derived from these sources are shared under that same licence; the full notices ship with the app in engine/brain/data/NOTICE.md.' }))]);
}

// ---------------- asking ----------------
function learnedPayload() {
  const domains = {};
  for (const [d, v] of Object.entries(state.learned.domains)) { const good = v.up || 0, bad = (v.down || 0) + ((v.failed || 0) >= 3 && !(v.fetched || 0) ? 2 : 0); if (good || bad) domains[d] = { good, bad }; }
  const providers = {};
  for (const [p, v] of Object.entries(state.learned.providers)) { const n = (v.ok || 0) + (v.failed || 0); if (n >= 3) providers[p] = Number((((v.ok || 0) - (v.failed || 0)) / n).toFixed(2)); }
  return { domains: Object.fromEntries(Object.entries(domains).slice(0, 150)), providers, vocab: Object.fromEntries(Object.entries(state.learned.vocab).slice(-200)) };
}
function absorb(learn) {
  if (!learn) return;
  for (const [p, v] of Object.entries(learn.providers || {})) { const cur = (state.learned.providers[p] = state.learned.providers[p] || { ok: 0, failed: 0 }); cur.ok = Math.min(200, cur.ok + v.ok); cur.failed = Math.min(200, cur.failed + v.failed); }
  for (const [d, v] of Object.entries(learn.domains || {})) { const cur = (state.learned.domains[d] = state.learned.domains[d] || {}); for (const k of ['fetched', 'failed', 'cited']) cur[k] = Math.min(500, (cur[k] || 0) + (v[k] || 0)); }
  for (const v of learn.vocab || []) state.learned.vocab[v.term] = [...new Set([...(v.related || []), ...(state.learned.vocab[v.term] || [])])].slice(0, 6);
  const keys = Object.keys(state.learned.vocab);
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete state.learned.vocab[k];
  saveLearned();
}
const DEPTHS = [['fast', 'Fast'], ['balanced', 'Balanced'], ['deep', 'Deep']];
const DEPTH_NOTE = { fast: 'Fast: reads about 3 pages', balanced: 'Balanced: reads about 6 pages', deep: 'Deep: reads about 10 pages and tries reformulated queries' };
function renderDepth() { $('depthLabel').textContent = (DEPTHS.find(([v]) => v === state.settings.depth) || DEPTHS[1])[1]; }
function cycleDepth() { const i = DEPTHS.findIndex(([v]) => v === state.settings.depth); state.settings.depth = DEPTHS[(i + 1) % DEPTHS.length][0]; saveSettings(); renderDepth(); toast(DEPTH_NOTE[state.settings.depth]); }
function setBusy(b) { state.busy = b; $('sendBtn').hidden = b; $('stopBtn').hidden = !b; $('sendBtn').disabled = !$('q').value.trim(); }
function regenerate(m) { if (state.busy) return; const i = state.chat.messages.indexOf(m); if (i < 0) return; run(m.question, { regenerate: true, replace: m, context: m.contextBefore || {} }); }
function ask(text) { const q = (text || $('q').value).trim(); if (!q || state.busy) return; $('q').value = ''; autoGrow(); run(q, {}); }

// A saved answer carries the context of the conversation it was saved in. Reused elsewhere, it brings its topic
// (for follow-ups) and what kind of reply it was, but what the brain remembers stays that of the current conversation.
function withOwnMemory(saved, current) {
  if (!saved || !Object.keys(saved).length) return current;
  const mine = current && current.brain, theirs = saved.brain;
  const last = theirs && typeof theirs === 'object' ? { last: theirs.last, lastText: theirs.lastText } : {};
  return { ...saved, brain: mine ? { ...mine, expect: null, ...last } : last };
}
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
async function run(question, { regenerate: regen = false, replace = null, context = null, route = '' } = {}) {
  const chat = state.chat;
  if (!chat.messages.length) $('thread').replaceChildren();
  const ctxBefore = context || chat.context || {};
  let m;
  if (replace) { m = replace; Object.assign(m, { status: 'working', result: null, events: [], error: '', cached: null, saved: false, voted: null }); m._body.replaceChildren(); }
  else {
    const u = { id: uid(), role: 'user', text: question };
    chat.messages.push(u); $('thread').append(userEl(u)); $('clearBtn').hidden = false;
    if (!chat.named && chat.messages.length === 1) { chat.title = question.length > 60 ? question.slice(0, 57) + '…' : question; $('chatTitle').textContent = chat.title; }
    m = { id: uid(), role: 'bot', question, contextBefore: ctxBefore, status: 'working', events: [] };
    chat.messages.push(m); $('thread').append(botEl(m));
  }
  // saved knowledge: reuse only for questions that are not time-sensitive, and say so
  if (!regen && !route) {
    const hit = await idb.get('knowledge', normQ(question));
    if (hit && !TIMEY.test(question) && !hit.result.timeSensitive) { Object.assign(m, { status: 'done', result: hit.result, cached: hit.savedAt, saved: true, events: [] }); chat.context = withOwnMemory(hit.result.context, chat.context); fillBot(m); scrollDown(); return saveChat(); }
  }
  // Three dots first. The research panel appears only once the web pipeline really starts,
  // so a chat reply from the brain never flashes a list of search stages.
  const act = createActivity(state.settings.autoExpand);
  const typing = h('div', { class: 'typing', role: 'status', 'aria-label': 'INFINI AI is replying' }, h('i'), h('i'), h('i'));
  act.el.hidden = true;
  m._body.append(typing, act.el);
  const reveal = () => { if (act.el.hidden) { act.el.hidden = false; typing.hidden = true; } };
  scrollDown(true);
  setBusy(true);
  state.abort = new AbortController();
  try {
    const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: state.abort.signal, body: JSON.stringify({ question, context: ctxBefore, regenerate: regen, tz: deviceTz(), learned: learnedPayload(), settings: { depth: state.settings.depth, providersOff: state.settings.providersOff, feeds: state.settings.feeds, ...(route ? { route } : {}) } }) });
    if (!res.ok || !res.body) { let msg = `The server answered ${res.status}.`; try { msg = (await res.json()).message || msg; } catch { /* not JSON */ } throw new Error(msg); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'answer') m.result = ev.result;
        else if (ev.type === 'error') m.error = ev.message;
        else if (ev.type !== 'done') { if (m.events.length < 120) m.events.push(ev); act.onEvent(ev); if (ev.type !== 'stage' || ev.stage !== 'understanding') reveal(); scrollDown(); }
      }
    }
    const newest = chat.messages[chat.messages.length - 1] === m;      // redoing an older reply must not rewind what the conversation knows
    if (m.result) { m.status = 'done'; if (newest && m.result.context && Object.keys(m.result.context).length) chat.context = m.result.context; absorb(m.result.learn); }
    else { m.status = 'error'; m.error = m.error || 'The connection closed before an answer arrived.'; }
  } catch (e) {
    if (e.name === 'AbortError') m.status = 'stopped'; else { m.status = 'error'; m.error = e.message === 'Failed to fetch' ? 'Could not reach the server. Check your connection and retry.' : e.message; }
  }
  state.abort = null;
  setBusy(false);
  fillBot(m);
  // show the question with the start of its answer, rather than jumping to the end of a long answer
  const top = (m._el.previousElementSibling || m._el).offsetTop;
  if (typeof top === 'number') $('scroll').scrollTop = Math.max(0, top - 12); else scrollDown();
  saveChat();
}
function autoGrow() { const q = $('q'); q.style.height = 'auto'; q.style.height = Math.min(160, q.scrollHeight) + 'px'; $('sendBtn').disabled = !q.value.trim(); }

// ---------------- wiring ----------------
async function init() {
  applyTheme();
  $('askForm').addEventListener('submit', (e) => { e.preventDefault(); ask(); });
  $('q').addEventListener('input', autoGrow);
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); } });
  $('stopBtn').addEventListener('click', () => { if (state.abort) state.abort.abort(); });
  for (const id of ['newChat', 'newChatTop']) $(id).addEventListener('click', () => { if (state.busy) return toast('Wait for the current answer or press stop'); newChat(); });
  $('depthBtn').addEventListener('click', cycleDepth);
  renderDepth();
  $('menuBtn').addEventListener('click', openNav);
  $('scrim').addEventListener('click', closeNav);
  $('histSearch').addEventListener('input', (e) => { state.filter = e.target.value; renderChatList(); });
  $('openSettings').addEventListener('click', () => { closeNav(); openSettings(); });
  $('openAbout').addEventListener('click', () => { closeNav(); openAbout(); });
  $('drawerClose').addEventListener('click', closeDrawer);
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  $('clearBtn').addEventListener('click', async () => { if (state.busy || !state.chat.messages.length) return; if (!confirm('Clear this conversation and its context?')) return; await idb.del('chats', state.chat.id); state.chats = state.chats.filter((c) => c.id !== state.chat.id); newChat(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeModal(); closeNav(); } });
  const stored = await idb.all('chats');
  state.chats = stored.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, text: c.messages.map((m) => m.text || (m.result && m.result.answer.text) || '').join(' ').slice(0, 4000).toLowerCase() })).sort((a, b) => b.updatedAt - a.updatedAt);
  newChat();
  autoGrow();
  // a link such as /?q=Why+do+stars+shine%3F opens the app and asks that question once
  const linked = new URLSearchParams(location.search).get('q');
  if (linked) { history.replaceState(null, '', location.pathname); if (linked.trim() && linked.length <= 600) ask(linked); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA install is optional */ });
}
init();
