// A two-page synthetic web behind the real engine: the Mwmbl provider returns two pages about Kathmandu and the HTTP
// transport serves them. Lets a full web answer (search → fetch → rank → cited answer) run offline in tests.
import { loadConfig } from '../../engine/config.js';
export const ONLY = ['wikipedia', 'ddg_instant', 'searxng', 'langsearch', 'tavily', 'brave', 'ddg_html', 'firecrawl', 'marginalia', 'wiby', 'stackexchange', 'mdn', 'arxiv', 'openalex', 'crossref', 'europepmc', 'hackernews', 'feeds', 'gdelt', 'wikidata'].join(',');
export function fakeConfig(extra = {}) {
  const pages = new Map([
    ['https://alpha-encyclopedia.org/kathmandu', '<html><head><title>Kathmandu - Alpha Encyclopedia</title></head><body><article><h1>Kathmandu</h1><p>Kathmandu is the capital and largest city of Nepal. The city stands at an elevation of about 1,400 metres in the Kathmandu Valley. It has a population of around 850,000 people within the city proper.</p><p>Kathmandu has been the centre of Nepal\'s history, art, culture and economy for centuries. Tourism is an important part of the economy of the city.</p></article></body></html>'],
    ['https://beta-atlas.net/nepal/capital', '<html><head><title>Capital of Nepal | Beta Atlas</title></head><body><article><h1>The capital of Nepal</h1><p>The capital of Nepal is Kathmandu, a city in the Kathmandu Valley at roughly 1,400 metres above sea level. Kathmandu is also the largest city in Nepal and the seat of the federal government.</p><p>Nepal lies between China and India in South Asia. Mount Everest, the highest mountain on Earth, is on the border of Nepal and China.</p></article></body></html>'],
  ]);
  const json = (o) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(o)), truncated: false });
  const cfg = loadConfig({ DISABLE_PROVIDERS: ONLY, LOG_LEVEL: 'silent', RATE_LIMIT_PER_MIN: '600', RATE_LIMIT_BURST: '200', ...extra });
  cfg.http.transport = async (u) => {
    if (u.pathname === '/robots.txt') return { status: 404, headers: {}, body: Buffer.alloc(0), truncated: false };
    if (u.hostname === 'api.mwmbl.org') return json([...pages.keys()].map((url) => ({ url, title: [{ value: /<title>([^<]+)/.exec(pages.get(url))[1] }], extract: [{ value: 'Kathmandu capital of Nepal' }] })));
    const key = u.origin + u.pathname;
    if (pages.has(key)) return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(pages.get(key)), truncated: false };
    return { status: 404, headers: {}, body: Buffer.alloc(0), truncated: false };
  };
  cfg.http.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  cfg.http.rateClasses = (cfg.http.rateClasses || []).map((r) => ({ ...r, perMin: 100000 }));
  return cfg;
}
