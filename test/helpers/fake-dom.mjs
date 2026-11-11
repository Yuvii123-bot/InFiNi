// Minimal DOM stand-in so the browser client (public/app.js) can be exercised under Node without a browser.
// It implements only what the client uses; it is a test double, not a DOM implementation.
class Node_ { constructor(type) { this.nodeType = type; this.parentNode = null; } }
class Text_ extends Node_ { constructor(t) { super(3); this.textContent = String(t); } }
class El extends Node_ {
  constructor(tag) {
    super(1); this.tagName = tag.toUpperCase(); this.childNodes = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.className = ''; this._hidden = false; this.value = ''; this.disabled = false; this.checked = false; this.scrollTop = 0;
    const self = this;
    this.classList = {
      add: (...c) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(' '); },
      remove: (...c) => { self.className = self.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' '); },
      contains: (c) => self.className.split(/\s+/).includes(c),
      toggle: (c, force) => { const has = self.classList.contains(c); const want = force === undefined ? !has : !!force; if (want) self.classList.add(c); else self.classList.remove(c); return want; },
    };
  }
  get hidden() { return this._hidden; } set hidden(v) { this._hidden = !!v; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.childNodes = [new Text_(v)]; }
  append(...nodes) { for (const n of nodes) { const node = typeof n === 'string' ? new Text_(n) : n; node.parentNode = this; this.childNodes.push(node); } }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'hidden') this._hidden = true; if (k === 'class') this.className = String(v); if (k === 'checked') this.checked = true; if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(type, extra = {}) { const ev = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extra }; return Promise.all((this.listeners[type] || []).map((fn) => fn(ev))); }
  click() { return this.fire('click'); }
  focus() {}
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const match = (el) => sel.startsWith('.') ? el.classList.contains(sel.slice(1)) : sel.includes('[') ? el.tagName === sel.split('[')[0].toUpperCase() : el.tagName === sel.toUpperCase();
    const walk = (el) => { for (const c of el.children) { if (match(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}
export function installDom(baseUrl) {
  const ids = {};
  const doc = {
    createElement: (t) => new El(t), createTextNode: (t) => new Text_(t), documentElement: new El('html'),
    getElementById: (id) => ids[id] || (ids[id] = Object.assign(new El(id === 'q' ? 'textarea' : 'div'), { id })),
    querySelector: () => new El('meta'), addEventListener() {},
  };
  const store = new Map();
  Object.assign(globalThis, {
    document: doc, window: { matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    location: { protocol: 'http:' }, confirm: () => true, prompt: () => 'Renamed chat',
  });
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { globalThis.__copied = t; } } }, configurable: true });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => realFetch(String(url).startsWith('/') ? baseUrl + url : url, opts);
  return { ids, text: (el) => el.textContent.replace(/\s+/g, ' ').trim(), find: (el, sel) => el.querySelectorAll(sel) };
}
