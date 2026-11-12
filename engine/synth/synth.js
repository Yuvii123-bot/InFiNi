// INFINI AI — answer construction (extractive + rule-based).
// Every sentence shown to the user is either (a) a verbatim sentence from a retrieved source, lightly cleaned,
// (b) a template filled with a structured fact that carries its own citation, or (c) fixed connective text that
// makes no factual claim. Nothing is generated from a model, so nothing can be asserted without a source.

import { queryModel, rankEvidence, mmr, corroborators, cleanSentence, CUES, stemsOf, simSets } from '../rank/rank.js';
import { claimNature, detectConflicts } from '../evidence/evidence.js';
import { findDates, formatDate } from '../util/dates.js';
import { readingEase, truncate, capitalize, stem, tokenize, uniq, clamp } from '../util/text.js';

const figures = (t) => { const years = new Set(), nums = new Set(); for (const m of String(t).matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/g)) { const raw = m[1].replace(/,/g, ''); (/^(1[0-9]{3}|20[0-9]{2})$/.test(raw) ? years : nums).add(Number(raw)); } return { years, nums }; };
/** Two similar sentences agree unless both state figures of the same kind and none coincide. */
export function figuresAgree(a, b) {
  const A = figures(a), B = figures(b);
  const clash = (x, y) => [...x].some((v) => !y.has(v)) && [...y].some((v) => !x.has(v));      // each side states a figure the other lacks
  return !(clash(A.years, B.years) || (A.years.size === 0 && B.years.size === 0 && clash(A.nums, B.nums)));
}
const span = (text, cites = [], extra = {}) => ({ text, cites: uniq(cites).slice(0, 4), ...extra });
const para = (spans) => ({ type: 'paragraph', spans });
const note = (text, tone = 'info') => ({ type: 'note', tone, text });
const NOT_VERIFIED = 'I could not verify this from the sources I found.';
const CONTESTED = /\b(disput|controvers|contested|debate[ds]?|credited|claim(?:s|ed)? (?:to|that)|some (?:argue|historians|sources)|rival|priority|unclear|uncertain|myth|misconception|not universally|challenged|also (?:invented|claimed|credited)|independently)\b/i;
const NEG = /\b(not|no|never|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|unable|impossible|false|myth|incorrect|untrue|debunked|misconception|contrary to)\b/i;
const ORG_WORDS = /\b(Company|University|Inc|Corporation|Institute|Laboratory|Laboratories|Labs|States|Kingdom|Republic|Museum|Award|Prize|Society|Association|Office|Court|Committee|War|Academy|College|School|Foundation|Department|Ministry|Party|Union|League|Church|Bank|Group|Ltd|Agency|Council|Empire|Dynasty|Island|Islands|City|County|River|Ocean|Sea|Mountain|Street|Avenue|Park|Bridge|Tower|Building|Hospital|Airport|Station|Century|Day|Act|Treaty|Battle|Revolution|Cases?|Patent|Records|Entertainment|Studios|Pictures|Music|Band|Label|Network|Channel|Magazine|Times|Press|News|Team|Club|Airlines|Motors|Systems|Technologies|Software|Games|Media|Program|Programme|Project|Mission|Apollo|Agency|Center|Centre)\b/;
const NOT_NAME = new Set('The A An In On At By For With From To Of And But Or As It He She They We His Her Its Their This That These Those There Here When Where Why How What Who Which While After Before During Since Although However Because If Then Thus Also Both Many Most Some Such Other Another Each Every All Several First Second Third Last Early Later Today January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday American British French German English European Chinese Japanese Indian Italian Scottish Canadian Russian Spanish Greek Roman Western Eastern Northern Southern North South East West New Old Great According Despite Unlike Like Among Between Under Over Until Upon Within Without Following Based Known Named Called Born Died'.split(' '));
const FACT_TEMPLATES = {
  P569: (e, v, x) => `${e} was born ${datePrep(x)} ${v}.`, P570: (e, v, x) => `${e} died ${datePrep(x)} ${v}.`, P19: (e, v) => `${e} was born in ${v}.`, P20: (e, v) => `${e} died in ${v}.`,
  P36: (e, v) => `The capital of ${e} is ${v}.`, P1082: (e, v, x) => `${e} has a population of ${v}${x.asOf ? ` (as of ${x.asOf})` : ''}.`, P38: (e, v) => `The currency of ${e} is ${v}.`,
  P35: (e, v) => `The head of state of ${e} is ${v}.`, P6: (e, v) => `The head of government of ${e} is ${v}.`, P112: (e, v) => `${e} was founded by ${v}.`,
  P571: (e, v, x) => `${e} was founded or created ${datePrep(x)} ${v}.`, P50: (e, v) => `${e} was written by ${v}.`, P57: (e, v) => `${e} was directed by ${v}.`,
  P170: (e, v) => `${e} was created by ${v}.`, P178: (e, v) => `${e} was developed by ${v}.`, P26: (e, v) => `The spouse of ${e}: ${v}.`, P30: (e, v) => `${e} is in ${v}.`,
  P17: (e, v) => `${e} is in ${v}.`, P37: (e, v) => `The official language of ${e}: ${v}.`, P577: (e, v, x) => `${e} was published or released ${datePrep(x)} ${v}.`,
  P575: (e, v, x) => `${e} was discovered or invented ${datePrep(x)} ${v}.`,
};
function datePrep(x) { return x.iso && /^-?\d+-\d\d-\d\d$/.test(x.iso) ? 'on' : 'in'; }
const listJoin = (a) => (a.length <= 1 ? a.join('') : a.length === 2 ? a.join(' and ') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const ago = (iso, now) => { const h = (now - Date.parse(iso)) / 3600000; if (!Number.isFinite(h)) return ''; return h < 1 ? 'under an hour ago' : h < 36 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };

/** Deletion-only simplification: drop parentheticals and trailing subordinate detail. The wording is never altered. */
export function simplifySentence(text) {
  let s = text.replace(/\s*\([^()]{0,160}\)/g, '').replace(/\s*\[[^\]]{0,80}\]/g, '');
  if (s.split(/\s+/).length > 30) { const cut = s.search(/;\s|,\s(?:which|whereas|although|while|including|such as)\b/); if (cut > 60) s = s.slice(0, cut).replace(/[,;\s]+$/, '') + '.'; }
  return s.replace(/\s+([,.;:])/g, '$1').trim();
}

// ---------------------------------------------------------------------------------------------------
function makeEnv(part, docs, ctx) {
  const style = { ...(part.style || {}), ...(ctx.style || {}) };
  const qm = ctx.qm || queryModel(part, ctx.extraTerms || []);
  const ranked = ctx.ranked || rankEvidence(docs, qm, { now: ctx.now, fresh: part.temporal.freshness });
  if (style.simple) {
    for (const s of ranked.sentences) { const ease = clamp((readingEase(s.text) - 25) / 50); s.score *= (0.5 + 0.5 * ease) * (docs[s.di].simple ? 1.35 : 1); }
    ranked.sentences.sort((a, b) => b.score - a.score);
  }
  const used = new Set(), claims = [];
  const env = {
    part, docs, ctx, style, qm, ranked, claims, used, top: ranked.sentences[0] || null, corroborated: 0, disputes: [],
    cite: (di) => ctx.cite(di),
    /** Quote a ranked sentence: returns a span (with corroborating citations) and records the claim, or null. */
    quote(s, { prefix = '', allowDangling = false, record = true } = {}) {
      const key = `${s.pi}:${s.si}`;
      if (used.has(key)) return null;
      let text = s.text;
      if (s.dangling && s.type === 'p') {
        const prev = s.si > 0 ? ranked.passages[s.pi].sentences[s.si - 1] : null;
        if (prev && !used.has(`${s.pi}:${s.si - 1}`) && prev.length + text.length <= 470) { text = prev + ' ' + text; used.add(`${s.pi}:${s.si - 1}`); }
        else if (!(prev && used.has(`${s.pi}:${s.si - 1}`)) && !allowDangling) return null;
      }
      used.add(key);
      const doc = docs[s.di];
      const similar = corroborators(s, ranked).filter((c) => docs[c.sentence.di].origin !== doc.origin);
      const corr = similar.filter((c) => figuresAgree(text, c.sentence.text));
      for (const c of similar) if (!figuresAgree(text, c.sentence.text) && !env.disputes.some((d) => d.b === c.sentence)) env.disputes.push({ a: s, b: c.sentence });
      const cites = [env.cite(s.di), ...corr.slice(0, 2).map((c) => env.cite(c.sentence.di))];
      if (corr.length) env.corroborated++;
      const shown = style.simple ? simplifySentence(text) : text;
      if (record) {
        const nat = claimNature(s, doc, ctx.now);
        claims.push({ text: shown, original: text, di: s.di, source: cites[0], alsoSupportedBy: cites.slice(1), heading: s.heading, passage: truncate(ranked.passages[s.pi].text, 600), nature: nat.nature, temporal: nat.temporal, stems: s.stems, origin: doc.origin, score: s.score, part: ctx.partIndex });
      }
      return span(prefix + shown, cites, { edited: shown !== text || undefined, nature: s.opinion ? 'opinion' : s.hedged ? 'hedged' : undefined });
    },
  };
  return env;
}

function insufficient(env, why) {
  const { ranked, top } = env;
  const blocks = [para([span(NOT_VERIFIED)])];
  if (why) blocks.push(note(why, 'warn'));
  const related = top && top.cov >= 0.28 ? mmr(ranked.sentences, 2, { maxPerDoc: 1, minScore: top.score * 0.6 }).map((s) => env.quote(s, { allowDangling: false, record: false })).filter(Boolean) : [];
  if (related.length) { blocks.push({ type: 'heading', text: 'Closest related information (does not answer the question directly)' }); blocks.push({ type: 'list', ordered: false, items: related.map((sp) => ({ spans: [sp] })) }); }
  return { blocks, claims: [], stats: { insufficient: true, directness: top ? top.cov * 0.5 : 0, keyClaims: 0, corroborated: 0 }, lead: NOT_VERIFIED };
}
const isWeak = (env) => !env.top || (env.top.directCov < 0.34 && env.top.cov < 0.5) || env.top.cov < 0.34 || !env.ranked.sentences.slice(0, 12).some((s) => s.predCov >= 0.5 && s.score >= env.top.score * 0.4);

/** Lead sentence(s) + key points. The workhorse for definitions, explanations, reasons and mechanisms. */
function composeExtractive(env, { leadFilter = null, bullets = null, heading = 'Key points', attribute = false, minRel = 0.5, bulletFilter = null, requireLead = false, openFirst = false } = {}) {
  const { ranked, style, docs, part } = env;
  if (isWeak(env)) return insufficient(env, 'The pages I retrieved mention the topic but none of them addresses this question directly.');
  const topScore = env.top.score;
  const cands = ranked.sentences.filter((s) => s.score >= topScore * minRel && s.cov >= 0.3 && !/[?:]\s*$/.test(s.text));       // a sentence ending in a colon introduces something that would not be shown
  // the page about the thing asked about gets the first chance to supply the opening sentence
  const leadPool = leadFilter ? ranked.sentences.filter((s) => s.score >= topScore * 0.35 && !/\?$/.test(s.text)).slice(0, 60) : [];
  const opening = openFirst ? leadPool.find((s) => docs[s.di].entity && s.order === 0 && s.si === 0 && leadFilter(s)) : null;   // the sentence that introduces the subject on its own page
  const strict = leadFilter ? opening || leadPool.find((s) => docs[s.di].entity && leadFilter(s)) || leadPool.find(leadFilter) : null;
  if (requireLead && !strict) return insufficient(env, requireLead);
  let lead = strict || cands.find((s) => (!s.dangling || s.si > 0) && s.predCov >= 0.5) || cands.find((s) => !s.dangling || s.si > 0) || cands[0];
  const blocks = [], leadSpans = [];
  const pre = (s) => (attribute ? `${docs[s.di].site || docs[s.di].domain}${docs[s.di].published ? ` (${String(docs[s.di].published).slice(0, 10)})` : ''}: ` : '');
  const first = env.quote(lead, { allowDangling: true, prefix: pre(lead) });
  if (first) leadSpans.push(first);
  // keep reading the same paragraph while it stays on topic → a coherent opening from one source
  const follow = style.brief ? 0 : part.answerType === 'definition' || part.explain || part.fn || part.answerType === 'mechanism' || part.answerType === 'reason' ? 2 : 1;
  const p = ranked.passages[lead.pi];
  for (let k = 1; k <= follow && p.type === 'p'; k++) {
    const nxt = ranked.sentences.find((s) => s.pi === lead.pi && s.si === lead.si + k);
    const continues = opening && lead === opening && CUES.function.test(nxt ? nxt.text : '');   // "… is the primary processor. Its circuitry executes …"
    if (!nxt || (nxt.score < topScore * 0.3 && !continues) || leadSpans.reduce((a, x) => a + x.text.length, 0) + nxt.text.length > 620) break;
    const sp = env.quote(nxt, { allowDangling: true });
    if (sp) leadSpans.push(sp);
  }
  blocks.push(para(leadSpans));
  const nB = bullets != null ? bullets : style.brief ? 0 : style.detail ? env.ctx.budget.sentences + 4 : env.ctx.budget.sentences;
  if (nB > 0) {
    // "Amazon Braket is a fully managed quantum computing service." describes a product, not the topic that was asked about
    const focusStems = new Set(stemsOf(part.focus || ''));
    const aboutOther = (s) => {
      if (!(part.answerType === 'definition' || part.explain || part.fn) || !focusStems.size) return false;
      const m = /^((?:[A-Z][\w&.’'-]*\s+){1,3})(?:is|are|was|were|offers?|provides?|lets|helps?|enables?|gives?|makes?|delivers?)\b/.exec(s.text);
      return !!m && !stemsOf(m[1]).some((w) => focusStems.has(w));
    };
    const picks = mmr(cands, nB + 4, { maxPerDoc: Math.max(2, Math.ceil(nB / 2)), filter: (s) => !env.used.has(`${s.pi}:${s.si}`) && s.type !== 'table' && simSets(s.stems, lead.stems) < 0.6 && (s.directCov >= lead.directCov * 0.6 || s.pi === lead.pi) && (s.predCov >= 0.5 || s.pi === lead.pi || part.answerType === 'definition' || part.explain) && (!bulletFilter || bulletFilter(s)) && !aboutOther(s) });
    const items = [];
    for (const s of picks) { if (items.length >= nB) break; const sp = env.quote(s, { prefix: pre(s) }); if (sp) items.push({ spans: [sp] }); }
    if (items.length) { blocks.push({ type: 'heading', text: heading }); blocks.push({ type: 'list', ordered: false, items }); }
  }
  const directness = clamp((0.25 + 0.75 * Math.min(1, lead.cov)) * (lead.cueHit || lead.defHit || !CUES[part.answerType] ? 1 : 0.8));
  return { blocks, claims: env.claims, stats: { directness, keyClaims: env.claims.length, corroborated: env.corroborated }, lead: leadSpans.map((s) => s.text).join(' ') };
}

// ---------------------------------------------------------------------------------------------------
// factoid candidates
function nearestCue(text, index, cueStems) {
  if (!cueStems.size) return 0.6;
  let best = Infinity;
  const re = /[\p{L}\p{N}]+/gu;
  let m;
  while ((m = re.exec(text))) if (cueStems.has(stem(m[0].toLowerCase()))) best = Math.min(best, Math.abs(m.index - index));
  return best === Infinity ? 0.15 : 1 / (1 + best / 60);
}
function extractCandidates(env) {
  const { part, ranked, docs } = env;
  const type = part.answerType;
  const qWords = new Set(tokenize(part.text));
  const cueStems = new Set([...(part.verb ? [stem(part.verb.lemma)] : []), ...stemsOf(part.attribute || '')]);
  const lemma = part.verb ? part.verb.lemma : '';
  const life = /^(born|die)$/.test(lemma) || /\b(birth|death|born|died)\b/i.test(part.attribute || '') ? (/(die|death|died)/.test(lemma + ' ' + part.attribute) ? 'death' : 'birth') : null;
  const map = new Map();
  const add = (norm, value, w, s) => {
    if (!norm || w <= 0) return;
    const c = map.get(norm) || { norm, value, score: 0, sentences: [], origins: new Set(), precision: 0 };
    c.score += w; if (!c.sentences.includes(s)) c.sentences.push(s); c.origins.add(docs[s.di].origin);
    if (value.length > c.value.length && c.sentences.length <= 3) c.value = value;
    map.set(norm, c);
  };
  const pool = ranked.sentences.filter((s) => s.cov >= 0.38).slice(0, 30);
  for (const s of pool) {
    const text = s.text;
    if (type === 'time') {
      const range = life && text.match(/\(([^()]*?\b\d{3,4})\s*[–—-]\s*([^()]*?\b\d{3,4}[^()]*?)\)/);
      if (range) for (const d of findDates(life === 'birth' ? range[1] : range[2]).slice(0, 1)) if (d.year != null) add(String(d.year), d.iso && d.precision !== 'century' ? formatDate(d.iso) : d.text, s.score * 1.6, s);
      for (const d of findDates(text)) {
        if (d.year == null || qWords.has(String(d.year)) || d.precision === 'century') continue;
        // "1400 workers", "2000 people": a count, not a year
        if (d.precision === 'year' && /^\s+(?!(?:was|is|as|has|his|its|this|thus|plus|versus|across|unless|whereas)\b)(?:[a-z]{3,}s|people|men|women|children|km|kg|percent)\b/.test(text.slice(d.index + d.text.length, d.index + d.text.length + 24))) continue;
        const w = s.score * ({ day: 1.2, month: 1.1 }[d.precision] || 1) * nearestCue(text, d.index, cueStems);
        add(String(d.year), d.iso ? formatDate(d.iso) : d.text, w, s);
      }
    } else if (type === 'person' || type === 'place' || type === 'entity' || type === 'attribute') {
      const re = /(?<![\p{L}])((?:[A-Z][\p{L}'’.-]+)(?:\s+(?:[A-Z][\p{L}'’.-]+|de|van|von|der|la|le|di|bin|al|ibn|da|del)){0,4})/gu;
      let m;
      while ((m = re.exec(text))) {
        let name = m[1].replace(/[.,;:'’]+$/, '').replace(/'s$/, '');
        const toks = name.split(/\s+/);
        while (toks.length && NOT_NAME.has(toks[0])) toks.shift();
        if (!toks.length) continue;
        name = toks.join(' ');
        if (name.length < 3 || toks.every((t) => qWords.has(t.toLowerCase())) || toks.some((t) => qWords.has(t.toLowerCase())) && type !== 'place') continue;
        const before = text.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
        const locative = /\b(in|at|near|from|to|of|across|throughout)\s+(the\s+)?$/.test(before);
        let w = s.score * nearestCue(text, m.index, cueStems);
        if (type === 'person') { if (toks.length < 2) w *= 0.25; if (ORG_WORDS.test(name)) w *= 0.15; if (locative) w *= 0.4; if (/\b(by|inventor|founder|author|scientist|engineer|president|minister|king|queen|director|credited|named|professor|physicist|chemist)\s+$/.test(before)) w *= 1.3; }
        if (type === 'place') { if (!locative) w *= 0.3; }
        add(name.toLowerCase(), name, w, s);
      }
    } else if (type === 'quantity') {
      const unitRe = { tall: /m|metres?|meters?|ft|feet|km|cm|inch(?:es)?/, high: /m|metres?|meters?|ft|feet|km/, far: /km|kilometres?|kilometers?|miles?|light[- ]years?|au|m/, long: /km|kilometres?|kilometers?|miles?|m|metres?|meters?|years?|days?|hours?|minutes?|months?|weeks?|seconds?/, old: /years?(?: old)?|million years|billion years/, heavy: /kg|kilograms?|tonnes?|tons?|pounds?|lbs?|g|grams?/, fast: /km\/h|mph|m\/s|knots?|kilometres? per hour|miles per hour/, hot: /°\s?[CF]|degrees?|K|kelvin/, cold: /°\s?[CF]|degrees?|K|kelvin/, deep: /m|metres?|meters?|ft|feet|km/, wide: /m|metres?|meters?|km|miles?|ft|feet/, big: /km2|km²|sq(?:uare)? (?:km|mi|kilometres?|kilometers?|miles?)|hectares?|acres?|km|miles?|m/, large: /km2|km²|sq(?:uare)? (?:km|mi|kilometres?|kilometers?|miles?)|hectares?|acres?|km|miles?/ }[part.quantityCue.split(' ')[0]];
      const counted = part.quantityCue === 'many' ? stemsOf(part.core.replace(/^how many\s+/i, '').split(/\s+/).slice(0, 2).join(' ')) : [];
      const re = /(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*(?:million|billion|trillion|thousand))?(\s*[%°\p{L}²\/.-]+(?:\s+[\p{L}²\/]+)?)?/gu;
      let m;
      while ((m = re.exec(text))) {
        const numTxt = m[1] + (m[2] || '');
        const after = (m[3] || '').trim();
        const unit = unitRe ? (after.match(new RegExp(`^(?:${unitRe.source})\\b`, 'i')) || [''])[0] : after.split(/\s+/)[0] || '';
        if (unitRe && !unit) continue;
        if (/^(1[0-9]{3}|20[0-9]{2})$/.test(m[1]) && !unit) continue;                      // bare years are not quantities
        let w = s.score * nearestCue(text, m.index, cueStems.size ? cueStems : new Set(counted));
        if (counted.length) { const nextStems = stemsOf(text.slice(m.index + numTxt.length, m.index + numTxt.length + 40)); if (!counted.some((c) => nextStems.slice(0, 3).includes(c))) w *= 0.3; }
        const value = `${numTxt}${unit && unitRe ? ' ' + unit : part.quantityCue === 'many' && after ? ' ' + after.split(/\s+/).slice(0, 2).join(' ') : ''}`.trim();
        add(`${Number(m[1].replace(/,/g, ''))}${(m[2] || '').trim()}${unitRe ? unit.toLowerCase().replace(/s$/, '') : ''}`, value, w, s);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

function composeFactoid(env) {
  const { part, ctx, docs } = env;
  const facts = ctx.facts && ctx.facts.facts && ctx.facts.facts.length ? ctx.facts : null;
  const cands = extractCandidates(env);
  const blocks = [];
  let direct = null, structuredAgreement = false, answerEntity = null, conflicts = 0;
  const lower = (s) => String(s).toLowerCase();
  if (facts) {
    const f = facts.facts[0];
    const e = facts.entity.label || part.focus;
    // several recorded values (e.g. rival inventors): order them by how strongly the retrieved text mentions each
    let topMention = '';
    if (f.values.length > 1 && f.values[0].kind === 'item') {
      const home = ctx.entityDocs ? ctx.entityDocs.get(lower(part.focus)) : undefined;          // the page about the thing asked about
      const poolS = env.ranked.sentences.filter((s) => home == null || s.di === home).slice(0, 80);
      const support = (name) => { const last = lower(name).split(' ').pop(); return poolS.reduce((a, s) => a + (lower(s.text).includes(lower(name)) ? s.score : new RegExp(`\\b${last.replace(/[^\p{L}\p{N}]/gu, '')}\\b`, 'iu').test(s.text) ? 0.6 * s.score : 0), 0); };
      const sup = new Map(f.values.map((x) => [x, support(x.text)]));
      f.values.sort((a, b) => sup.get(b) - sup.get(a));
      if (sup.get(f.values[0]) > 0 && sup.get(f.values[0]) >= 1.3 * (sup.get(f.values[1]) || 0)) topMention = f.values[0].text;
    }
    const vals = f.values.slice(0, f.values.length > 4 ? 4 : f.values.length);
    const v = listJoin(vals.map((x) => x.text)) + (f.values.length > vals.length ? ' and others' : '');
    const tpl = FACT_TEMPLATES[f.pid];
    const text = tpl ? tpl(e, v, vals[0]) : `${capitalize(f.property)} of ${e}: ${v}${vals[0].asOf ? ` (as of ${vals[0].asOf})` : ''}.`;
    const sid = ctx.citeStructured(facts.entity, f);
    structuredAgreement = cands.slice(0, 4).some((c) => vals.some((x) => (x.year != null && c.norm === String(x.year)) || lower(c.value).includes(lower(x.text)) || lower(x.text).includes(lower(c.value)) || (x.amount != null && Number(c.norm.replace(/[^\d.]/g, '')) && Math.abs(Number(c.norm.replace(/[^\d.]/g, '')) - x.amount) / x.amount < 0.02)));
    direct = { text, cites: [sid], values: vals.map((x) => x.text), structured: true };
    if (topMention) direct.more = [span(`Of these, ${topMention} is the name the passages I retrieved mention most.`)];
    if (vals[0].kind === 'item') answerEntity = { name: vals[0].text, kind: /P(61|112|50|57|170|26|22|25|40|35|6|169|488|175|86|84|287)$/.test(f.pid) ? 'person' : /P(36|19|20|17|131|159|30)$/.test(f.pid) ? 'place' : 'unknown' };
    env.ctx.relations.push({ subject: e, property: f.property, value: v, source: sid, part: ctx.partIndex });
    for (const extra of facts.facts.slice(1, 3)) { const ev = listJoin(extra.values.slice(0, 3).map((x) => x.text)); const t2 = FACT_TEMPLATES[extra.pid]; env.ctx.relations.push({ subject: e, property: extra.property, value: ev, source: sid, part: ctx.partIndex }); direct.more = (direct.more || []).concat(span(t2 ? t2(e, ev, extra.values[0]) : `${capitalize(extra.property)} of ${e}: ${ev}.`, [ctx.citeStructured(facts.entity, extra)])); }
  }
  const best = cands[0];
  const strongText = best && (best.sentences.length >= 2 || best.sentences[0].cov >= 0.75) && (!cands[1] || best.score >= cands[1].score * 1.25 || best.origins.size > cands[1].origins.size);
  if (!direct && best && strongText && ['time', 'person', 'place', 'quantity'].includes(part.answerType)) {
    direct = { text: null, value: best.value, cand: best };
    if (part.answerType === 'person' || part.answerType === 'place') answerEntity = { name: best.value, kind: part.answerType };
  }
  const rival0 = cands[1];
  if (!direct && best && rival0 && ['time', 'person', 'place', 'quantity'].includes(part.answerType) && rival0.score >= best.score * 0.8 && [...rival0.origins].some((o) => !best.origins.has(o)) && best.sentences[0].cov >= 0.6) {
    // two answers with comparable support from different origins: show both, do not pick one silently
    const label = { time: 'date', person: 'name', place: 'place', quantity: 'figure' }[part.answerType];
    const items = [];
    for (const c of [best, rival0]) { const sp = env.quote(c.sentences[0], { allowDangling: true }); if (sp) items.push({ spans: [span(`${c.value}: `, [], { strong: true }), sp] }); }
    if (items.length === 2) {
      blocks.push(para([span(`The sources disagree on this ${label}:`, [], { strong: true })]), { type: 'list', ordered: false, items }, note('I found no basis in the retrieved text for preferring one of these, so both are shown.', 'warn'));
      return { blocks, claims: env.claims, stats: { directness: 0.7, keyClaims: 2, corroborated: 0, conflicts: 1 }, lead: `Sources disagree: ${best.value} or ${rival0.value}` };
    }
  }
  if (!direct) { const r = composeExtractive(env, { bullets: Math.min(3, ctx.budget.sentences) }); r.candidates = cands.slice(0, 3).map((c) => c.value); return r; }

  const evid = [];
  const want = direct.structured ? direct.values.map(lower) : [lower(direct.value)];
  const supporting = (direct.cand ? direct.cand.sentences : env.ranked.sentences.filter((s) => s.cov >= 0.4 && want.some((w) => lower(s.text).includes(w) || (/\d{4}/.test(w) && s.text.includes(w.match(/\d{4}/)[0])))).slice(0, 6));
  for (const s of supporting.slice(0, 3)) { const sp = env.quote(s, { allowDangling: true }); if (sp) evid.push(sp); }
  if (direct.structured) {
    blocks.push(para([span(direct.text, direct.cites, { strong: true }), ...(direct.more || [])]));
    if (evid.length) { blocks.push({ type: 'heading', text: structuredAgreement ? 'Confirmed in the text of the sources' : 'Related passages' }); blocks.push({ type: 'list', ordered: false, items: evid.map((sp) => ({ spans: [sp] })) }); }
    if (!structuredAgreement && best && best.sentences.length >= 2 && docs[best.sentences[0].di].origin !== 'wikimedia') { conflicts++; blocks.push(note(`The text of other sources most often mentions “${best.value}”, which differs from the structured record above. Check the cited passages.`, 'warn')); }
  } else {
    const label = { time: 'date', person: 'name', place: 'place', quantity: 'figure' }[part.answerType];
    const multi = direct.cand.origins.size >= 2;
    const weak = direct.cand.sentences.length < 2 && !multi;
    blocks.push(para([span(`${multi ? 'The sources agree on' : weak ? 'Only one passage suggests' : 'The source text points to'} this ${label}: `), span(direct.value, evid.flatMap((e) => e.cites), { strong: true }), span(weak ? ' — treat this as unconfirmed.' : '.')]));
    if (evid.length) blocks.push({ type: 'list', ordered: false, items: evid.map((sp) => ({ spans: [sp] })) });
    const rival = cands[1];
    if (rival && rival.score >= best.score * 0.6 && rival.norm !== best.norm && !lower(best.value).includes(lower(rival.value)) && !lower(rival.value).includes(lower(best.value))) {
      const rs = env.quote(rival.sentences[0], { allowDangling: true });
      if (rs) { conflicts++; blocks.push(note(`Another ${label} also appears in the sources: “${rival.value}”. The evidence does not clearly settle which is right.`, 'warn')); blocks.push({ type: 'list', ordered: false, items: [{ spans: [rs] }] }); }
    }
  }
  // a name or figure voted from text is only as direct as its support: one sentence from one origin is weak
  const directness = direct.structured ? 0.95 : clamp(0.38 + (direct.cand.sentences.length >= 2 ? 0.25 : 0) + (direct.cand.origins.size >= 2 ? 0.27 : 0));
  return { blocks, claims: env.claims, stats: { directness, keyClaims: Math.max(1, env.claims.length), corroborated: env.corroborated + (structuredAgreement ? 1 : 0), structuredAgreement, conflicts }, lead: direct.structured ? direct.text : `${direct.value}`, answerEntity };
}

function composeYesNo(env) {
  const { ranked, part } = env;
  if (isWeak(env)) return insufficient(env, 'None of the retrieved pages states this directly, so I will not guess yes or no.');
  const topScore = env.top.score;
  const direct = ranked.sentences.filter((s) => s.directCov >= 0.55 && s.predCov >= 0.6 && s.score >= topScore * 0.45 && !/\?$/.test(s.text)).slice(0, 8);
  if (!direct.length) return insufficient(env, 'None of the retrieved passages speaks to this directly, so I will not guess yes or no.');
  let picks = mmr(direct, Math.min(4, env.ctx.budget.sentences), { maxPerDoc: 2 });
  // "Is X a Y?" — the sentence with which X's own page defines it is the most direct evidence there is, so it comes first
  const subject = env.ctx.entityDocs ? env.ctx.entityDocs.get((part.focus || '').toLowerCase()) : undefined;
  const defining = subject != null ? ranked.sentences.find((s) => s.di === subject && s.type === 'p' && s.order <= 1 && s.si === 0 && s.predCov >= 0.6 && !/\?$/.test(s.text)) : null;
  if (defining) picks = [defining, ...picks.filter((s) => s !== defining)].slice(0, Math.max(picks.length, 2));
  let pos = 0, neg = 0, contested = 0;
  for (const s of picks) { if (CONTESTED.test(s.text)) contested++; if (NEG.test(s.text) !== part.negated) neg++; else pos++; }
  const strong = direct.length > 0 && direct[0].directCov >= 0.72 && direct[0].predCov >= 0.75;
  let verdict, tone = 'info';
  if (!strong) verdict = 'The sources do not state this outright. The most relevant evidence I found:';
  else if (contested && (pos || neg)) { verdict = 'The sources describe this as disputed or qualified rather than a simple yes or no:'; tone = 'warn'; }
  else if (pos && neg) { verdict = 'The sources point in different directions:'; tone = 'warn'; }
  else if (neg) verdict = 'According to the sources I found, the answer is no:';
  else verdict = 'According to the sources I found, the answer appears to be yes:';
  const items = picks.map((s) => env.quote(s, { allowDangling: true })).filter(Boolean).map((sp) => ({ spans: [sp] }));
  if (!items.length) return insufficient(env);
  const blocks = [para([span(verdict, [], { strong: strong && !contested })]), { type: 'list', ordered: false, items }];
  if (strong) blocks.push(note('The yes/no reading is derived by rule from the wording of these passages (presence of negation or dispute terms); read them to judge for yourself.', tone));
  return { blocks, claims: env.claims, stats: { directness: strong ? clamp(0.3 + 0.7 * direct[0].directCov) : 0.42, keyClaims: env.claims.length, corroborated: env.corroborated, conflicts: pos && neg ? 1 : 0 }, lead: verdict + ' ' + (items[0] ? items[0].spans[0].text : '') };
}

function bestList(env, { ordered = false, minItems = 3 } = {}) {
  const { ranked, docs } = env;
  const maxP = Math.max(...ranked.passages.map((p) => p.score), 0.0001);
  let best = null, bestScore = 0;
  for (const p of ranked.passages) {
    if (p.type !== 'list' || p.sentences.length < minItems) continue;
    const avgLen = p.sentences.reduce((a, s) => a + s.length, 0) / p.sentences.length;
    if (avgLen < 12 || avgLen > 420) continue;
    const titleStems = new Set(stemsOf(docs[p.di].title || ''));
    const need = [...env.qm.focus];
    if (ordered && need.length && need.filter((f) => titleStems.has(f) || p.headSet.has(f)).length / need.length < 0.6) continue;   // page or section is about something else
    if (ordered && need.length && !need.some((f) => p.stemSet.has(f))) continue;   // the steps themselves never mention the subject (e.g. a "without X" scenario)
    if (ordered && !p.block.structured) {                 // steps must read like instructions, not testimonials or link lists
      const imperative = p.sentences.filter((x) => CUES.procedure.test(x)).length / p.sentences.length;
      if (imperative < (p.block.ordered ? 0.34 : 0.5)) continue;
    }
    let sc = p.score / maxP + 0.25 * [...p.headSet].filter((h) => env.qm.terms.has(h)).length;
    if (p.block.ordered) sc *= ordered ? 1.5 : 1.1;
    if (p.block.structured) sc *= 1.3;
    if (/\b(step|how to|guide|tutorial|instructions|getting started|procedure|method)\b/i.test(p.heading) && ordered) sc *= 1.3;
    if (ordered) {
      // The steps must be the procedure that was asked for. A page about the subject also has lists for other actions
      // ("Running the agent locally", "Making an inbound call"), so the list's own heading is checked, not the page title.
      const near = String(p.heading || '').split(' › ').pop().replace(/^\d+[.)]?\s*/, '');
      const nearStems = stemsOf(near);
      const verb = env.part.verb && env.part.verb.lemma ? stem(env.part.verb.lemma) : '';
      const first = (near.split(/\s+/)[0] || '').toLowerCase();
      const action = /^[a-z]{3,}ing$/.test(first) || /^(?:install|create|run|use|add|open|configure|define|set|write|import|call|make|build|download|connect|enable|deploy|test|train|design|plan|implement|integrate|start|launch|host|publish|upgrade|update|remove|delete)$/.test(first);
      const hasFocus = need.length ? need.filter((f) => nearStems.includes(f)).length / need.length >= 0.5 : false;
      const sameAction = !!verb && nearStems.some((h) => h === verb || (h === stem(first) && env.qm.terms.has(h)));
      const generic = /\b(steps?|how to|guide|tutorial|instructions|getting started|procedure|method|quick ?start|walkthrough|process)\b/i.test(near);
      if (nearStems.includes(verb) && verb) sc *= 1.5;                          // "How does the build process work?" for "how do I build …"
      else if (action && !(sameAction && hasFocus)) sc *= 0.5;                  // a different action, or the same verb applied to something else
      else if (near && !generic && !hasFocus && !nearStems.some((h) => env.qm.terms.has(h))) sc *= 0.5;
      if (verb && titleStems.has(verb)) sc *= 1.2;                              // the page itself is a "how to <verb> …" page
    }
    sc *= 0.75 + 0.5 * (docs[p.di].quality || 0.5);
    if (sc > bestScore) { bestScore = sc; best = p; }
  }
  return best && bestScore >= 0.45 ? { passage: best, score: bestScore } : null;
}

function composeSteps(env, ordered) {
  const { ranked, docs, part, ctx } = env;
  if (isWeak(env)) return insufficient(env, 'I found pages on the topic, but none with instructions that match this question.');
  const found = bestList(env, { ordered });
  const codeFits = (p) => p.type === 'code' && p.text.length >= 8 && p.text.split('\n').length <= 40;
  const trusted = (d) => d.sourceType === 'community' || d.sourceType === 'primary';
  // commands shown next to a step list must come from the same guide; otherwise the best-matching snippet from documentation or a Q&A site
  const code = !ctx.programming ? null
    : found ? (found.passage.block.items.some((it) => it.code) ? null : ranked.passages.filter((p) => codeFits(p) && p.di === found.passage.di && p.heading === found.passage.heading).sort((a, b) => b.score - a.score)[0] || null)
      : ranked.passages.filter((p) => codeFits(p) && p.text.length >= 15 && (docs[p.di].sourceType === 'community' || docs[p.di].category === 'official documentation') && p.score > 0).sort((a, b) => (b.score + (trusted(docs[b.di]) ? 0.5 : 0)) - (a.score + (trusted(docs[a.di]) ? 0.5 : 0)))[0] || null;
  if (!found && !code) {
    const r = composeExtractive(env, { heading: ordered ? 'Advice found in the sources' : 'Points found in the sources', leadFilter: ordered ? (s) => s.cueHit && !s.dangling && s.directCov >= 0.5 : null });
    if (ordered && !r.stats.insufficient) { r.blocks.unshift(note('I did not find a page with step-by-step instructions for exactly this, so what follows is advice gathered from the sources rather than a complete procedure.', 'info')); r.stats.directness = Math.min(r.stats.directness, 0.6); }
    return r;
  }
  const blocks = [];
  // a step list is introduced by its own heading ("Steps — from …"); a loosely related top sentence in front of it only misleads
  const leadS = found ? null : ranked.sentences.find((s) => s.type === 'p' && (!s.dangling || s.si > 0) && !/\?$/.test(s.text));
  const leadSp = leadS && leadS.score >= env.top.score * 0.5 ? env.quote(leadS, { allowDangling: true }) : null;
  if (leadSp) blocks.push(para([leadSp]));
  let n = 0;
  if (found) {
    const p = found.passage, sid = env.cite(p.di);
    const items = p.block.items.slice(0, 12).map((it) => ({ spans: [span(truncate(cleanSentence(it.text), 320), [sid])], depth: it.depth || 0, ...(it.code && it.code.length ? { code: it.code } : {}) }));
    blocks.push({ type: 'heading', text: `${ordered ? 'Steps' : capitalize(part.attribute || 'Items')} — from ${docs[p.di].site || docs[p.di].domain}${p.heading ? ` (“${truncate(p.heading.split(' › ').pop(), 60)}”)` : ''}` });
    blocks.push({ type: 'list', ordered: !!p.block.ordered || ordered, items });
    env.claims.push({ text: items.map((i) => i.spans[0].text).join(' / ').slice(0, 400), di: p.di, source: sid, alsoSupportedBy: [], heading: p.heading, passage: truncate(p.text, 600), nature: 'stated as fact', temporal: 'undated', stems: p.stemSet, origin: docs[p.di].origin, score: p.score, part: ctx.partIndex });
    n = items.length;
  }
  if (code) { blocks.push({ type: 'heading', text: `Example code — from ${docs[code.di].site || docs[code.di].domain}` }); blocks.push({ type: 'code', text: code.text.slice(0, 2400), lang: code.block.lang || '', cites: [env.cite(code.di)] }); }
  const extra = mmr(ranked.sentences.filter((s) => s.score >= env.top.score * 0.45 && s.type === 'p' && !/:\s*$/.test(s.text) && (!found || s.di !== found.passage.di) && (!ordered || s.cueHit)), 3, { maxPerDoc: 1, filter: (s) => !env.used.has(`${s.pi}:${s.si}`) }).map((s) => env.quote(s)).filter(Boolean);
  if (extra.length && !env.style.brief) { blocks.push({ type: 'heading', text: 'Other sources add' }); blocks.push({ type: 'list', ordered: false, items: extra.map((sp) => ({ spans: [sp] })) }); }
  return { blocks, claims: env.claims, stats: { directness: clamp(0.5 + 0.4 * Math.min(1, (found ? found.score : 0.6))), keyClaims: env.claims.length, corroborated: env.corroborated }, lead: leadSp ? leadSp.text : `${n} steps from ${found ? docs[found.passage.di].site : ''}` };
}

function composeComparison(env) {
  const { part, ctx, docs, ranked } = env;
  const items = part.compare.items;
  const blocks = [];
  const stemSets = items.map((it) => new Set(stemsOf(it)));
  // one identifying sentence per item, from the page that is about that item
  const intro = [];
  items.forEach((it, i) => {
    const di = ctx.entityDocs ? ctx.entityDocs.get(it.toLowerCase()) : undefined;
    // without an identified page for the item, only a page titled after this item alone may introduce it — a "TCP vs UDP" article is not "the page about TCP"
    const others = stemSets.filter((_, k) => k !== i);
    const titled = (x) => { const ts = stemsOf(docs[x.di].title || ''); return [...stemSets[i]].every((t) => ts.includes(t)) && !others.some((o) => [...o].every((t) => ts.includes(t))); };
    const own = (x) => (di != null ? x.di === di : titled(x) && [...stemSets[i]].every((t) => x.stems.has(t)));
    const s = ranked.sentences.filter((x) => own(x) && x.type === 'p' && x.order <= 2 && x.si === 0).sort((a, b) => a.order - b.order)[0];
    const sp = s && env.quote(s, { allowDangling: true });
    if (sp) intro.push({ spans: [span(`${capitalize(it)}: `, [], { strong: true }), sp] });
  });
  if (intro.length) blocks.push({ type: 'list', ordered: false, items: intro });
  const cmp = ctx.comparison;
  if (cmp && cmp.rows.length) {
    const sids = cmp.entities.map((e) => ctx.citeStructured(e, null));
    blocks.push({ type: 'table', header: ['', ...cmp.entities.map((e) => e.label)], rows: cmp.rows.map((r) => [capitalize(r.property), ...r.cells]), cites: sids, caption: 'Properties recorded for both in Wikidata' });
    for (const r of cmp.rows.slice(0, 6)) ctx.relations.push({ subject: cmp.entities.map((e) => e.label).join(' / '), property: r.property, value: r.cells.join(' / '), source: sids[0], part: ctx.partIndex });
  }
  const aspect = new Set(stemsOf(part.compare.aspect || ''));
  const both = ranked.sentences.filter((s) => s.cueHit && stemSets.filter((ss) => [...ss].every((t) => s.stems.has(t))).length >= 2 && !/\?$/.test(s.text));
  const oneSided = ranked.sentences.filter((s) => s.cueHit && stemSets.some((ss) => [...ss].every((t) => s.stems.has(t))) && (!aspect.size || [...aspect].some((a) => s.stems.has(a))));
  const direct = mmr(both.length ? both : [], Math.min(5, ctx.budget.sentences), { maxPerDoc: 2 }).map((s) => env.quote(s, { allowDangling: true })).filter(Boolean);
  if (direct.length) { blocks.push({ type: 'heading', text: 'Where the sources compare them directly' }); blocks.push({ type: 'list', ordered: false, items: direct.map((sp) => ({ spans: [sp] })) }); }
  if (direct.length < 3 && !env.style.brief) {                       // what each one's own page says (about the requested aspect, if any)
    const more = [];
    items.forEach((it, i) => {
      const di = ctx.entityDocs ? ctx.entityDocs.get(it.toLowerCase()) : undefined;
      if (di == null) return;
      const pool = ranked.sentences.filter((s) => s.di === di && s.type === 'p' && !s.dangling && !env.used.has(`${s.pi}:${s.si}`) && (aspect.size ? [...aspect].some((a) => s.stems.has(a)) : s.cueHit || s.order <= 3));
      for (const s of mmr(pool, aspect.size ? 2 : 1, {})) { const sp = env.quote(s); if (sp) more.push({ spans: [span(`${capitalize(it)}: `, [], { strong: true }), sp] }); }
    });
    if (!more.length && oneSided.length) for (const s of mmr(oneSided, 3, { maxPerDoc: 1, filter: (x) => !env.used.has(`${x.pi}:${x.si}`) })) { const sp = env.quote(s); if (sp) more.push({ spans: [sp] }); }
    if (more.length) { blocks.push({ type: 'heading', text: part.compare.aspect ? `On ${part.compare.aspect}` : 'Characteristics described in the sources' }); blocks.push({ type: 'list', ordered: false, items: more }); }
  }
  if (!direct.length) blocks.push(note('I did not find a passage that compares them head to head; the points above come from separate sources about each one, so no “winner” is implied.', 'info'));
  if (!blocks.some((b) => b.type === 'list' || b.type === 'table')) return insufficient(env, 'I could not retrieve usable pages about the things being compared.');
  return { blocks, claims: env.claims, stats: { directness: direct.length ? 0.85 : cmp ? 0.65 : 0.5, keyClaims: Math.max(1, env.claims.length), corroborated: env.corroborated, structuredAgreement: false }, lead: direct[0] ? direct[0].text : intro.map((i) => i.spans[1].text).join(' ') };
}

const NAME_ADJECTIVES = { france: 'french', spain: 'spanish', britain: 'british', uk: 'british', netherlands: 'dutch', switzerland: 'swiss', greece: 'greek', turkey: 'turkish', poland: 'polish', sweden: 'swedish', denmark: 'danish', finland: 'finnish', ireland: 'irish', scotland: 'scottish', wales: 'welsh', england: 'english', thailand: 'thai', philippines: 'filipino', portugal: 'portuguese', norway: 'norwegian', belgium: 'belgian', peru: 'peruvian', asia: 'asian', us: 'american', usa: 'american' };
/** Word forms that refer to the same named topic: the name itself and its adjective (China → Chinese, Nepal → Nepali/Nepalese, Germany → German). */
function nameForms(word) {
  const w = word.toLowerCase();
  const base = w.replace(/[aeiouy]$/, '');
  const irregular = NAME_ADJECTIVES[w];
  return (tok) => tok === w || tok === w + 's' || tok === irregular || (base.length >= 4 && tok.startsWith(base) && (base.length >= 5 && tok.length === base.length ? true : /^(n|an|ian|ean|ese|i|is|ish)$/.test(tok.slice(base.length))));
}

/**
 * Does a headline (with its summary) concern the asked topic? Every word of a short topic must be present ("artificial
 * intelligence", not just "intelligence"), or its initials ("AI"), or — for a one-word name — its adjective ("Chinese").
 */
export function topicMatcher(focusText) {
  const focus = new Set(stemsOf(focusText || ''));
  const words = (focusText || '').split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  const initials = words.length >= 2 && words.length <= 5 ? new RegExp(`(^|[^\\p{L}\\p{N}])${words.map((w) => w[0].toUpperCase()).join('')}(?![\\p{L}\\p{N}])`, 'u') : null;
  const named = words.length === 1 ? nameForms(words[0]) : null;
  const need = focus.size <= 2 ? focus.size : Math.ceil(focus.size * 0.6);
  return (text) => {
    if (!focus.size) return true;
    const st = new Set(stemsOf(text));
    let n = 0;
    for (const f of focus) if (st.has(f)) n++;
    return n >= need || !!(initials && initials.test(text)) || !!(named && text.toLowerCase().split(/[^\p{L}\p{N}]+/u).some(named));
  };
}

function composeNews(env) {
  const { ctx, part, docs } = env;
  const fresh = part.temporal.freshness || 'week';
  let hours = part.temporal.when === 'yesterday' ? 50 : { day: 26, week: 7 * 24, month: 31 * 24, year: 366 * 24 }[fresh];
  let windowLabel = part.temporal.when === 'yesterday' ? 'since yesterday' : { day: 'in the last 24 hours', week: 'in the last 7 days', month: 'in the last month', year: 'in the last year' }[fresh];
  const focus = new Set(stemsOf(part.focus || ''));
  const about = topicMatcher(part.focus);
  const gather = (maxAge) => {
    const out = [];
    docs.forEach((d, di) => {
      if (!d.news || !d.published) return;
      const age = (ctx.now - Date.parse(d.published)) / 3600000;
      if (!(age >= -2 && age <= maxAge)) return;
      const onTopic = about(d.title + ' ' + (d.summary || ''));
      if (!onTopic && !d.regional) return;
      out.push({ di, doc: d, age, titleStems: new Set(stemsOf(d.title)), onTopic });
    });
    return out;
  };
  let stories = gather(hours);
  if (!stories.length && fresh === 'day' && part.temporal.when !== 'yesterday') {      // nothing in the last day: say so and show what the feeds carried just before
    stories = gather(50);
    if (stories.length) { hours = 50; windowLabel = 'in the last two days (I found nothing dated within the last 24 hours)'; }
  }
  if (!stories.length) return insufficient(env, `I read the available news feeds but found no item ${part.focus ? `about ${part.focus} ` : ''}published ${windowLabel}.`);
  // cluster the same story across publishers
  const clusters = [];
  for (const s of stories.sort((a, b) => a.age - b.age)) {
    const c = clusters.find((cl) => simSets(cl.titleStems, s.titleStems) >= 0.34);
    if (c) { if (!c.items.some((x) => x.doc.origin === s.doc.origin)) c.items.push(s); } else clusters.push({ titleStems: s.titleStems, items: [s] });
  }
  for (const c of clusters) c.score = c.items.length * 1.2 + (c.items.some((x) => x.onTopic) && focus.size ? 1 : 0) + Math.max(0, 1 - c.items[0].age / hours) + (c.items.some((x) => x.doc.verified) ? 0.3 : 0);
  clusters.sort((a, b) => b.score - a.score);
  // at most three single-publisher stories per outlet, so one prolific feed cannot fill the whole digest
  const maxShown = env.style.brief ? 4 : env.style.detail ? 12 : 8;
  const perOutlet = new Map(), shown = [];
  for (const c of clusters) {
    const outlet = c.items[0].doc.origin || c.items[0].doc.site;
    if (c.items.length === 1 && (perOutlet.get(outlet) || 0) >= 3) continue;
    perOutlet.set(outlet, (perOutlet.get(outlet) || 0) + 1);
    shown.push(c);
    if (shown.length >= maxShown) break;
  }
  for (const c of clusters) { if (shown.length >= maxShown) break; if (!shown.includes(c)) shown.push(c); }
  const items = shown.map((c) => {
    const lead = c.items.find((x) => x.doc.verified) || c.items[0];
    const cites = c.items.slice(0, 3).map((x) => env.cite(x.di));
    const summary = lead.doc.leadSentence || lead.doc.summary || '';
    const text = truncate(cleanSentence(summary), 280);
    env.claims.push({ text: lead.doc.title, di: lead.di, source: cites[0], alsoSupportedBy: cites.slice(1), heading: '', passage: truncate(`${lead.doc.title}. ${summary}`, 500), nature: 'reported', temporal: `published ${String(lead.doc.published).slice(0, 16).replace('T', ' ')} UTC`, stems: c.titleStems, origin: lead.doc.origin, score: c.score, part: ctx.partIndex });
    if (c.items.length > 1) env.corroborated++;
    return { spans: [span(lead.doc.title.replace(/\s+[|–]\s+[^|–]{3,40}$/, '').trim(), [], { strong: true }), span(text && simSets(new Set(stemsOf(text)), c.titleStems) < 0.8 ? `— ${text}` : ''), span(`(${lead.doc.site}, ${ago(lead.doc.published, ctx.now)}${c.items.length > 1 ? `; also reported by ${c.items.slice(1, 3).map((x) => x.doc.site).join(', ')}` : ''})`, cites, { meta: true })] };
  });
  const publishers = uniq(stories.map((s) => s.doc.site));
  const blocks = [
    para([span(`These are the main stories ${part.focus ? `about ${part.focus} ` : ''}that news publishers reported ${windowLabel} (checked ${formatDate(new Date(ctx.now).toISOString().slice(0, 10))}, ${new Date(ctx.now).toISOString().slice(11, 16)} UTC):`)]),
    { type: 'list', ordered: false, items },
    note(`Based on ${stories.length} dated item${stories.length > 1 ? 's' : ''} from ${publishers.length} publisher${publishers.length > 1 ? 's' : ''} (${publishers.slice(0, 6).join(', ')}). This reflects what those outlets published, not a complete picture; stories carried by several outlets are listed first.`, 'info'),
  ];
  return { blocks, claims: env.claims, stats: { directness: 0.85, keyClaims: shown.length, corroborated: env.corroborated, freshOk: true }, lead: items.slice(0, 2).map((i) => i.spans[0].text).join('; ') };
}

/** Answer one part of the question from the retrieved documents. */
export function answerPart(part, docs, ctx) {
  const env = makeEnv(part, docs, ctx);
  let res;
  const t = part.qtype === 'prediction' ? 'prediction' : part.answerType;      // "who will win …" is a prediction, whatever kind of answer it asks for
  if (t === 'news') res = composeNews(env);
  else if (t === 'comparison' && part.compare && part.compare.items.length >= 2) res = composeComparison(env);
  else if (t === 'yesno') res = composeYesNo(env);
  else if (['time', 'person', 'place', 'quantity', 'attribute', 'entity'].includes(t)) res = composeFactoid(env);
  else if (t === 'procedure') res = composeSteps(env, true);
  else if (t === 'list') { const found = bestList(env); res = found ? composeSteps(env, false) : composeExtractive(env, { heading: `${capitalize(part.attribute || 'Items')} mentioned in the sources` }); }
  else if (t === 'prediction') {
    // A question about a named future year is answered only by a source statement about that year; anything else would be a guess.
    const futureYears = ((part.temporal && part.temporal.years) || []).filter((y) => y > new Date(env.ctx.now || Date.now()).getUTCFullYear());
    const thisYear = new Date(env.ctx.now || Date.now()).getUTCFullYear();
    // "The next eclipse will occur on April 8, 2024", read in a later year, is an old forecast and no longer an answer
    const stale = (s) => { const ys = (s.text.match(/\b(?:19|20|21)\d\d\b/g) || []).map(Number); return ys.length > 0 && ys.every((y) => y < thisYear) && /\b(will|next|upcoming|expected|scheduled)\b/i.test(s.text); };
    const aboutYear = (s) => (!futureYears.length || futureYears.some((y) => s.text.includes(String(y)))) && !stale(s);
    res = composeExtractive(env, { attribute: true, heading: 'What other sources say', leadFilter: (s) => CUES.prediction.test(s.text) && aboutYear(s), bulletFilter: aboutYear,
      requireLead: futureYears.length ? `I cannot predict the future, and none of the pages I retrieved makes a statement about ${futureYears.join(' or ')}.` : 'I cannot predict the future, and none of the pages I retrieved makes a current forward-looking statement about this.' }); if (!res.stats.insufficient) res.blocks.unshift(note('I cannot predict the future. What follows is what the sources I retrieved say or project — treat it as their view, with their dates.', 'warn')); }
  else if (t === 'recommendation') { res = composeExtractive(env, { attribute: true, heading: 'Other advice in the sources', leadFilter: (s) => CUES.recommendation.test(s.text) }); if (!res.stats.insufficient) res.blocks.unshift(note('Recommendations depend on your situation. These are the views of the cited sources, not a verified fact.', 'info')); }
  else if (t === 'definition') res = composeExtractive(env, { leadFilter: (s) => s.defHit && (!s.dangling), heading: 'Key points' });
  else if (t === 'reason') res = composeExtractive(env, { leadFilter: (s) => s.cueHit && s.directCov >= 0.5 && s.predCov >= 0.5 && !s.dangling, bulletFilter: (s) => s.cueHit && (env.docs[s.di].entity || env.docs[s.di].kind !== 'encyclopedia'), heading: 'In more detail', requireLead: 'The pages I retrieved discuss the topic, but I found no sentence in them that states a cause or reason for this.' });
  else res = composeExtractive(env, { heading: t === 'mechanism' ? 'How it works, according to the sources' : 'Key points', openFirst: !!part.fn, leadFilter: t === 'mechanism' ? (s) => s.defHit && !s.dangling && s.order <= 1 : part.fn ? (s) => s.defHit && !s.dangling : null, bulletFilter: t === 'mechanism' ? (s) => s.cueHit && (s.order <= 14 || /\b(process|mechanism|overview|function|operation|principle|stages?|steps?|cycle|reactions?)\b/i.test(s.heading)) : null });
  // a near-identical statement elsewhere that gives a different figure is shown as a dispute, never counted as support
  for (const d of env.disputes.slice(0, 2)) {
    if (res.stats.insufficient || env.used.has(`${d.b.pi}:${d.b.si}`)) continue;
    const sp = env.quote(d.b, { allowDangling: true });
    if (!sp) continue;
    res.stats.conflicts = (res.stats.conflicts || 0) + 1;
    res.blocks.push(note('Another source states this with a different figure:', 'warn'), { type: 'list', ordered: false, items: [{ spans: [sp] }] });
  }
  // conflicts among the statements actually used
  const conf = detectConflicts(res.claims.map((c) => ({ text: c.original || c.text, stems: c.stems, origin: c.origin })));
  if (conf.length) {
    res.stats.conflicts = (res.stats.conflicts || 0) + conf.length;
    res.conflicts = conf.map((x) => ({ ...x, ca: x.a, cb: x.b }));
    res.blocks.push(note(`Possible disagreement between sources (${conf.map((x) => x.kind + (x.detail ? ': ' + x.detail : '')).slice(0, 2).join('; ')}). Compare the cited passages before relying on this.`, 'warn'));
  }
  res.ranked = env.ranked;
  res.qm = env.qm;
  return res;
}

/** Summarise a single page the user pointed at (direct URL questions). */
export function summarizeDoc(doc, di, ctx) {
  const lead = (doc.blocks || []).filter((b) => b.type === 'p' && b.text.length > 80).slice(0, 2);
  const sid = ctx.cite(di);
  const blocks = [];
  if (!lead.length) return { blocks: [para([span(NOT_VERIFIED)]), note('The page could be fetched but contains almost no readable text (it may require JavaScript).', 'warn')], claims: [], stats: { insufficient: true, directness: 0, keyClaims: 0, corroborated: 0 }, lead: NOT_VERIFIED };
  blocks.push(para(lead.map((b) => span(truncate(cleanSentence(b.text), 420), [sid]))));
  const heads = (doc.blocks || []).filter((b) => b.type === 'heading' && b.level <= 3).slice(0, 10);
  if (heads.length >= 2) { blocks.push({ type: 'heading', text: 'Sections of the page' }); blocks.push({ type: 'list', ordered: false, items: heads.map((h) => ({ spans: [span(h.text, [sid])] })) }); }
  const claims = lead.map((b) => ({ text: truncate(b.text, 300), di, source: sid, alsoSupportedBy: [], heading: b.heading, passage: truncate(b.text, 600), nature: 'stated as fact', temporal: 'undated', stems: new Set(stemsOf(b.text)), origin: doc.origin, score: 1, part: ctx.partIndex }));
  return { blocks, claims, stats: { directness: 0.8, keyClaims: claims.length, corroborated: 0 }, lead: truncate(lead[0].text, 300) };
}
