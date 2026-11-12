// INFINI AI — evidence layer: source classification, independence of origins, conflict detection,
// claim typing (fact / opinion / hedged, current / historical), the evidence graph and confidence scoring.
// All rules are explicit and inspectable. The domain patterns below describe *kinds of publishers* (configuration),
// they are heuristics — incomplete and skewed towards English-language sources — and they never contain answers.

import { domainOf, hostOf, shingles, jaccard, tokenize, clamp, truncate } from '../util/text.js';

const REF = /(^|\.)(wikipedia\.org|britannica\.com|wiktionary\.org|encyclopedia\.com|scholarpedia\.org|wikidata\.org|wikibooks\.org|wikivoyage\.org)$/;
const SCHOLAR = /(^|\.)(arxiv\.org|doi\.org|nature\.com|science\.org|sciencedirect\.com|springer\.com|pnas\.org|europepmc\.org|plos\.org|acm\.org|ieee\.org|jstor\.org|cell\.com|thelancet\.com|bmj\.com|nejm\.org|biorxiv\.org|medrxiv\.org|semanticscholar\.org|openalex\.org|wiley\.com|tandfonline\.com|oup\.com|cambridge\.org|frontiersin\.org|mdpi\.com)$/;
const DOCS = /(^|\.)(developer\.mozilla\.org|docs\.python\.org|learn\.microsoft\.com|developer\.apple\.com|developer\.android\.com|doc\.rust-lang\.org|go\.dev|nodejs\.org|kubernetes\.io|docs\.github\.com|w3\.org|whatwg\.org|ietf\.org|rfc-editor\.org|readthedocs\.io|postgresql\.org|sqlite\.org|react\.dev|vuejs\.org|angular\.dev|rust-lang\.org|python\.org|typescriptlang\.org|cppreference\.com|php\.net|ruby-lang\.org|kernel\.org|git-scm\.com|docker\.com|tc39\.es)$|^(docs|developer|developers|documentation|manual)\./;
const NEWS = /(^|\.)(reuters\.com|apnews\.com|bbc\.com|bbc\.co\.uk|npr\.org|aljazeera\.com|theguardian\.com|nytimes\.com|washingtonpost\.com|dw\.com|france24\.com|economist\.com|ft\.com|bloomberg\.com|cnn\.com|abc\.net\.au|cbc\.ca|thehindu\.com|kathmandupost\.com|thehimalayantimes\.com|onlinekhabar\.com|nepalitimes\.com|khabarhub\.com|arstechnica\.com|techcrunch\.com|theverge\.com|wired\.com|sciencedaily\.com|newscientist\.com|scientificamerican\.com|nationalgeographic\.com|smithsonianmag\.com|time\.com|theatlantic\.com|pbs\.org|cbsnews\.com|nbcnews\.com|usatoday\.com|wsj\.com|indianexpress\.com|indiatimes\.com|hindustantimes\.com|risingnepaldaily\.com|nagariknetwork\.com|setopati\.com|ekantipur\.com|space\.com|phys\.org|livescience\.com|technologyreview\.com|quantamagazine\.org|theconversation\.com)$/;
const COMMUNITY = /(^|\.)(stackoverflow\.com|stackexchange\.com|superuser\.com|serverfault\.com|askubuntu\.com|mathoverflow\.net)$/;
const UGC = /(^|\.)(reddit\.com|quora\.com|medium\.com|blogspot\.com|wordpress\.com|tumblr\.com|substack\.com|x\.com|twitter\.com|facebook\.com|youtube\.com|tiktok\.com|instagram\.com|pinterest\.com|linkedin\.com|dev\.to|hashnode\.dev|answers\.com|fandom\.com|ycombinator\.com|github\.io|everything2\.com|blogger\.com|livejournal\.com|neocities\.org)$/;
const GOV = /\.(gov|mil|int)$|\.gov\.[a-z]{2}$|\.gouv\.fr$|(^|\.)(europa\.eu|un\.org|who\.int|cern\.ch|worldbank\.org|imf\.org|oecd\.org|esa\.int|nobelprize\.org)$/;
const EDU = /\.edu$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$/;
const WIKIMEDIA = /(^|\.)(wikipedia|wikidata|wikimedia|wiktionary|wikibooks|wikivoyage)\.org$/;

/**
 * Classify a source. meta: {author, published, quality:{fallback,chars,linkDensity}, via, kind, provider, se:{accepted,topScore}}
 * learned: {domain: {good, bad}} — user feedback / fetch history supplied by the client (clearable).
 */
export function classifySource(url, meta = {}, learned = null) {
  const host = hostOf(url), domain = domainOf(url);
  let category = 'unknown', sourceType = 'secondary', quality = 0.5;
  const notes = [];
  if (meta.structured) { category = 'structured data'; sourceType = 'reference'; quality = 0.8; }
  else if (GOV.test(host)) { category = 'official / institutional'; sourceType = 'primary'; quality = 0.88; }
  else if (SCHOLAR.test(host)) { category = /rxiv\.org$/.test(host) ? 'preprint' : 'scholarly'; sourceType = 'primary'; quality = /rxiv\.org$/.test(host) ? 0.76 : 0.86; }
  else if (DOCS.test(host)) { category = 'official documentation'; sourceType = 'primary'; quality = 0.86; }
  else if (REF.test(host)) { category = 'encyclopedia'; sourceType = 'reference'; quality = 0.8; }
  else if (EDU.test(host)) { category = 'academic institution'; sourceType = 'secondary'; quality = 0.8; }
  else if (NEWS.test(host)) { category = 'news / journalism'; sourceType = 'secondary'; quality = 0.76; }
  else if (COMMUNITY.test(host)) { category = 'community Q&A'; sourceType = 'community'; quality = 0.62; }
  else if (UGC.test(host)) { category = 'user-generated'; sourceType = 'community'; quality = 0.4; }
  else if (meta.kind === 'news') { category = 'news feed'; sourceType = 'secondary'; quality = 0.6; }
  if (meta.se) { if (meta.se.accepted) { quality += 0.07; notes.push('accepted answer'); } if (meta.se.topScore >= 20) { quality += 0.05; notes.push(`answer score ${meta.se.topScore}`); } }
  if (category === 'unknown') { if (meta.author) quality += 0.03; if (meta.published) quality += 0.03; }
  const q = meta.quality || {};
  if (q.fallback) { quality -= 0.12; notes.push(`extracted via ${q.fallback} fallback`); }
  if (q.chars && q.chars < 600 && !meta.via) { quality -= 0.08; notes.push('very little readable text'); }
  if (q.linkDensity > 0.5) { quality -= 0.06; notes.push('link-heavy page'); }
  if (/^http:/.test(url)) quality -= 0.03;
  if (meta.partial) notes.push('summary/abstract only');
  if (learned && learned[domain]) {
    const { good = 0, bad = 0 } = learned[domain];
    const adj = clamp((good - bad * 1.5) * 0.02, -0.12, 0.08);
    if (adj) { quality += adj; notes.push(`history ${adj > 0 ? '+' : ''}${adj.toFixed(2)}`); }
  }
  return { domain, host, category, sourceType, quality: clamp(quality, 0.1, 0.95), origin: WIKIMEDIA.test(host) || meta.via === 'ddg-instant-answer' ? 'wikimedia' : domain, notes };
}

/** Group documents by independent origin: same publisher family, or near-identical text (syndicated copies). */
export function originGroups(docs) {
  const n = docs.length;
  const parent = docs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  const sh = docs.map((d) => {
    if (d.offTopic) return null;
    const text = (d.blocks || []).filter((b) => b.type === 'p').slice(0, 12).map((b) => b.text).join(' ').slice(0, 2400);
    const toks = tokenize(text);
    return toks.length >= 40 ? shingles(toks, 5) : null;
  });
  // same origin: one pass
  const first = new Map();
  for (let i = 0; i < n; i++) { const o = docs[i].origin; if (first.has(o)) union(i, first.get(o)); else first.set(o, i); }
  const copy = (i, j) => { if (sh[i] && sh[j] && docs[i].origin !== docs[j].origin && jaccard(sh[i], sh[j]) > 0.45) { union(i, j); docs[j].copyOf = docs[i].url; } };
  if (n <= 80) { for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) copy(i, j); }
  else {
    // many documents: only pairs that share one of their smallest shingle hashes are compared (near-copies always do)
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      if (!sh[i]) continue;
      const hs = [];
      for (const x of sh[i]) { let h = 0x811c9dc5; for (let k = 0; k < x.length; k++) { h ^= x.charCodeAt(k); h = Math.imul(h, 0x01000193); } hs.push(h >>> 0); }
      hs.sort((a, b) => a - b);
      for (const h of hs.slice(0, 6)) { let b = buckets.get(h); if (!b) buckets.set(h, (b = [])); b.push(i); }
    }
    const done = new Set();
    for (const b of buckets.values()) {
      if (b.length < 2 || b.length > 40) continue;
      for (let x = 0; x < b.length; x++) for (let y = x + 1; y < b.length; y++) { const k = b[x] * 100003 + b[y]; if (done.has(k)) continue; done.add(k); copy(b[x], b[y]); }
    }
  }
  const ids = new Map();
  return docs.map((_, i) => { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r); });
}

const NEGATION = /\b(not|no|never|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|unable|impossible|false|myth|incorrect|untrue|debunked|misconception|neither|nor|without|fails? to|lacks?)\b/i;
const numbersIn = (text) => {
  const years = new Set(), nums = [];
  const re = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(million|billion|trillion|thousand|percent|%|km|kilometers|kilometres|miles|m|metres|meters|feet|ft|kg|years|people|°c|°f))?/gi;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1].replace(/,/g, '');
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    if (/^(1[0-9]{3}|20[0-9]{2})$/.test(raw) && !m[2]) years.add(v);
    else nums.push({ v: v * ({ thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 }[(m[2] || '').toLowerCase()] || 1), unit: (m[2] || '').toLowerCase().replace(/^(million|billion|trillion|thousand)$/, '') });
  }
  return { years, nums };
};

/**
 * Detect statements from different origins that talk about the same thing but disagree.
 * claims: [{text, stems:Set, origin, di}]. Returns [{a, b, kind, detail}] (indices into claims).
 */
export function detectConflicts(claims, { minSim = 0.5 } = {}) {
  const out = [];
  const info = claims.map((c) => ({ neg: NEGATION.test(c.text), n: numbersIn(c.text), content: new Set([...c.stems].filter((s) => !/^\d/.test(s))) }));
  for (let i = 0; i < claims.length; i++) for (let j = i + 1; j < claims.length; j++) {
    if (claims[i].origin === claims[j].origin) continue;
    const sim = jaccard(info[i].content, info[j].content);
    if (sim < minSim) continue;
    const A = info[i], B = info[j];
    if (A.neg !== B.neg && sim >= 0.6) { out.push({ a: i, b: j, kind: 'negation', detail: 'one source negates what the other states', sim }); continue; }
    if (A.n.years.size && B.n.years.size && sim >= 0.55 && A.n.years.size <= 2 && B.n.years.size <= 2 && ![...A.n.years].some((y) => B.n.years.has(y))) { out.push({ a: i, b: j, kind: 'date', detail: `${[...A.n.years].join('/')} vs ${[...B.n.years].join('/')}`, sim }); continue; }
    if (A.n.nums.length === 1 && B.n.nums.length === 1 && A.n.nums[0].unit === B.n.nums[0].unit && sim >= 0.6) {
      const x = A.n.nums[0].v, y = B.n.nums[0].v;
      if (x && y && Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y)) > 0.05) out.push({ a: i, b: j, kind: 'number', detail: `${x.toLocaleString('en-US')} vs ${y.toLocaleString('en-US')}${A.n.nums[0].unit ? ' ' + A.n.nums[0].unit : ''}`, sim });
    }
  }
  return out;
}

/** Label how a statement should be read: stated fact, hedged/reported, or opinion; current, dated or historical. */
export function claimNature(sentence, doc, now = Date.now()) {
  const text = sentence.text;
  const community = doc.sourceType === 'community';
  let nature = 'stated as fact';
  if (sentence.opinion || (community && /\b(i|my|we)\b/i.test(text))) nature = 'opinion';
  else if (sentence.hedged) nature = 'hedged / reported';
  const years = (text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []).map(Number);
  const thisYear = new Date(now).getUTCFullYear();
  let temporal = 'undated';
  if (years.length && Math.max(...years) < thisYear - 1 && /\b(was|were|had|did|became|began|ended|died|founded|built|invented|discovered|[a-z]+ed)\b/i.test(text)) temporal = 'historical';
  else if (years.length && Math.max(...years) >= thisYear - 1) temporal = 'recent';
  else if (doc.published || doc.modified) temporal = `as of ${String(doc.modified || doc.published).slice(0, 10)}`;
  return { nature, temporal };
}

/**
 * Confidence from explicit, inspectable factors. Input (per answer):
 * {cited:[{quality, origin, partial, evidenceLevel}], keyClaims:n, corroborated:n, directness:0..1, partsAnswered, partsTotal,
 *  extraction:0..1, timeSensitive, freshOk, conflicts:n, structuredAgreement:bool, insufficient:bool}
 */
export function scoreConfidence(e) {
  const factors = [];
  if (e.insufficient || !e.cited.length) return { score: 0.1, level: 'insufficient', label: 'Not verified', factors: [{ name: 'evidence', value: 0, note: 'No passage in the retrieved sources answers the question directly.' }], caps: [] };
  const origins = new Set(e.cited.map((c) => c.origin));
  const q = e.cited.reduce((a, c) => a + c.quality, 0) / e.cited.length;
  const indep = origins.size >= 3 ? 1 : origins.size === 2 ? 0.75 : 0.42;
  const agree = e.keyClaims ? clamp(e.corroborated / e.keyClaims) : 0;
  const agreement = clamp(agree + (e.structuredAgreement ? 0.5 : 0));
  const complete = e.partsTotal ? e.partsAnswered / e.partsTotal : 1;
  const recency = !e.timeSensitive ? 1 : e.freshOk ? 1 : 0.3;
  factors.push({ name: 'Source quality', value: q, note: `average ${q.toFixed(2)} over ${e.cited.length} cited source${e.cited.length > 1 ? 's' : ''}` });
  factors.push({ name: 'Independent sources', value: indep, note: `${origins.size} independent origin${origins.size > 1 ? 's' : ''} (copies and sister projects count once)` });
  factors.push({ name: 'Agreement', value: agreement, note: e.keyClaims ? `${e.corroborated} of ${e.keyClaims} key statements are corroborated by another origin${e.structuredAgreement ? '; structured data agrees with the text' : ''}` : 'nothing to compare' });
  factors.push({ name: 'Directness', value: clamp(e.directness), note: e.directness >= 0.75 ? 'the evidence addresses the question directly' : e.directness >= 0.45 ? 'the evidence partly addresses the question' : 'the evidence is only loosely related' });
  factors.push({ name: 'Completeness', value: complete, note: `${e.partsAnswered} of ${e.partsTotal} part${e.partsTotal > 1 ? 's' : ''} answered` });
  factors.push({ name: 'Extraction quality', value: clamp(e.extraction), note: e.extraction >= 0.8 ? 'page text extracted cleanly' : 'some pages were only partly readable' });
  if (e.timeSensitive) factors.push({ name: 'Recency', value: recency, note: e.freshOk ? 'time-sensitive question; recent dated sources found' : 'time-sensitive question, but no recently dated source was found' });
  if (e.conflicts) factors.push({ name: 'Contradictions', value: 0, note: `${e.conflicts} possible conflict${e.conflicts > 1 ? 's' : ''} between sources` });
  let score = 0.26 * q + 0.2 * indep + 0.16 * agreement + 0.2 * clamp(e.directness) + 0.08 * complete + 0.05 * clamp(e.extraction) + 0.05 * recency - (e.conflicts ? Math.min(0.18, 0.08 * e.conflicts) : 0);
  const caps = [];
  const cap = (limit, why) => { if (score > limit) { score = limit; caps.push(why); } };
  if (origins.size === 1) cap(0.7, 'only one independent origin');
  if (e.timeSensitive && !e.freshOk) cap(0.5, 'could not confirm the information is current');
  if (e.cited.every((c) => c.partial)) cap(0.62, 'only summaries or abstracts were available, not full pages');
  if (e.directness < 0.4) cap(0.45, 'no passage answers the question directly');
  score = clamp(score);
  const level = score >= 0.74 ? 'high' : score >= 0.54 ? 'medium' : score >= 0.34 ? 'low' : 'insufficient';
  return { score: Number(score.toFixed(2)), level, label: { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', insufficient: 'Not verified' }[level], factors, caps };
}

/** Evidence graph. Nodes: question, subquestion, entity, claim, passage, source, date, relation, answer. */
export function buildGraph({ question, parts, entities, claims, sources, conflicts, relations = [] }) {
  const nodes = [], edges = [];
  const add = (id, type, label, extra) => { nodes.push({ id, type, label: truncate(label, 140), ...extra }); return id; };
  const link = (from, to, type) => edges.push({ from, to, type });
  add('q', 'question', question);
  parts.forEach((p, i) => { add(`sq${i}`, 'subquestion', p.text); link(`sq${i}`, 'q', 'relevant to'); add(`a${i}`, 'answer component', p.label || `Answer to part ${i + 1}`); link(`a${i}`, `sq${i}`, 'relevant to'); });
  entities.forEach((e, i) => { add(`e${i}`, 'entity', e.name, { kind: e.kind }); link(`e${i}`, 'q', 'relevant to'); });
  const dates = new Map();
  sources.forEach((s) => {
    add(`s${s.id}`, 'source', s.title || s.domain, { url: s.url, sourceType: s.sourceType });
    const d = (s.modified || s.published || '').slice(0, 10);
    if (d) { if (!dates.has(d)) dates.set(d, add(`d${dates.size}`, 'date', d)); link(`s${s.id}`, dates.get(d), s.modified ? 'updated at' : 'published at'); }
  });
  relations.forEach((r, i) => { add(`r${i}`, 'relation', `${r.subject} — ${r.property} → ${r.value}`); if (r.source) link(`r${i}`, `s${r.source}`, 'derived from'); if (r.part != null) link(`r${i}`, `a${r.part}`, 'supports'); });
  claims.forEach((c, i) => {
    add(`c${i}`, 'claim', c.text, { nature: c.nature, temporal: c.temporal });
    add(`p${i}`, 'passage', c.passage || c.text, { heading: c.heading });
    link(`c${i}`, `p${i}`, 'derived from');
    link(`p${i}`, `s${c.source}`, 'published by');
    link(`c${i}`, `a${c.part}`, 'supports');
    for (const s of c.alsoSupportedBy || []) link(`s${s}`, `c${i}`, 'supports');
    entities.forEach((e, k) => { if (c.text.toLowerCase().includes(e.name.toLowerCase())) link(`c${i}`, `e${k}`, 'refers to'); });
  });
  for (const x of conflicts || []) if (x.ca != null && x.cb != null) link(`c${x.ca}`, `c${x.cb}`, 'contradicts');
  const counts = {};
  for (const n of nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  const edgeCounts = {};
  for (const e of edges) edgeCounts[e.type] = (edgeCounts[e.type] || 0) + 1;
  return { nodes: nodes.slice(0, 220), edges: edges.slice(0, 500), counts, edgeCounts };
}
