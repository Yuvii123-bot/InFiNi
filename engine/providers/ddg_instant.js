// DuckDuckGo Instant Answer API (documented, keyless): entity abstracts, infobox facts and disambiguation.
// Its abstracts are derived from Wikipedia, so evidence from here is attributed to — and counted as the same
// origin as — the Wikipedia article it points to. It is used as an entity resolver that costs no Wikimedia API budget.

import { enc } from './base.js';
import { squash } from '../util/text.js';

export default {
  id: 'ddg_instant', label: 'DuckDuckGo Instant Answers', kind: 'encyclopedia', keyless: true, documented: true, defaultOn: true,
  note: 'Entity abstracts/infobox (Wikipedia-derived). Not a web search.',
  available: () => true,

  /** Resolve a name to {type:'article'|'disambiguation'|'none', title, url, abstract, source, infobox[], related[]}. */
  async entity(name, ctx) {
    const { json } = await ctx.http.getJSON(`https://api.duckduckgo.com/?q=${enc(name)}&format=json&no_html=1&skip_disambig=0&t=infiniai`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 4500, fresh: ctx.noCache, ttlMs: 60 * 60000, accept202: true, accept: 'any' });
    const type = json.Type === 'A' ? 'article' : json.Type === 'D' ? 'disambiguation' : 'none';
    const infobox = [];
    for (const c of (json.Infobox && json.Infobox.content) || []) {
      if (c && c.data_type === 'string' && typeof c.value === 'string' && c.label && c.value.length < 300) infobox.push({ label: squash(c.label), value: squash(c.value) });
    }
    const related = [];
    const visit = (arr) => { for (const t of arr || []) { if (t.Topics) visit(t.Topics); else if (t.Text && t.FirstURL) related.push({ text: squash(t.Text), url: t.FirstURL.replace('https://duckduckgo.com/', 'https://en.wikipedia.org/wiki/') }); } };
    visit(json.RelatedTopics);
    return {
      type, title: squash(json.Heading || ''), url: json.AbstractURL || '', abstract: squash(json.AbstractText || ''), source: json.AbstractSource || '',
      infobox: infobox.slice(0, 30), related: related.slice(0, 12),
    };
  },

  async search(query, ctx) {
    const e = await this.entity(query, ctx);
    if (e.type !== 'article' || !e.url || !e.abstract) return [];
    const blocks = [{ type: 'p', text: e.abstract, heading: '' }];
    if (e.infobox.length) blocks.push({ type: 'table', header: null, rows: e.infobox.map((r) => [r.label, r.value]), caption: 'Infobox', heading: 'Infobox' });
    return [{
      title: e.title, url: e.url, snippet: e.abstract.slice(0, 320), provider: 'ddg_instant', kind: 'encyclopedia',
      content: { title: e.title, site: e.source === 'Wikipedia' ? 'Wikipedia' : (e.source || 'DuckDuckGo'), blocks, partial: true, pageType: 'reference', via: 'ddg-instant-answer' },
    }];
  },
};
