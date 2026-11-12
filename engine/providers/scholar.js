// INFINI AI — open scholarly indexes with documented, keyless APIs.
//   openalex   : OpenAlex (CC0 metadata for ~250 million works: titles, abstracts, citation counts, open-access links)
//   europepmc  : Europe PMC (life-science literature: abstracts, publication types, and the full text of open-access articles)
// One request returns dozens of abstracts, so these two are how a research run can take in hundreds of studies quickly.
// An abstract is a summary written by the authors: documents built from it are marked "abstract only" until the full
// text has been read as well.

import { enc, ProviderError } from './base.js';
import { parseHTML, textOf, stripTags, decodeEntities } from '../extract/html.js';
import { squash, truncate } from '../util/text.js';

const opts = (ctx, extra) => ({ signal: ctx.signal, timeoutMs: ctx.timeoutMs || 8000, fresh: ctx.noCache, ttlMs: 30 * 60000, maxBytes: 3_000_000, ...extra });
const cleanDoi = (d) => String(d || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim().toLowerCase();
const yearOf = (d) => (String(d || '').match(/^(\d{4})/) || [])[1] || '';

/** OpenAlex stores abstracts as an inverted index (word → positions); this puts the words back in order. */
export function invertedToText(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const words = [];
  let n = 0;
  for (const [w, pos] of Object.entries(inv)) { if (!Array.isArray(pos)) continue; for (const p of pos) { if (Number.isInteger(p) && p >= 0 && p < 4000) { words[p] = w; n++; } } if (n > 4000) break; }
  return squash(words.filter(Boolean).join(' '));
}

// Publication types as the indexes report them → the study designs shown in the evidence overview.
const STUDY_FROM_TYPE = [
  [/meta-?analysis/i, 'meta-analysis'], [/systematic review/i, 'systematic review'], [/randomi[sz]ed controlled trial/i, 'randomised trial'], [/clinical trial/i, 'clinical trial'],
  [/practice guideline|guideline|consensus/i, 'guideline'], [/case reports?/i, 'case report'], [/observational study|cohort|cross-sectional/i, 'observational study'],
  [/review/i, 'review'], [/preprint/i, 'preprint'], [/editorial|comment|letter|news/i, 'commentary'],
];
export function studyFromTypes(types) {
  const all = [].concat(types || []).join(' | ');
  for (const [re, label] of STUDY_FROM_TYPE) if (re.test(all)) return label;
  return '';
}

function oaWork(w) {
  const abstract = invertedToText(w.abstract_inverted_index);
  const title = squash(stripTags(decodeEntities(String(w.title || w.display_name || ''))));
  const doi = cleanDoi(w.doi);
  const loc = w.primary_location || {};
  const venue = squash((loc.source && loc.source.display_name) || '');
  const landing = typeof loc.landing_page_url === 'string' && /^https?:\/\//.test(loc.landing_page_url) ? loc.landing_page_url : '';
  const url = doi ? `https://doi.org/${doi}` : landing || (typeof w.id === 'string' ? w.id : '');
  if (!title || !/^https?:\/\//.test(url)) return null;
  const authors = (w.authorships || []).slice(0, 4).map((a) => a && a.author && a.author.display_name).filter(Boolean);
  const oa = w.open_access || {};
  const published = /^\d{4}-\d{2}-\d{2}$/.test(w.publication_date || '') ? w.publication_date : w.publication_year ? String(w.publication_year) : '';
  const meta = { work: doi || String(w.id || '').replace(/^https?:\/\/openalex\.org\//, 'oa:'), doi, year: Number(w.publication_year) || 0, citedBy: Number(w.cited_by_count) || 0, type: String(w.type || ''), venue, oa: !!oa.is_oa, oaUrl: /^https?:\/\//.test(oa.oa_url || '') ? oa.oa_url : '', study: studyFromTypes([w.type]) || studyFromTypes([title]) };
  return {
    title, url, snippet: truncate(abstract, 320), provider: 'openalex', kind: 'academic', date: published, meta,
    content: abstract.length >= 120 ? { title, site: venue || 'OpenAlex', author: authors.join(', ') + ((w.authorships || []).length > 4 ? ' et al.' : ''), published, blocks: [{ type: 'p', text: abstract, heading: 'Abstract' }], pageType: 'scholarly', via: 'api', partial: true, lang: w.language || '' } : null,
  };
}
const OA_SELECT = 'id,doi,title,display_name,publication_year,publication_date,cited_by_count,type,language,open_access,primary_location,authorships,abstract_inverted_index';

export const openalex = {
  id: 'openalex', label: 'OpenAlex', kind: 'academic', keyless: true, documented: true, defaultOn: true,
  note: 'Open index of scholarly works across all disciplines (CC0): titles, abstracts, citation counts and open-access links. Keyless.',
  available: () => true,
  async search(query, ctx) {
    const mail = ctx.cfg && ctx.cfg.contact && /@/.test(ctx.cfg.contact) ? `&mailto=${enc(ctx.cfg.contact)}` : '';
    const q = query.replace(/[",]/g, ' ').trim();
    const { json } = await ctx.http.getJSON(`https://api.openalex.org/works?search=${enc(q)}&per-page=${Math.min(ctx.limit || 10, 100)}&select=${OA_SELECT}${ctx.fresh === 'year' || ctx.fresh === 'month' ? `&filter=from_publication_date:${new Date((ctx.now || Date.now()) - 400 * 86400000).toISOString().slice(0, 10)}` : ''}${mail}`, opts(ctx));
    if (!json || !Array.isArray(json.results)) throw new ProviderError('Unexpected OpenAlex response', 'bad_response');
    const out = json.results.map(oaWork).filter(Boolean);
    out.total = json.meta && Number(json.meta.count) || out.length;
    return out;
  },
  /** Look up works by DOI (up to 50 per request): turns the reference list of a page into abstracts. */
  async byDoi(dois, ctx) {
    const list = [...new Set(dois.map(cleanDoi).filter((d) => /^10\.\d{4,9}\/\S+$/.test(d) && !/[|,]/.test(d)))].slice(0, 50);
    if (!list.length) return [];
    const mail = ctx.cfg && ctx.cfg.contact && /@/.test(ctx.cfg.contact) ? `&mailto=${enc(ctx.cfg.contact)}` : '';
    const { json } = await ctx.http.getJSON(`https://api.openalex.org/works?filter=doi:${list.map(enc).join('|')}&per-page=50&select=${OA_SELECT}${mail}`, opts(ctx));
    return ((json && json.results) || []).map(oaWork).filter(Boolean);
  },
};

function epmcWork(r) {
  const title = squash(stripTags(decodeEntities(String(r.title || '')))).replace(/\.$/, '');
  if (!title || !r.id || !r.source) return null;
  const abstract = squash(stripTags(decodeEntities(String(r.abstractText || '').replace(/<h4>([^<]{1,40})<\/h4>/gi, ' $1: '))));
  const doi = cleanDoi(r.doi);
  const types = (r.pubTypeList && r.pubTypeList.pubType) || [];
  const venue = squash((r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.title) || r.journalTitle || (r.bookOrReportDetails && r.bookOrReportDetails.publisher) || '');
  const published = /^\d{4}-\d{2}-\d{2}$/.test(r.firstPublicationDate || '') ? r.firstPublicationDate : yearOf(r.pubYear);
  const pmcid = /^PMC\d+$/.test(r.pmcid || '') ? r.pmcid : '';
  const meta = { work: doi || `${r.source}:${r.id}`, doi, year: Number(r.pubYear) || 0, citedBy: Number(r.citedByCount) || 0, type: [].concat(types).join(', '), venue, oa: r.isOpenAccess === 'Y', pmcid: pmcid && r.inEPMC === 'Y' && r.isOpenAccess === 'Y' ? pmcid : '', study: r.source === 'PPR' ? 'preprint' : studyFromTypes(types) || studyFromTypes([String(r.pubType || '')]) || studyFromTypes([title]) };
  return {
    title, url: pmcid ? `https://europepmc.org/article/PMC/${pmcid}` : `https://europepmc.org/article/${enc(r.source)}/${enc(r.id)}`, snippet: truncate(abstract, 320), provider: 'europepmc', kind: 'academic', date: published, meta,
    content: abstract.length >= 120 ? { title, site: venue || 'Europe PMC', author: truncate(squash(String(r.authorString || '')), 120), published, blocks: [{ type: 'p', text: abstract, heading: 'Abstract' }], pageType: 'scholarly', via: 'api', partial: true, lang: r.language || '' } : null,
  };
}

/** JATS article XML (the format of open-access full texts) → blocks. Reference lists, tables, figures and formulas are left out. */
export function jatsToBlocks(xml) {
  const root = parseHTML(xml, { xml: true, maxNodes: 120000 });
  const blocks = [];
  const SKIP = new Set(['ref-list', 'table-wrap', 'fig', 'supplementary-material', 'disp-formula', 'inline-formula', 'ack', 'fn-group', 'back', 'front', 'xref', 'sup', 'label', 'tex-math', 'object-id', 'graphic', 'media']);
  const text = (el) => { let s = ''; for (const ch of el.children) { if (ch.text !== undefined) s += ch.text; else if (!SKIP.has(ch.tag)) s += text(ch); } return s; };
  const visit = (el, path) => {
    for (const ch of el.children) {
      if (ch.text !== undefined || SKIP.has(ch.tag)) continue;
      if (ch.tag === 'sec' || ch.tag === 'abstract') {
        const t = ch.children.find((x) => x.tag === 'title');
        const title = t ? squash(text(t)).slice(0, 160) : ch.tag === 'abstract' ? 'Abstract' : '';
        const next = title ? [...path, title] : path;
        if (title && blocks.length < 900) blocks.push({ type: 'heading', level: Math.min(6, next.length + 1), text: title, heading: path.join(' › ') });
        visit(ch, next);
      } else if (ch.tag === 'p') {
        const t = squash(text(ch)).replace(/\s*\[\s*[,–-]?\s*\]/g, '').replace(/\s+([,.;:])/g, '$1');
        if (t.length >= 30 && blocks.length < 900) blocks.push({ type: 'p', text: t, heading: path.join(' › ') });
      } else if (ch.tag === 'list') {
        const items = ch.children.filter((x) => x.tag === 'list-item').map((x) => ({ text: truncate(squash(text(x)), 700), depth: 0 })).filter((x) => x.text.length > 2);
        if (items.length && blocks.length < 900) blocks.push({ type: 'list', ordered: ch.attrs['list-type'] === 'order', items, heading: path.join(' › ') });
      } else if (ch.tag !== 'title') visit(ch, path);
    }
  };
  const find = (el, tag) => { for (const ch of el.children) { if (ch.text !== undefined) continue; if (ch.tag === tag) return ch; const f = find(ch, tag); if (f) return f; } return null; };
  const body = find(root, 'body');
  if (body) visit(body, []);
  const titleEl = find(root, 'article-title');
  return { title: titleEl ? squash(text(titleEl)) : '', blocks };
}

export const europepmc = {
  id: 'europepmc', label: 'Europe PMC', kind: 'academic', keyless: true, documented: true, defaultOn: true,
  note: 'Life-science and medical literature (EMBL-EBI): abstracts, publication types, and full text of open-access articles. Keyless.',
  available: () => true,
  async search(query, ctx) {
    const words = query.replace(/["()[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
    // ctx.openAccess: only articles whose full text can be read through this API (open access, held by Europe PMC)
    const q = ctx.openAccess ? `(${words}) AND OPEN_ACCESS:y AND IN_EPMC:y` : words;
    // for full-text leads the short record is enough (title, identifiers) — a tenth of the size of the record with abstracts
    const { json } = await ctx.http.getJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(q)}&format=json&resultType=${ctx.openAccess ? 'lite' : 'core'}&pageSize=${Math.min(ctx.limit || 10, ctx.openAccess ? 50 : 100)}`, opts(ctx, { timeoutMs: Math.min(ctx.timeoutMs || 9000, 8000), circuit: 'search' }));
    const list = json && json.resultList && json.resultList.result;
    if (!Array.isArray(list)) throw new ProviderError('Unexpected Europe PMC response', 'bad_response');
    const out = list.map(epmcWork).filter(Boolean);
    out.total = Number(json.hitCount) || out.length;
    return out;
  },
  handles(url) { return /^https:\/\/europepmc\.org\/article\/PMC\/PMC\d+$/i.test(String(url)); },
  /** Full text of an open-access article (JATS XML through the documented REST endpoint). */
  async fetch(url, ctx) {
    const pmcid = (String(url).match(/(PMC\d+)$/i) || [])[1];
    if (!pmcid) throw new ProviderError('Not a Europe PMC full-text address', 'not_found');
    const res = await ctx.http.getText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid.toUpperCase()}/fullTextXML`, { accept: 'xml', signal: ctx.signal, timeoutMs: ctx.timeoutMs || 9000, maxBytes: 2_500_000, fresh: ctx.noCache, ttlMs: 60 * 60000 });
    const { title, blocks } = jatsToBlocks(res.text);
    if (blocks.filter((b) => b.type === 'p').length < 3) throw new ProviderError('The open-access full text is not available through the API', 'no_content');
    return { title, blocks, bytes: res.bytes, ms: res.ms, fromCache: res.fromCache, via: 'api', url };
  },
};
