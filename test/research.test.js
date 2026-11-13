// INFINI AI — offline tests for deep search and research runs (no network). Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { splitSentences } from '../engine/util/text.js';
import { analyze } from '../engine/nlp/analyze.js';
import { createHttpClient } from '../engine/net/http.js';
import { researchDirective } from '../engine/research/directive.js';
import { createFrontier } from '../engine/research/frontier.js';
import { sharedHeadings, keyPhrases, mergeAspects } from '../engine/research/aspects.js';
import { rankEvidence, queryModel } from '../engine/rank/rank.js';
import { classifyDoc, stanceOf, buildClassification } from '../engine/classify/classify.js';
import { invertedToText, jatsToBlocks, jatsAbstractToText, studyFromTypes, crossref } from '../engine/providers/scholar.js';
import { yearInContext, figureKeys } from '../engine/synth/report.js';
import { resetCooling } from '../engine/providers/index.js';
import { createEngine, loadConfig, blocksToText } from '../engine/index.js';
import { createApp } from '../server/app.js';

const part = (q) => analyze(q, {}).parts[0];

test('research requests: the instruction is taken off and sets the depth', () => {
  const d = (q) => researchDirective(q);
  assert.deepEqual([d('Do deep research on the health effects of microplastics').depth, d('Do deep research on the health effects of microplastics').question], ['research', 'The health effects of microplastics']);
  assert.equal(d('research quantum computing').depth, 'research');
  assert.equal(d('can you do deep research on lithium mining?').question, 'Lithium mining');
  assert.equal(d('give me a detailed report on nepal\'s economy').depth, 'research');
  assert.equal(d('search the whole web for solid-state batteries').question, 'Solid-state batteries');
  assert.equal(d('find everything you can about the Kathmandu valley').depth, 'research');
  assert.equal(d('tell me everything about black holes').depth, 'deep');
  assert.equal(d('investigate the collapse of FTX').depth, 'deep');
  assert.equal(d('what does the research say about intermittent fasting?').depth, 'deep');
  assert.equal(d('what does the research say about intermittent fasting?').scholarly, true);
  // not requests for research
  for (const q of ['research shows that coffee is good for you, is that true?', 'research papers on graph neural networks', 'can you research things for me?', 'What is quantum computing?', 'an overview of photosynthesis', 'why is the sky blue', 'deep research'])
    assert.equal(d(q), null, q);
});

test('question analysis: degree words, relation nouns, hyphenated terms, past events', () => {
  assert.equal(part('How long do solid-state batteries last?').focus, 'solid-state batteries');
  assert.equal(part('How old is the universe?').focus, 'universe');
  assert.equal(part('how much does a tesla cost').focus, 'tesla');
  assert.equal(part('The impact of remote work on productivity').focus, 'remote work');
  assert.equal(part('The relationship between sleep and memory').focus, 'sleep');
  assert.equal(part('The health effects of microplastics').focus, 'microplastics');
  // a hyphenated word is matched as its parts (text is split at hyphens), never as one unfindable token
  const stems = part('What are solid-state batteries?').terms.map((t) => t.stem);
  assert.ok(stems.includes('solid') && stems.includes('state') && !stems.includes('solid-state'), stems.join(' '));
  assert.notEqual(part('What happened to the Vatsala Durga temple in the 2015 earthquake?').answerType, 'news');
  assert.equal(part('What happened in Nepal today?').answerType, 'news');
});

test('sentences glued together by markup or abstract indexes are separated', () => {
  assert.deepEqual(splitSentences('Samples were taken in June 2022.Results and Discussion: The levels were high.'), ['Samples were taken in June 2022.', 'Results and Discussion: The levels were high.']);
  assert.equal(splitSentences('It rose by 84%.The rest fell.').length, 2);
  assert.equal(splitSentences('Shares of Amazon.Com Inc rose. He works at Node.js.').length, 2);
  assert.equal(splitSentences('See www.Example.org for U.S.A. details. J. K. Rowling wrote it.').length, 2);
});

test('report helpers: years in context, comparable figures', () => {
  assert.equal(yearInContext('In 1986, a new battery system was proposed', 1986), true);
  assert.equal(yearInContext('capacities of 5.83 mA h cm−2 and 1300 mA h cm−3, which are', 1300), false);
  assert.equal(yearInContext('A cohort of 2000 patients was followed', 2000), false);
  assert.equal(yearInContext('During the 1990s the field grew', 1990), true);
  assert.equal(yearInContext('The treaty (1648) ended the war', 1648), true);
  assert.deepEqual(figureKeys('particles smaller than 5 mm, or 5mm, at 10 μg/mL'), ['5mm', '10µg']);
});

test('lead queue: screening, per-site limits, and a busy site never holds up the others', () => {
  const terms = new Map([['microplast', 1.2], ['health', 1], ['effect', 1]]);
  const f = createFrontier({ terms, focus: new Set(['microplast']), skip: () => false, perDomain: 2, learned: {} });
  const res = (url, title, snippet = 'health effects of microplastics') => ({ url, title, snippet, provider: 'test', kind: 'web' });
  f.addResults([
    res('https://slow-site.org/a', 'Microplastics health effects A'), res('https://slow-site.org/b', 'Microplastics health effects B'), res('https://slow-site.org/c', 'Microplastics health effects C'),
    res('https://other-site.com/x', 'Health effects of microplastics explained'), res('https://other-site.com/x#section', 'Health effects of microplastics explained'),
    res('https://third-site.net/unrelated', 'Football results this weekend', 'All the scores from Saturday'),
  ], { weight: 1 });
  let st = f.stats();
  assert.deepEqual([st.screened, st.accepted, st.duplicates, st.rejected], [6, 4, 1, 1]);          // the same page twice counts once; the off-topic lead is not queued
  // slow-site.org is busy: the lead from the other site is handed out although the busy site's leads rank above it
  const first = f.next((host) => host === 'slow-site.org');
  assert.equal(first.host, 'other-site.com');
  assert.equal(f.next((host) => host === 'slow-site.org'), null);                 // only busy leads remain: nothing is handed out, and nothing is lost
  assert.equal(f.size, 3);
  const a = f.next(), b = f.next();
  assert.equal(a.host, 'slow-site.org'); assert.equal(b.host, 'slow-site.org');
  assert.equal(f.next(), null);                                                   // a third page of the same site would exceed the per-site limit
  st = f.stats();
  assert.equal(st.handedOut, 3);
});

test('sub-topics: the standard parts of a paper are never offered as sub-topics', () => {
  const docs = [1, 2, 3].map((i) => ({ origin: 'o' + i, outline: ['1. Materials', 'Statistical analysis', 'Results and Discussion', 'Associated Data', '2.1 Oxidative stress', 'Routes of exposure', 'Conclusions and future perspectives', 'Author Contributions', 'Outcomes', 'Primary outcome measures'].map((t) => ({ text: t, level: 2 })) }));
  assert.deepEqual(sharedHeadings(docs, new Set(['health', 'effect', 'microplast']), { minOrigins: 2 }).map((a) => a.label), ['Oxidative stress', 'Routes of exposure']);
});

test('sub-topics: a label does not run across a comma, and two labels for one thing are merged', () => {
  const docs = [{ origin: 'a' }, { origin: 'b' }, { origin: 'c' }];
  const S = (text, di) => ({ text, di });
  const found = keyPhrases([
    S('Remote work may improve flexibility, autonomy, and retention of staff.', 0), S('It enhances flexibility, autonomy and job satisfaction.', 1),
    S('Greater flexibility, autonomy, and job satisfaction were reported.', 2), S('Flexibility and autonomy rose while job satisfaction stayed.', 0),
    S('Flexibility and autonomy matter, as does job satisfaction.', 1),
  ], docs, new Set(['remot', 'work']), { minOrigins: 2 }).map((x) => x.label);
  assert.ok(found.includes('Job satisfaction') && found.includes('Flexibility and autonomy'), found.join(' | '));
  assert.ok(!found.includes('Flexibility autonomy'), 'neighbours in a list are not a phrase');
  const merged = mergeAspects([[
    { label: 'Immune function', stems: ['immun', 'function'] }, { label: 'Immune system', stems: ['immun', 'system'] },
    { label: 'Energy density', stems: ['energi', 'densiti'] }, { label: 'Energy storage', stems: ['energi', 'storag'] },
    { label: 'Inflammation', stems: ['inflamm'] }, { label: 'Inflammatory responses', stems: ['inflammatori', 'respons'] },
  ]]).map((a) => a.label);
  assert.deepEqual(merged, ['Immune function', 'Energy density', 'Energy storage', 'Inflammation']);
});

test('“the impact of X on Y”: a statement must name Y to count as an answer', () => {
  const doc = (i, text) => ({ title: `T${i}`, url: `https://s${i}.example.org/x`, origin: `s${i}.example.org`, domain: `s${i}.example.org`, kind: 'web', quality: 0.6, blocks: [{ type: 'p', text, heading: '' }] });
  const qm = queryModel(part('The impact of remote work on productivity'));
  assert.deepEqual(qm.requiredAll.map((x) => [...x]), [['product']]);
  assert.equal(queryModel(part('What are the health effects of microplastics?')).requiredAll.length, 0);
  const r = rankEvidence([
    doc(1, 'Many studies have investigated how remote work adaptation and control over scheduling reduced burnout, thus improving the impact of remote work on employee wellbeing.'),
    doc(2, 'The findings indicate that remote work can enhance productivity through increased flexibility, autonomy, and reduced commuting time.'),
  ], qm);
  assert.match(r.sentences[0].text, /enhance productivity/);
  assert.ok(r.sentences[1].score < r.sentences[0].score * 0.6, 'the statement about wellbeing ranks far below');
});

test('scholarly indexes: abstracts and article XML become plain text', () => {
  assert.equal(invertedToText({ Microplastics: [0], are: [1], everywhere: [2] }), 'Microplastics are everywhere');
  assert.equal(jatsAbstractToText('<jats:title>Abstract</jats:title><jats:sec><jats:title>Background</jats:title><jats:p>Remote work rose &amp; stayed.</jats:p></jats:sec><jats:sec><jats:title>Results</jats:title><jats:p>Output grew by 13%.</jats:p></jats:sec>'), 'Background: Remote work rose & stayed. Results: Output grew by 13%.');
  const art = jatsToBlocks('<article><front><article-meta><title-group><article-title>Plastics in blood</article-title></title-group></article-meta></front><body><sec><title>Introduction</title><p>Microplastics have been detected in human blood samples in several studies so far.</p></sec><sec><title>Results</title><p>Particles were found in 17 of 22 donors, mostly PET and polystyrene fragments.</p><table-wrap><p>ignored table text that must not appear anywhere</p></table-wrap></sec></body><back><ref-list><ref>Ref 1</ref></ref-list></back></article>');
  assert.equal(art.title, 'Plastics in blood');
  assert.deepEqual(art.blocks.filter((b) => b.type === 'heading').map((b) => b.text), ['Introduction', 'Results']);
  assert.ok(!JSON.stringify(art.blocks).includes('ignored table'));
  assert.equal(studyFromTypes(['Journal Article', 'Meta-Analysis']), 'meta-analysis');
  assert.equal(studyFromTypes(['Randomized Controlled Trial']), 'randomised trial');
});

test('Crossref provider: works with abstracts become documents marked as abstracts', async () => {
  const hc = createHttpClient({ ...loadConfig({}).http, lookup: async () => [{ address: '93.184.216.34', family: 4 }], transport: async (u) => {
    assert.equal(u.hostname, 'api.crossref.org');
    assert.match(u.search, /filter=has-abstract(%3A|:)true/);
    return { status: 200, headers: { 'content-type': 'application/json' }, truncated: false, body: Buffer.from(JSON.stringify({ message: { 'total-results': 2, items: [
      { DOI: '10.1000/abc.1', title: ['Remote work and productivity'], abstract: '<jats:p>' + 'Remote work changed how teams collaborate and how output is measured across firms. '.repeat(3) + '</jats:p>', published: { 'date-parts': [[2024, 5, 2]] }, 'container-title': ['Journal of Work'], type: 'journal-article', 'is-referenced-by-count': 12, author: [{ given: 'A', family: 'Rai' }] },
      { DOI: '10.1000/abc.2', title: ['A preprint'], abstract: '<jats:p>short</jats:p>', issued: { 'date-parts': [[2023]] }, type: 'posted-content' },
    ] } })) };
  } });
  const out = await crossref.search('remote work productivity', { http: hc, cfg: { contact: 'ops@example.org' }, limit: 100 });
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://doi.org/10.1000/abc.1');
  assert.equal(out[0].meta.year, 2024); assert.equal(out[0].date, '2024-05-02'); assert.equal(out[0].meta.citedBy, 12);
  assert.equal(out[0].content.partial, true);                      // an abstract is never a page read
  assert.equal(out[1].content, null);                              // too short to count as a source
  assert.equal(out[1].meta.study, 'preprint');
  hc.close();
});

test('HTTP client: a failing search endpoint does not block the rest of its host', async () => {
  let n = 0;
  const hc = createHttpClient({ ...loadConfig({}).http, lookup: async () => [{ address: '93.184.216.34', family: 4 }], transport: async (u) => {
    n++;
    if (u.pathname === '/search') { const e = new Error('Timed out after 10 ms'); e.code = 'timeout'; throw e; }
    return { status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('full text'), truncated: false };
  } });
  for (let i = 0; i < 3; i++) await assert.rejects(hc.get('https://api.example.org/search?q=' + i, { circuit: 'search', accept: 'any', cache: false }), /Timed out/);
  await assert.rejects(hc.get('https://api.example.org/search?q=x', { circuit: 'search', accept: 'any', cache: false }), /skipped after repeated failures/);
  const before = n;
  const ok = await hc.get('https://api.example.org/fulltext/1', { accept: 'any', cache: false });        // another endpoint of the same host still answers
  assert.equal(ok.status, 200); assert.equal(n, before + 1);
  assert.equal(hc.hostDown('api.example.org'), false);
  hc.close();
});

test('HTTP client: an API with a per-second limit gets its requests spaced out', async () => {
  const starts = [];
  const hc = createHttpClient({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }], respectRobots: false,
    rateClasses: [{ id: 'paced', label: 'Paced API', perMin: 100, gapMs: 90, test: (u) => u.hostname === 'api.example.org' }],
    transport: async () => { starts.push(Date.now()); return { status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('ok'), truncated: false }; },
  });
  await Promise.all([1, 2, 3, 4].map((i) => hc.get('https://api.example.org/works?q=' + i, { accept: 'any', cache: false })));
  await hc.get('https://other.example.org/x', { accept: 'any', cache: false });      // other hosts are not slowed down
  const gaps = starts.slice(1, 4).map((t, i) => t - starts[i]);
  assert.ok(gaps.every((g) => g >= 75), `gaps between the starts: ${gaps.join(', ')} ms`);
  assert.ok(starts[4] - starts[3] < 60, 'a host without a per-second limit starts at once');
  hc.close();
});

test('classification: kinds, study designs, stance and counted facets', () => {
  const now = Date.parse('2026-11-12');
  const mk = (o) => ({ blocks: [{ type: 'p', text: 'x'.repeat(400) }], quality: 0.7, rel: 0.8, origin: o.url, ...o });
  const docs = [
    mk({ url: 'https://doi.org/10.1/a', domain: 'doi.org', title: 'A meta-analysis of fasting', kind: 'academic', partial: true, scholar: { type: 'article', study: 'meta-analysis', year: 2024, citedBy: 40 }, published: '2024-03-01', sid: 1, stance: 'supports', themes: [0] }),
    mk({ url: 'https://www.bbc.com/news/health-1', domain: 'bbc.com', title: 'Fasting diets: what the evidence says', kind: 'news', published: '2026-10-30', stance: 'qualified' }),
    mk({ url: 'https://en.wikipedia.org/wiki/Intermittent_fasting', domain: 'wikipedia.org', title: 'Intermittent fasting', kind: 'encyclopedia', provider: 'wikipedia', stance: 'supports', themes: [0, 1] }),
    mk({ url: 'https://example.co.uk/blog/fasting', domain: 'example.co.uk', title: 'My fasting diary', offTopic: true, rel: 0.2 }),
  ];
  for (const d of docs) d.cls = classifyDoc(d, now);
  assert.equal(docs[0].cls.study, 'meta-analysis');
  assert.equal(docs[0].cls.access, 'abstract or summary only');
  assert.equal(docs[1].cls.access, 'full text read');
  assert.equal(docs[1].cls.recency, 'last 30 days');
  assert.equal(docs[3].cls.region, 'United Kingdom');
  const C = buildClassification(docs, { now, themes: [{ label: 'Weight loss', source: 'recurring phrase' }, { label: 'Metabolic health', source: 'recurring phrase' }], yesno: true, screened: 120, failed: 5, failures: { 'refused automated access': 5 } });
  assert.deepEqual([C.totals.documents, C.totals.relevant, C.totals.offTopic, C.totals.fullText, C.totals.abstracts, C.totals.cited, C.totals.screened, C.totals.failed], [4, 3, 1, 2, 1, 1, 120, 5]);
  const facet = (id) => C.facets.find((f) => f.id === id);
  assert.deepEqual(facet('stance').values.map((v) => [v.label, v.count]), [['Leans yes', 2], ['Qualified or uncertain', 1]]);
  assert.deepEqual(facet('theme').values.map((v) => [v.label, v.count]), [['Weight loss', 2], ['Metabolic health', 1]]);
  assert.equal(facet('relevance').values.find((v) => v.id === 'read, not relevant').count, 1);
  assert.equal(C.items[0].c, 1);                                                // the cited document is listed first
  assert.equal(C.items.length, 4);
  // which way a statement leans is read from its main clause
  assert.equal(stanceOf('Intermittent fasting is an effective approach for weight loss.'), 'supports');
  assert.equal(stanceOf('Intermittent fasting does not lead to greater weight loss than daily calorie restriction.'), 'contradicts');
  assert.equal(stanceOf('Weight loss occurs over time if energy intake on feeding days is not sufficient to compensate.'), 'supports');
  assert.equal(stanceOf('The diet not only reduces weight but also improves insulin sensitivity.'), 'supports');
  assert.equal(stanceOf('The study proved that intermittent fasting results in weight loss but with no large significant effects on other body composition parameters.'), 'supports');
  assert.equal(stanceOf('Fasting did not reduce weight but improved other markers.'), 'contradicts');
  assert.equal(stanceOf('Evidence is mixed and more research is needed.'), 'qualified');
});

// ------------------------------------------------------------------------------------------------------------------
// A complete run against a small synthetic web: one search service, one scholarly index, forty sites.
const TOPICS = ['Inflammation', 'Oxidative stress', 'Gut microbiome', 'Respiratory effects', 'Reproductive effects', 'Endocrine disruption'];
const FINDINGS = {
  Inflammation: ['can trigger inflammation in the gut and the lungs', 'cause chronic inflammation of exposed tissues'],
  'Oxidative stress': ['cause oxidative stress in human cells', 'lead to oxidative stress and DNA damage'],
  'Gut microbiome': ['disturb the gut microbiome and the intestinal barrier', 'alter the gut microbiome in exposed people'],
  'Respiratory effects': ['can cause respiratory effects such as airway irritation when inhaled', 'lead to respiratory effects including reduced lung function'],
  'Reproductive effects': ['are linked to reproductive effects such as lower sperm quality', 'may cause reproductive effects in adults'],
  'Endocrine disruption': ['cause endocrine disruption through the additives they carry', 'can lead to endocrine disruption in exposed people'],
};
function syntheticWeb() {
  const pages = new Map();
  const sites = Array.from({ length: 40 }, (_, i) => `synthetic-site-${i + 1}.org`);          // made-up names: every request is answered by the transport below, none leaves the process
  sites.forEach((host, i) => {
    const topic = TOPICS[i % TOPICS.length], other = TOPICS[(i + 1) % TOPICS.length];
    const s1 = `Studies of people show that microplastics ${FINDINGS[topic][i % 2]}, according to the report by group ${i + 1}.`;
    const s2 = `The health effects of microplastics include ${topic.toLowerCase()} and ${other.toLowerCase()}, the authors of report ${i + 1} conclude.`;
    // links stand inside sentences, as on real pages (a paragraph made only of links would be taken for navigation)
    const link = (k) => `<a href="https://${sites[(i + k * 7) % sites.length]}/more-${k}">a further report on the health effects of microplastics</a>`;
    // some pages also link to addresses inside a private network, with a perfectly on-topic link text: the crawler must never request them
    const hostile = i % 5 === 0 ? ` See also <a href="http://127.0.0.1:8080/health-effects-of-microplastics">the internal report on the health effects of microplastics</a>, <a href="http://169.254.169.254/latest/meta-data/microplastics-health-effects">health effects of microplastics data</a> and <a href="http://intranet.local/microplastics-health-effects">more health effects of microplastics</a>.` : '';
    const body = (extra) => `<html><head><title>Health effects of microplastics: ${topic} (${i + 1})</title></head><body><article><h1>Health effects of microplastics: ${topic}</h1><p>${s1} The same was seen in ${link(1)}, which looked at other groups of people.${hostile}</p><h2>${topic}</h2><p>${s2} ${extra}</p><p>Microplastics are plastic particles that people take in with food, water and air every day of the year, report ${i + 1} notes, and ${link(2)} gives the measured amounts, while ${link(3)} describes how the particles enter the body.</p></article></body></html>`;
    pages.set(`https://${host}/article`, body('This page is the main article of the site.'));
    for (const k of [1, 2, 3]) pages.set(`https://${host}/more-${k}`, body(`Part ${k} adds that microplastics ${FINDINGS[other][k % 2]} as well, a finding of the follow-up number ${k} of group ${i + 1}.`));
  });
  pages.set('https://synthetic-blocked.org/article', null);                         // answers 403
  const works = Array.from({ length: 60 }, (_, i) => {
    const topic = TOPICS[i % TOPICS.length];
    return { DOI: `10.5555/mp.${i + 1}`, title: [`Microplastics and ${topic.toLowerCase()}: a ${i % 5 === 0 ? 'systematic review' : 'study'} (${i + 1})`], abstract: `<jats:p>In this cohort, microplastics ${FINDINGS[topic][i % 2]}. The health effects of microplastics were assessed in ${200 + i} adults, and exposure was associated with ${topic.toLowerCase()} in the exposed group number ${i + 1}.</jats:p>`, published: { 'date-parts': [[2015 + (i % 12), 3, 1]] }, 'container-title': ['Journal of Synthetic Tests'], type: 'journal-article', 'is-referenced-by-count': i };
  });
  const stats = { searches: 0, crossref: 0, pages: 0, other: 0, privateRequests: 0 };
  const web = { delayMs: 0 };                                                    // a test can slow page delivery down to hold a run open
  const json = (o) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(o)), truncated: false });
  const transport = async (u) => {
    if (/^(127\.|10\.|169\.254\.|192\.168\.)|\.local$|^localhost$/.test(u.hostname)) stats.privateRequests++;
    if (u.pathname === '/robots.txt') return { status: 404, headers: {}, body: Buffer.alloc(0), truncated: false };
    if (u.hostname === 'api.mwmbl.org') {
      stats.searches++;
      const q = (u.searchParams.get('s') || '').toLowerCase();
      const hit = sites.map((h, i) => ({ h, i, topic: TOPICS[i % TOPICS.length] })).filter((x) => !TOPICS.some((t) => q.includes(t.toLowerCase())) || q.includes(x.topic.toLowerCase())).slice(0, 30);
      return json([...hit.map((x) => ({ url: `https://${x.h}/article`, title: [{ value: `Health effects of microplastics: ${x.topic} (${x.i + 1})` }], extract: [{ value: 'microplastics health effects' }] })), { url: 'https://synthetic-blocked.org/article', title: [{ value: 'Health effects of microplastics (blocked site)' }], extract: [{ value: 'microplastics health effects' }] }]);
    }
    if (u.hostname === 'api.crossref.org') { stats.crossref++; return json({ message: { 'total-results': works.length, items: works } }); }
    const key = u.origin + u.pathname;
    if (pages.has(key)) { stats.pages++; if (web.delayMs) await new Promise((r) => setTimeout(r, web.delayMs)); const body = pages.get(key); return body == null ? { status: 403, headers: {}, body: Buffer.from('forbidden'), truncated: false } : { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(body), truncated: false }; }
    stats.other++;
    return { status: 404, headers: {}, body: Buffer.alloc(0), truncated: false };
  };
  return Object.assign(web, { transport, stats, sites });
}
const ONLY = ['wikipedia', 'ddg_instant', 'searxng', 'tavily', 'brave', 'ddg_html', 'firecrawl', 'marginalia', 'wiby', 'stackexchange', 'mdn', 'arxiv', 'openalex', 'europepmc', 'hackernews', 'feeds', 'gdelt', 'wikidata'].join(',');
function syntheticConfig(extra = {}) {
  const web = syntheticWeb();
  const cfg = loadConfig({ DISABLE_PROVIDERS: ONLY, LOG_LEVEL: 'silent', RATE_LIMIT_PER_MIN: '600', RATE_LIMIT_BURST: '200', ...extra });
  cfg.http.transport = web.transport;
  cfg.http.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  cfg.http.rateClasses = (cfg.http.rateClasses || []).map((r) => ({ ...r, perMin: 100000 }));
  return { cfg, web };
}

test('research run, end to end on a synthetic web: rounds, counters, drafts, report, classification', async () => {
  resetCooling();
  const { cfg, web } = syntheticConfig();
  const engine = createEngine(cfg);
  const events = [];
  const r = await engine.ask({ question: 'Do deep research on the health effects of microplastics', settings: { depth: 'auto' } }, { onEvent: (ev) => events.push(ev) });
  engine.close();
  assert.equal(r.kind, 'retrieval');
  assert.deepEqual(r.depth, { asked: 'auto', used: 'research' });
  assert.equal(r.interpretation.rewrites[0].to, 'The health effects of microplastics');
  // what the run reports is what happened
  const fetched = r.research.counts.pagesFetched;
  assert.equal(r.run.mode, 'research');
  assert.equal(r.run.pages, fetched);
  assert.ok(r.run.pages >= 60, `pages read: ${r.run.pages}`);                    // 40 sites × 4 pages exist; links were followed beyond the search results
  assert.ok(r.run.pages <= web.stats.pages, 'never more pages reported than were requested');
  assert.equal(web.stats.privateRequests, 0, 'links to private addresses found on pages were never requested');
  assert.ok(r.run.rounds >= 2 && r.run.linksFollowed > 0 && r.run.abstracts >= 40, JSON.stringify({ rounds: r.run.rounds, links: r.run.linksFollowed, abstracts: r.run.abstracts }));
  assert.ok(r.run.stopped.length > 0);
  assert.ok(r.research.counts.pagesFailed >= 1);                                 // the site that answers 403 is counted as not readable
  // abstracts are counted apart from pages read
  const T = r.classification.totals;
  assert.equal(T.fullText + T.abstracts, T.relevant);
  assert.ok(T.abstracts >= 40 && T.fullText >= 60 && T.documents >= 100, JSON.stringify(T));
  assert.ok(T.failures['refused automated access'] >= 1);
  assert.deepEqual(r.classification.facets.map((f) => f.id).filter((id) => ['source', 'doc', 'access', 'relevance'].includes(id)), ['source', 'doc', 'access', 'relevance']);
  assert.ok(r.classification.timeline.length >= 5);
  assert.ok(r.classification.items.length >= 100 && r.classification.items.some((it) => it.c));
  // events: start and end of the run, live counters, drafts before the final answer, the first draft straight after the quick round
  const types = events.map((e) => e.type);
  assert.deepEqual(events.filter((e) => e.type === 'research').map((e) => e.status), ['start', 'done']);
  assert.ok(types.filter((t) => t === 'progress').length >= 2);
  const drafts = events.filter((e) => e.type === 'draft');
  assert.ok(drafts.length >= 2, `drafts: ${drafts.length}`);
  assert.equal(drafts[0].round, 1);
  assert.equal(drafts[0].result.draft, true);
  assert.ok(types.indexOf('draft') < types.lastIndexOf('answer'));
  assert.equal(events.filter((e) => e.type === 'answer').length, 1);
  const progress = events.filter((e) => e.type === 'progress');
  assert.ok(progress.every((p, i) => i === 0 || p.read >= progress[i - 1].read), 'the page counter never goes down');
  // the report: sub-topic sections found in the material, every statement cited, text only from the pages
  const subs = r.answer.blocks.filter((b) => b.type === 'heading' && b.subtopic).map((b) => b.text);
  assert.ok(subs.length >= 3, `sections: ${subs.join(', ')}`);
  assert.ok(subs.some((s) => /oxidative stress/i.test(s)) && subs.some((s) => /inflammation/i.test(s)), subs.join(', '));
  for (const b of r.answer.blocks) if (b.type === 'list') for (const it of b.items) assert.ok(it.spans.some((sp) => sp.cites && sp.cites.length), 'a statement without a citation');
  assert.ok(r.sources.length >= 10 && r.confidence.level !== 'insufficient');
  assert.match(blocksToText(r.answer.blocks), /microplastics/i);
});

test('research runs are limited: per instance, per hour, and by the caller; the answer then says so', async () => {
  resetCooling();
  const { cfg, web } = syntheticConfig({ MAX_CONCURRENT_RESEARCH: '1', RESEARCH_PER_HOUR: '2' });
  const engine = createEngine(cfg);
  const ask = (extra = {}, onEvent = null) => engine.ask({ question: 'Do deep research on the health effects of microplastics', settings: { depth: 'auto' }, ...extra }, { onEvent });
  // a second request arrives while a run is in progress and there is room for one: it is answered at depth "deep" and says why
  // (page delivery is slowed down once the first run has started, so that it is still going when the second one gets that far)
  let second = null;
  const a = await ask({}, (e) => { if (e.type === 'research' && e.status === 'start' && !second) { web.delayMs = 150; second = ask(); } });
  const limited = await second;
  web.delayMs = 0;
  assert.equal(a.depth.used, 'research');
  assert.equal(limited.depth.used, 'deep');
  assert.match(limited.depth.limited, /already in progress/);
  assert.match(blocksToText(limited.answer.blocks), /A full research run was not started/);
  assert.equal(limited.run.mode, 'deep');
  assert.equal(engine.status().research.running, 0);                              // the slot is given back when a run ends
  // the caller's own limit (the HTTP server uses it per client address)
  const c = await ask({ researchAllowed: () => 'this device has started 6 research runs in the last hour' });
  assert.equal(c.depth.used, 'deep'); assert.match(c.depth.limited, /this device/);
  // per hour on this instance: one more is allowed (2 per hour), the next is not
  assert.equal((await ask()).depth.used, 'research');
  const e = await ask();
  assert.equal(e.depth.used, 'deep'); assert.match(e.depth.limited, /in the last hour/);
  // research switched off altogether
  engine.close();
  const off = createEngine(syntheticConfig({ RESEARCH_MODE: '0' }).cfg);
  assert.equal((await off.ask({ question: 'the health effects of microplastics', settings: { depth: 'research' } }, {})).depth.used, 'deep');
  off.close();
});

test('server: a research run streams counters and drafts, costs more allowance, and is limited per client', async () => {
  resetCooling();
  const { cfg } = syntheticConfig({ RESEARCH_PER_CLIENT_PER_HOUR: '1', RATE_LIMIT_PER_MIN: '1', RATE_LIMIT_BURST: '10' });
  const app = createApp(cfg);
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (body) => { const res = await fetch(base + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const text = await res.text(); return { status: res.status, events: res.ok ? text.trim().split('\n').map((l) => JSON.parse(l)) : [], json: res.ok ? null : JSON.parse(text) }; };
    const st = await (await fetch(base + '/api/status')).json();
    assert.deepEqual(st.depths, ['auto', 'fast', 'balanced', 'deep', 'research']);
    assert.equal(st.research.enabled, true); assert.equal(st.research.perClientPerHour, 1);
    // allowance: 10. A request at depth "research" costs 4 in all → 6 left
    const one = await post({ question: 'the health effects of microplastics', settings: { depth: 'research' } });
    assert.equal(one.status, 200);
    const kinds = new Set(one.events.map((e) => e.type));
    for (const t of ['research', 'progress', 'draft', 'answer', 'done']) assert.ok(kinds.has(t), `missing ${t} event`);
    assert.equal(one.events.filter((e) => e.type === 'answer')[0].result.depth.used, 'research');
    assert.equal(one.events[one.events.length - 1].type, 'done');
    // the same client asks again: its one research run per hour is used up → answered at depth "deep", with the reason → 2 left
    const two = await post({ question: 'the health effects of microplastics', settings: { depth: 'research' } });
    const ans = two.events.filter((e) => e.type === 'answer')[0].result;
    assert.equal(ans.depth.used, 'deep'); assert.match(ans.depth.limited, /this device has started 1 research run/);
    // 2 left: a third research-depth request cannot pay its 4 and is refused (the request itself has cost 1 → 1 left) …
    const three = await post({ question: 'the health effects of microplastics', settings: { depth: 'research' } });
    assert.equal(three.status, 429); assert.equal(three.json.error, 'rate_limited'); assert.match(three.json.message, /depth “research” counts 4 times/);
    // … while an ordinary message still passes, and the one after it does not
    assert.equal((await post({ question: 'hello', settings: { depth: 'auto' } })).status, 200);
    assert.equal((await post({ question: 'hello', settings: { depth: 'auto' } })).status, 429);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    app.engine.close();
  }
});
