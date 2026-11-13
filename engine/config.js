// INFINI AI — configuration (environment-driven; every value has a safe default; no key is required).

export const VERSION = '4.0.0';

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
    creator: String(env.INFINI_CREATOR || '').trim().slice(0, 60).replace(/[^\p{L}\p{N} .,'&-]/gu, '') || 'Nepal369',
    port: num(env.PORT, 8787, 1, 65535),
    host: env.HOST || '0.0.0.0',
    keys: { brave: env.BRAVE_API_KEY || '', marginalia: env.MARGINALIA_API_KEY || '', stackexchange: env.STACKEXCHANGE_KEY || '', tavily: env.TAVILY_API_KEY || '', langsearch: env.LANGSEARCH_API_KEY || '', firecrawl: env.FIRECRAWL_API_KEY || '', openalex: env.OPENALEX_API_KEY || '' },
    searxngUrl,
    disabled: new Set(list(env.DISABLE_PROVIDERS)),
    extraFeeds: list(env.EXTRA_FEEDS),
    rate: { perMin: num(env.RATE_LIMIT_PER_MIN, 20, 1, 10000), burst: num(env.RATE_LIMIT_BURST, 8, 1, 1000) },
    trustProxy: env.TRUST_PROXY === '1',
    allowEmbed: env.ALLOW_EMBED === '1',
    maxConcurrentAsks: num(env.MAX_CONCURRENT_ASKS, 4, 1, 64),
    // Research mode: one question may read up to this many pages for up to this many seconds. On serverless hosts the
    // time must stay below the platform's function limit (Vercel hobby: 300 s) with room to build the final answer.
    research: {
      enabled: env.RESEARCH_MODE !== '0',
      maxPages: num(env.RESEARCH_MAX_PAGES, 1500, 50, 5000),
      maxSeconds: num(env.RESEARCH_MAX_SECONDS, 170, 30, 270),
      concurrency: num(env.CRAWL_CONCURRENCY, 40, 4, 96),
      maxConcurrent: num(env.MAX_CONCURRENT_RESEARCH, 2, 1, 16),
      perHour: num(env.RESEARCH_PER_HOUR, 12, 1, 1000),
      perClientPerHour: num(env.RESEARCH_PER_CLIENT_PER_HOUR, 6, 1, 1000),
      keyedSearches: num(env.RESEARCH_KEYED_SEARCHES, 5, 1, 40),          // searches per research run on services with a metered key (Tavily, Brave)
      langsearchSearches: num(env.RESEARCH_LANGSEARCH_SEARCHES, 12, 0, 40), // searches per research run on LangSearch (free; its allowance is counted in tokens of returned text and renews daily)
    },
    http: {
      userAgent,
      global: Math.max(12, Math.round(num(env.CRAWL_CONCURRENCY, 40, 4, 96) * 1.5) + 12),      // room for a research run and ordinary questions side by side
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
        { id: 'openalex', label: 'OpenAlex API', perMin: 60, test: (u) => u.hostname === 'api.openalex.org' },
        // Crossref's public pool states 3 requests per second and 3 at a time (response headers, November 2026): starts are spaced 380 ms apart
        { id: 'crossref', label: 'Crossref API', perMin: 100, gapMs: num(env.CROSSREF_GAP_MS, 380, 0, 5000), test: (u) => u.hostname === 'api.crossref.org' },
        { id: 'europepmc', label: 'Europe PMC API', perMin: 120, test: (u) => u.hostname === 'www.ebi.ac.uk' },
        { id: 'mwmbl', label: 'Mwmbl', perMin: 30, test: (u) => u.hostname === 'api.mwmbl.org' },
        // LangSearch allows 5 requests per second on a new account (docs, November 2026): starts are spaced 250 ms apart
        { id: 'langsearch', label: 'LangSearch API', perMin: 120, gapMs: num(env.LANGSEARCH_GAP_MS, 250, 0, 5000), test: (u) => u.hostname === 'api.langsearch.com' },
        // GitHub REST API (openly licensed text collections for the learning pipeline): well under the documented limits
        { id: 'github', label: 'GitHub API', perMin: 240, test: (u) => u.hostname === 'api.github.com' },
      ],
    },
    // Infinity LLM (engine/neural, learning/). On for the real process environment; a configuration built from an explicit
    // environment object (tests, embedding) gets the model only when it asks for it with INFINI_LLM=1.
    llm: {
      enabled: env.INFINI_LLM !== undefined && env.INFINI_LLM !== '' ? env.INFINI_LLM !== '0' : (typeof process !== 'undefined' && env === process.env),
      dir: String(env.INFINI_LLM_DIR || ''),                                  // state directory; empty = <repo>/data/llm
      bundled: String(env.INFINI_LLM_BUNDLED || ''),                          // the published model; empty = <repo>/model
      minLogProb: num(env.INFINI_LLM_MIN_LOGPROB, -1.6, -20, 0),
      minAgreement: num(env.INFINI_LLM_MIN_AGREEMENT, 0.6, 0, 1),            // word overlap a generated reply needs with a correct rule-based reply before it is shown               // replies the model itself finds less likely than this are not shown
      adminToken: String(env.INFINI_ADMIN_TOKEN || '').length >= 16 ? String(env.INFINI_ADMIN_TOKEN) : '',     // protects the training controls; unset = controls disabled
      serverless: !!(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME),              // no writable disk, no long-running processes: training runs elsewhere
      learning: env.INFINI_LEARNING !== '0',
      // the learning worker's model channel (a URL under which channel.json and the model files are served, for example
      // https://github.com/<owner>/<repo>/releases/download/infinity-model): approved models arrive here without a redeploy
      channel: /^https?:\/\//.test(String(env.INFINI_MODEL_CHANNEL || '')) ? String(env.INFINI_MODEL_CHANNEL).trim() : '',
      channelSeconds: num(env.INFINI_MODEL_CHANNEL_SECONDS, 300, 5, 86400),
      channelDir: String(env.INFINI_MODEL_CHANNEL_DIR || ''),
      scheduler: env.INFINI_LEARNING_SCHEDULER !== '0',
    },
  };
}
