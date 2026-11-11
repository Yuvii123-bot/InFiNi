// Wikidata — structured facts and knowledge-graph traversal (documented, keyless, CC0).
// Used for (1) direct factoid answers ("When was X born?"), (2) entity typing for follow-up resolution,
// (3) side-by-side comparison tables built from the properties two entities share.
// Entity documents come from the Linked Data interface (Special:EntityData), labels from the Action API.

import { enc } from './base.js';
import { formatDate } from '../util/dates.js';
import { stem, tokenize } from '../util/text.js';

const API = 'https://www.wikidata.org/w/api.php';

// Relation lexicon: maps question vocabulary onto Wikidata's property schema. This is linguistic knowledge
// (what the word "born" asks for), not world knowledge — the values always come from live retrieval.
// types: which question types the property can answer (omitted = any).
const R = (p, label, cues, types) => ({ p, label, cues: cues.split('|'), types: types ? types.split(' ') : null });
export const RELATIONS = [
  R('P569', 'date of birth', 'born|birth|birthday|birthdate', 'time'),
  R('P19', 'place of birth', 'born|birth|birthplace', 'place'),
  R('P570', 'date of death', 'die|died|death|dead|passed away', 'time'),
  R('P20', 'place of death', 'die|died|death', 'place'),
  R('P36', 'capital', 'capital|capital city'),
  R('P1082', 'population', 'population|inhabitants|people live|populous|how many people'),
  R('P38', 'currency', 'currency|money'),
  R('P35', 'head of state', 'president|king|queen|monarch|head of state|emperor'),
  R('P6', 'head of government', 'prime minister|chancellor|premier|mayor|head of government|governor'),
  R('P61', 'discoverer or inventor', 'invent|invented|inventor|discover|discovered|discoverer', 'person entity'),
  R('P575', 'time of discovery or invention', 'invent|invented|discover|discovered', 'time'),
  R('P112', 'founded by', 'found|founded|founder|founders|cofounder|started|established', 'person entity'),
  R('P571', 'inception', 'found|founded|establish|established|created|formed|started|inception|built|begin|began', 'time'),
  R('P50', 'author', 'write|wrote|written|author', 'person entity'),
  R('P57', 'director', 'direct|directed|director', 'person entity'),
  R('P170', 'creator', 'create|created|creator|paint|painted|made', 'person entity'),
  R('P178', 'developer', 'develop|developed|developer|make|makes|made', 'person entity'),
  R('P287', 'designed by', 'design|designed|designer', 'person entity'),
  R('P84', 'architect', 'architect|designed|built', 'person entity'),
  R('P86', 'composer', 'compose|composed|composer', 'person entity'),
  R('P175', 'performer', 'sing|sang|sung|singer|perform|performed', 'person entity'),
  R('P26', 'spouse', 'spouse|wife|husband|married|marry', 'person entity'),
  R('P22', 'father', 'father|dad', 'person entity'),
  R('P25', 'mother', 'mother|mom|mum', 'person entity'),
  R('P40', 'child', 'children|child|son|daughter|kids', 'person entity quantity'),
  R('P169', 'chief executive officer', 'ceo|chief executive', 'person entity'),
  R('P488', 'chairperson', 'chairman|chairperson|chairwoman', 'person entity'),
  R('P127', 'owned by', 'own|owns|owned|owner', 'person entity'),
  R('P749', 'parent organization', 'parent company|parent organization|parent organisation'),
  R('P159', 'headquarters location', 'headquarters|headquartered|hq|based', 'place entity'),
  R('P17', 'country', 'country|located|location', 'place entity'),
  R('P131', 'located in', 'located|location|city|state|province|situated', 'place'),
  R('P30', 'continent', 'continent'),
  R('P37', 'official language', 'language|languages|speak|spoken'),
  R('P2046', 'area', 'area|big|large|size', 'quantity'),
  R('P2048', 'height', 'tall|height|high', 'quantity'),
  R('P2044', 'elevation above sea level', 'elevation|altitude|high|height|tall', 'quantity'),
  R('P2043', 'length', 'long|length', 'quantity'),
  R('P2067', 'mass', 'mass|weigh|weighs|weight|heavy', 'quantity'),
  R('P2386', 'diameter', 'diameter|wide|width', 'quantity'),
  R('P577', 'publication date', 'publish|published|release|released|come out|came out|premiere|premiered|launched', 'time'),
  R('P619', 'time of spacecraft launch', 'launch|launched', 'time'),
  R('P106', 'occupation', 'occupation|profession|job|do for a living'),
  R('P27', 'country of citizenship', 'nationality|citizenship|citizen'),
  R('P69', 'educated at', 'study|studied|educated|university|college|school|attend|attended'),
  R('P136', 'genre', 'genre'),
  R('P1086', 'atomic number', 'atomic number'),
  R('P246', 'element symbol', 'symbol'),
  R('P274', 'chemical formula', 'formula'),
  R('P2102', 'boiling point', 'boiling point|boil|boils', 'quantity'),
  R('P2101', 'melting point', 'melting point|melt|melts', 'quantity'),
  R('P421', 'located in time zone', 'time zone|timezone'),
  R('P1451', 'motto text', 'motto'),
  R('P85', 'anthem', 'anthem'),
  R('P2250', 'life expectancy', 'life expectancy'),
  R('P2131', 'nominal GDP', 'gdp'),
  R('P161', 'cast member', 'star|starred|stars|cast|actor|actors|played'),
  R('P800', 'notable work', 'known for|famous for|notable work'),
  R('P166', 'award received', 'award|awards|prize|prizes'),
  R('P47', 'shares border with', 'border|borders|neighbor|neighbour|neighbors|neighbours|neighboring|neighbouring'),
  R('P1120', 'number of deaths', 'deaths|killed|casualties|death toll', 'quantity'),
  R('P2031', 'work period (start)', 'career'),
  R('P1128', 'employees', 'employees|staff|workers', 'quantity'),
  R('P2139', 'total revenue', 'revenue', 'quantity'),
  R('P3966', 'programming paradigm', 'paradigm|paradigms'),
  R('P275', 'copyright license', 'license|licence'),
  R('P348', 'software version identifier', 'version|latest version|current version'),
  R('P277', 'programmed in', 'written in|programmed in|implemented in'),
  R('P2047', 'duration', 'duration|runtime|how long', 'quantity'),
  R('P1113', 'number of episodes', 'episodes', 'quantity'),
  R('P2121', 'prize money', 'prize money'),
  R('P1352', 'ranking', 'rank|ranking|ranked'),
];

/** Rank Wikidata properties by how well their cue words match the question. */
export function matchRelations(questionText, qtype) {
  const lower = ' ' + questionText.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ') + ' ';
  const stems = new Set(tokenize(lower).map(stem));
  const out = [];
  for (const r of RELATIONS) {
    if (r.types && qtype && !r.types.includes(qtype)) continue;
    let score = 0;
    for (const cue of r.cues) {
      if (cue.includes(' ')) { if (lower.includes(' ' + cue + ' ')) score = Math.max(score, 3); }
      else if (stems.has(stem(cue))) score = Math.max(score, r.types ? 2 : 1.5);
    }
    if (score) out.push({ ...r, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

export async function searchEntities(name, ctx, limit = 3) {
  const { json } = await ctx.http.getJSON(`${API}?action=wbsearchentities&search=${enc(name)}&language=en&uselang=en&type=item&limit=${limit}&format=json`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 5000, hostLimit: 3, ttlMs: 60 * 60000 });
  return (json.search || []).map((e) => ({ id: e.id, label: e.label || '', description: e.description || '', matched: (e.match && e.match.text) || '' }));
}

/** Entity document via the Linked Data interface (no API budget; CDN cached). */
export async function getEntity(qid, ctx) {
  if (!/^Q\d+$/.test(qid)) return null;
  const { json } = await ctx.http.getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 7000, hostLimit: 2, maxBytes: 6_000_000, ttlMs: 60 * 60000, cache: false });
  const e = json.entities && (json.entities[qid] || Object.values(json.entities)[0]);
  if (!e) return null;
  return { id: e.id, label: (e.labels && e.labels.en && e.labels.en.value) || '', description: (e.descriptions && e.descriptions.en && e.descriptions.en.value) || '', claims: e.claims || {}, enwiki: (e.sitelinks && e.sitelinks.enwiki && e.sitelinks.enwiki.title) || '' };
}

export async function getLabels(ids, ctx) {
  const out = {};
  const list = [...new Set(ids)].filter((x) => /^[QP]\d+$/.test(x)).slice(0, 50);
  if (!list.length) return out;
  const { json } = await ctx.http.getJSON(`${API}?action=wbgetentities&ids=${list.join('%7C')}&props=labels&languages=en&format=json`, { signal: ctx.signal, timeoutMs: ctx.timeoutMs || 5000, hostLimit: 3, ttlMs: 60 * 60000 });
  for (const [id, e] of Object.entries(json.entities || {})) if (e.labels && e.labels.en) out[id] = e.labels.en.value;
  return out;
}

const qualTime = (s, p) => { const q = s.qualifiers && s.qualifiers[p] && s.qualifiers[p][0]; return q && q.datavalue && q.datavalue.type === 'time' ? timeValue(q.datavalue.value) : null; };

function timeValue(v) {
  const m = String(v.time).match(/^([+-])(\d+)-(\d\d)-(\d\d)/);
  if (!m) return null;
  const year = (m[1] === '-' ? -1 : 1) * Number(m[2]);
  const p = v.precision;
  const iso = p >= 11 ? `${year}-${m[3]}-${m[4]}` : p === 10 ? `${year}-${m[3]}` : String(year);
  const text = p >= 9 ? formatDate(iso.replace(/^-/, '-')) : p === 8 ? `${Math.floor(Math.abs(year) / 10) * 10}s${year < 0 ? ' BCE' : ''}` : p === 7 ? `${Math.ceil(Math.abs(year) / 100)}th century${year < 0 ? ' BCE' : ''}` : `c. ${Math.abs(year).toLocaleString('en-US')}${year < 0 ? ' BCE' : ''}`;
  return { year, iso, text, precision: p };
}

/** Pick the statements that represent the current/best value of a property. */
export function bestStatements(stmts) {
  let list = (stmts || []).filter((s) => s.rank !== 'deprecated' && s.mainsnak && s.mainsnak.snaktype === 'value' && s.mainsnak.datavalue);
  const preferred = list.filter((s) => s.rank === 'preferred');
  if (preferred.length) list = preferred;
  const current = list.filter((s) => !(s.qualifiers && s.qualifiers.P582));
  if (current.length) list = current;
  return list.map((s) => ({ s, t: qualTime(s, 'P585') || qualTime(s, 'P580') })).sort((a, b) => ((b.t ? b.t.year : -1e9) - (a.t ? a.t.year : -1e9))).map((x) => x.s);
}

/** Collect the entity ids a set of statements refers to (values and units) so labels can be fetched in one call. */
function referencedIds(stmts, into) {
  for (const s of stmts) {
    const dv = s.mainsnak.datavalue;
    if (dv.type === 'wikibase-entityid') into.add(dv.value.id);
    else if (dv.type === 'quantity' && /Q\d+$/.test(dv.value.unit || '')) into.add(dv.value.unit.match(/Q\d+$/)[0]);
  }
}

function formatStatement(s, labels) {
  const dv = s.mainsnak.datavalue;
  let text = '', kind = dv.type, extra = {};
  if (dv.type === 'wikibase-entityid') { text = labels[dv.value.id] || ''; extra.qid = dv.value.id; kind = 'item'; }
  else if (dv.type === 'time') { const t = timeValue(dv.value); if (t) { text = t.text; extra.iso = t.iso; extra.year = t.year; } }
  else if (dv.type === 'quantity') {
    const n = Number(dv.value.amount);
    const unitId = (String(dv.value.unit || '').match(/Q\d+$/) || [])[0];
    const unit = unitId ? labels[unitId] || '' : '';
    if (Number.isFinite(n)) { text = n.toLocaleString('en-US', { maximumFractionDigits: 3 }) + (unit ? ' ' + unit : ''); extra.amount = n; extra.unit = unit; }
  } else if (dv.type === 'string') text = String(dv.value);
  else if (dv.type === 'monolingualtext') text = dv.value.text;
  else if (dv.type === 'globecoordinate') text = `${Number(dv.value.latitude).toFixed(4)}°, ${Number(dv.value.longitude).toFixed(4)}°`;
  if (!text) return null;
  const asOf = qualTime(s, 'P585');
  return { text, kind, asOf: asOf ? asOf.text : '', ...extra };
}

/**
 * Structured facts for one entity.
 * Returns {entity:{id,label,description,isHuman,gender,types[]}, facts:[{pid, property, values[], url}]} or null.
 */
export async function entityFacts(qid, pids, ctx) {
  const e = await getEntity(qid, ctx);
  if (!e) return null;
  const chosen = {};
  const ids = new Set();
  for (const pid of pids) { const st = bestStatements(e.claims[pid]).slice(0, 8); if (st.length) { chosen[pid] = st; referencedIds(st, ids); } }
  const typeSt = bestStatements(e.claims.P31).slice(0, 3), genderSt = bestStatements(e.claims.P21).slice(0, 1);
  referencedIds(typeSt, ids); referencedIds(genderSt, ids);
  let labels = {};
  if (ids.size) { try { labels = await getLabels([...ids], ctx); } catch { /* label budget exhausted: item-valued facts are dropped below */ } }
  const facts = [];
  for (const pid of pids) {
    if (!chosen[pid]) continue;
    const values = chosen[pid].map((s) => formatStatement(s, labels)).filter(Boolean);
    const rel = RELATIONS.find((r) => r.p === pid);
    if (values.length) facts.push({ pid, property: rel ? rel.label : pid, values, url: `https://www.wikidata.org/wiki/${e.id}#${pid}` });
  }
  const types = typeSt.map((s) => labels[s.mainsnak.datavalue.value.id]).filter(Boolean);
  const isHuman = typeSt.some((s) => s.mainsnak.datavalue.value.id === 'Q5');
  const g = genderSt[0] && genderSt[0].mainsnak.datavalue.value.id;
  const gender = g === 'Q6581097' || g === 'Q2449503' ? 'm' : g === 'Q6581072' || g === 'Q1052281' ? 'f' : '';
  return { entity: { id: e.id, label: e.label, description: e.description, isHuman, gender, types, url: `https://www.wikidata.org/wiki/${e.id}` }, facts };
}

// Properties that make informative comparison rows, in display priority order.
const COMPARE_PRIORITY = ['P31', 'P279', 'P571', 'P577', 'P569', 'P570', 'P19', 'P27', 'P106', 'P17', 'P30', 'P36', 'P1082', 'P2046', 'P38', 'P37', 'P35', 'P6',
  'P122', 'P112', 'P159', 'P452', 'P169', 'P1128', 'P2139', 'P178', 'P287', 'P170', 'P3966', 'P7078', 'P275', 'P348', 'P277', 'P306', 'P737', 'P136', 'P50', 'P57',
  'P86', 'P161', 'P2047', 'P2048', 'P2067', 'P2044', 'P2043', 'P2386', 'P495', 'P176', 'P2102', 'P2101', 'P2054', 'P1086', 'P246', 'P141', 'P171', 'P105',
  'P2250', 'P2131', 'P2132', 'P1081', 'P421', 'P47', 'P610', 'P1101', 'P2109', 'P2114', 'P21', 'P26', 'P69', 'P166', 'P800', 'P400', 'P404', 'P479', 'P1056', 'P366'];
const SKIP_COMPARE = new Set(['P18', 'P373', 'P910', 'P1343', 'P5008', 'P6104', 'P2959', 'P1424', 'P1151', 'P8687', 'P935', 'P1889', 'P460', 'P527', 'P361', 'P1269', 'P5125', 'P8402', 'P1482', 'P7084', 'P1423', 'P1552']);
const COMPARABLE = new Set(['wikibase-item', 'time', 'quantity', 'string', 'monolingualtext']);

/** Build a comparison table from the properties two (or three) entities have in common. */
export async function compareEntities(qids, ctx, maxRows = 10) {
  const ents = (await Promise.all(qids.map((q) => getEntity(q, ctx).catch(() => null)))).filter(Boolean);
  if (ents.length < 2) return null;
  const shared = Object.keys(ents[0].claims).filter((pid) => !SKIP_COMPARE.has(pid) && ents.every((e) => {
    const st = bestStatements(e.claims[pid]);
    return st.length && COMPARABLE.has(st[0].mainsnak.datatype);
  }));
  const prio = (p) => { const i = COMPARE_PRIORITY.indexOf(p); return i < 0 ? 1000 + ents.reduce((s, e) => s + e.claims[p].length, 0) : i; };
  const pids = shared.sort((a, b) => prio(a) - prio(b)).slice(0, maxRows);
  const entities = ents.map((e) => ({ id: e.id, label: e.label, description: e.description, url: `https://www.wikidata.org/wiki/${e.id}`, enwiki: e.enwiki }));
  if (pids.length < 2) return { entities, rows: [] };
  const ids = new Set(pids);
  const chosen = ents.map((e) => Object.fromEntries(pids.map((pid) => { const st = bestStatements(e.claims[pid]).slice(0, 4); referencedIds(st, ids); return [pid, st]; })));
  const labels = await getLabels([...ids], ctx);
  const rows = [];
  for (const pid of pids) {
    const cells = chosen.map((c) => { const vals = c[pid].map((s) => formatStatement(s, labels)).filter(Boolean); return vals.slice(0, 3).map((v) => v.text + (v.asOf ? ` (${v.asOf})` : '')).join(', ') + (c[pid].length > 3 ? ', …' : ''); });
    if (labels[pid] && cells.every(Boolean)) rows.push({ pid, property: labels[pid], cells });
  }
  return { entities, rows: rows.length >= 2 ? rows : [] };
}

const NOISE_DESC = /disambiguation page|family name|given name|surname|scientific article|scholarly article|wikimedia (?:list|category|template)|wikinews article|^(?:19|20)\d\d (?:film|song|album|single|video game|novel)\b|\b(?:song|album|single|episode) by\b/i;
const descStems = (d) => new Set(tokenize(d).filter((w) => w.length > 2).map(stem));
function overlapCount(a, b) { let n = 0; for (const x of a) if (b.has(x)) n++; return n; }

/**
 * Word-sense choice for names with several meanings ("Python", "Rust", "Mercury").
 * Candidates come from Wikidata's entity search; things being compared are assumed to be of the same kind, so the
 * combination whose descriptions share the most vocabulary wins; for a single name the rest of the question decides.
 * Returns [{item, id, label, description, alternatives:[{label, description}]}] (id null when nothing was found).
 */
export async function chooseSenses(items, contextStems, ctx) {
  const lists = await Promise.all(items.map((it) => searchEntities(it, ctx, 6).catch(() => [])));
  // a candidate qualifies when its label contains the name, or when the name is exactly one of its aliases ("TCP" → Transmission Control Protocol)
  const named = (c, it) => c.label.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(it.toLowerCase().split(/[^\p{L}\p{N}]+/u)[0]) || (c.matched || '').toLowerCase() === it.toLowerCase();
  const cands = lists.map((l, i) => l.filter((c) => c.description && !NOISE_DESC.test(c.description) && named(c, items[i])).map((c, rank) => ({ ...c, rank, stems: descStems(c.description) })));
  // Wikidata's own ordering is a weak signal of salience; an exact label match ("Mercury") outranks a longer one ("Mercury Records")
  const prior = (c) => 0.3 / (1 + c.rank) + (items.some((it) => it.toLowerCase() === c.label.toLowerCase() || it.toLowerCase() === (c.matched || '').toLowerCase()) ? 0.5 : 0) + 0.6 * overlapCount(c.stems, contextStems);
  let pick = cands.map((l) => l.slice().sort((a, b) => prior(b) - prior(a))[0] || null);
  if (items.length >= 2 && cands[0].length && cands[1].length) {
    let best = -1;
    for (const a of cands[0]) for (const b of cands[1]) {
      // being of one kind counts once: two prominent senses that share a class word ("protocol") beat two obscure ones that share two ("chemical compound")
      const sc = Math.min(1, overlapCount(a.stems, b.stems)) + prior(a) + prior(b);
      if (sc > best) { best = sc; pick[0] = a; pick[1] = b; }
    }
    for (let k = 2; k < items.length; k++) if (cands[k].length) pick[k] = cands[k].slice().sort((x, y) => (overlapCount(y.stems, pick[0].stems) + prior(y)) - (overlapCount(x.stems, pick[0].stems) + prior(x)))[0];
  }
  return items.map((item, i) => ({ item, id: pick[i] ? pick[i].id : null, label: pick[i] ? pick[i].label : item, description: pick[i] ? pick[i].description : '', alternatives: cands[i].filter((c) => c !== pick[i]).slice(0, 4).map((c) => ({ label: c.label, description: c.description })) }));
}
