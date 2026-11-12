// INFINI AI — brain: pattern templates.
//   (a|b c)   one of the alternatives          [a|b]   optional (same as (a|b)?)
//   (a|b)?    optional group                    {x}     slot: captures one or more words
// Templates are expanded into plain phrases (exact lookup) or compiled into a regular expression when they contain a slot.

/** Parse a template into a tree: {seq:[node]}, node = string | {alt:[seq], opt:boolean} | {slot:name}. */
export function parseTemplate(src) {
  let i = 0;
  const s = src;
  function seq(stop) {
    const out = [];
    let word = '';
    const flush = () => { if (word) { out.push(word); word = ''; } };
    while (i < s.length) {
      const ch = s[i];
      if (stop.includes(ch)) break;
      if (ch === '(' || ch === '[') {
        flush();
        const close = ch === '(' ? ')' : ']';
        i++;
        const alts = [seq('|' + close)];
        while (s[i] === '|') { i++; alts.push(seq('|' + close)); }
        if (s[i] !== close) throw new Error(`unbalanced "${ch}" in pattern: ${src}`);
        i++;
        let opt = ch === '[';
        if (s[i] === '?') { opt = true; i++; }
        out.push({ alt: alts, opt });
      } else if (ch === '{') {
        flush();
        const j = s.indexOf('}', i);
        if (j < 0) throw new Error(`unbalanced "{" in pattern: ${src}`);
        out.push({ slot: s.slice(i + 1, j).trim() || 'x' });
        i = j + 1;
      } else if (ch === ')' || ch === ']' || ch === '|') { throw new Error(`unexpected "${ch}" in pattern: ${src}`); }
      else if (/\s/.test(ch)) { flush(); i++; }
      else if (ch === '?' ) { flush(); i++; }                // a stray "?" after a space: ignore
      else { word += ch; i++; }
    }
    flush();
    return out;
  }
  const tree = seq('');
  if (i < s.length) throw new Error(`unexpected "${s[i]}" in pattern: ${src}`);
  return tree;
}

export const hasSlot = (tree) => tree.some((n) => typeof n === 'object' && (n.slot || (n.alt && n.alt.some(hasSlot))));

/** All plain phrases a slot-free template stands for. `limit` guards against accidental explosions. */
export function expand(tree, limit = 20000) {
  let acc = [''];
  for (const node of tree) {
    let parts;
    if (typeof node === 'string') parts = [node];
    else if (node.alt) { parts = node.opt ? [''] : []; for (const a of node.alt) for (const p of expand(a, limit)) parts.push(p); }
    else throw new Error('slot in a template that is being expanded');
    const next = [];
    for (const a of acc) for (const p of parts) { next.push(p ? (a ? a + ' ' + p : p) : a); if (next.length > limit) throw new Error('pattern expands to too many phrases'); }
    acc = next;
  }
  return acc;
}

/** How many phrases a slot-free template stands for (without building them). */
export function countExpansions(tree) {
  let n = 1;
  for (const node of tree) {
    if (typeof node === 'string') continue;
    if (node.slot) return Infinity;
    let k = node.opt ? 1 : 0;
    for (const a of node.alt) k += countExpansions(a);
    n *= k;
    if (n > 1e9) return n;
  }
  return n;
}

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Regular expression source for a template; every word is preceded by exactly one space, so match it against " " + text. */
export function toRegexSource(tree, names = []) {
  let out = '';
  for (const node of tree) {
    if (typeof node === 'string') out += ' ' + esc(node);
    else if (node.slot) { const n = names.includes(node.slot) ? node.slot + names.length : node.slot; names.push(n); out += ` (?<${n}>\\S(?:.*?\\S)?)`; }
    else { const alts = node.alt.map((a) => toRegexSource(a, names)); out += `(?:${alts.join('|')})${node.opt || alts.includes('') ? '?' : ''}`; }
  }
  return out;
}
export function compile(tree) { return new RegExp('^' + toRegexSource(tree) + '$'); }

/** Rewrite the literal words of a template with `fn(phrase) -> phrase` (used at build time to store templates in normalised form). */
export function mapLiterals(tree, fn) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length) { const t = fn(run.join(' ')); if (t) out.push(...t.split(' ')); run = []; } };
  for (const node of tree) {
    if (typeof node === 'string') run.push(node);
    else { flush(); out.push(node.alt ? { alt: node.alt.map((a) => mapLiterals(a, fn)), opt: node.opt } : node); }
  }
  flush();
  return out;
}
export function stringify(tree) {
  return tree.map((n) => (typeof n === 'string' ? n : n.slot ? `{${n.slot}}` : `(${n.alt.map(stringify).join('|')})${n.opt ? '?' : ''}`)).join(' ');
}
