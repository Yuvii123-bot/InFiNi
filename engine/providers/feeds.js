// Publisher news feeds (RSS/Atom) — the search-engine-independent backbone for current-affairs questions.
// The catalogue is *configuration* (where to look), not knowledge: every headline is read live from the publisher.
// Operators can extend it with EXTRA_FEEDS; users can add feeds in Settings; feeds are also auto-discovered from
// <link rel="alternate"> tags on pages the engine reads.

import { parseFeed } from '../extract/feed.js';
import { stem, tokenize } from '../util/text.js';

const F = (name, url, tags) => ({ name, url, tags: tags.split(' ') });
export const FEED_CATALOGUE = [
  F('BBC News — World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'world international global'),
  F('The Guardian — World', 'https://www.theguardian.com/world/rss', 'world international global'),
  F('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'world international global'),
  F('DW — World', 'https://rss.dw.com/rdf/rss-en-world', 'world international global'),
  F('UN News', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', 'world international global un'),
  F('France 24', 'https://www.france24.com/en/rss', 'world international france french europe'),
  F('The Kathmandu Post', 'https://kathmandupost.com/rss', 'nepal nepali nepalese kathmandu'),
  F('The Himalayan Times', 'https://thehimalayantimes.com/rssFeed/15', 'nepal nepali nepalese kathmandu'),
  F('OnlineKhabar English', 'https://english.onlinekhabar.com/feed', 'nepal nepali nepalese kathmandu'),
  F('Nepali Times', 'https://www.nepalitimes.com/feed', 'nepal nepali nepalese kathmandu'),
  F('Khabarhub', 'https://english.khabarhub.com/feed', 'nepal nepali nepalese kathmandu'),
  F('The Hindu — National', 'https://www.thehindu.com/news/national/feeder/default.rss', 'india indian delhi'),
  F('The Hindu — International', 'https://www.thehindu.com/news/international/feeder/default.rss', 'india world international'),
  F('BBC News — Asia', 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', 'asia asian china chinese japan japanese india pakistan korea'),
  F('BBC News — UK', 'https://feeds.bbci.co.uk/news/uk/rss.xml', 'uk britain british england london scotland wales'),
  F('BBC News — Europe', 'https://feeds.bbci.co.uk/news/world/europe/rss.xml', 'europe european eu germany france italy spain ukraine russia'),
  F('BBC News — Africa', 'https://feeds.bbci.co.uk/news/world/africa/rss.xml', 'africa african nigeria kenya egypt'),
  F('BBC News — Middle East', 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', 'middle east israel iran gaza saudi syria'),
  F('BBC News — Latin America', 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml', 'latin america brazil mexico argentina'),
  F('BBC News — US & Canada', 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', 'us usa america american united states canada canadian washington'),
  F('New York Times — World', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'world international us usa america'),
  F('ABC News Australia', 'https://www.abc.net.au/news/feed/51120/rss.xml', 'australia australian sydney'),
  F('CBC — World', 'https://www.cbc.ca/webfeed/rss/rss-world', 'canada canadian world'),
  F('BBC News — Technology', 'https://feeds.bbci.co.uk/news/technology/rss.xml', 'technology tech ai software internet computing cyber'),
  F('Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index', 'technology tech ai software science computing gadgets'),
  F('TechCrunch', 'https://techcrunch.com/feed/', 'technology tech ai startup startups software'),
  F('BBC News — Science', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'science scientific environment climate space'),
  F('ScienceDaily', 'https://www.sciencedaily.com/rss/top/science.xml', 'science scientific research physics biology space'),
  F('Nature', 'https://www.nature.com/nature.rss', 'science scientific research nature'),
  F('BBC News — Business', 'https://feeds.bbci.co.uk/news/business/rss.xml', 'business economy economic markets finance financial stock'),
  F('BBC News — Health', 'https://feeds.bbci.co.uk/news/health/rss.xml', 'health medical medicine disease'),
  F('BBC Sport', 'https://feeds.bbci.co.uk/sport/rss.xml', 'sport sports football cricket tennis olympics'),
];
const WORLD = new Set(['world']);

/** Choose feeds whose tags match the question; fall back to world feeds. Returns [{feed, regional}]. */
export function selectFeeds(questionText, extra = [], max = 6) {
  const toks = new Set(tokenize(questionText).map(stem));
  const scored = [];
  for (const f of FEED_CATALOGUE) {
    let score = 0;
    for (const t of f.tags) if (!WORLD.has(t) && toks.has(stem(t))) score += t.length > 3 ? 2 : 1;
    if (score > 0) scored.push({ feed: f, score, regional: true });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = scored.slice(0, max);
  const custom = extra.slice(0, 4).map((url) => ({ feed: { name: hostName(url), url, tags: [] }, regional: false, custom: true }));
  if (out.length < 3) for (const f of FEED_CATALOGUE) { if (out.length + custom.length >= Math.max(4, max - 1)) break; if (f.tags.includes('world') && !out.some((o) => o.feed === f)) out.push({ feed: f, score: 0, regional: false }); }
  return [...out, ...custom].slice(0, max + 2);
}
function hostName(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'feed'; } }

/** Fetch feeds in parallel. Returns {items, log}; each item carries its publisher and publication time. */
export async function fetchFeeds(selection, ctx, log) {
  const items = [];
  await Promise.all(selection.map(async ({ feed, regional, custom }) => {
    const t0 = Date.now();
    const entry = { provider: 'feeds', label: feed.name, query: feed.url, results: 0, ms: 0, ok: false, error: '' };
    try {
      const res = await ctx.http.getText(feed.url, { accept: 'xml', signal: ctx.signal, timeoutMs: ctx.timeoutMs || 6000, fresh: ctx.noCache, ttlMs: 4 * 60000, robots: !!custom });
      const parsed = parseFeed(res.text, res.url);
      for (const it of parsed.items) items.push({ ...it, source: feed.name || parsed.title, feedUrl: feed.url, regional });
      entry.results = parsed.items.length; entry.ok = true;
    } catch (e) { entry.error = e.code === 'aborted' ? 'stopped' : e.message; entry.code = e.code; }
    entry.ms = Date.now() - t0;
    if (log) log(entry);
  }));
  return items;
}

export default {
  id: 'feeds', label: 'Publisher news feeds (RSS/Atom)', kind: 'news', keyless: true, documented: true, defaultOn: true,
  note: `${FEED_CATALOGUE.length} publisher feeds in the built-in catalogue; extend with EXTRA_FEEDS or in Settings.`,
  available: () => true,
  async search() { return []; },          // feeds are driven by the news planner (selectFeeds/fetchFeeds), not by keyword search
};
