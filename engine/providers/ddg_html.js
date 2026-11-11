// DuckDuckGo — the public no-JavaScript HTML interface (html.duckduckgo.com).
// Keyless general web search. This is a public interface rather than a contractual API: the host's robots.txt
// allows it, volume is one request per user question, and a challenge page is treated as a failure — never bypassed.

import { enc, ProviderError } from './base.js';
import { parseHTML, findAll, find, hasClass, textOf } from '../extract/html.js';
import { squash } from '../util/text.js';

const DF = { day: 'd', week: 'w', month: 'm', year: 'y' };

export default {
  id: 'ddg_html', label: 'DuckDuckGo (HTML)', kind: 'web', keyless: true, documented: false, defaultOn: true,
  note: 'Public no-JS search interface; may rate-limit. Challenges are not bypassed.',
  available: () => true,
  async search(query, ctx) {
    const url = `https://html.duckduckgo.com/html/?q=${enc(query)}&kl=wt-wt${ctx.fresh && DF[ctx.fresh] ? '&df=' + DF[ctx.fresh] : ''}`;
    let res;
    try { res = await ctx.http.getText(url, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 6000, fresh: ctx.noCache, ttlMs: ctx.fresh ? 5 * 60000 : undefined }); }
    catch (e) { if (e.status === 202 || e.status === 403 || e.status === 429) throw new ProviderError('DuckDuckGo declined the request (rate limit or human check) — not bypassed', 'challenged'); throw e; }
    const root = parseHTML(res.text);
    const out = [];
    for (const a of findAll(root, (el) => el.tag === 'a' && hasClass(el, 'result__a'))) {
      let target = '';
      try {
        const u = new URL(a.attrs.href || '', 'https://duckduckgo.com');
        if (u.hostname.endsWith('duckduckgo.com')) { if (u.pathname.startsWith('/y.js')) continue; target = u.searchParams.get('uddg') || ''; } else target = u.toString();
      } catch { continue; }
      if (!/^https?:\/\//i.test(target)) continue;
      let box = a.parent;
      while (box && !hasClass(box, 'result')) box = box.parent;
      const sn = box ? find(box, (el) => hasClass(el, 'result__snippet')) : null;
      out.push({ title: squash(textOf(a)), url: target, snippet: sn ? squash(textOf(sn)) : '', provider: 'ddg_html', kind: 'web' });
      if (out.length >= (ctx.limit || 10)) break;
    }
    if (!out.length && /anomaly|challenge|captcha|unusual traffic|bots use duckduckgo/i.test(res.text)) throw new ProviderError('DuckDuckGo asked for a human check — not bypassed', 'challenged');
    return out;
  },
};
