// INFINI AI — configuration (environment-driven; every value has a safe default; no key is required).

export const VERSION = '1.0.0';

const WIKIMEDIA_HOST = /(^|\.)(wikipedia|wikidata|wikimedia|mediawiki|wiktionary|wikinews|wikibooks|wikiquote|wikivoyage|wikiversity|wikisource)\.org$/;
const WIKIMEDIA_API_PATH = /^\/(w\/api\.php|w\/rest\.php|api\/rest_v1|core\/v1)/;

export function loadConfig(env = (typeof process !== 'undefined' ? process.env : {})) {
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(hi, Math.max(lo, n)) : d; };
  const contact = String(env.INFINI_CONTACT || '').trim().slice(0, 120).replace(/[^\w@.:/+\-~ ]/g, '');
  // Wikimedia policy (2026): clients without contact details in the User-Agent are "unidentified" and get
  // 10 requests/minute; a compliant User-Agent gets 200. We stay under whichever applies.
  // The operator contact is sent ONLY to Wikimedia hosts (their API policy asks for it). Every other site gets the
  // generic User-Agent, so a personal e-mail address is never broadcast to arbitrary web pages.
  const siteUrl = String(env.INFINI_SITE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).trim().slice(0, 120).replace(/[^\w@.:/+\-~]/g, '');
  const genericUA = env.INFINI_USER_AGENT || `InfiniAI/${VERSION} (retrieval assistant; user-initiated requests) node-http`;
  const contactUA = contact ? `InfiniAI/${VERSION} (${[siteUrl, contact].filter(Boolean).join('; ')}) node-http` : genericUA;
  const userAgent = genericUA;
  let searxngUrl = '';
  try { if (env.SEARXNG_URL) searxngUrl = new URL(env.SEARXNG_URL).toString(); } catch { /* ignored: invalid URL */ }
  return {
    version: VERSION,
    contact, userAgent,
    port: num(env.PORT, 8787, 1, 65535),
    host: env.HOST || '0.0.0.0',
    keys: { brave: env.BRAVE_API_KEY || '', marginalia: env.MARGINALIA_API_KEY || '', stackexchange: env.STACKEXCHANGE_KEY || '', tavily: env.TAVILY_API_KEY || '', firecrawl: env.FIRECRAWL_API_KEY || '' },
    searxngUrl,
    disabled: new Set(list(env.DISABLE_PROVIDERS)),
    extraFeeds: list(env.EXTRA_FEEDS),
    rate: { perMin: num(env.RATE_LIMIT_PER_MIN, 20, 1, 10000), burst: num(env.RATE_LIMIT_BURST, 8, 1, 1000) },
    trustProxy: env.TRUST_PROXY === '1',
    allowEmbed: env.ALLOW_EMBED === '1',
    maxConcurrentAsks: num(env.MAX_CONCURRENT_ASKS, 4, 1, 64),
    http: {
      userAgent,
      userAgentFor: (u) => (WIKIMEDIA_HOST.test(u.hostname) ? contactUA : genericUA),
      timeoutMs: num(env.FETCH_TIMEOUT_MS, 7000, 1000, 30000),
      maxBytes: num(env.FETCH_MAX_BYTES, 1_500_000, 50_000, 10_000_000),
      cacheBytes: num(env.CACHE_MAX_MB, 24, 0, 1024) * 1024 * 1024,
      cacheTtlMs: num(env.CACHE_TTL_MIN, 15, 0, 1440) * 60000,
      respectRobots: env.IGNORE_ROBOTS !== '1',
      trustedOrigins: searxngUrl ? [new URL(searxngUrl).origin] : [],
      rateClasses: [
        { id: 'wikimedia-api', label: 'Wikimedia API', perMin: num(env.WIKIMEDIA_PER_MIN, contact ? 150 : 9, 1, 2000), test: (u) => WIKIMEDIA_HOST.test(u.hostname) && WIKIMEDIA_API_PATH.test(u.pathname) },
        { id: 'stackexchange', label: 'Stack Exchange API', perMin: 20, test: (u) => u.hostname === 'api.stackexchange.com' },
        { id: 'duckduckgo-html', label: 'DuckDuckGo', perMin: 12, test: (u) => u.hostname === 'html.duckduckgo.com' },
        { id: 'gdelt', label: 'GDELT', perMin: 6, test: (u) => u.hostname === 'api.gdeltproject.org' },
        { id: 'arxiv', label: 'arXiv API', perMin: 15, test: (u) => u.hostname === 'export.arxiv.org' },
        { id: 'firecrawl', label: 'Firecrawl', perMin: 8, test: (u) => u.hostname === 'api.firecrawl.dev' },
      ],
    },
  };
}
