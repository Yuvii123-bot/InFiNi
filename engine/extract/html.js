// INFINI AI — a small, forgiving HTML/XML parser (tokenizer + tree builder).
// A real state-machine parser, not regex scraping: handles comments, CDATA, raw-text elements,
// unquoted/malformed attributes, implied end tags (p, li, td, tr, dt/dd, option) and mis-nested markup.
// ~7 KB of source, no dependencies, works in Node and browsers.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'li', 'dd', 'dt']);
const NO_SELF_CLOSE = new Set(['div', 'span', 'p', 'a', 'li', 'td', 'th', 'tr', 'table', 'section', 'article', 'ul', 'ol', 'body', 'html', 'head',
  'i', 'b', 'em', 'strong', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'label', 'form', 'main', 'nav', 'header', 'footer', 'aside']);
const TABLE_TAGS = new Set(['table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup']);
const SCOPE = new Set(['table', 'td', 'th', 'caption', 'template', 'object']);
const B_LIST = new Set(['ul', 'ol', 'menu']), B_DL = new Set(['dl']), B_TABLE = new Set(['table']), B_ROW = new Set(['tr', 'table']), B_SEL = new Set(['select', 'datalist']);
const B_P = new Set(['table', 'td', 'th', 'caption', 'button', 'template', 'object']);

// ---- character references --------------------------------------------------------------------
const NAMED = Object.create(null);
(function buildEntities() {
  const latin1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot ' +
    'cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute ' +
    'Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde ' +
    'auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave ' +
    'uacute ucirc uuml yacute thorn yuml').split(' ');
  latin1.forEach((name, i) => { NAMED[name] = String.fromCharCode(0xa0 + i); });
  const greekU = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho _ Sigma Tau Upsilon Phi Chi Psi Omega'.split(' ');
  greekU.forEach((name, i) => { if (name !== '_') NAMED[name] = String.fromCharCode(0x391 + i); });
  const greekL = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega'.split(' ');
  greekL.forEach((name, i) => { NAMED[name] = String.fromCharCode(0x3b1 + i); });
  const misc = {
    quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', circ: 'ˆ', tilde: '˜',
    ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', lrm: '', rlm: '', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“',
    rdquo: '”', bdquo: '„', dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›',
    oline: '‾', frasl: '⁄', euro: '€', trade: '™', larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', hArr: '⇔',
    forall: '∀', part: '∂', exist: '∃', empty: '∅', nabla: '∇', isin: '∈', notin: '∉', ni: '∋', prod: '∏', sum: '∑', minus: '−', lowast: '∗',
    radic: '√', prop: '∝', infin: '∞', ang: '∠', and: '∧', or: '∨', cap: '∩', cup: '∪', int: '∫', there4: '∴', sim: '∼', cong: '≅', asymp: '≈',
    ne: '≠', equiv: '≡', le: '≤', ge: '≥', sub: '⊂', sup: '⊃', nsub: '⊄', sube: '⊆', supe: '⊇', oplus: '⊕', otimes: '⊗', perp: '⊥', sdot: '⋅',
    hyphen: '-', dash: '‐', nbhyp: '‑', colon: ':', comma: ',', period: '.', lpar: '(', rpar: ')', lsqb: '[', rsqb: ']', sol: '/', num: '#',
    percnt: '%', plus: '+', equals: '=', quest: '?', excl: '!', semi: ';', ast: '*', commat: '@', dollar: '$', lowbar: '_', vert: '|', Tab: '\t', NewLine: '\n',
  };
  for (const k in misc) NAMED[k] = misc[k];
})();
const WIN1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };

export function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,10});?/g, (m, e) => {
    if (e.charCodeAt(0) === 35) {
      const code = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (WIN1252[code]) return WIN1252[code];
      if (code === 9 || code === 10 || code === 13) return ' ';
      if (code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || (code >= 0x7f && code <= 0x9f)) return '';
      return String.fromCodePoint(code);
    }
    const r = NAMED[e] !== undefined ? NAMED[e] : NAMED[e.toLowerCase()];
    return r !== undefined ? r : m;
  });
}

const isSpace = (c) => c === 32 || c === 10 || c === 9 || c === 13 || c === 12;
const rawCloseRe = Object.create(null);

/**
 * Parse markup into a light tree: element = {tag, attrs, children, parent}; text node = {text}.
 * xml:true disables the HTML-specific rules (void elements, raw text, implied end tags) for RSS/Atom.
 */
export function parseHTML(input, { xml = false, maxNodes = 150000, maxDepth = 220 } = {}) {
  input = String(input || '');
  const root = { tag: '#root', attrs: Object.create(null), children: [], parent: null };
  const stack = [root];
  let cur = root, nodes = 0, i = 0;
  const n = input.length;

  const addText = (t, raw) => {
    if (!t) return;
    const txt = raw ? t : decodeEntities(t);
    const last = cur.children[cur.children.length - 1];
    if (last && last.text !== undefined) last.text += txt; else { cur.children.push({ text: txt }); nodes++; }
  };
  const closeIfOpen = (tag, barrier) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag;
      if (t === tag) { stack.length = k; cur = stack[k - 1]; return true; }
      if (barrier.has(t)) return false;
    }
    return false;
  };
  const closeTag = (tag) => {
    const tableTag = TABLE_TAGS.has(tag);
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag;
      if (t === tag) { stack.length = k; cur = stack[k - 1]; return; }
      if (!xml && !tableTag && SCOPE.has(t)) return;         // a stray end tag may not break out of a table cell
    }
  };
  const append = (tag, attrs, push) => {
    const node = { tag, attrs, children: [], parent: cur };
    cur.children.push(node); nodes++;
    if (push && stack.length < maxDepth) { stack.push(node); cur = node; }
    return node;
  };

  while (i < n && nodes < maxNodes) {
    const lt = input.indexOf('<', i);
    if (lt < 0) { addText(input.slice(i)); break; }
    if (lt > i) addText(input.slice(i, lt));
    const c1 = input.charCodeAt(lt + 1);

    if (c1 === 33) {                                           // "<!"
      if (input.startsWith('<!--', lt)) { const e = input.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
      if (input.startsWith('<![CDATA[', lt)) { const e = input.indexOf(']]>', lt + 9); addText(input.slice(lt + 9, e < 0 ? n : e), true); i = e < 0 ? n : e + 3; continue; }
      const e = input.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue;
    }
    if (c1 === 63) { const e = input.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }   // "<?xml … ?>"
    if (c1 === 47) {                                           // end tag
      const gt = input.indexOf('>', lt + 2);
      if (gt < 0) { i = n; break; }
      let name = input.slice(lt + 2, gt).trim().split(/\s/)[0];
      if (!xml) name = name.toLowerCase();
      if (name === 'br' && !xml) append('br', Object.create(null), false); else if (name) closeTag(name);
      i = gt + 1; continue;
    }
    if (!((c1 >= 65 && c1 <= 90) || (c1 >= 97 && c1 <= 122))) { addText('<'); i = lt + 1; continue; }   // a literal "<"

    // ---- start tag ----
    let j = lt + 1;
    while (j < n) { const c = input.charCodeAt(j); if (isSpace(c) || c === 47 || c === 62) break; j++; }
    let tag = input.slice(lt + 1, j);
    if (!xml) tag = tag.toLowerCase();
    const attrs = Object.create(null);
    let selfClose = false, count = 0;
    while (j < n) {
      while (j < n && isSpace(input.charCodeAt(j))) j++;
      if (j >= n) break;
      const ch = input.charCodeAt(j);
      if (ch === 62) { j++; break; }
      if (ch === 47) { if (input.charCodeAt(j + 1) === 62) { selfClose = true; j += 2; break; } j++; continue; }
      let k = j;
      while (k < n) { const c = input.charCodeAt(k); if (isSpace(c) || c === 61 || c === 62 || c === 47) break; k++; }
      if (k === j) { j++; continue; }
      const name = input.slice(j, k).toLowerCase();
      j = k;
      while (j < n && isSpace(input.charCodeAt(j))) j++;
      let val = '';
      if (input.charCodeAt(j) === 61) {
        j++;
        while (j < n && isSpace(input.charCodeAt(j))) j++;
        const q = input.charCodeAt(j);
        if (q === 34 || q === 39) {
          const e = input.indexOf(q === 34 ? '"' : "'", j + 1);
          if (e < 0) { val = input.slice(j + 1); j = n; } else { val = input.slice(j + 1, e); j = e + 1; }
        } else {
          k = j;
          while (k < n) { const c = input.charCodeAt(k); if (isSpace(c) || c === 62) break; k++; }
          val = input.slice(j, k); j = k;
        }
      }
      if (count < 60 && !(name in attrs)) { attrs[name] = decodeEntities(val.length > 6000 ? val.slice(0, 6000) : val); count++; }
    }

    if (xml) { append(tag, attrs, !selfClose); i = j; continue; }

    if (RAW.has(tag)) {                                        // raw text: no markup inside
      const re = rawCloseRe[tag] || (rawCloseRe[tag] = new RegExp('</' + tag + '\\s*>', 'gi'));
      re.lastIndex = j;
      const m = selfClose ? null : re.exec(input);
      const end = m ? m.index : n;
      if (CLOSES_P.has(tag)) closeIfOpen('p', B_P);
      const node = append(tag, attrs, false);
      const raw = selfClose ? '' : input.slice(j, end);
      if (raw) { node.children.push({ text: (tag === 'title' || tag === 'textarea') ? decodeEntities(raw) : raw }); nodes++; }
      i = selfClose ? j : (m ? m.index + m[0].length : n);
      continue;
    }

    // implied end tags
    if (CLOSES_P.has(tag)) closeIfOpen('p', B_P);
    if (tag === 'li') closeIfOpen('li', B_LIST);
    else if (tag === 'dt' || tag === 'dd') { closeIfOpen('dd', B_DL); closeIfOpen('dt', B_DL); }
    else if (tag === 'tr') closeIfOpen('tr', B_TABLE);
    else if (tag === 'td' || tag === 'th') { closeIfOpen('td', B_ROW); closeIfOpen('th', B_ROW); }
    else if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot') { closeIfOpen('tbody', B_TABLE); closeIfOpen('thead', B_TABLE); closeIfOpen('tfoot', B_TABLE); }
    else if (tag === 'option' || tag === 'optgroup') closeIfOpen('option', B_SEL);
    else if (tag === 'body') closeIfOpen('head', B_TABLE);

    append(tag, attrs, !(VOID.has(tag) || (selfClose && !NO_SELF_CLOSE.has(tag))));
    i = j;
  }
  root.truncated = nodes >= maxNodes;
  return root;
}

// ---- tree helpers ----------------------------------------------------------------------------
export function walk(node, fn) {
  // Iterative pre-order traversal; fn may return false to skip a subtree.
  const st = [node];
  while (st.length) {
    const cur = st.pop();
    if (cur.text !== undefined) continue;
    if (cur !== node && fn(cur) === false) continue;
    for (let k = cur.children.length - 1; k >= 0; k--) st.push(cur.children[k]);
  }
}
export function findAll(node, pred, limit = Infinity) {
  const out = [];
  walk(node, (el) => { if (pred(el)) { out.push(el); if (out.length >= limit) return false; } });
  return out;
}
export function find(node, pred) { return findAll(node, pred, 1)[0] || null; }
export function textOf(node) {
  if (node.text !== undefined) return node.text;
  let out = '';
  const st = [node];
  while (st.length) {
    const cur = st.pop();
    if (cur.text !== undefined) { out += cur.text; continue; }
    for (let k = cur.children.length - 1; k >= 0; k--) st.push(cur.children[k]);
  }
  return out;
}
export function hasClass(el, name) { const c = el.attrs.class; return !!c && (' ' + c + ' ').includes(' ' + name + ' '); }

/** Strip markup from an HTML fragment and return plain text (used for feed descriptions, JSON-LD strings). */
export function stripTags(html) {
  if (!html) return '';
  const s = String(html);
  if (s.indexOf('<') < 0) return decodeEntities(s).replace(/\s+/g, ' ').trim();
  const root = parseHTML(s, { maxNodes: 20000 });
  let out = '';
  const st = [root];
  while (st.length) {
    const cur = st.pop();
    if (cur.text !== undefined) { out += cur.text; continue; }
    if (cur.tag === 'script' || cur.tag === 'style') continue;
    if (cur.tag === 'br' || cur.tag === 'p' || cur.tag === 'div' || cur.tag === 'li') out += ' ';
    for (let k = cur.children.length - 1; k >= 0; k--) st.push(cur.children[k]);
  }
  return out.replace(/\s+/g, ' ').trim();
}
