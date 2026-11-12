// INFINI AI — web page extraction engine.
// Turns untrusted HTML into structured, attributed blocks (headings, paragraphs, lists, tables, code)
// plus metadata (title, site, author, dates, feeds, structured data). Boilerplate, navigation,
// advertisements and hidden text are removed. Nothing in a page is ever executed or obeyed.

import { parseHTML, walk, textOf, stripTags, find } from './html.js';
import { cleanText, squash, hash, truncate, splitSentences } from '../util/text.js';
import { parseDate, plausiblePubDate } from '../util/dates.js';

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed', 'form', 'button', 'select', 'input',
  'textarea', 'nav', 'aside', 'footer', 'dialog', 'menu', 'video', 'audio', 'map', 'figcaption', 'head', 'title', 'meta', 'link', 'picture', 'source',
  'label', 'fieldset', 'math', 'img', 'noembed', 'noframes', 'xmp', 'base', 'area', 'track', 'param', 'datalist', 'optgroup', 'option']);
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt',
  'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr', 'br', 'nobr']);
const CONTAINERS = new Set(['div', 'section', 'article', 'main', 'center', 'td', 'tr', 'tbody', 'table', 'body', 'html', '#root', 'span', 'font', 'dd', 'li', 'ul', 'ol']);
const BOILER_RE = /(^|[\s_-])(comments?|disqus|sidebar|widgets?|related|recommended|recirc|share|sharing|social|newsletter|subscribe|subscription|signup|sign-up|cookies?|consent|gdpr|banner|advert\w*|ads?|sponsor\w*|promo\w*|popup|modal|overlay|breadcrumbs?|pagination|pager|toolbar|menu|navbar|nav|footer|masthead|skip-link|toc|table-of-contents|author-bio|tags|taglist|outbrain|taboola|paywall|login|search-form|searchbox|print|hatnote|navbox|reflist|references|mw-editsection|catlinks|noprint|sistersitebox|thumbcaption|mw-jump-link|vector-menu|shortdescription|ambox|metadata|byline-social|trending|most-read|popular|read-more|more-stories|also-read|feedback|rating|donate|cta)([\s_-]|$)/i;
const HIDDEN_CLASS_RE = /(^|\s)(hidden|sr-only|visually-hidden|visuallyhidden|screen-reader-text|d-none|invisible|is-hidden|u-hidden|hide|offscreen|a11y-hidden|assistive-text)(\s|$)/i;
const HIDDEN_STYLE_RE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(px|pt|em|rem|%)?\s*(;|$)|opacity\s*:\s*0(\.0+)?\s*(;|$)|text-indent\s*:\s*-\d{3,}|(left|top)\s*:\s*-\d{4,}|(^|;)\s*(width|height)\s*:\s*0(px)?\s*(;|$)|clip\s*:\s*rect\(\s*0/i;
const BOILER_TEXT_RE = /^(share( this)?|tweet|follow us|subscribe|sign up|log ?in|sign in|read more|continue reading|advertisement|sponsored|related (articles|posts|stories)|copyright|©|all rights reserved|we use cookies|this (web)?site uses cookies|accept (all )?cookies|privacy policy|terms of (use|service)|click here|skip to|loading|please enable javascript|you (must|need to) enable|javascript is (required|disabled)|photo( credit)?:|image( credit)?:|credit:|getty images|posted (in|by|on)|filed under|tags?:|leave a (reply|comment)|back to top|table of contents|jump to|print this|email this|last (updated|modified)|your browser|sorry, |error 4|page not found|access denied)/i;
const ROLE_SKIP = new Set(['navigation', 'banner', 'complementary', 'contentinfo', 'search', 'dialog', 'alert', 'alertdialog', 'menu', 'menubar', 'toolbar', 'tablist', 'presentation-ignored']);

function isHidden(el) {
  const a = el.attrs;
  if ('hidden' in a || a['aria-hidden'] === 'true') return true;
  if (a.style && HIDDEN_STYLE_RE.test(a.style)) return true;
  if (a.class && HIDDEN_CLASS_RE.test(a.class)) return true;
  return false;
}

/** First pass: mark skipped subtrees and measure text / link-text length per element. */
function measure(el, inLink) {
  let t = 0, l = 0;
  for (const ch of el.children) {
    if (ch.text !== undefined) { const len = ch.text.trim().length; t += len; if (inLink) l += len; continue; }
    if (ch._skip) continue;                                       // already classified as boilerplate on an earlier pass
    if (ch.tag === 'form' && !isHidden(ch)) {                     // ASP.NET-style pages wrap the whole body in a <form>: keep large ones
      measure(ch, inLink);
      if (ch._t < 600) { ch._skip = true; continue; }
      t += ch._t; l += ch._l; continue;
    }
    if (SKIP.has(ch.tag) || isHidden(ch) || (ch.attrs.role && ROLE_SKIP.has(ch.attrs.role))) { ch._skip = true; continue; }
    measure(ch, inLink || ch.tag === 'a');
    t += ch._t; l += ch._l;
  }
  el._t = t; el._l = l;
}

const INLINE_TAGS = new Set(['a', 'span', 'abbr', 'em', 'strong', 'b', 'i', 'u', 'mark', 'small', 'cite', 'q', 'dfn', 'code', 'time', 'data', 'var', 'kbd', 'samp', 'ins', 'font', 'bdi', 'bdo']);
const TEXT_PARENTS = new Set(['p', 'li', 'td', 'th', 'dd', 'dt', 'blockquote', 'figcaption', 'caption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'em', 'strong', 'b', 'i', 'u', 'mark', 'small', 'cite', 'q', 'dfn']);
/** Second pass: drop boilerplate containers identified by class/id naming, link density, or role. */
function markBoilerplate(root, total) {
  walk(root, (el) => {
    if (el._skip) return false;
    if (el.tag === 'body' || el.tag === 'html' || el.tag === 'main' || el.tag === 'article') return;
    const share = el._t / Math.max(1, total);
    const idc = (el.attrs.class || '') + ' ' + (el.attrs.id || '');
    // A short inline element inside running text (a glossary link, a term with a pop-up explanation) is part of its
    // sentence whatever its class is called: dropping it would leave "… harmful to humans and ." behind.
    const inText = INLINE_TAGS.has(el.tag) && el._t <= 90 && el.parent && TEXT_PARENTS.has(el.parent.tag) && el.parent._t - el._t >= 40;
    if (idc.length > 1 && share < 0.45 && !inText && BOILER_RE.test(idc)) { el._skip = true; return false; }
    if (el.tag === 'header' && (el._l / Math.max(1, el._t) > 0.3 || share < 0.02)) { el._skip = true; return false; }
    if ((el.tag === 'div' || el.tag === 'ul' || el.tag === 'ol' || el.tag === 'section' || el.tag === 'table' || el.tag === 'p') && el._t > 60 && el._l / el._t > 0.72 && share < 0.4) { el._skip = true; return false; }
  });
}

const contentLen = (el) => (el._t || 0) - (el._l || 0);

function mainContainer(start) {
  let node = start, lead = null;
  for (let guard = 0; guard < 60; guard++) {
    const total = contentLen(node);
    if (total < 250) break;
    let best = null, bestLen = 0;
    for (const ch of node.children) {
      if (ch.text !== undefined || ch._skip) continue;
      const len = contentLen(ch);
      if (len > bestLen) { best = ch; bestLen = len; }
    }
    if (best && bestLen >= total * 0.72 && CONTAINERS.has(best.tag) && best.tag !== 'ul' && best.tag !== 'ol' && best.tag !== 'li' && best.tag !== 'table' && best.tag !== 'td') {
      // Many layouts put the title and the opening summary in a header block *next to* the body. Descending into the
      // body would lose that summary (on documentation pages it is the definition), so the header block is remembered.
      for (const sib of node.children) {
        if (sib === best) break;
        if (sib.text === undefined && !sib._skip && sib._t >= 80 && sib._l / Math.max(1, sib._t) < 0.5 && find(sib, (x) => x.tag === 'h1')) lead = sib;
      }
      node = best;
    } else break;
  }
  return { node, lead };
}

const REF_RE = /^\s*\[?\s*(\d{1,3}|[a-z]|citation needed|note \d+|edit|update|when\?|who\?|clarification needed)\s*\]?\s*$/i;
const BLOCKISH = new Set(['p', 'div', 'section', 'article', 'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'dd', 'dt', 'header', 'figure', 'main']);

// Links found inside the main text while a page is being extracted (set by extractPage, which runs synchronously).
let LINKS = null;

function inline(el, out) {
  for (const ch of el.children) {
    if (ch.text !== undefined) { out.s += ch.text; continue; }
    if (ch._skip) continue;
    const tag = ch.tag;
    if (tag === 'br') { out.s += '\n'; continue; }
    if (tag === 'ul' || tag === 'ol' || tag === 'table' || tag === 'pre') continue;
    if (tag === 'sup' && (REF_RE.test(textOf(ch)) || (ch.attrs.class || '').includes('reference'))) continue;
    if ((tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') && !out.pre) {
      const t = textOf(ch).trim();
      if (t && t.length <= 80 && !t.includes('`') && !t.includes('\n')) { out.s += '`' + t + '`'; continue; }
    }
    const before = out.s.length;
    inline(ch, out);
    if (tag === 'a') {
      out.link += out.s.length - before;
      if (LINKS && ch.attrs.href && LINKS.length < 400 && out.s.length - before >= 3) LINKS.push({ href: ch.attrs.href, text: out.s.slice(before, before + 160) });
    }
    if (BLOCKISH.has(tag)) out.s += '\n';
  }
}
function inlineText(el) { const o = { s: '', link: 0 }; inline(el, o); return o; }

/**
 * Many pages mark sub-headings as a paragraph that is bold from start to finish (<p><strong>1. Start here</strong></p>).
 * Returns that title, or '' when the paragraph is ordinary text, a link, a byline or boilerplate.
 */
function pseudoHeading(p, o) {
  let bold = 0;
  for (const ch of p.children) {
    if (ch.text !== undefined) { if (ch.text.trim()) return ''; continue; }
    if (ch.tag === 'br' || ch.tag === 'img') continue;
    if (ch.tag !== 'strong' && ch.tag !== 'b') return '';
    bold++;
  }
  if (!bold) return '';
  const text = squash(o.s);
  if (text.length < 4 || text.length > 110 || /[.!,;:…]$/.test(text) || o.link / Math.max(1, o.s.length) > 0.5) return '';
  if (BOILER_TEXT_RE.test(text) || /^(by|photo|image|credit|source|updated|published|posted|note|example|tip|warning)\b/i.test(text)) return '';
  return text;
}

const STEP_HEAD_RE = /^(?:step\s*)?(\d{1,2})\s*[.):\u2013\u2014-]\s*(\S.{2,})$/i;
/**
 * Guides often number their section titles ("1. Define the goal", "Step 2: …") instead of using a list.
 * Each run of three or more such titles, counted up from 1 at one heading level, becomes an ordered list whose
 * items are the title plus the first sentence of that section — both verbatim from the page.
 */
const NUM_PARA = /^\(?(\d{1,2})[.)]\s+(\S[\s\S]*)$/;
const BUL_PARA = /^[•‣◦▪●·*–-]\s+(\S[\s\S]*)$/;
/**
 * Lists that a page's markup scatters: steps written as paragraphs ("1. …", "2. …", "3. …"), bullets typed as text,
 * or one <ul> per item. They are put back together so that a procedure is seen as one ordered list.
 */
function normalizeLists(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'p') {
      const num = NUM_PARA.exec(b.text);
      const re = num ? NUM_PARA : BUL_PARA.test(b.text) ? BUL_PARA : null;
      if (re && (!num || Number(num[1]) === 1)) {
        const items = [];
        let j = i;
        for (; j < blocks.length; j++) {
          const c = blocks[j];
          const m = c.type === 'p' && (c.heading || '') === (b.heading || '') ? re.exec(c.text) : null;
          if (!m || (num && Number(m[1]) !== items.length + 1)) break;
          items.push({ text: num ? m[2] : m[1], depth: 0 });
        }
        if (items.length >= 3) { out.push({ type: 'list', ordered: !!num, items, heading: b.heading, derived: num ? 'numbered-paragraphs' : 'bulleted-paragraphs' }); i = j - 1; continue; }
      }
    }
    const prev = out[out.length - 1];
    if (b.type === 'list' && prev && prev.type === 'list' && !!prev.ordered === !!b.ordered && (prev.heading || '') === (b.heading || '') && !prev.structured && !b.structured && prev.items.length + b.items.length <= 60) {
      prev.items = [...prev.items, ...b.items];                 // adjacent lists of the same kind under one heading are one list
      continue;
    }
    out.push(b);
  }
  return out;
}

function numberedSectionLists(blocks) {
  const lists = [];
  let run = [];
  const close = () => { if (run.length >= 3) lists.push(run); run = []; };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'heading') continue;
    const m = STEP_HEAD_RE.exec(b.text);
    if (!m) { if (run.length && b.level <= run[0].level) close(); continue; }
    const n = Number(m[1]);
    if (run.length && (b.level !== run[0].level || n !== run[run.length - 1].n + 1)) close();
    if (!run.length && n !== 1) continue;
    let first = '';
    for (let j = i + 1; j < blocks.length && blocks[j].type !== 'heading'; j++) {
      if (blocks[j].type === 'p' && blocks[j].text.length >= 30) { first = splitSentences(blocks[j].text)[0] || ''; break; }
    }
    run.push({ n, level: b.level, label: squash(m[2]), first, parent: b.heading || '' });
  }
  close();
  return lists.map((steps) => ({
    type: 'list', ordered: true, structured: true, derived: 'numbered-sections', heading: steps[0].parent,
    items: steps.map((st) => ({ text: truncate(st.first ? `${st.label}${/[.!?:]$/.test(st.label) ? '' : ':'} ${st.first}` : st.label, 420), depth: 0 })),
  }));
}

function hasBlockChild(el) {
  for (const ch of el.children) if (ch.tag && !INLINE.has(ch.tag) && !ch._skip) return true;
  return false;
}

/** Commands shown inside a list item (<li>Run this: <pre>…</pre></li>) stay attached to that item. */
function itemCode(li) {
  const out = [];
  const visit = (el) => {
    for (const ch of el.children || []) {
      if (ch.text !== undefined || ch._skip || ch.tag === 'ul' || ch.tag === 'ol') continue;
      if (ch.tag === 'pre') { const c = textOf(ch).replace(/\s+$/, '').replace(/^\n+/, ''); if (c.trim() && out.length < 2) out.push(c.slice(0, 600)); continue; }
      visit(ch);
    }
  };
  visit(li);
  return out;
}

function listItems(listEl, depth, items) {
  for (const li of listEl.children) {
    if (li.text !== undefined || li._skip) continue;
    if (li.tag !== 'li') { if (li.tag === 'ul' || li.tag === 'ol') listItems(li, depth + 1, items); continue; }
    const o = inlineText(li);
    const text = squash(o.s);
    const code = text ? itemCode(li) : [];
    if (text) items.push({ text: truncate(text, 700), depth, ...(code.length ? { code } : {}) });
    for (const sub of li.children) if ((sub.tag === 'ul' || sub.tag === 'ol') && !sub._skip && depth < 3) listItems(sub, depth + 1, items);
    if (items.length >= 120) return;
  }
}

function tableData(table) {
  const rows = [];
  let caption = '', nested = false;
  const visit = (el) => {
    for (const ch of el.children) {
      if (ch.text !== undefined || ch._skip) continue;
      if (ch.tag === 'tr') {
        const cells = [];
        let allTh = true;
        for (const c of ch.children) {
          if (c.tag !== 'td' && c.tag !== 'th') continue;
          if (find(c, (x) => x.tag === 'table')) nested = true;
          if (c.tag === 'td') allTh = false;
          cells.push(truncate(squash(inlineText(c).s), 300));
        }
        if (cells.length && rows.length < 80) rows.push({ cells: cells.slice(0, 12), head: allTh });
      } else if (ch.tag === 'thead' || ch.tag === 'tbody' || ch.tag === 'tfoot') visit(ch);
      else if (ch.tag === 'caption') caption = squash(inlineText(ch).s);
    }
  };
  visit(table);
  const cols = rows.reduce((mx, r) => Math.max(mx, r.cells.length), 0);
  const chars = rows.reduce((s, r) => s + r.cells.join('').length, 0);
  const isData = !nested && rows.length >= 2 && cols >= 2 && chars / Math.max(1, rows.length * cols) < 160;
  return { rows, caption, isData };
}

function collectBlocks(container, blocks, state) {
  const headings = state.headings;
  let buf = { s: '', link: 0 };
  const push = (b) => {
    if (blocks.length >= 1500) return;
    b.heading = headings.filter(Boolean).join(' › ');
    blocks.push(b);
    // links met since the last block belong to this one: remember the words around each (what the link is cited for)
    if (LINKS) {
      const text = b.type === 'p' ? b.text : b.type === 'list' ? b.items.map((i) => i.text).join(' \n ') : '';
      for (let i = state.linkMark || 0; i < LINKS.length; i++) {
        const l = LINKS[i];
        if (!text) continue;
        const at = text.indexOf(l.text.slice(0, 40).trim());
        if (at >= 0) l.ctx = text.slice(Math.max(0, at - 170), at + 190);
      }
      state.linkMark = LINKS.length;
    }
  };
  const flush = () => {
    if (!buf.s) return;
    const linkShare = buf.link / Math.max(1, buf.s.length);
    for (const part of buf.s.split(/\n\s*\n/)) {
      const text = squash(part);
      if (text.length >= 30 || (text.length >= 12 && /[.!?:]$/.test(text))) {
        if (!(linkShare > 0.65 && text.length < 240)) push({ type: 'p', text });
      }
    }
    buf = { s: '', link: 0 };
  };
  const addHeading = (text, level, href = '', pseudo = false) => {
    headings.length = level;
    for (let k = 0; k < level; k++) if (headings[k] === undefined) headings[k] = '';
    headings[level - 1] = text;
    if (!pseudo) state.realLevel = level;
    if (blocks.length < 1500) blocks.push({ type: 'heading', level, text, href, heading: headings.slice(0, level - 1).filter(Boolean).join(' › '), ...(pseudo ? { pseudo: true } : {}) });
  };
  const visit = (node) => {
    for (const ch of node.children) {
      if (ch.text !== undefined) { buf.s += ch.text; continue; }
      if (ch._skip) continue;
      const tag = ch.tag;
      if (INLINE.has(tag) && !hasBlockChild(ch)) {
        if (tag === 'br') { buf.s += '\n'; continue; }
        if (tag === 'sup' && REF_RE.test(textOf(ch))) continue;
        inline({ children: [ch] }, buf);
        continue;
      }
      if (tag.length === 2 && tag[0] === 'h' && tag[1] >= '1' && tag[1] <= '6') {
        flush();
        const text = squash(inlineText(ch).s).replace(/\s*\[edit\]\s*$/i, '');
        if (text && text.length < 200) {
          const link = find(ch, (x) => x.tag === 'a' && !!x.attrs.href) || (ch.parent && ch.parent.tag === 'a' && ch.parent.attrs.href ? ch.parent : null);
          addHeading(text, Number(tag[1]), link ? link.attrs.href : '');
        }
        continue;
      }
      flush();
      if (tag === 'p') {
        const o = inlineText(ch);
        const title = pseudoHeading(ch, o);
        if (title) { addHeading(title, Math.min(6, (state.realLevel || 1) + 1), '', true); continue; }
        buf = o; flush();
      } else if (tag === 'ul' || tag === 'ol') {
        const items = [];
        listItems(ch, 0, items);
        const avg = items.reduce((s, it) => s + it.text.length, 0) / Math.max(1, items.length);
        const linkShare = ch._l / Math.max(1, ch._t);
        if (items.length && !(linkShare > 0.6 && avg < 70)) push({ type: 'list', ordered: tag === 'ol', items });
      } else if (tag === 'table') {
        const t = tableData(ch);
        if (t.isData) {
          const header = t.rows[0].head ? t.rows[0].cells : null;
          push({ type: 'table', header, rows: (header ? t.rows.slice(1) : t.rows).map((r) => r.cells), caption: t.caption });
        } else visit(ch);
      } else if (tag === 'pre') {
        const code = textOf(ch).replace(/\s+$/, '').replace(/^\n+/, '');
        if (code.trim()) {
          const cls = (ch.attrs.class || '') + ' ' + ((ch.children.find((x) => x.tag === 'code') || { attrs: {} }).attrs.class || '');
          const lang = (cls.match(/(?:language|lang|brush:)[-\s]*([\w+#]+)/i) || [])[1] || '';
          push({ type: 'code', text: code.slice(0, 6000), lang: lang.toLowerCase() });
        }
      } else if (tag === 'dl') {
        const items = [];
        let term = '';
        for (const d of ch.children) {
          if (d.text !== undefined || d._skip) continue;
          const text = squash(inlineText(d).s);
          if (d.tag === 'dt') term = text;
          else if (d.tag === 'dd' && text) { items.push({ text: truncate(term ? term + ': ' + text : text, 700), depth: 0 }); }
        }
        if (items.length) push({ type: 'list', ordered: false, items });
      } else if (tag === 'hr') { /* paragraph break only */ }
      else visit(ch);
      flush();
    }
    flush();
  };
  visit(container);
}

// ---- structured data (JSON-LD) ---------------------------------------------------------------
function flattenLd(node, out, depth = 0) {
  if (!node || depth > 6 || out.length > 200) return;
  if (Array.isArray(node)) { for (const x of node) flattenLd(x, out, depth + 1); return; }
  if (typeof node !== 'object') return;
  if (node['@type']) out.push(node);
  if (node['@graph']) flattenLd(node['@graph'], out, depth + 1);
  for (const k of ['mainEntity', 'mainEntityOfPage', 'hasPart']) if (node[k] && typeof node[k] === 'object') flattenLd(node[k], out, depth + 1);
}
const ldTypes = (o) => [].concat(o['@type'] || []).map((t) => String(t).toLowerCase());
const ldText = (v) => (typeof v === 'string' ? stripTags(v) : (v && typeof v === 'object' && typeof v.text === 'string') ? stripTags(v.text) : (v && typeof v === 'object' && typeof v.name === 'string') ? stripTags(v.name) : '');
function ldName(v) {
  if (!v) return '';
  if (typeof v === 'string') return /^https?:/.test(v) ? '' : v;
  if (Array.isArray(v)) return v.map(ldName).filter(Boolean).slice(0, 3).join(', ');
  return typeof v.name === 'string' ? v.name : '';
}
function ldSteps(v, out = []) {
  for (const s of [].concat(v || [])) {
    if (out.length >= 40) break;
    if (typeof s === 'string') { const t = stripTags(s); if (t) out.push(t); continue; }
    if (!s || typeof s !== 'object') continue;
    if (s.itemListElement) { ldSteps(s.itemListElement, out); continue; }
    const name = typeof s.name === 'string' ? stripTags(s.name) : '';
    const text = typeof s.text === 'string' ? stripTags(s.text) : '';
    const joined = name && text && !text.toLowerCase().startsWith(name.toLowerCase().slice(0, 20)) ? `${name}: ${text}` : (text || name);
    if (joined) out.push(joined);
  }
  return out;
}

/** Harvest prose from embedded application state (e.g. __NEXT_DATA__) — fallback for JS-rendered pages. */
function harvestJson(node, out, depth = 0) {
  if (out.length >= 40 || depth > 12 || node === null) return;
  if (typeof node === 'string') {
    if (node.length >= 160 && node.length < 20000) {
      const spaces = (node.match(/ /g) || []).length;
      if (spaces > node.length / 12 && !/^(https?:|data:|\{|\[|<svg)/.test(node) && !/[{}\\]{3}/.test(node)) out.push(stripTags(node));
    }
    return;
  }
  if (Array.isArray(node)) { for (const x of node.slice(0, 200)) harvestJson(x, out, depth + 1); return; }
  if (typeof node === 'object') for (const k of Object.keys(node).slice(0, 200)) harvestJson(node[k], out, depth + 1);
}

/**
 * Extract a page. `html` is untrusted. Returns structured content + metadata + quality signals.
 */
export function extractPage(html, baseUrl, { lastModified, now = Date.now() } = {}) {
  const root = parseHTML(html);
  const meta = Object.create(null);
  const lds = [];
  const feeds = [];
  const jsonScripts = [];
  let title = '', lang = '', canonical = '', scripts = 0, h1 = '', timeAttr = '', relAuthor = '';
  let body = null;

  walk(root, (el) => {
    const tag = el.tag, a = el.attrs;
    if (tag === 'html') lang = (a.lang || '').toLowerCase().slice(0, 12);
    else if (tag === 'body') { if (!body) body = el; }
    else if (tag === 'title') { if (!title && (!el.parent || el.parent.tag !== 'svg')) title = squash(textOf(el)); }
    else if (tag === 'meta') {
      const key = (a.property || a.name || a.itemprop || '').toLowerCase();
      if (key && a.content && !(key in meta) && a.content.length < 3000) meta[key] = a.content.trim();
    } else if (tag === 'link') {
      const rel = (a.rel || '').toLowerCase();
      if (rel === 'canonical' && a.href) canonical = a.href;
      else if (rel.includes('alternate') && /(rss|atom)\+xml/i.test(a.type || '') && a.href && feeds.length < 6) feeds.push({ url: a.href, type: /atom/i.test(a.type) ? 'atom' : 'rss', title: (a.title || '').slice(0, 120) });
    } else if (tag === 'script') {
      scripts++;
      const type = (a.type || '').toLowerCase();
      if (type === 'application/ld+json' && lds.length < 8) {
        const raw = textOf(el);
        if (raw.length < 400000) { try { flattenLd(JSON.parse(raw.replace(/^\s*<!--|-->\s*$/g, '')), lds); } catch { /* malformed structured data is ignored */ } }
      } else if (type === 'application/json' && jsonScripts.length < 3) jsonScripts.push(el);
      return false;
    } else if (tag === 'time') { if (!timeAttr && a.datetime) timeAttr = a.datetime; }
    else if (tag === 'h1') { if (!h1) h1 = squash(textOf(el)).slice(0, 300); }
    else if (tag === 'a') { if (!relAuthor && (a.rel || '').toLowerCase().includes('author')) relAuthor = squash(textOf(el)).slice(0, 80); }
  });

  const start = body || root;
  measure(start, false);
  const total = start._t || 0;
  markBoilerplate(start, total);
  measure(start, false);                                   // re-measure without boilerplate
  const { node: container, lead } = mainContainer(start);
  const blocks = [];
  LINKS = [];
  if (lead) {                                              // opening paragraphs that sit beside the main body
    const opening = [];
    collectBlocks(lead, opening, { headings: [] });
    blocks.push(...opening.filter((b) => b.type === 'p' && b.text.length >= 60).slice(0, 3));
  }
  collectBlocks(container, blocks, { headings: [] });
  const rawLinks = LINKS;
  LINKS = null;

  // ---- structured data → metadata and extra blocks ----
  const ld = { headline: '', published: '', modified: '', author: '', publisher: '', body: '', description: '', types: [] };
  for (const o of lds) {
    const types = ldTypes(o);
    ld.types.push(...types);
    if (types.some((t) => /article|posting|report|webpage|creativework/.test(t))) {
      ld.headline = ld.headline || ldText(o.headline || o.name);
      ld.published = ld.published || (typeof o.datePublished === 'string' ? o.datePublished : '');
      ld.modified = ld.modified || (typeof o.dateModified === 'string' ? o.dateModified : '');
      ld.author = ld.author || ldName(o.author);
      ld.publisher = ld.publisher || ldName(o.publisher);
      if (typeof o.articleBody === 'string' && o.articleBody.length > ld.body.length) ld.body = o.articleBody;
      ld.description = ld.description || (typeof o.description === 'string' ? stripTags(o.description) : '');
    }
    if (types.includes('howto') || types.includes('recipe')) {
      const steps = ldSteps(o.step || o.recipeInstructions);
      if (steps.length >= 2) blocks.push({ type: 'list', ordered: true, structured: true, items: steps.map((t) => ({ text: truncate(squash(t), 700), depth: 0 })), heading: squash(ldText(o.name) || 'Steps') });
      const ing = [].concat(o.recipeIngredient || []).filter((x) => typeof x === 'string').slice(0, 40);
      if (ing.length >= 2) blocks.push({ type: 'list', ordered: false, structured: true, items: ing.map((t) => ({ text: squash(stripTags(t)), depth: 0 })), heading: squash((ldText(o.name) || '') + ' › Ingredients') });
    }
    if (types.includes('question')) {
      const q = squash(ldText(o.name));
      const ans = [].concat(o.acceptedAnswer || [], o.suggestedAnswer || []).map(ldText).filter(Boolean).slice(0, 3);
      for (const t of ans) if (q && t) blocks.push({ type: 'p', text: truncate(squash(t), 1500), heading: q, structured: true });
    }
  }

  let chars = 0;
  for (const b of blocks) chars += b.text ? b.text.length : b.items ? b.items.reduce((s, it) => s + it.text.length, 0) : b.rows ? b.rows.reduce((s, r) => s + r.join('').length, 0) : 0;

  // ---- fallbacks for pages whose content is rendered by JavaScript ----
  let fallback = '';
  const jsHint = /enable javascript|javascript is (required|disabled)|requires javascript|turn on javascript/i.test(html.slice(0, 200000));
  if (chars < 500) {
    if (ld.body && ld.body.length > 200) {
      for (const para of ld.body.split(/\n+/)) { const t = squash(stripTags(para)); if (t.length >= 40) blocks.push({ type: 'p', text: truncate(t, 2000), heading: '', structured: true }); }
      fallback = 'structured-data';
    }
    if (!fallback) {
      const found = [];
      for (const s of jsonScripts) { const raw = textOf(s); if (raw.length < 1500000) { try { harvestJson(JSON.parse(raw), found); } catch { /* ignore */ } } }
      for (const t of found) { const c = squash(t); if (c.length >= 120) blocks.push({ type: 'p', text: truncate(c, 2000), heading: '', embedded: true }); }
      if (found.length) fallback = 'embedded-state';
    }
    if (!fallback) {
      const ns = [];
      walk(root, (el) => { if (el.tag === 'noscript') { ns.push(el); return false; } });
      for (const el of ns) {
        const sub = parseHTML(textOf(el), { maxNodes: 20000 });      // noscript content may be raw text or parsed nodes
        const target = sub.children.some((x) => x.tag) ? sub : el;
        measure(target, false);
        const before = blocks.length;
        collectBlocks(target, blocks, { headings: [] });
        if (blocks.length > before) fallback = 'noscript';
      }
    }
    const desc = meta.description || meta['og:description'] || ld.description;
    if (!fallback && desc && desc.length > 60) { blocks.push({ type: 'p', text: squash(desc), heading: '', structured: true, metaDescription: true }); fallback = 'meta-description'; }
    chars = 0;
    for (const b of blocks) chars += b.text ? b.text.length : b.items ? b.items.reduce((s, it) => s + it.text.length, 0) : 0;
  }

  // ---- clean, de-duplicate, drop boilerplate phrases ----
  const seen = new Set();
  const clean = [];
  for (const b of blocks) {
    if (b.text !== undefined) {
      b.text = b.type === 'code' ? b.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '') : cleanText(b.text);
      if (!b.text) continue;
      if (b.type === 'p' && b.text.length < 240 && BOILER_TEXT_RE.test(b.text)) continue;
      const k = b.type + hash(b.text);
      if (seen.has(k)) continue;
      seen.add(k);
    } else if (b.items) {
      b.items = b.items.map((it) => ({ ...it, text: cleanText(it.text), ...(it.code ? { code: it.code.map((c) => c.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')) } : {}) })).filter((it) => it.text);
      if (!b.items.length) continue;
      const k = 'l' + hash(b.items.map((it) => it.text).join('|'));
      if (seen.has(k)) continue;
      seen.add(k);
    } else if (b.rows) {
      b.rows = b.rows.map((r) => r.map(cleanText));
      if (b.header) b.header = b.header.map(cleanText);
    }
    if (b.heading) b.heading = cleanText(b.heading);
    if (b.href) { try { const u = new URL(b.href, baseUrl); b.href = /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { b.href = ''; } }
    clean.push(b);
  }
  { const merged = normalizeLists(clean); clean.length = 0; clean.push(...merged); }
  if (!clean.some((b) => b.type === 'list' && b.ordered && b.structured)) clean.push(...numberedSectionLists(clean).slice(0, 3));

  // ---- metadata ----
  const pick = (...keys) => { for (const k of keys) if (meta[k]) return meta[k]; return ''; };
  const ogTitle = pick('og:title', 'twitter:title');
  let finalTitle = squash(ogTitle || ld.headline || '');
  if (!finalTitle) {
    finalTitle = title;
    if (h1 && title.toLowerCase().includes(h1.toLowerCase().slice(0, 40))) finalTitle = h1;
    else {
      const parts = title.split(/\s+[|–—·•:»-]\s+/).filter(Boolean);
      if (parts.length > 1) finalTitle = parts.reduce((a, b) => (b.length > a.length ? b : a));
    }
  }
  finalTitle = finalTitle || h1 || title;
  let host = '';
  try { host = new URL(baseUrl).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  const abs = (href) => { try { const u = new URL(href, baseUrl); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; } };
  const urlDate = (String(baseUrl).match(/\/((?:19|20)\d{2})[/-](\d{1,2})[/-](\d{1,2})(?:[/-]|$)/) || []).slice(1, 4).join('-');
  const dateOf = (...cands) => { for (const c of cands) { const d = parseDate(c); if (plausiblePubDate(d, now)) return d.iso; } return ''; };
  const published = dateOf(ld.published, pick('article:published_time', 'og:article:published_time', 'datepublished', 'date', 'pubdate', 'publishdate', 'publish-date', 'publish_date',
    'dc.date.issued', 'dc.date', 'dcterms.created', 'dcterms.date', 'parsely-pub-date', 'sailthru.date', 'article.published', 'citation_publication_date', 'citation_date'), timeAttr, urlDate);
  const modified = dateOf(ld.modified, pick('article:modified_time', 'og:updated_time', 'datemodified', 'lastmod', 'last-modified', 'dcterms.modified', 'revised'), lastModified);
  const authorMeta = pick('author', 'article:author', 'parsely-author', 'citation_author', 'dc.creator', 'twitter:creator');
  const author = squash(ld.author || (/^https?:/.test(authorMeta) ? '' : authorMeta) || relAuthor).slice(0, 120);

  const types = new Set(ld.types);
  const ogType = (meta['og:type'] || '').toLowerCase();
  const pageType = types.has('newsarticle') || types.has('reportagenewsarticle') || types.has('liveblogposting') ? 'news'
    : types.has('howto') || types.has('recipe') ? 'howto'
    : types.has('faqpage') ? 'faq' : types.has('qapage') ? 'qa'
    : types.has('scholarlyarticle') ? 'scholarly'
    : types.has('blogposting') ? 'blog'
    : (types.has('article') || types.has('techarticle') || ogType === 'article') ? 'article' : 'page';

  return {
    title: cleanText(finalTitle).slice(0, 300),
    site: cleanText(pick('og:site_name', 'application-name') || ld.publisher || host).slice(0, 80),
    description: cleanText(pick('description', 'og:description') || ld.description).slice(0, 500),
    author: cleanText(author), published, modified, lang, pageType,
    robots: String(meta.robots || '').toLowerCase().slice(0, 120),
    canonical: abs(canonical),
    feeds: feeds.map((f) => ({ ...f, url: abs(f.url) })).filter((f) => f.url),
    // links inside the main text (navigation, footers and link lists were dropped before): leads for further reading
    links: (() => { const seen = new Set(), out = []; for (const l of rawLinks) { const u = abs(l.href).replace(/#.*$/, ''); const text = squash(l.text); if (!u || seen.has(u) || text.length < 3) continue; seen.add(u); out.push(l.ctx ? { url: u, text, ctx: squash(l.ctx) } : { url: u, text }); if (out.length >= 250) break; } return out; })(),
    ogType, ldTypes: [...types].slice(0, 12),
    blocks: clean,
    quality: {
      chars, blocks: clean.length, fallback,
      jsRequired: chars < 500 && (scripts >= 4 || jsHint),
      truncated: !!root.truncated,
      linkDensity: total ? Math.round(((start._l || 0) / total) * 100) / 100 : 0,
    },
  };
}

/** Extract blocks from an HTML fragment delivered by an API (no page chrome, no metadata). */
export function extractFragment(html) {
  const root = parseHTML(html, { maxNodes: 40000 });
  measure(root, false);
  const blocks = [];
  collectBlocks(root, blocks, { headings: [] });
  const out = [];
  for (const b of blocks) {
    if (b.text !== undefined) { b.text = b.type === 'code' ? b.text : cleanText(b.text); if (!b.text) continue; }
    else if (b.items) { b.items = b.items.map((it) => ({ ...it, text: cleanText(it.text) })).filter((it) => it.text); if (!b.items.length) continue; }
    out.push(b);
  }
  return out;
}
