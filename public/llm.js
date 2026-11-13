// Infinity LLM — pure neural chat (client).
//
// This page talks to one endpoint only: POST /api/llm/chat. That endpoint runs Infinity LLM, the project's own neural
// language model, and nothing else: no web search, no rule-based reply, no outside model. Whatever the model generates
// is shown as it arrives, token by token, and is never replaced, corrected or completed by this page. Messages this
// page writes itself (errors, "the model produced no text") are shown as notices, never as a reply from the model.
//
// The conversation lives in sessionStorage (this tab, until it is closed or "New chat" is pressed). Each request sends
// the earlier turns; the server feeds as many of the latest ones as fit the model's context window.

const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—');

const KEY = 'infini.pure.chat';
const MAX_TURNS_SENT = 16;
const store = {
  load() { try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return v && Array.isArray(v.turns) ? v : null; } catch { return null; } },
  save() { try { sessionStorage.setItem(KEY, JSON.stringify({ turns: state.turns.filter((t) => !t.live).map(({ u, a, note, error, meta }) => ({ u, a, note, error, meta })), temp: state.temp })); } catch { /* storage unavailable: the chat still works, it just does not survive a reload */ } },
};
const saved = store.load();
let liveText = null;      // the element the reply being generated is streamed into
const state = { turns: saved ? saved.turns.filter((t) => t && typeof t.u === 'string').map((t) => ({ u: t.u, a: typeof t.a === 'string' ? t.a : '', note: t.note || '', error: t.error || '', meta: t.meta || null })) : [], temp: saved && typeof saved.temp === 'number' ? saved.temp : 0.6, busy: false, abort: null, model: null, unavailable: '' };

/** Earlier turns sent as context: only turns the model actually answered. */
const historyBefore = (index) => state.turns.slice(0, index).filter((t) => t.a && !t.live).slice(-MAX_TURNS_SENT).map((t) => [t.u, t.a]);

function metaLine(t) {
  const m = t.meta; if (!m) return '';
  const bits = [`${num(m.tokens)} token${m.tokens === 1 ? '' : 's'} generated`];
  if (m.tps) bits.push(`${num(m.tps)} tokens/s`);
  bits.push(m.sent ? `context: ${m.used} of ${m.sent} earlier turn${m.sent === 1 ? '' : 's'}${m.used < m.sent ? ` (the rest did not fit the ${num(m.window)}-token window)` : ''}` : 'context: none (first message)');
  bits.push(`variety ${Number(m.temp).toFixed(1)}`);
  return bits.join(' · ');
}

function turnEl(t, i) {
  const last = i === state.turns.length - 1;
  const text = h('p', { class: `p-text${t.live ? ' live' : ''}${!t.a && !t.live ? ' none' : ''}` }, t.a || (t.live ? '' : '(no text)'));
  const bot = h('div', { class: 'msg bot' },
    h('div', { class: 'p-tag', text: `Infinity LLM${t.meta && t.meta.version ? ' ' + t.meta.version : state.model ? ' ' + state.model.version : ''}` }),
    text,
    t.note ? h('p', { class: 'p-note', text: `Note: ${t.note}.` }) : null,
    t.meta ? h('p', { class: 'p-meta', text: metaLine(t) }) : null,
    last && !t.live && !state.busy ? h('div', { class: 'p-acts' }, h('button', { type: 'button', class: 'p-regen', onclick: () => regenerate() }, 'Generate again')) : null);
  if (t.live) liveText = text;
  return [h('div', { class: 'msg user' }, h('div', { class: 'bubble', text: t.u })), t.error ? h('div', { class: 'p-notice bad', text: t.error }) : bot];
}

function intro() {
  const m = state.model;
  return h('section', { class: 'p-intro' },
    h('h2', { text: 'Infinity LLM, on its own' }),
    h('p', { text: m ? `Here you talk to the neural network directly: Infinity LLM ${m.version}, ${num(m.parameters)} parameters, trained from random weights by this project. Each reply is produced one token at a time from what the network learned.` : 'Here you talk to the neural network directly. Each reply is produced one token at a time from what the network learned.' }),
    h('ul', null,
      h('li', { text: 'Nothing else answers in this mode: no web search, no prepared replies, no rules, no outside model.' }),
      h('li', { text: 'The model is very small. Many replies will not fit your message, and it cannot be relied on for facts.' }),
      h('li', { text: 'It learned to chat from the built-in replies of the Internet mode, so it often repeats their wording and may offer to “look something up”. In this mode it cannot look anything up.' })),
    h('div', { class: 'p-try' }, ['Hello', 'Good night', 'My name is Sam', 'What can you do?'].map((q) => h('button', { type: 'button', onclick: () => send(q) }, q))));
}

function render() {
  const out = [];
  if (state.unavailable) out.push(h('div', { class: 'p-notice bad', text: state.unavailable }));
  if (!state.turns.length) out.push(intro());
  state.turns.forEach((t, i) => out.push(...turnEl(t, i)));
  $('pThread').replaceChildren(...out);
  const answered = state.turns.filter((t) => t.a && !t.live).length;
  $('pCtx').textContent = answered ? `${answered} turn${answered === 1 ? '' : 's'} in this chat` : 'new chat';
  $('pSend').hidden = state.busy; $('pStop').hidden = !state.busy;
  $('pSend').disabled = !!state.unavailable;
  if (state.turns.length) toBottom(); else $('pScroll').scrollTop = 0;
}
function toBottom() { const s = $('pScroll'); s.scrollTop = s.scrollHeight; }
function setTemp(v) { state.temp = Math.min(1.2, Math.max(0, Math.round(v * 10) / 10)); $('pTemp').value = String(Math.round(state.temp * 10)); $('pTempOut').textContent = state.temp.toFixed(1); }
function grow() { const q = $('pInput'); if (!q.style) return; q.style.height = 'auto'; q.style.height = `${Math.min(140, q.scrollHeight || 0)}px`; }

/** Ask the model for a reply to turn `index` and stream it into that turn. */
async function generate(index) {
  const t = state.turns[index];
  const history = historyBefore(index);
  Object.assign(t, { a: '', note: '', error: '', meta: null, live: true });
  state.busy = true; state.abort = new AbortController();
  render();
  try {
    const res = await fetch('/api/llm/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: state.abort.signal, body: JSON.stringify({ message: t.u, history, temperature: state.temp }) });
    if (!res.ok || !res.body) { let msg = `The server answered ${res.status}.`; try { msg = (await res.json()).message || msg; } catch { /* not JSON */ } throw new Error(msg); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', answer = null;
    const handle = (ev) => {
      if (ev.type === 'token' && typeof ev.text === 'string') { t.a += ev.text; if (liveText) liveText.textContent = t.a; toBottom(); }
      else if (ev.type === 'answer') answer = ev;
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line) { try { handle(JSON.parse(line)); } catch { /* a broken line is skipped */ } } }
    }
    if (!answer) throw new Error('The connection ended before the model finished.');
    // the final text is the server's record of exactly what the model generated (the stream carried the same tokens)
    t.a = answer.text || '';
    t.note = answer.note || '';
    t.meta = { version: answer.model && answer.model.version, tokens: answer.tokens || 0, tps: answer.tokensPerSecond || 0, used: answer.contextTurns || 0, sent: history.length, window: answer.contextWindow || (state.model && state.model.context) || 0, temp: state.temp, finished: !!answer.finished };
  } catch (e) {
    if (state.abort.signal.aborted) t.note = t.a ? 'stopped before the model finished' : 'stopped before the model produced any text';
    else { t.error = `No reply was generated: ${String((e && e.message) || e)}`; t.a = ''; }
  } finally {
    t.live = false; liveText = null; state.busy = false; state.abort = null;
    store.save(); render();
  }
}

async function send(text) {
  const q = String(text == null ? $('pInput').value : text).trim();
  if (!q || state.busy || state.unavailable) return;
  $('pInput').value = ''; grow();
  state.turns.push({ u: q.slice(0, 2000), a: '' });
  await generate(state.turns.length - 1);
}
async function regenerate() { if (state.busy || !state.turns.length) return; await generate(state.turns.length - 1); }
function newChat() { if (state.abort) state.abort.abort(); state.turns = []; store.save(); render(); $('pInput').focus(); }

async function loadModel() {
  try {
    const res = await fetch('/api/llm/status');
    const j = await res.json();
    const m = j && j.model;
    if (m && m.available) {
      state.model = { version: m.version, parameters: m.parameters, context: m.context, layers: m.layers, width: m.width };
      $('pModel').textContent = `Infinity LLM ${m.version} · ${num(m.parameters)} parameters`;
      $('pFine').textContent = `Only Infinity LLM ${m.version} answers here: no web search, no prepared replies, no outside model. It is very small and is often wrong. It sees only the last few messages of this chat (its window is ${num(m.context)} tokens, replies included).`;
    } else {
      state.unavailable = `Infinity LLM is not available on this server${m && m.reason ? ` (${m.reason})` : ''}, so this mode cannot answer. Nothing else will answer in its place.`;
      $('pBanner').classList.add('bad'); $('pModel').textContent = 'No model is loaded.';
    }
  } catch { $('pModel').textContent = 'The model\'s details could not be loaded. Sending a message will show whether it is available.'; }
  render();
}

// ---- wiring ----
try { const th = JSON.parse(localStorage.getItem('infini.settings') || '{}').theme; const dark = th === 'dark' || (th === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); if (dark) document.documentElement.setAttribute('data-theme', 'dark'); } catch { /* default theme */ }
$('pForm').addEventListener('submit', (e) => { e.preventDefault(); return send(); });
$('pInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); return send(); } });
$('pInput').addEventListener('input', grow);
$('pStop').addEventListener('click', () => { if (state.abort) state.abort.abort(); });
$('pNew').addEventListener('click', newChat);
$('pTemp').addEventListener('input', () => { setTemp(Number($('pTemp').value) / 10); store.save(); });
setTemp(state.temp);
render();
loadModel();
