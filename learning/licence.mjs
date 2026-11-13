// INFINITY LLM — learning: which licence a document carries, and whether it allows training.
// A document is used only when a licence on the allow-list is found. "No licence found" means "not permitted".

const CC = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)(?:\/(\d\.\d))?/i;

/** https://creativecommons.org/licenses/by-sa/4.0/ → "CC-BY-SA-4.0". Returns '' when the URL names no known licence. */
export function licenceFromUrl(url) {
  const m = CC.exec(String(url || ''));
  if (!m) return '';
  const kind = m[2].toLowerCase(), ver = m[3] || '';
  if (m[1].toLowerCase() === 'publicdomain') return kind === 'zero' ? 'CC0-1.0' : kind === 'mark' ? 'PDM' : '';
  if (!/^by(-nc)?(-nd|-sa)?$/.test(kind)) return '';
  return `CC-${kind.toUpperCase()}${ver ? '-' + ver : ''}`;
}

// Sites whose terms of use put all text under one licence (the page itself need not repeat it).
const SITE_LICENCES = [
  [/(^|\.)wikipedia\.org$/, 'CC-BY-SA-4.0', 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use'],
  [/(^|\.)(wikibooks|wikiversity|wikivoyage|wiktionary|wikiquote|wikisource)\.org$/, 'CC-BY-SA-4.0', 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use'],
  [/(^|\.)wikinews\.org$/, 'CC-BY-4.0', 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use'],
];
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : ''; };

/**
 * @returns {{id: string, url: string, basis: 'declared'|'site-terms'|'', optOut: string}}
 *   optOut is non-empty when the page or its headers ask not to be used for AI training or text mining.
 */
export function detectLicence({ html = '', url = '', headers = {}, robotsMeta = '' } = {}) {
  let optOut = '';
  const xr = String(headers['x-robots-tag'] || '').toLowerCase();
  const rm = String(robotsMeta || '').toLowerCase();
  if (/\bnoai\b|\bnoimageai\b|\bnotrain\b/.test(xr)) optOut = 'X-Robots-Tag: ' + xr.slice(0, 60);
  else if (/\bnoai\b|\bnotrain\b/.test(rm)) optOut = 'robots meta: ' + rm.slice(0, 60);
  const head = html.slice(0, 200000);
  if (!optOut && /<meta[^>]+name\s*=\s*["']?tdm-reservation["']?[^>]*content\s*=\s*["']?1/i.test(head)) optOut = 'tdm-reservation: 1';
  if (!optOut && String(headers['tdm-reservation'] || '') === '1') optOut = 'tdm-reservation header';
  let host = ''; try { host = new URL(url).hostname.toLowerCase(); } catch { /* no site rule */ }
  // 1. declared in the page
  const tags = head.match(/<(?:link|a)\b[^>]*\brel\s*=\s*["']?[^"'>]*\blicen[sc]e\b[^>]*>/gi) || [];
  for (const t of tags) { const href = attr(t, 'href'); const id = licenceFromUrl(href); if (id) return { id, url: href, basis: 'declared', optOut }; }
  const meta = head.match(/<meta\b[^>]*\b(?:name|property)\s*=\s*["']?(?:dcterms\.license|dc\.rights|license|og:license|copyright)["']?[^>]*>/gi) || [];
  for (const t of meta) { const c = attr(t, 'content'); const id = licenceFromUrl(c); if (id) return { id, url: c, basis: 'declared', optOut }; }
  const ld = /"license"\s*:\s*"([^"]+)"/i.exec(head);
  if (ld) { const id = licenceFromUrl(ld[1]); if (id) return { id, url: ld[1], basis: 'declared', optOut }; }
  // 2. the site's terms of use
  for (const [re, id, terms] of SITE_LICENCES) if (re.test(host)) return { id, url: terms, basis: 'site-terms', optOut };
  return { id: '', url: '', basis: '', optOut };
}

/** Is this licence on the operator's allow-list? Non-commercial and no-derivatives licences never are. */
export function permitted(id, allow) {
  if (!id) return false;
  if (/-NC\b|-ND\b/.test(id)) return false;
  const base = id.replace(/-\d\.\d$/, '');
  return allow.some((a) => a === id || a.replace(/-\d\.\d$/, '') === base && /^CC-/.test(a) && !/\d\.\d$/.test(id));
}
