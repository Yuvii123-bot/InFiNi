// INFINI AI — RSS 2.0 / Atom / RDF feed parser (uses the engine's own XML tokenizer).

import { parseHTML, textOf, stripTags, walk } from './html.js';
import { parseDate } from '../util/dates.js';
import { cleanText, truncate } from '../util/text.js';

const child = (el, ...names) => el.children.find((c) => c.tag && names.includes(c.tag.toLowerCase()));
const txt = (el) => (el ? cleanText(stripTags(textOf(el))) : '');

export function parseFeed(xml, baseUrl) {
  const root = parseHTML(xml, { xml: true, maxNodes: 60000 });
  const items = [];
  let title = '';
  walk(root, (el) => {
    const tag = el.tag.toLowerCase();
    if ((tag === 'channel' || tag === 'feed') && !title) title = txt(child(el, 'title'));
    if (tag !== 'item' && tag !== 'entry') return;
    if (items.length >= 80) return false;
    let url = '';
    for (const c of el.children) {
      if (!c.tag || c.tag.toLowerCase() !== 'link') continue;
      const rel = (c.attrs.rel || 'alternate').toLowerCase();
      if (c.attrs.href) { if (rel === 'alternate' || !url) url = c.attrs.href; } else if (!url) url = textOf(c).trim();
    }
    if (!url) { const g = child(el, 'guid', 'id'); const t = g ? textOf(g).trim() : ''; if (/^https?:\/\//.test(t)) url = t; }
    try { const u = new URL(url, baseUrl); url = /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { url = ''; }
    const date = parseDate(textOf(child(el, 'pubdate', 'published', 'dc:date', 'updated', 'date') || { text: '' }).trim());
    const authorEl = child(el, 'dc:creator', 'author');
    const summary = txt(child(el, 'description', 'summary', 'content:encoded', 'content'));
    const t = txt(child(el, 'title'));
    if (t && url) items.push({ title: truncate(t, 300), url, summary: truncate(summary, 900), published: date ? date.iso : '', ms: date ? date.ms : 0, author: truncate(txt(authorEl && (child(authorEl, 'name') || authorEl)), 80) });
    return false;
  });
  return { title, items };
}
