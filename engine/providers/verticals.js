// Vertical knowledge sources with documented public APIs: Stack Exchange (programming Q&A), MDN (web docs),
// arXiv (preprints), Hacker News (technology news), GDELT (global news index).

import { enc, ProviderError, FRESH_DAYS } from './base.js';
import { extractFragment } from '../extract/readable.js';
import { parseHTML, walk, textOf, stripTags, decodeEntities } from '../extract/html.js';
import { squash, truncate } from '../util/text.js';
import { parseDate } from '../util/dates.js';

export const stackexchange = {
  id: 'stackexchange', label: 'Stack Exchange', kind: 'qa', keyless: true, documented: true, defaultOn: true,
  note: 'Stack Exchange API v2.3 (300 requests/day per IP without a key; set STACKEXCHANGE_KEY for more). Content is CC BY-SA.',
  available: () => true,
  async search(query, ctx) {
    const key = ctx.cfg && ctx.cfg.keys && ctx.cfg.keys.stackexchange ? `&key=${enc(ctx.cfg.keys.stackexchange)}` : '';
    const base = 'https://api.stackexchange.com/2.3';
    const opts = { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 6000, fresh: ctx.noCache, ttlMs: 30 * 60000 };
    const site = /^[a-z.]{2,40}$/.test(ctx.site || '') ? ctx.site : 'stackoverflow';
    const siteName = site === 'stackoverflow' ? 'Stack Overflow' : `${site.charAt(0).toUpperCase()}${site.slice(1)} Stack Exchange`;
    const { json } = await ctx.http.getJSON(`${base}/search/advanced?order=desc&sort=relevance&q=${enc(query)}&site=${site}&pagesize=${Math.min(ctx.limit || 4, 6)}&answers=1&filter=withbody${key}`, opts);
    if (json.error_id) throw new ProviderError(json.error_message || 'Stack Exchange API error', 'api_error');
    const questions = (json.items || []).filter((q) => q.answer_count > 0).slice(0, 4);
    if (!questions.length) return [];
    const ans = await ctx.http.getJSON(`${base}/questions/${questions.map((q) => q.question_id).join(';')}/answers?order=desc&sort=votes&site=${site}&pagesize=12&filter=withbody${key}`, opts);
    const byQ = new Map();
    for (const a of ans.json.items || []) { if (!byQ.has(a.question_id)) byQ.set(a.question_id, []); byQ.get(a.question_id).push(a); }
    return questions.map((q) => {
      const title = squash(decodeEntities(q.title || ''));
      const blocks = [{ type: 'heading', level: 1, text: title, heading: '' }];
      const answers = (byQ.get(q.question_id) || []).sort((a, b) => (b.is_accepted - a.is_accepted) || (b.score - a.score)).slice(0, 2);
      for (const a of answers) {
        const label = `${a.is_accepted ? 'Accepted answer' : 'Answer'} (score ${a.score})`;
        for (const b of extractFragment(a.body || '')) blocks.push({ ...b, heading: label });
      }
      const top = answers[0];
      return {
        title, url: q.link, provider: 'stackexchange', kind: 'qa',
        snippet: truncate(squash(stripTags(top ? top.body : q.body || '')), 300),
        date: parseDate(q.last_activity_date || q.creation_date)?.iso || '',
        content: { title, site: siteName, blocks, pageType: 'qa', via: 'api', published: parseDate(q.creation_date)?.iso || '', modified: parseDate(q.last_activity_date)?.iso || '', meta: { score: q.score, accepted: answers.some((a) => a.is_accepted), topScore: top ? top.score : 0 } },
      };
    }).filter((r) => r.content.blocks.length > 1);
  },
};

export const mdn = {
  id: 'mdn', label: 'MDN Web Docs', kind: 'docs', keyless: true, documented: true, defaultOn: true,
  note: 'MDN search API; documentation pages are then fetched normally.',
  available: () => true,
  async search(query, ctx) {
    const { json } = await ctx.http.getJSON(`https://developer.mozilla.org/api/v1/search?q=${enc(query)}&locale=en-US&size=${Math.min(ctx.limit || 4, 8)}`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 5000, fresh: ctx.noCache });
    return (json.documents || []).map((d) => ({ title: squash(d.title), url: 'https://developer.mozilla.org' + d.mdn_url, snippet: squash(d.summary || ''), provider: 'mdn', kind: 'docs', score: d.score }));
  },
};

export const arxiv = {
  id: 'arxiv', label: 'arXiv', kind: 'academic', keyless: true, documented: true, defaultOn: true,
  note: 'arXiv API (Atom). Abstracts are primary research sources (preprints, not necessarily peer reviewed).',
  available: () => true,
  async search(query, ctx) {
    const q = query.replace(/["()]/g, ' ').trim().split(/\s+/).slice(0, 8).map((w) => 'all:' + w).join('+AND+');
    const res = await ctx.http.getText(`https://export.arxiv.org/api/query?search_query=${q.replace(/[^\w:+.-]/g, encodeURIComponent)}&max_results=${Math.min(ctx.limit || 4, 8)}&sortBy=relevance`, { accept: 'xml', signal: ctx.signal, timeoutMs: ctx.timeoutMs || 7000, hostLimit: 1, fresh: ctx.noCache });
    const root = parseHTML(res.text, { xml: true });
    const out = [];
    walk(root, (el) => {
      if (el.tag !== 'entry') return;
      const get = (name) => { const c = el.children.find((x) => x.tag === name); return c ? squash(textOf(c)) : ''; };
      const authors = el.children.filter((x) => x.tag === 'author').map((a) => squash(textOf(a))).slice(0, 4);
      const title = get('title'), summary = get('summary'), id = get('id').replace(/^http:/, 'https:');
      if (title && summary && id) out.push({
        title, url: id, snippet: truncate(summary, 300), provider: 'arxiv', kind: 'academic', date: parseDate(get('published'))?.iso || '',
        content: { title, site: 'arXiv', author: authors.join(', '), published: parseDate(get('published'))?.iso || '', modified: parseDate(get('updated'))?.iso || '', blocks: [{ type: 'p', text: summary, heading: 'Abstract' }], pageType: 'scholarly', via: 'api', partial: true },
      });
      return false;
    });
    return out;
  },
};

export const hackernews = {
  id: 'hackernews', label: 'Hacker News', kind: 'news', keyless: true, documented: true, defaultOn: true,
  note: 'HN Search API (Algolia). Returns links to stories; the linked pages are fetched normally.',
  available: () => true,
  async search(query, ctx) {
    const days = FRESH_DAYS[ctx.fresh];
    const since = days ? `&numericFilters=created_at_i>${Math.floor((ctx.now || Date.now()) / 1000) - days * 86400}` : '';
    const { json } = await ctx.http.getJSON(`https://hn.algolia.com/api/v1/search?query=${enc(query)}&tags=story&hitsPerPage=${Math.min(ctx.limit || 6, 10)}${since}`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 5000, fresh: ctx.noCache, ttlMs: 5 * 60000 });
    return (json.hits || []).filter((h) => h.title && /^https?:\/\//.test(h.url || '')).map((h) => ({ title: squash(h.title.replace(/^(Show|Ask|Launch|Tell) HN:\s*/i, '')), url: h.url, snippet: truncate(squash(stripTags(h.story_text || '')), 300), provider: 'hackernews', kind: 'news', date: h.created_at || '', meta: { points: h.points } }));
  },
};

export const gdelt = {
  id: 'gdelt', label: 'GDELT', kind: 'news', keyless: true, documented: true, defaultOn: true,
  note: 'GDELT DOC 2.0 API — global news index. Often slow (5–15 s); used only for news questions and never waited on for long.',
  available: () => true,
  async search(query, ctx) {
    const span = { day: '1d', week: '7d', month: '1m' }[ctx.fresh] || '3d';
    const q = query.replace(/["()]/g, ' ').trim() + ' sourcelang:english';
    const { json } = await ctx.http.getJSON(`https://api.gdeltproject.org/api/v2/doc/doc?query=${enc(q)}&mode=artlist&format=json&maxrecords=${Math.min(ctx.limit || 12, 25)}&timespan=${span}&sort=datedesc`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 14000, hostLimit: 1, fresh: ctx.noCache, ttlMs: 5 * 60000 });
    return (json.articles || []).filter((a) => /^https?:/.test(a.url) && a.title).map((a) => ({ title: squash(a.title), url: a.url, snippet: '', provider: 'gdelt', kind: 'news', date: parseDate(a.seendate)?.iso || '', meta: { country: a.sourcecountry } }));
  },
};
