// INFINI AI — orchestrator.
// Conversation, memory and everyday common sense are answered by the built-in brain (engine/brain).
// Everything that needs knowledge goes to the web: Understanding → Planning → Searching → Reading → Comparing → Constructing.
// Every event emitted here reports an operation that actually ran (with its real outcome, timing and errors).

import { loadConfig, VERSION } from './config.js';
import { createHttpClient } from './net/http.js';
import { analyze } from './nlp/analyze.js';
import { buildPlan, reformulate } from './plan/plan.js';
import { PROVIDERS, runProvider, webSearch, fuse, isEnabled, listProviders, resetCooling, providerCooling, WEB_CHAIN } from './providers/index.js';
import { langsearchUsage } from './providers/searchapis.js';
import { createBrain, sanitizeState as sanitizeBrain, noteWeb } from './brain/index.js';
import wikipedia from './providers/wikipedia.js';
import ddgInstant from './providers/ddg_instant.js';
import { selectFeeds, fetchFeeds } from './providers/feeds.js';
import { entityFacts, compareEntities, getEntity, chooseSenses } from './providers/wikidata.js';
import { extractPage } from './extract/readable.js';
import { classifySource, originGroups, scoreConfidence, buildGraph } from './evidence/evidence.js';
import { answerPart, summarizeDoc, topicMatcher } from './synth/synth.js';
import { composeReport, applyConsensus } from './synth/report.js';
import { relatedQuestions } from './synth/related.js';
import { queryModel, rankEvidence, feedbackTerms, stemsOf, lexicalOverlap, docStems } from './rank/rank.js';
import { europepmc } from './providers/scholar.js';
import { setMaxListeners } from 'node:events';
import { runResearch, RESEARCH_BUDGET } from './research/run.js';
import { digestDoc } from './research/digest.js';
import { applySalience } from './research/salience.js';
import { aspectMatcher } from './research/aspects.js';
import { researchDirective } from './research/directive.js';
import { buildClassification, stanceOf } from './classify/classify.js';
import { canonicalUrl, domainOf, truncate, uniq, capitalize, squash, splitSentences, hash, escapeRegex } from './util/text.js';
import { formatDate } from './util/dates.js';

export { VERSION, loadConfig };
export const STAGES = ['understanding', 'planning', 'searching', 'reading', 'comparing', 'constructing'];
export const DEPTHS = ['auto', 'fast', 'balanced', 'deep', 'research'];

const SKIP_HOST = /(^|\.)(youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com|pinterest\.com|linkedin\.com|vimeo\.com|spotify\.com|play\.google\.com|apps\.apple\.com)$/;
const SKIP_EXT = /\.(pdf|docx?|pptx?|xlsx?|zip|gz|png|jpe?g|gif|webp|svg|mp4|mp3|avi|mov|exe|dmg|apk)(\?|#|$)/i;
const str = (v, n) => (typeof v === 'string' ? squash(v).slice(0, n) : '');

function sanitizeContext(c) {
  if (!c || typeof c !== 'object') return {};
  const ents = Array.isArray(c.entities) ? c.entities.slice(0, 10).map((e) => ({ name: str(e && e.name, 120), kind: ['person', 'place', 'thing', 'unknown'].includes(e && e.kind) ? e.kind : 'unknown', gender: e && (e.gender === 'm' || e.gender === 'f') ? e.gender : '', plural: !!(e && e.plural) })).filter((e) => e.name) : [];
  return {
    entities: ents, topic: str(c.topic, 120),
    predicates: Array.isArray(c.predicates) ? c.predicates.slice(0, 5).map((p) => ({ verb: str(p && p.verb, 30).toLowerCase().replace(/[^a-z-]/g, ''), object: str(p && p.object, 120), subject: str(p && p.subject, 120) })).filter((p) => p.verb) : [],
    compare: Array.isArray(c.compare) ? c.compare.slice(0, 4).map((x) => str(x, 80)).filter(Boolean) : null,
    lastQuestion: str(c.lastQuestion, 600), lastFocus: str(c.lastFocus, 120), lastKeywords: str(c.lastKeywords, 200), lastAnswerType: str(c.lastAnswerType, 30),
    lastSources: Array.isArray(c.lastSources) ? c.lastSources.slice(0, 12).map((s) => ({ title: str(s && s.title, 200), url: /^https?:\/\//.test(s && s.url) ? String(s.url).slice(0, 600) : '', domain: str(s && s.domain, 100) })).filter((s) => s.url) : [],
    turn: Number.isInteger(c.turn) ? Math.min(c.turn, 100000) : 0,
    brain: c.brain && typeof c.brain === 'object' ? sanitizeBrain(c.brain) : null,
  };
}
function sanitizeLearned(l) {
  const out = { domains: {}, providers: {}, vocab: {} };
  if (!l || typeof l !== 'object') return out;
  for (const [d, v] of Object.entries(l.domains || {}).slice(0, 300)) if (/^[a-z0-9.-]{3,80}$/.test(d) && v) out.domains[d] = { good: Math.min(50, Math.max(0, Number(v.good) || 0)), bad: Math.min(50, Math.max(0, Number(v.bad) || 0)) };
  for (const [p, v] of Object.entries(l.providers || {}).slice(0, 30)) if (PROVIDERS[p]) out.providers[p] = Math.min(1, Math.max(-1, Number(v) || 0));
  for (const [t, v] of Object.entries(l.vocab || {}).slice(0, 400)) if (/^[\p{L}\p{N}-]{2,30}$/u.test(t) && Array.isArray(v)) out.vocab[t] = v.slice(0, 6).map((w) => str(w, 30).toLowerCase()).filter((w) => /^[\p{L}\p{N}-]{3,30}$/u.test(w));
  return out;
}
function inferKind(text) {
  const t = String(text || '').slice(0, 700);
  if (/\((?:born\b|[^()]{0,60}\b\d{3,4}\s*[–—-]\s*[^()]{0,60}\b\d{3,4})[^()]*\)/.test(t.slice(0, 300)) && /\b(?:is|was) an? /.test(t)) return 'person';
  if (/\b(?:is|was) (?:a|an|the) (?:[\w-]+ ){0,6}(?:country|city|town|village|capital|state|province|region|island|river|mountain|continent|municipality|district|county|lake|ocean|sea|territory|republic|kingdom|nation|peninsula|desert|valley|archipelago)\b/.test(t)) return 'place';
  return 'thing';
}
function inferGender(text) {
  const he = (text.match(/\b(he|his|him)\b/gi) || []).length, she = (text.match(/\b(she|her|hers)\b/gi) || []).length;
  return he >= 2 && he > she * 1.5 ? 'm' : she >= 2 && she > he * 1.5 ? 'f' : '';
}
export function blocksToText(blocks) {
  const sp = (spans) => spans.map((s) => s.text + (s.cites && s.cites.length ? ' ' + s.cites.map((c) => `[${c}]`).join('') : '')).join(' ').replace(/\s+([.,;:])/g, '$1').replace(/ {2,}/g, ' ');
  const out = [];
  for (const b of blocks) {
    if (b.type === 'paragraph') out.push(sp(b.spans));
    else if (b.type === 'heading') out.push(`\n${b.text}`);
    else if (b.type === 'list') out.push(b.items.map((it, i) => `${'  '.repeat(it.depth || 0)}${b.ordered ? i + 1 + '.' : '•'} ${sp(it.spans)}${(it.code || []).map((c) => '\n' + c.split('\n').map((l) => '      ' + l).join('\n')).join('')}`).join('\n'));
    else if (b.type === 'table') out.push([b.header.join(' | '), ...b.rows.map((r) => r.join(' | '))].join('\n') + (b.cites ? ' ' + b.cites.map((c) => `[${c}]`).join('') : ''));
    else if (b.type === 'code') out.push(b.text);
    else if (b.type === 'note') out.push(`Note: ${b.text}`);
  }
  return out.join('\n\n').trim();
}
const P = (text, extra) => ({ type: 'paragraph', spans: [{ text, cites: [], ...extra }] });

const BRIDGE = /^(.*?\b)(?:the |a |an )?((?:inventor|discoverer|author|writer|founder|creator|director|capital|capital city|president|prime minister|ceo|composer|architect|developer|designer|wife|husband|spouse|father|mother|king|queen|leader|currency|largest city|official language) of (?:the )?[^,?]+?)((?:\s+(?:born|die|died|live|lived|located|founded|built|written|published|was|is|did|do|does|have|has|had|speak|use)\b.*)?)\??$/i;
/** Does the question need the answer to an inner question before it can be asked? Returns {first, rest(name), describe} or null. */
function detectHop(analysis) {
  const parts = analysis.parts;
  if (parts.length >= 2 && analysis.unresolved.some((w) => /^(he|she|him|her|his|they|them|their|it|its)$/i.test(w)) && ['person', 'place', 'entity', 'attribute'].includes(parts[0].answerType)) {
    const rest = parts.slice(1).map((p) => (p.original || p.text).replace(/[?.!]+$/, '')).join(' and ');
    const pron = /\b(he|she|they|it)\b/i, obj = /\b(him|her|them)\b/i, poss = /\b(his|her|their|its)\b/i;
    return { first: parts[0].text.replace(/[?.!]*$/, '?'), describe: rest, rest: (name) => (pron.test(rest) ? rest.replace(pron, name) : obj.test(rest) ? rest.replace(obj, name) : rest.replace(poss, `${name}'s`)).replace(/^./, (c) => c.toUpperCase()) + '?' };
  }
  if (parts.length !== 1) return null;
  const core = parts[0].core.replace(/[?.!]+$/, '');
  const m = core.match(BRIDGE);
  if (!m || /^(?:who|what|which)\s+(?:is|was|are|were)\s*$/i.test(m[1].trim()) || !m[1].trim() || m[1].trim().split(/\s+/).length < 2) return null;
  const role = m[2].split(' of ')[0].toLowerCase();
  const wh = /capital|currency|city|language/.test(role) ? 'What' : 'Who';
  return { first: `${wh} is the ${m[2]}?`, describe: core, rest: (name) => `${m[1]}${name}${m[3] || ''}?`.replace(/\s+/g, ' ') };
}
/** Combine the two hops into one answer: sources are renumbered, confidence is that of the weaker step. */
function mergeResults(r1, r2, t1, t2, question) {
  const map = new Map();
  const sources = r1.sources.map((x) => ({ ...x, passages: [...x.passages] }));
  for (const x of r2.sources) {
    const ex = sources.find((y) => y.url === x.url);
    if (ex) { map.set(x.id, ex.id); for (const p of x.passages) if (!ex.passages.some((q) => q.text === p.text)) ex.passages.push(p); }
    else { const id = sources.length + 1; map.set(x.id, id); sources.push({ ...x, id }); }
  }
  const remap = (v) => JSON.parse(JSON.stringify(v), (k, val) => (k === 'cites' && Array.isArray(val) ? val.map((c) => map.get(c) || c) : (k === 'source' && typeof val === 'number' ? map.get(val) || val : k === 'alsoSupportedBy' && Array.isArray(val) ? val.map((c) => map.get(c) || c) : val)));
  const weaker = (r1.confidence && r2.confidence && r1.confidence.score < r2.confidence.score ? r1 : r2).confidence;
  const R1 = r1.research || { searches: [], fetches: [], passages: [], timings: {}, counts: {} }, R2 = r2.research || { searches: [], fetches: [], passages: [], timings: {}, counts: {} };
  const sum = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = (o[k] || 0) + v; return o; };
  return {
    ...r2, question, kind: 'retrieval', sources,
    answer: { blocks: [{ type: 'heading', text: `Step 1 — ${t1}`, level: 2 }, ...r1.answer.blocks, { type: 'heading', text: `Step 2 — ${t2}`, level: 2 }, ...remap(r2.answer.blocks)] },
    confidence: weaker ? { ...weaker, factors: [...weaker.factors, { name: 'Multi-step', value: weaker.score, note: 'two-step answer: the confidence shown is that of the weaker step, because an error in step 1 carries into step 2' }] } : weaker,
    interpretation: { resolved: `${t1} → ${t2}`, rewrites: [{ from: question, to: `${t1} → ${t2}`, reason: 'multi-step question solved in two hops' }], followUp: false, metaOf: null, parts: [...((r1.interpretation || {}).parts || []), ...((r2.interpretation || {}).parts || [])] },
    consulted: [...(r1.consulted || []), ...(r2.consulted || [])].slice(0, 30), unavailable: [...(r1.unavailable || []), ...(r2.unavailable || [])],
    research: { ...R2, plan: R2.plan ? { ...R2.plan, subquestions: [...((R1.plan || {}).subquestions || []), ...R2.plan.subquestions] } : R1.plan, searches: [...R1.searches, ...R2.searches], fetches: [...R1.fetches, ...R2.fetches], passages: [...R1.passages, ...remap(R2.passages)], timings: sum(R1.timings, R2.timings), counts: sum(R1.counts, R2.counts) },
    timeSensitive: r1.timeSensitive || r2.timeSensitive, hops: 2,
    // run and classification describe the second step (where the search went deep); its citation numbers follow the merged list
    ...(r2.classification ? { classification: { ...r2.classification, items: (r2.classification.items || []).map((it) => (it.c ? { ...it, c: map.get(it.c) || it.c } : it)) } } : {}),
  };
}

export function createEngine(userCfg) {
  const cfg = userCfg || loadConfig();
  const http = createHttpClient(cfg.http);
  const totals = { asks: 0, answered: 0, insufficient: 0, errors: 0, brain: 0, startedAt: Date.now() };
  let lastDraftError = '';          // development aid: why the last interim draft could not be built (drafts are optional; the answer never depends on them)
  const brain = createBrain({ version: VERSION, creator: cfg.creator, maxPages: cfg.research.maxPages });
  const resting = () => WEB_CHAIN.filter((id) => providerCooling(id)).length;
  // A research run is heavy (hundreds of requests, up to a few hundred MB of memory): only a few run side by side, and
  // only so many are started per hour, counted for this server instance. A request beyond that is answered at depth "deep".
  const researchLoad = { running: 0, starts: [] };
  const researchGate = () => {
    const t = Date.now();
    while (researchLoad.starts.length && t - researchLoad.starts[0] > 3600_000) researchLoad.starts.shift();
    if (researchLoad.running >= cfg.research.maxConcurrent) return `${researchLoad.running} research ${researchLoad.running === 1 ? 'run is' : 'runs are'} already in progress on this server (the limit is ${cfg.research.maxConcurrent} at a time)`;
    if (researchLoad.starts.length >= cfg.research.perHour) return `this server has started ${researchLoad.starts.length} research runs in the last hour (the limit is ${cfg.research.perHour} per hour); the next one can start in about ${Math.max(1, Math.ceil((3600_000 - (t - researchLoad.starts[0])) / 60000))} min`;
    researchLoad.running++; researchLoad.starts.push(t);
    return '';
  };

  async function ask(req, { signal = null, onEvent = null, inspect = null } = {}) {
    const t0 = Date.now();
    const now = Date.now();
    totals.asks++;
    const emit = (ev) => { if (onEvent) { try { onEvent(ev); } catch { /* listener errors never break retrieval */ } } };
    if (signal) { try { setMaxListeners(0, signal); } catch { /* older runtimes: only a warning is at stake */ } }      // a research run has dozens of requests listening for "stop" at once
    const timings = {};
    const aborted = () => !!(signal && signal.aborted);
    const stage = async (name, fn, round) => {
      if (aborted()) throw Object.assign(new Error('Stopped'), { code: 'aborted' });
      emit({ type: 'stage', stage: name, status: 'start', round });
      const s = Date.now();
      const detail = await fn();
      timings[name] = (timings[name] || 0) + (Date.now() - s);
      emit({ type: 'stage', stage: name, status: 'done', ms: Date.now() - s, round, detail });
      return detail;
    };
    const settings = req.settings && typeof req.settings === 'object' ? req.settings : {};
    const off = new Set(Array.isArray(settings.providersOff) ? settings.providersOff.slice(0, 30).map(String) : []);
    const context = sanitizeContext(req.context);
    const learned = sanitizeLearned(req.learned);
    let question = typeof req.question === 'string' ? req.question : '';
    const base = { ok: true, id: hash(question + ':' + t0), version: VERSION, question: question.slice(0, 600), kind: 'retrieval', sources: [], consulted: [], unavailable: [], research: null, context, learn: null, timeSensitive: false };
    const finish = (r) => { r.elapsedMs = Date.now() - t0; r.answer.text = blocksToText(r.answer.blocks); emit({ type: 'answer', result: r }); return r; };
    let preface = '';                     // a short social reply that goes in front of a web answer ("You're welcome!")
    const local = (kind, blocks, confidence = null, extra = {}) => finish({ ...base, kind, answer: { blocks: preface && kind !== 'brain' ? [P(preface), ...blocks] : blocks }, confidence, ...extra });

    // ---------------- the built-in brain: conversation, memory, common sense, small skills ----------------
    // It answers by itself or passes the message on (sometimes reworded) to the web pipeline below.
    let brainState = context.brain;
    let reworded = null;
    // "Do deep research on X", "find everything you can about X": the instruction says how to answer and is taken off first,
    // so that the brain and the question analysis see the topic alone (and its spelling can be repaired like any other question's).
    let directive = null;
    if (!req._hop) {
      directive = researchDirective(question);
      if (directive && directive.question.length >= 3) {
        reworded = { from: question.slice(0, 300), to: directive.question, reason: directive.reason };
        question = directive.question;
      } else directive = null;
    }
    if (!req._hop) {
      const pre = analyze(question, context, { now });
      const lastKind = brainState && brainState.last ? brainState.last.k : '';
      const pending = !!(brainState && brainState.expect);
      const direct = pre.intent === 'empty' || pre.intent === 'url' || (pre.intent === 'calc' && !pending) || (pre.intent === 'meta' && lastKind !== 'brain' && !pending);
      if (!direct) {
        const s0 = Date.now();
        let b = null;
        try {
          b = brain.respond({ question, state: brainState, now, tz: req.tz, country: req.country, health: { resting: resting() }, ctxTurn: context.turn || 0, regenerate: !!req.regenerate, route: settings.route === 'web' ? 'web' : '', strict: pre.intent === 'meta' || pre.intent === 'calc' });
        } catch (e) { emit({ type: 'note', stage: 'understanding', text: `The built-in brain could not process this message (${truncate(String(e && e.message), 120)}); using web search instead.` }); }
        if (b && b.handled) {
          totals.brain++;
          emit({ type: 'stage', stage: 'understanding', status: 'start' });
          emit({ type: 'stage', stage: 'understanding', status: 'done', ms: Date.now() - s0, detail: { intent: 'conversation', followUp: false, rewrites: [], resolved: '', parts: [], brain: { intent: b.intent, origin: b.origin } } });
          return local('brain', b.blocks, null, { context: { ...context, brain: b.state, turn: (context.turn || 0) + 1 }, suggestions: b.suggestions, origin: b.origin, brain: { intent: b.intent, group: b.group, sure: b.sure, alternatives: b.alternatives || [] } });
        }
        if (b) {
          brainState = b.state; preface = b.preface || '';
          if (b.question && b.question !== question) {
            const why = b.why === 'spelling' ? 'spelling corrected by the built-in brain' : 'understood by the built-in brain';
            reworded = reworded ? { ...reworded, to: b.question, reason: `${reworded.reason}; ${why}` } : { from: question.slice(0, 300), to: b.question, reason: why };
            question = b.question;
          }
        }
      } else if (brainState) brainState = { ...brainState, expect: null };
      context.brain = brainState;
    }

    // ---------------- how deep to go ----------------
    // "auto" (the default) sizes the search itself: a quick round first, widened when that leaves a part of the question
    // without direct evidence, and a full research run when the message asks for one ("do deep research on …").
    // "fast", "balanced", "deep" and "research" are taken as given.
    const asked = DEPTHS.includes(settings.depth) ? settings.depth : 'auto';

    // ---------------- Understanding ----------------
    let style = {};
    let analysisRef = null, planRef = null;
    let analysis = await stage('understanding', async () => {
      let a = analyze(question, context, { now });
      if (a.intent === 'meta' && a.meta !== 'sources' && context.lastQuestion) {            // re-run the previous question in a different style
        const kind = a.meta;
        style = kind === 'simplify' ? { simple: true } : kind === 'elaborate' ? { detail: true } : kind === 'shorten' ? { brief: true } : {};
        a = { ...analyze(context.lastQuestion, {}, { now }), metaOf: kind, followUp: true, rewrites: [{ from: question, to: context.lastQuestion, reason: { simplify: 'simpler explanation of the previous question', elaborate: 'more detail on the previous question', shorten: 'shorter answer to the previous question', verify: 'previous question re-checked with a deeper search' }[kind] }] };
        if (kind === 'verify' || kind === 'elaborate') settings._seedDeep = true;
        if (kind === 'verify') req.regenerate = true;
      }
      analysisRef = a;
      return { intent: a.intent, followUp: a.followUp, rewrites: a.rewrites, resolved: a.resolved || '', parts: a.parts.map((p) => ({ text: p.text, qtype: p.qtype, answerType: p.answerType, focus: p.focus, keywords: p.keywords, timeSensitive: p.temporal.timeSensitive, freshness: p.temporal.freshness })) };
    }).then(() => analysisRef);

    if (analysis.intent === 'empty') return local('empty', [P('Please type a question.')]);
    if (reworded && Array.isArray(analysis.rewrites)) analysis.rewrites = [reworded, ...analysis.rewrites];
    if (analysis.intent === 'calc') {
      const c = analysis.calc;
      if (c.kind === 'error') return local('calc', [P(`I can’t compute that: ${c.error}.`)]);
      return local('calc', [P(`${c.expr} = `, {}), { type: 'paragraph', spans: [{ text: c.formatted, cites: [], strong: true }] }, ...(c.steps.length ? [{ type: 'heading', text: 'Working' }, { type: 'list', ordered: true, items: c.steps.map((s) => ({ spans: [{ text: s, cites: [] }] })) }] : []), { type: 'note', tone: 'info', text: 'Computed locally by the built-in calculator — no sources were needed.' }],
        { score: 1, level: 'high', label: 'Computed', factors: [{ name: 'Deterministic calculation', value: 1, note: 'evaluated by the built-in parser; the working is shown' }], caps: [] });
    }
    if (analysis.intent === 'meta') {
      if (analysis.meta === 'sources' && context.lastSources.length) return local('meta', [P('These are the sources cited in my previous answer:'), { type: 'list', ordered: true, items: context.lastSources.map((s) => ({ spans: [{ text: `${s.title || s.domain} — ${s.url}`, cites: [] }] })) }]);
      return local('meta', [P('There is no earlier answer in this conversation for me to work from. Ask a question first, then I can simplify it, expand it or show its sources.')]);
    }
    if (analysis.clarification) {
      const c = analysis.clarification;
      return local('clarification', [P(c.reason === 'compare-items' ? `Which ${c.category || 'things'} would you like me to compare? Name them — for example “Compare Python and Rust”.` : `I’m not sure what “${(c.words || ['it'])[0]}” refers to — there is nothing earlier in this conversation it could point to. Could you name it?`)]);
    }

    // ---------------- multi-step (multi-hop) questions ----------------
    // The second step cannot even be phrased until the first is answered, so the pipeline runs twice.
    if (!req._hop && analysis.intent === 'question' && !analysis.metaOf) {
      const hop = detectHop(analysis);
      if (hop) {
        emit({ type: 'note', stage: 'understanding', text: `Multi-step question: first “${hop.first}”, then the rest using that answer.` });
        const inner = { signal, onEvent: (ev) => { if (ev.type !== 'answer' && ev.type !== 'draft') emit(ev); } };
        const r1 = await ask({ ...req, question: hop.first, _hop: true, settings: { ...settings, depth: 'balanced' } }, inner);
        const ent = (r1.answerEntities || [])[0];
        if (!ent) {
          r1.answer.blocks.push({ type: 'note', tone: 'warn', text: `This was the first step of a two-step question. I could not pin down a single answer to it, so I did not attempt the second step (“${hop.describe}”).` });
          return finish({ ...r1, question: question.slice(0, 600) });
        }
        const q2 = hop.rest(ent.name);
        const r2 = await ask({ ...req, question: q2, context: r1.context, _hop: true }, inner);
        return finish(mergeResults(r1, r2, hop.first, q2, question.slice(0, 600)));
      }
    }

    // ---------------- shared retrieval state ----------------
    const researchOn = !!(cfg.research && cfg.research.enabled);
    const auto = asked === 'auto';
    let depth = 'balanced';               // budget of the first round: fast | balanced | deep
    let mode = '';                        // research loop after the first round: '' | 'widen' | 'deep' | 'research'
    if (asked === 'fast' || asked === 'balanced') depth = asked;
    else if (asked === 'deep') { depth = 'deep'; mode = 'deep'; }
    else if (asked === 'research') { depth = 'deep'; mode = researchOn ? 'research' : 'deep'; }
    else if (directive) { depth = 'deep'; mode = directive.depth === 'research' && researchOn ? 'research' : 'deep'; }
    if (settings._seedDeep) { depth = 'deep'; if (asked !== 'deep' && asked !== 'research') mode = ''; }      // "tell me more" / "are you sure?": a deeper first round, no long run
    if (analysis.intent === 'url' || (analysis.parts.length && analysis.parts.every((p) => p.answerType === 'news'))) mode = '';
    const docs = [], docByKey = new Map(), workIndex = new Map(), searchLog = [], fetchLog = [], relations = [];
    const entityDocs = new Map(), qids = new Map(), disambig = new Map(), partFacts = [], partCompare = [], candidateLists = [];
    const senses = [];                    // [{item, label, description, url, alternatives}] — meanings chosen for ambiguous names
    const wikiUrl = (title) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')')}`;
    /** Point an item of the question at the Wikipedia article of the chosen meaning (and silence a wrong-sense page). */
    const adoptSense = (item, sense, enwiki) => {
      if (!enwiki) return;
      const cur = entityDocs.get(item.toLowerCase());
      if (cur != null && docs[cur].title.toLowerCase() === enwiki.toLowerCase()) return;
      if (cur != null) { docs[cur].blocks = []; docs[cur].wrongSense = true; entityDocs.delete(item.toLowerCase()); }
      senses.push({ item, label: sense.label, description: sense.description, url: wikiUrl(enwiki), title: enwiki, alternatives: sense.alternatives || [] });
    };
    let entityInfo = null;
    const pctx = { http, cfg, signal, now, noCache: !!req.regenerate, limit: 6, wikiReserve: 3 };
    const logSearch = (e) => { searchLog.push(e); emit({ type: 'search', ...e }); };
    const addDoc = (d) => {
      const key = d.key || canonicalUrl(d.url);
      const cls = classifySource(d.url, { author: d.author, published: d.published, quality: d.extraction, via: d.via, kind: d.kind, partial: d.partial, structured: d.structured, se: d.meta && 'accepted' in d.meta ? d.meta : null }, learned.domains);
      const doc = { ...d, ...cls, key, retrievedAt: new Date().toISOString(), blocks: d.blocks || [] };
      if (d.work) doc.origin = `work:${d.work}`;          // every scholarly work is a source of its own, wherever it is hosted
      if (d.partial && d.kind === 'academic') doc.quality = Math.max(0.1, doc.quality - 0.06);      // an abstract is the authors' summary, not the study
      let i = docByKey.get(key);
      // one scholarly work = one document: its abstract (from an index) and its full text (from the publisher or a repository) are merged
      if (i == null && d.work && workIndex.has(d.work)) {
        i = workIndex.get(d.work);
        docByKey.set(key, i);
        if (docs[i].partial && !doc.partial) docs[i] = { ...docs[i], ...doc, abstractAt: docs[i].url, published: doc.published || docs[i].published, scholar: doc.scholar || docs[i].scholar, title: doc.title || docs[i].title };
        return i;
      }
      if (d.work && i == null) workIndex.set(d.work, docs.length);
      if (i == null) { i = docs.length; docs.push(doc); docByKey.set(key, i); }
      else if ((docs[i].partial && !doc.partial) || (docs[i].partial && doc.blocks.length > docs[i].blocks.length)) docs[i] = { ...docs[i], ...doc, title: docs[i].news ? docs[i].title : doc.title || docs[i].title, published: doc.published || docs[i].published };
      return i;
    };
    const contentDoc = (r) => addDoc({ url: r.url, title: r.content.title || r.title, site: r.content.site, author: r.content.author, published: r.content.published || '', modified: r.content.modified || '', blocks: r.content.blocks, partial: !!r.content.partial, via: r.content.via, lang: r.content.lang, simple: r.content.lang === 'simple', pageType: r.content.pageType, evidenceLevel: 'api', kind: r.kind, provider: r.provider, meta: r.content.meta });

    async function fetchPage(url, { timeoutMs = 6500, news = null } = {}) {
      const t = Date.now();
      const ev = { type: 'fetch', url, domain: domainOf(url), ok: false, ms: 0, bytes: 0, blocks: 0, title: '', error: '', via: 'page', fromCache: false };
      try {
        if (wikipedia.handles(url) && isEnabled('wikipedia', cfg, off)) {
          const page = await wikipedia.fetch(url, { ...pctx, timeoutMs });
          addDoc({ url: page.url || url, title: page.title, site: page.site, modified: page.modified, blocks: page.blocks, partial: false, via: page.via, lang: page.lang, simple: page.lang === 'simple', pageType: 'reference', evidenceLevel: page.via === 'api' ? 'api' : 'page', kind: 'encyclopedia', provider: 'wikipedia' });
          Object.assign(ev, { ok: true, bytes: page.bytes || 0, blocks: page.blocks.length, title: page.title, via: page.via === 'api' ? 'Wikipedia API' : 'page', fromCache: !!page.fromCache });
        } else {
          const res = await http.getText(url, { robots: true, signal, timeoutMs, fresh: !!req.regenerate });
          const page = extractPage(res.text, res.url, { lastModified: res.headers['last-modified'], now });
          if (/\b(noai|noimageai|nosnippet|none)\b/.test(`${res.headers['x-robots-tag'] || ''} ${page.robots || ''}`.toLowerCase())) throw Object.assign(new Error('The page opts out of excerpts (robots directive) — not quoted'), { code: 'robots_meta' });
          if (page.quality.chars < 220) throw Object.assign(new Error(page.quality.jsRequired ? 'The page needs JavaScript to show its content — not readable without a browser' : 'No readable text could be extracted'), { code: 'no_content' });
          Object.assign(ev, { ok: true, bytes: res.bytes, blocks: page.blocks.length, title: page.title, fromCache: !!res.fromCache, truncated: res.truncated || undefined });
          if (news != null) {
            const d = docs[news];
            const lead = page.blocks.find((b) => b.type === 'p' && b.text.length >= 80);
            Object.assign(d, { blocks: page.blocks, verified: true, partial: false, evidenceLevel: 'page', extraction: page.quality, author: page.author, leadSentence: lead ? truncate(splitSentences(lead.text).slice(0, 2).join(' '), 300) : d.summary, published: d.published || page.published });
          } else addDoc({ url: res.url, title: page.title, site: page.site, author: page.author, published: page.published, modified: page.modified, blocks: page.blocks, extraction: page.quality, lang: page.lang, pageType: page.pageType, evidenceLevel: 'page', kind: 'web', partial: false });
        }
      } catch (e) { ev.error = e.code === 'aborted' ? 'stopped' : /EPROTO|SSL|TLS|CERT/i.test(e.message || '') ? 'Secure connection failed (TLS error)' : truncate(String(e.message || 'failed').split('\n')[0], 160); ev.code = e.code || 'error'; }
      ev.ms = Date.now() - t;
      fetchLog.push(ev);
      emit(ev);
      return ev.ok;
    }
    /** Fetch several pages in parallel; stop waiting once enough are in and the soft deadline has passed. */
    async function readPages(urls, { soft = 4500, hard = 8500, enough = 3, news = false } = {}) {
      if (!urls.length) return;
      let ok = 0, done = 0;
      const started = Date.now();
      await new Promise((resolve) => {
        const timer = setInterval(() => { const el = Date.now() - started; if (done >= urls.length || el >= hard || (el >= soft && ok >= enough) || aborted()) { clearInterval(timer); resolve(); } }, 60);
        for (const u of urls) fetchPage(typeof u === 'string' ? u : u.url, { timeoutMs: hard - 300, news: news ? u.di : null }).then((r) => { if (r) ok++; done++; });
      });
      const pending = urls.length - done;
      if (pending > 0) emit({ type: 'note', stage: 'reading', text: `Stopped waiting for ${pending} slow page${pending > 1 ? 's' : ''} — enough evidence had arrived.` });
    }

    /**
     * Read one lead during a research run. The page is fetched through the same guarded path as any other page
     * (public addresses only, robots.txt, size and time limits), reduced to the blocks that bear on the question,
     * and added to the evidence. Resolves with {ok, rel, di, links}; never throws.
     */
    let bulkEvents = 0;
    async function readLead(lead, model, { keep = 8, timeoutMs = 6000 } = {}) {
      const t = Date.now();
      const ev = { type: 'fetch', url: lead.url, domain: lead.domain || domainOf(lead.url), ok: false, ms: 0, bytes: 0, blocks: 0, title: '', error: '', via: 'page', fromCache: false };
      const out = { ok: false, rel: 0, di: -1, links: null };
      try {
        if (aborted()) throw Object.assign(new Error('stopped'), { code: 'aborted' });
        let d;
        if (wikipedia.handles(lead.url) && isEnabled('wikipedia', cfg, off)) {
          const page = await wikipedia.fetch(lead.url, { ...pctx, timeoutMs: Math.max(timeoutMs, 5000) });
          if (page.disambiguation) throw Object.assign(new Error('A list of meanings, not an article'), { code: 'no_content' });
          d = { url: page.url || lead.url, title: page.title, site: page.site, modified: page.modified, blocks: page.blocks, partial: false, via: page.via, lang: page.lang, simple: page.lang === 'simple', pageType: 'reference', evidenceLevel: page.via === 'api' ? 'api' : 'page', kind: 'encyclopedia', provider: 'wikipedia' };
          Object.assign(ev, { bytes: page.bytes || 0, via: page.via === 'api' ? 'Wikipedia API' : 'page', fromCache: !!page.fromCache });
        } else if (europepmc.handles(lead.url) && isEnabled('europepmc', cfg, off)) {
          const page = await europepmc.fetch(lead.url, { ...pctx, timeoutMs: Math.max(timeoutMs, 8000) });
          const m = lead.meta || {};
          d = { url: lead.url, title: page.title || lead.title, site: m.venue || 'Europe PMC', published: lead.date || '', blocks: page.blocks, partial: false, via: 'api', pageType: 'scholarly', evidenceLevel: 'api', kind: 'academic', provider: 'europepmc', scholar: lead.meta || null, work: m.work };
          Object.assign(ev, { bytes: page.bytes || 0, via: 'Europe PMC API', fromCache: !!page.fromCache });
        } else {
          const res = await http.getText(lead.url, { robots: true, signal, timeoutMs, maxBytes: 900_000, cache: false });
          const page = extractPage(res.text, res.url, { lastModified: res.headers['last-modified'], now });
          if (/\b(noai|noimageai|nosnippet|none)\b/.test(`${res.headers['x-robots-tag'] || ''} ${page.robots || ''}`.toLowerCase())) throw Object.assign(new Error('The page opts out of excerpts (robots directive) — not quoted'), { code: 'robots_meta' });
          if (page.quality.chars < 220) throw Object.assign(new Error(page.quality.jsRequired ? 'The page needs JavaScript to show its content — not readable without a browser' : 'No readable text could be extracted'), { code: 'no_content' });
          d = { url: res.url, title: page.title || lead.title || '', site: page.site, author: page.author, published: page.published || '', modified: page.modified, blocks: page.blocks, extraction: page.quality, lang: page.lang, pageType: page.pageType, ogType: page.ogType, ldTypes: page.ldTypes, evidenceLevel: 'page', kind: 'web', partial: false, scholar: lead.kind === 'academic' ? lead.meta || null : null, work: lead.kind === 'academic' && lead.meta ? lead.meta.work : undefined };
          out.links = page.links;
          Object.assign(ev, { bytes: res.bytes, truncated: res.truncated || undefined });
        }
        const dg = digestDoc(d, model, { keep });
        d.fullOutline = d.provider === 'wikipedia' ? d.blocks.filter((b) => b.type === 'heading' && b.level <= 3).slice(0, 80).map((b) => ({ text: b.text, level: b.level, heading: b.heading })) : undefined;
        Object.assign(d, { blocks: dg.blocks, rel: dg.rel, offTopic: dg.offTopic, outline: dg.outline, stats: dg.stats, digest: true, aspects: lead.aspects || [], foundVia: lead.via || 'search' });
        out.di = addDoc(d);
        out.ok = true; out.rel = dg.rel;
        Object.assign(ev, { ok: true, blocks: dg.blocks.length, title: d.title, rel: Number(dg.rel.toFixed(2)) });
      } catch (e) { ev.error = e.code === 'aborted' ? 'stopped' : /EPROTO|SSL|TLS|CERT/i.test(e.message || '') ? 'Secure connection failed (TLS error)' : truncate(String(e.message || 'failed').split('\n')[0], 160); ev.code = e.code || 'error'; }
      ev.ms = Date.now() - t;
      fetchLog.push(ev);
      if (bulkEvents++ < 30) emit(ev);                     // the first pages are listed one by one; after that the progress counter speaks for them
      return out;
    }

    // ---------------- direct URL questions ----------------
    if (analysis.intent === 'url') {
      await stage('planning', async () => ({ depth, subquestions: [{ id: 's1', text: `Read ${analysis.urls.join(', ')}`, purpose: 'Read the page you provided', tasks: [] }], tasks: analysis.urls.map((u, i) => ({ id: `t${i + 1}`, kind: 'url', label: `Fetch ${u}` })), notes: [] }));
      await stage('reading', async () => { await readPages(analysis.urls, { soft: 9000, hard: 9500 }); return { pages: fetchLog.filter((f) => f.ok).length, failed: fetchLog.filter((f) => !f.ok).length }; });
      if (!docs.length) {
        totals.insufficient++;
        return local('url', [P('I could not read that page, so I cannot answer from it.'), { type: 'note', tone: 'warn', text: fetchLog.map((f) => `${f.domain}: ${f.error}`).join(' · ') || 'The page was unavailable.' }], scoreConfidence({ insufficient: true, cited: [] }), { unavailable: fetchLog.filter((f) => !f.ok).map((f) => ({ url: f.url, domain: f.domain, error: f.error })), research: { searches: [], fetches: fetchLog, timings } });
      }
    }

    // ---------------- Planning ----------------
    let plan = null;
    if (analysis.intent !== 'url') {
      plan = await stage('planning', async () => {
        const p = buildPlan(analysis, { depth, enabled: (id) => isEnabled(id, cfg, off), wikiBudget: http.remaining('wikimedia-api'), simple: !!style.simple || analysis.parts.some((x) => x.style.simple) });
        planRef = p;
        // `long`: these lookups are only the quick first round of a deep search or research run (the depth named here is that round's budget)
        return { depth: p.depth, long: mode === 'deep' || mode === 'research', subquestions: p.subquestions, tasks: p.tasks.map((t) => ({ id: t.id, kind: t.kind, label: t.label, provider: t.provider || 'web' })), notes: p.notes, synthesis: p.synthesis };
      }).then(() => planRef);

      // ---------------- Searching ----------------
      const runSearchTasks = async (tasks) => {
        let lookupDone = Promise.resolve();
        const jobs = [];
        for (const t of tasks) {
          if (t.kind === 'lookup') {
            const job = (async () => {
              const s = Date.now();
              const entry = { provider: 'wikipedia', label: t.lang === 'simple' ? 'Simple English Wikipedia (titles)' : 'Wikipedia (title lookup)', query: t.titles.join(' | '), results: 0, ms: 0, ok: false, error: '' };
              try {
                const res = await wikipedia.lookup(t.titles, { ...pctx, lang: t.lang });
                for (const r of res) {
                  const want = (r.requested || r.title).toLowerCase();
                  if (r.disambiguation) { disambig.set(want, r); continue; }
                  const di = contentDoc(r);
                  docs[di].entity = true;
                  if (t.lang !== 'simple') { entityDocs.set(want, di); entityDocs.set(r.title.toLowerCase(), di); if (r.wikibase) { qids.set(want, r.wikibase); qids.set(r.title.toLowerCase(), r.wikibase); } }
                }
                entry.results = res.length; entry.ok = true;
              } catch (e) { entry.error = e.message; entry.code = e.code; }
              entry.ms = Date.now() - s;
              logSearch(entry);
              // no Wikimedia budget → resolve the main entities through DuckDuckGo's instant-answer API instead
              if (!entry.ok && t.lang !== 'simple' && isEnabled('ddg_instant', cfg, off)) {
                await Promise.all(t.titles.slice(0, 2).map(async (title) => {
                  const s2 = Date.now();
                  const e2 = { provider: 'ddg_instant', label: PROVIDERS.ddg_instant.label, query: title, results: 0, ms: 0, ok: false, error: '' };
                  try {
                    const res = await ddgInstant.search(title, pctx);
                    for (const r of res) { const di = contentDoc(r); docs[di].entity = true; entityDocs.set(title.toLowerCase(), di); }
                    e2.results = res.length; e2.ok = true;
                  } catch (e) { e2.error = e.message; e2.code = e.code; }
                  e2.ms = Date.now() - s2; logSearch(e2);
                }));
              }
            })();
            if (t.lang !== 'simple') lookupDone = job;
            jobs.push(job);
          } else if (t.kind === 'wiki' || t.kind === 'vertical') {
            jobs.push((async () => {
              const res = await runProvider(t.provider, t.query, { ...pctx, fresh: t.fresh, site: t.site, limit: t.provider === 'wikipedia' ? 5 : 6 }, logSearch);
              if (!res) return;
              const withContent = res.filter((r) => r.content && !r.disambiguation), links = res.filter((r) => !r.content);      // a disambiguation page is a signpost, not evidence
              withContent.forEach((r) => contentDoc(r));
              candidateLists.push({ results: res.map((r) => ({ ...r, query: t.query })), weight: t.kind === 'wiki' ? 1 : 0.9, part: t.part });
              if (links.length && t.provider === 'hackernews') for (const r of links) r.kind = 'news';
            })());
          } else if (t.kind === 'web') {
            jobs.push((async () => {
              const res = await webSearch(t.query, { ...pctx, fresh: t.fresh, limit: 8 }, logSearch, { off, weights: learned.providers });
              if (res && res.length) candidateLists.push({ results: res.map((r) => ({ ...r, query: t.query })), weight: 1.1, part: t.part });
            })());
          } else if (t.kind === 'feeds') {
            jobs.push((async () => {
              const sel = selectFeeds(t.query, [...cfg.extraFeeds, ...(Array.isArray(settings.feeds) ? settings.feeds.filter((u) => /^https?:\/\//.test(u)).slice(0, 4) : [])]);
              const items = await fetchFeeds(sel, pctx, logSearch);
              const hours = { day: 50, week: 8 * 24, month: 32 * 24, year: 367 * 24 }[t.fresh] || 8 * 24;
              // keep what the feeds say about the asked topic first, then the most recent of everything else
              const within = items.filter((it) => it.ms && now - it.ms <= hours * 3600000 && it.ms - now < 7200000).sort((a, b) => b.ms - a.ms);
              const topic = analysis.parts[t.part] ? analysis.parts[t.part].focus : '';
              const about = topicMatcher(topic);
              const topical = topic ? within.filter((it) => about(`${it.title} ${it.summary || ''}`)).slice(0, 60) : [];
              [...topical, ...within.filter((it) => !topical.includes(it)).slice(0, 90 - topical.length)]
                .forEach((it) => addDoc({ url: it.url, title: it.title, site: it.source, author: it.author, published: it.published, summary: it.summary, blocks: [{ type: 'p', text: `${it.title}. ${it.summary}`.trim(), heading: '' }], news: true, regional: it.regional, partial: true, evidenceLevel: 'feed', kind: 'news', provider: 'feeds' }));
            })());
          } else if (t.kind === 'current-events') {
            jobs.push(Promise.all(wikipedia.currentEventsTitles(now, 2).map(async (ce) => {
              const s = Date.now();
              const entry = { provider: 'wikipedia', label: 'Wikipedia Current events', query: ce.title, results: 0, ms: 0, ok: false, error: '' };
              try {
                const page = await wikipedia.fetchRendered(ce.title, 'en', pctx);
                let n = 0;
                for (const b of page.blocks) if (b.type === 'list') for (const it of b.items) if (it.text.length >= 70 && /[.!?)]$/.test(it.text.trim()) && n < 40) {
                  const text = it.text.replace(/\s*\((?:[^()]{2,40})\)\s*$/g, '').trim();
                  addDoc({ url: page.url, key: `${page.url}#${n++}`, title: truncate(splitSentences(text)[0] || text, 150), site: 'Wikipedia Current events', published: `${ce.iso}T12:00:00.000Z`, summary: text, blocks: [{ type: 'p', text, heading: '' }], news: true, regional: true, partial: false, evidenceLevel: 'api', kind: 'news', provider: 'wikipedia', via: 'api' });
                }
                entry.results = n; entry.ok = true;
              } catch (e) { entry.error = e.message; entry.code = e.code; }
              entry.ms = Date.now() - s; logSearch(entry);
            })));
          } else if (t.kind === 'facts' || t.kind === 'compare') {
            const ld = lookupDone;
            jobs.push((async () => {
              await ld;
              const s = Date.now();
              const entry = { provider: 'wikidata', label: 'Wikidata', query: t.kind === 'facts' ? `${t.entity}: ${t.relations.map((r) => r.label).join(', ')}` : t.items.join(' vs '), results: 0, ms: 0, ok: false, error: '' };
              try {
                const ctxStems = (names) => { const own = new Set(names.flatMap((x) => stemsOf(x))); return new Set(analysis.parts.flatMap((p) => p.terms.map((x) => x.stem)).filter((x) => !own.has(x))); };
                if (t.kind === 'facts') {
                  let qid = qids.get(t.entity.toLowerCase());
                  if (!qid) {                                     // ambiguous or unknown title → choose a meaning from Wikidata
                    const [sense] = await chooseSenses([t.entity], ctxStems([t.entity]), pctx);
                    qid = sense && sense.id;
                    if (qid) { const e = await getEntity(qid, pctx); if (e) adoptSense(t.entity, sense, e.enwiki); }
                  }
                  if (!qid) throw new Error(`No Wikidata entity found for “${t.entity}”`);
                  const f = await entityFacts(qid, t.relations.map((r) => r.p), pctx);
                  if (f) { partFacts[t.part] = f; if (!entityInfo) entityInfo = f.entity; entry.results = f.facts.length; }
                } else {
                  const chosen = await chooseSenses(t.items, ctxStems(t.items), pctx);
                  const ok = chosen.filter((c) => c.id);
                  if (ok.length < 2) throw new Error('Could not identify both items in Wikidata');
                  const c = await compareEntities(ok.map((x) => x.id), pctx, depth === 'deep' ? 12 : 8);
                  if (c) { c.entities.forEach((e, k) => adoptSense(ok[k].item, ok[k], e.enwiki)); if (c.rows.length) partCompare[t.part] = c; entry.results = c.rows.length; }
                }
                entry.ok = true;
              } catch (e) { entry.error = e.message; entry.code = e.code; }
              entry.ms = Date.now() - s; logSearch(entry);
            })());
          }
        }
        await Promise.all(jobs);
      };
      await stage('searching', async () => {
        await runSearchTasks(plan.tasks);
        // a name that Wikipedia lists under several meanings and that nothing else resolved → choose a meaning explicitly
        for (const p of analysis.parts) {
          const name = (p.focus || '').toLowerCase();
          if (!name || !disambig.has(name) || entityDocs.has(name) || senses.some((x) => x.item.toLowerCase() === name) || http.remaining('wikimedia-api') < 2) continue;
          // 1) meanings already present among the Wikipedia search hits ("Mercury (planet)", "Mercury (element)"), in search-rank order
          const reName = new RegExp(`^${escapeRegex(p.focus)}(?: \\(.+\\))?$`, 'i');
          const ownStems = new Set(stemsOf(p.focus));
          const ctxTerms = p.terms.map((x) => x.stem).filter((x) => !ownStems.has(x));
          const hits = docs.map((d, di) => ({ d, di })).filter((x) => x.d.provider === 'wikipedia' && x.d.partial && !x.d.news && reName.test(x.d.title || ''));
          if (hits.length) {
            const intro = (d) => (d.blocks.find((b) => b.type === 'p') || { text: '' }).text;
            const score = (x) => { const st = new Set(stemsOf(intro(x.d))); return ctxTerms.filter((t) => st.has(t)).length; };
            const best = hits.slice().sort((a, b) => score(b) - score(a))[0];
            best.d.entity = true; entityDocs.set(name, best.di);
            const desc = (d) => truncate(splitSentences(intro(d))[0] || '', 110);
            senses.push({ item: p.focus, label: best.d.title, description: desc(best.d), url: best.d.url, title: best.d.title, alternatives: hits.filter((x) => x !== best).slice(0, 3).map((x) => ({ label: x.d.title, description: desc(x.d) })) });
            continue;
          }
          const s0 = Date.now();
          const entry = { provider: 'wikidata', label: 'Wikidata (meanings)', query: p.focus, results: 0, ms: 0, ok: false, error: '' };
          try {
            const own = new Set(stemsOf(p.focus));
            const [sense] = await chooseSenses([p.focus], new Set(p.terms.map((x) => x.stem).filter((x) => !own.has(x))), pctx);
            if (sense && sense.id) { const e = await getEntity(sense.id, pctx); if (e) { adoptSense(p.focus, sense, e.enwiki); entry.results = 1 + sense.alternatives.length; } }
            entry.ok = true;
          } catch (e) { entry.error = e.message; entry.code = e.code; }
          entry.ms = Date.now() - s0; logSearch(entry);
        }
        return { queries: searchLog.length, ok: searchLog.filter((s) => s.ok).length, failed: searchLog.filter((s) => !s.ok).length, results: searchLog.reduce((a, s) => a + s.results, 0) }; });
    }

    // ---------------- Reading ----------------
    const allTerms = new Map();
    for (const p of analysis.parts) for (const t of p.terms) if (t.weight >= 0.5) allTerms.set(t.stem, Math.max(allTerms.get(t.stem) || 0, t.weight));
    const chooseWebPages = (limit, exclude = new Set()) => {
      const fused = fuse(candidateLists, { limit: 40, perDomain: 2 });
      const scored = fused.filter((r) => !r.content && !SKIP_HOST.test(domainOf(r.url)) && !SKIP_EXT.test(r.url) && !docByKey.has(canonicalUrl(r.url)) && !exclude.has(canonicalUrl(r.url)) && !fetchLog.some((f) => canonicalUrl(f.url) === canonicalUrl(r.url)))
        .map((r) => ({ r, ov: lexicalOverlap(r.title, r.snippet || '', allTerms) })).map((x) => ({ ...x, s: x.r.score * (0.25 + x.ov) * (0.6 + classifySource(x.r.url).quality) }));
      const usable = scored.filter((x) => x.ov >= 0.45 || (x.ov > 0 && scored.length <= 3)).sort((a, b) => b.s - a.s);
      return usable.slice(0, limit).map((x) => x.r.url);
    };
    if (analysis.intent !== 'url') {
      await stage('reading', async () => {
        const urls = [];
        // full Wikipedia articles for the entities the question is about
        const wantFull = [];
        const needDepth = analysis.parts.some((p) => !(p.answerType === 'definition' && !p.explain && !style.detail && depth !== 'deep') && p.answerType !== 'news');
        for (const p of analysis.parts) {
          const names = p.compare && p.compare.items.length ? p.compare.items : [p.phrase, p.focus].filter(Boolean);
          for (const nm of names) { const di = entityDocs.get(nm.toLowerCase()); if (di != null && docs[di].partial && !wantFull.includes(di)) wantFull.push(di); }
        }
        if (needDepth) {                     // search hits whose introduction is actually on topic (judged by the sentence ranker)
          const pre = analysis.parts.map((part) => rankEvidence(docs, queryModel(part), { now }));
          const best = new Map();
          let top = 0;
          for (const r of pre) for (const s2 of r.sentences.slice(0, 40)) { best.set(s2.di, Math.max(best.get(s2.di) || 0, s2.score)); top = Math.max(top, s2.score); }
          [...best].sort((a, b) => b[1] - a[1]).forEach(([di, sc]) => { const d = docs[di]; if (d.provider === 'wikipedia' && d.partial && !d.news && !wantFull.includes(di) && sc >= top * 0.6) wantFull.push(di); });
        }
        for (const sn of senses) urls.push(sn.url);
        for (const di of wantFull.filter((i) => !docs[i].wrongSense).slice(0, Math.max(0, (needDepth ? plan.budget.wikiFull : 1) - senses.length))) urls.push(docs[di].url);
        urls.push(...chooseWebPages(plan.budget.pages));
        // verify the leading news stories against the publisher's article page
        const newsDocs = docs.map((d, di) => ({ d, di })).filter((x) => x.d.news && x.d.evidenceLevel === 'feed');
        const focusStems = new Set(analysis.parts.flatMap((p) => stemsOf(p.focus || '')));
        const pickNews = [];
        for (const x of newsDocs.sort((a, b) => (Number([...focusStems].some((f) => stemsOf(b.d.title + ' ' + b.d.summary).includes(f))) - Number([...focusStems].some((f) => stemsOf(a.d.title + ' ' + a.d.summary).includes(f)))) || Date.parse(b.d.published) - Date.parse(a.d.published))) {
          if (pickNews.length >= (depth === 'deep' ? 6 : depth === 'fast' ? 2 : 4)) break;
          if (pickNews.filter((y) => y.d.origin === x.d.origin).length < 2) pickNews.push(x);
        }
        const haveFacts = partFacts.some(Boolean);
        await Promise.all([readPages(urls, { soft: depth === 'deep' ? 6500 : haveFacts ? 2500 : 3800, hard: depth === 'deep' ? 10000 : 6500, enough: haveFacts ? 1 : Math.min(depth === 'deep' ? 4 : 2, urls.length) }), readPages(pickNews.map((x) => ({ url: x.d.url, di: x.di })), { soft: 4000, hard: 7000, enough: 2, news: true })]);
        for (const sn of senses) {
          let di = docByKey.get(canonicalUrl(sn.url));
          if (di == null) di = docs.findIndex((d) => d.provider === 'wikipedia' && !d.partial && (d.title || '').toLowerCase() === sn.title.toLowerCase());
          if (di == null || di < 0) continue;
          docs[di].entity = true; entityDocs.set(sn.item.toLowerCase(), di);
          // pages about *other* meanings of the same name are neighbours, not evidence about this one
          const name = new Set(stemsOf(sn.item));
          docs.forEach((d, k) => { if (k !== di && d.provider === 'wikipedia' && !d.entity) { const ts = stemsOf(d.title || ''); if ([...name].every((x) => ts.includes(x))) d.quality *= 0.55; } });
        }
        return { pages: fetchLog.filter((f) => f.ok).length, failed: fetchLog.filter((f) => !f.ok).length, bytes: fetchLog.reduce((a, f) => a + (f.bytes || 0), 0), documents: docs.length };
      });
    }

    // ---------------- Comparing ----------------
    const vocabTerms = (part) => { const out = []; for (const t of part.terms) for (const w of learned.vocab[t.stem] || []) out.push({ stem: stemsOf(w)[0] || w, word: w, weight: 0.2 }); return out; };
    const rankAll = () => analysis.parts.map((part) => {
      const qm0 = queryModel(part, vocabTerms(part));
      const first = rankEvidence(docs, qm0, { now, fresh: part.temporal.freshness });
      if (part.answerType === 'news' || !first.sentences.length) return { qm: qm0, ranked: first, feedback: [] };
      // pseudo-relevance feedback: vocabulary shared by the best evidence joins the query at low weight, then re-rank
      const fb = feedbackTerms(first, qm0, 5);
      const qm = queryModel(part, [...vocabTerms(part), ...fb.map((f) => ({ stem: f.stem, word: f.word, weight: 0.22 }))]);
      return { qm, ranked: rankEvidence(docs, qm, { now, fresh: part.temporal.freshness }), feedback: fb };
    });
    let ranks = [];
    let wide = false;                     // true once a research loop is running: agreement between sources is counted and shown
    const weakPart = (i) => { const p = analysis.parts[i]; if (p.answerType === 'news' || partFacts[i] || partCompare[i]) return false; const ss = ranks[i].ranked.sentences; const top = ss[0]; return !top || (top.directCov < 0.34 && top.cov < 0.5) || top.cov < 0.34 || !ss.slice(0, 12).some((x) => x.predCov >= 0.5 && x.score >= top.score * 0.4); };
    const compare = async (round) => stage('comparing', async () => {
      const groups = originGroups(docs);
      docs.forEach((d, i) => { d.group = groups[i]; });
      ranks = rankAll();
      if (wide) for (const r of ranks) { if (r.qm.answerType !== 'news') applySalience(r.ranked, docs, r.qm); applyConsensus(r.ranked, docs); }
      return { documents: docs.length, independentOrigins: new Set(groups).size, copies: docs.filter((d) => d.copyOf).length, passages: ranks[0] ? ranks[0].ranked.passages.length : 0, sentences: ranks.reduce((a, r) => a + r.ranked.sentences.length, 0), weakParts: analysis.parts.map((_, i) => weakPart(i)).filter(Boolean).length };
    }, round);
    await compare(1);

    // iterative retrieval: when a part has no direct evidence, reformulate once and read a few more pages
    // (not when a research loop follows: it searches wider than this round would)
    if (analysis.intent !== 'url' && !mode && plan.budget.iterate > 0 && Date.now() - t0 < plan.budget.timeMs * 0.7 && analysis.parts.some((_, i) => weakPart(i))) {
      const tasks = [];
      analysis.parts.forEach((part, i) => {
        if (!weakPart(i)) return;
        for (const q of reformulate(part, ranks[i].feedback || []).slice(0, 1)) {
          tasks.push({ kind: 'web', part: i, query: q, fresh: part.temporal.freshness });
          if (isEnabled('wikipedia', cfg, off) && http.remaining('wikimedia-api') > 4) tasks.push({ kind: 'wiki', provider: 'wikipedia', part: i, query: q });
        }
      });
      if (tasks.length) {
        const before = docs.length + fetchLog.length;
        await stage('searching', async () => { emit({ type: 'note', stage: 'searching', text: `No passage answered directly — trying reformulated queries: ${tasks.map((t) => `“${t.query}”`).join(', ')}` }); const n0 = searchLog.length; await runSearchTasksLate(tasks); return { queries: searchLog.length - n0, reformulated: tasks.map((t) => t.query) }; }, 2);
        await stage('reading', async () => { const urls = chooseWebPages(3); const wiki = docs.filter((d) => d.provider === 'wikipedia' && d.partial && !d.news && lexicalOverlap(d.title, d.blocks.slice(0, 2).map((b) => b.text || '').join(' '), allTerms) >= 0.5 && !fetchLog.some((f) => canonicalUrl(f.url) === d.key)).slice(0, 1).map((d) => d.url); await readPages([...wiki, ...urls], { soft: 4000, hard: 7000, enough: 2 }); return { pages: fetchLog.filter((f) => f.ok).length, documents: docs.length }; }, 2);
        if (docs.length + fetchLog.length > before) await compare(2);
      }
    }
    async function runSearchTasksLate(tasks) {
      await Promise.all(tasks.map(async (t) => {
        if (t.kind === 'web') { const res = await webSearch(t.query, { ...pctx, fresh: t.fresh, limit: 8 }, logSearch, { off, weights: learned.providers }); if (res && res.length) candidateLists.push({ results: res.map((r) => ({ ...r, query: t.query })), weight: 1, part: t.part }); }
        else { const res = await runProvider('wikipedia', t.query, { ...pctx, limit: 4 }, logSearch); if (res) { res.filter((r) => !r.disambiguation).forEach((r) => contentDoc(r)); candidateLists.push({ results: res, weight: 0.9, part: t.part }); } }
      }));
    }

    // ---------------- Citations and failure labels (used by drafts during a research run and by the final answer) ----------------
    let nextSid = 0;
    const cite = (di) => { if (!docs[di].sid) docs[di].sid = ++nextSid; return docs[di].sid; };
    const citeStructured = (entity, fact) => {
      const di = addDoc({ url: entity.url, title: `${entity.label} — Wikidata`, site: 'Wikidata', blocks: [], structured: true, evidenceLevel: 'structured', kind: 'structured', provider: 'wikidata', partial: false, modified: '' });
      if (fact) (docs[di].statements = docs[di].statements || []).push(`${fact.property}: ${fact.values.map((v) => v.text + (v.asOf ? ` (as of ${v.asOf})` : '')).join(', ')}`);
      return cite(di);
    };
    const FAILURE = [[/^http_(401|403)$|^refused$/, 'refused automated access'], [/^http_(404|410)$/, 'page no longer exists'], [/^robots$/, 'disallowed by the site’s robots.txt'], [/^robots_meta$/, 'page opts out of excerpts'], [/^no_content$/, 'no readable text (often needs JavaScript)'], [/timeout/, 'too slow'], [/^http_429$|rate_limited|rate_budget/, 'rate limited'], [/^dns/, 'address not found'], [/^content_type$/, 'a file, not a web page'], [/^circuit_open$/, 'site kept failing'], [/private_address|bad_port|blocked|bad_scheme|bad_host/, 'address not allowed'], [/^http_5\d\d$/, 'server error'], [/^aborted$/, 'stopped']];
    const failureKind = (f) => { for (const [re, label] of FAILURE) if (re.test(String(f.code || ''))) return label; return 'other errors'; };


    // ---------------- Research loop (depths "deep" and "research"; automatic widening) ----------------
    let research = null;                  // summary of the loop, once it has run
    let limited = '';                     // why a requested research run was answered at depth "deep" instead
    let holdsResearch = false;
    let draftFailed = false;
    let aspects = [];                     // sub-topics found in the material (they become report sections and a way to sort the results)
    const skipUrl = (u) => SKIP_HOST.test(domainOf(u)) || SKIP_EXT.test(u);
    if (analysis.intent !== 'url' && !aborted()) {
      // automatic: the quick round found the topic but nothing that answers the question directly → read more before giving up
      const related = (i) => { const top = ranks[i] && ranks[i].ranked.sentences[0]; return !!top && top.cov >= 0.3; };
      if (!mode && auto && researchOn && Date.now() - t0 < 22000 && analysis.parts.some((_, i) => weakPart(i) && related(i))) {
        mode = 'widen';
        emit({ type: 'note', stage: 'comparing', text: 'The first round found the topic but no passage that answers the question directly — widening the search.' });
      }
      if (mode === 'research') {
        // the caller (the HTTP server) may hold its own limit per client; then the engine's limits for the whole instance
        if (typeof req.researchAllowed === 'function') { try { limited = String(req.researchAllowed() || ''); } catch { limited = ''; } }
        if (!limited) limited = researchGate();
        if (limited) { mode = 'deep'; emit({ type: 'note', stage: 'comparing', text: `A full research run was not started: ${limited}. Answering at depth “deep” instead.` }); }
        else holdsResearch = true;
      }
      if (mode) {
        const budget = { ...RESEARCH_BUDGET[mode] };
        if (mode === 'research') Object.assign(budget, { maxPages: cfg.research.maxPages, maxMs: cfg.research.maxSeconds * 1000, concurrency: cfg.research.concurrency });
        else budget.concurrency = Math.min(budget.concurrency, cfg.research.concurrency);
        if (mode === 'widen') budget.maxMs += Date.now() - t0;                 // widening gets its own time on top of the first round
        wide = true;
        emit({ type: 'research', status: 'start', mode, budget: { pages: budget.maxPages, seconds: Math.round(budget.maxMs / 1000) } });
        const r0 = Date.now();
        // An interim answer after each round — and one straight away from the first, quick round, so that something useful is on screen while the reading goes on.
        const emitDraft = (round) => {
          if (!onEvent || mode === 'widen') return;
          try { const d = assemble(false); delete d._detail; if (d.confidence && d.confidence.level !== 'insufficient') emit({ type: 'draft', round, result: d }); }
          catch (e) {      // a draft is optional: the final answer does not depend on it
            if (!draftFailed) { draftFailed = true; totals.draftErrors = (totals.draftErrors || 0) + 1; lastDraftError = `${String((e && e.message) || e).slice(0, 200)} ${String((e && e.stack) || '').split('\n')[1] || ''}`.trim(); if (process.env.INFINI_DEBUG) console.error('draft failed:', lastDraftError); }
          }
        };
        // rounds are counted with the quick first round as round 1, everywhere: stages, counters, drafts and the summary
        emitDraft(1);
        try {
        research = await runResearch({
          cfg, http, off, signal, aborted, emit, now, t0, analysis, mode, budget, docs, addDoc, fetchLog, searchLog, logSearch, entityDocs, senses, learned, candidateLists, pctx, skipUrl, readLead, weakPart,
          recompare: async (round) => { await compare(round); return ranks; },
          draft: async (round, found) => {
            aspects = (found || []).map((a) => ({ label: a.label, stems: a.stems, source: a.source, heading: !!a.heading }));
            emitDraft(round + 1);
          },
        });
        } finally { if (holdsResearch) { holdsResearch = false; researchLoad.running = Math.max(0, researchLoad.running - 1); } }
        timings.searching = (timings.searching || 0) + (research.searchMs || 0);
        timings.reading = (timings.reading || 0) + (research.readMs || 0);
        timings.research = Date.now() - r0;
        aspects = (research.aspects || []).map((a) => ({ label: a.label, stems: a.stems, source: a.source, heading: !!a.heading }));
        emit({ type: 'research', status: 'done', mode, rounds: research.rounds + 1, pages: research.pages, abstracts: research.abstracts, stopped: research.stopped, ms: timings.research });
        if (aborted()) throw Object.assign(new Error('Stopped'), { code: 'aborted' });
      }
    }
    // ---------------- Constructing ----------------
    /**
     * Build the complete result from the evidence in hand. For an ordinary answer it runs once; during a research run it
     * also runs after every round to produce the draft shown while reading continues. Citations are assigned afresh each time.
     */
    function assemble(final) {
      nextSid = 0;
      for (const d of docs) { d.sid = 0; if (d.structured) d.statements = []; }
      relations.length = 0;
      const results = [];
      const blocks = [];
      const multi = analysis.parts.length > 1;
      const loopBudget = wide && mode ? RESEARCH_BUDGET[mode] : null;
      const baseBudget = plan ? plan.budget : { sentences: 5 };
      analysis.parts.forEach((part, i) => {
        const actx = { now, style, budget: loopBudget && mode !== 'widen' ? { ...baseBudget, sentences: baseBudget.sentences + (mode === 'research' ? 2 : 0) } : baseBudget, cite, citeStructured, relations, partIndex: i, facts: partFacts[i], comparison: partCompare[i], entityDocs, programming: plan ? plan.programming : false, qm: ranks[i].qm, ranked: ranks[i].ranked, wide };
        const r = analysis.intent === 'url' && analysis.urlTask === 'summarize' ? summarizeDoc(docs[0], 0, actx) : answerPart(part, docs, actx);
        results.push(r);
        if (multi) blocks.push({ type: 'heading', text: capitalize((part.original || part.text).replace(/[?.!]+$/, '')) + '?', level: 2 });
        blocks.push(...r.blocks);
      });
      if (analysis.intent === 'url' && !analysis.parts.length) { const r = summarizeDoc(docs[0], 0, { cite, partIndex: 0 }); results.push(r); blocks.push(...r.blocks); }
      if (limited && final) blocks.push({ type: 'note', tone: 'warn', text: `A full research run was not started: ${limited}. This answer was built at depth “deep” instead (up to ${RESEARCH_BUDGET.deep.maxPages} pages). Ask again a little later for the full run.` });
      const answered = results.filter((r) => !r.stats.insufficient);
      if (multi && answered.filter((r) => r.stats.directness >= 0.6).length >= 2) {
        blocks.push({ type: 'heading', text: 'In short', level: 2 });
        blocks.push({ type: 'list', ordered: false, items: results.map((r, i) => ({ spans: r.stats.insufficient ? [{ text: `Part ${i + 1}: not verified from the sources found.`, cites: [] }] : [{ ...(r.blocks.find((b) => b.type === 'paragraph') || { spans: [{ text: r.lead, cites: [] }] }).spans.find((s) => s.cites && s.cites.length) || { text: truncate(r.lead, 260), cites: [] } }] })) });
      }
      // the sources of the direct answer: confidence is judged on these, not on the supplementary report sections
      const coreKeys = new Set(docs.filter((d) => d.sid).map((d) => d.key));
      // research report: sections by sub-topic, figures, dated statements, differences (first part of the question)
      let report = null;
      if (loopBudget && loopBudget.sections && results[0] && !results[0].stats.insufficient && results[0].env) {
        report = composeReport(analysis.parts[0], results[0].env, { aspects, budget: loopBudget, mode, docs });
        if (report.blocks.length) { blocks.push(...report.blocks); results[0].claims = results[0].env.claims; }
      }
      const amb = senses.filter((x) => x.alternatives.length).slice(0, 3);
      if (amb.length) blocks.push({ type: 'note', tone: 'info', text: `${amb.map((sn) => `I read “${sn.item}” as ${sn.label}${sn.description && sn.description.length < 70 ? ` (${sn.description})` : ''}`).join('; ')}. Other meanings exist — for example ${amb.flatMap((sn) => sn.alternatives.slice(0, 2)).slice(0, 3).map((a) => a.label + (a.description && a.description.length < 60 ? ` (${a.description})` : '')).join('; ')}. Add a word to your question to choose a different one.` });

      // ---------------- sources, confidence, classification ----------------
      const cited = docs.filter((d) => d.sid).sort((a, b) => a.sid - b.sid);
      const allClaims = results.flatMap((r) => r.claims);
      const sources = cited.map((d) => ({
        id: d.sid, url: d.url, title: d.title || d.domain, domain: d.domain, site: d.site || d.domain, author: d.author || '', category: d.category, sourceType: d.sourceType, quality: Number(d.quality.toFixed(2)),
        published: d.published || '', modified: d.modified || '', retrievedAt: d.retrievedAt, evidenceLevel: d.evidenceLevel, partial: !!d.partial, origin: d.origin, copyOf: d.copyOf || '', notes: d.notes, provider: d.provider || 'web',
        passages: d.structured ? (d.statements || []).slice(0, 6).map((t) => ({ text: t, heading: 'Structured statement' })) : uniq(allClaims.filter((c) => c.source === d.sid || (c.alsoSupportedBy || []).includes(d.sid)).map((c) => ({ text: c.source === d.sid ? c.passage : '', heading: c.heading || '', claim: c.text })).filter((p) => p.text), (p) => p.text).slice(0, final ? 4 : 2),
      }));
      const stats = results.map((r) => r.stats);
      const partsAnswered = stats.filter((s) => !s.insufficient).length;
      const timeSensitive = analysis.parts.some((p) => p.temporal.timeSensitive);
      const freshDays = analysis.parts.some((p) => p.temporal.freshness === 'day') ? 3 : analysis.parts.some((p) => p.temporal.freshness === 'week') ? 10 : 400;
      const freshOk = stats.some((s) => s.freshOk) || cited.some((d) => { const t = Date.parse(d.published || d.modified || ''); return Number.isFinite(t) && now - t <= freshDays * 86400000; });
      const core = wide ? cited.filter((d) => coreKeys.has(d.key)) : cited;
      const confidence = scoreConfidence({
        insufficient: partsAnswered === 0, cited: core.map((d) => ({ quality: d.quality, origin: d.copyOf ? `copy:${d.group}` : d.origin, partial: d.partial && !d.verified, evidenceLevel: d.evidenceLevel })),
        keyClaims: stats.reduce((a, s) => a + (s.keyClaims || 0), 0), corroborated: stats.reduce((a, s) => a + (s.corroborated || 0), 0),
        directness: partsAnswered ? stats.filter((s) => !s.insufficient).reduce((a, s) => a + s.directness, 0) / partsAnswered : 0,
        partsAnswered, partsTotal: Math.max(1, stats.length), extraction: core.length ? core.reduce((a, d) => a + (d.evidenceLevel === 'page' ? (d.extraction && d.extraction.fallback ? 0.55 : d.extraction && d.extraction.chars < 1500 ? 0.8 : 1) : d.evidenceLevel === 'feed' ? 0.6 : 1), 0) / core.length : 0,
        timeSensitive, freshOk, conflicts: stats.reduce((a, s) => a + (s.conflicts || 0), 0), structuredAgreement: stats.some((s) => s.structuredAgreement),
      });
      if (final) { if (partsAnswered === 0) totals.insufficient++; else totals.answered++; }

      // classification of everything that was brought in: leaning (yes/no questions), sub-topics, kinds, ages, tiers
      const yesno = analysis.parts.length === 1 && analysis.parts[0].answerType === 'yesno' && partsAnswered > 0;
      if (yesno && ranks[0]) {
        const seen = new Set();
        for (const d of docs) d.stance = '';
        for (const s of ranks[0].ranked.sentences) {
          if (seen.size >= 800) break;
          if (seen.has(s.di) || s.directCov < 0.5 || s.predCov < 0.5 || /\?\s*$/.test(s.text)) continue;
          seen.add(s.di);
          docs[s.di].stance = stanceOf(s.text, !!analysis.parts[0].negated);
        }
      }
      const themes = aspects.filter((a) => a.stems && a.stems.length);
      const themeMatch = themes.map((a) => aspectMatcher(a));
      if (themes.length) for (const d of docs) {
        d.themes = [];
        if (d.offTopic || d.structured || !d.blocks.length) continue;
        const st = docStems(d);
        themeMatch.forEach((match, k) => { if (match(st)) d.themes.push(k); });
      }
      const failures = {};
      let failed = 0, okPages = 0, bytes = 0, cacheHits = 0;
      for (const f of fetchLog) { if (f.ok) okPages++; else { failed++; const k = failureKind(f); failures[k] = (failures[k] || 0) + 1; } bytes += f.bytes || 0; if (f.fromCache) cacheHits++; }
      const searchResults = searchLog.reduce((a, s) => a + s.results, 0);
      const screened = research && research.frontier ? Math.max(searchResults, research.frontier.screened + research.abstractsScreened) : searchResults;
      const classification = analysis.intent === 'url' ? null : buildClassification(docs.filter((d) => !d.structured || d.sid), { now, themes, yesno, screened, failed, failures, maxItems: final ? 400 : 40 });
      if (classification && research && final && research.unread) classification.unread = research.unread.slice(0, 40);
      const run = wide && research ? {
        mode, rounds: research.rounds + 1, pages: okPages, relevant: classification ? classification.totals.relevant : 0, abstracts: research.abstracts, sites: classification ? classification.totals.sites : 0, screened, seconds: Math.round((Date.now() - t0) / 1000), stopped: research.stopped,
        queries: research.queries.slice(0, 60), subtopics: (report ? report.sections : []).map((x) => x.label), found: aspects.map((a) => ({ label: a.label, from: a.source })), linksFollowed: research.linksFollowed, references: research.references, budget: { pages: (research.frontier && RESEARCH_BUDGET[mode] ? (mode === 'research' ? cfg.research.maxPages : RESEARCH_BUDGET[mode].maxPages) : 0), seconds: mode === 'research' ? cfg.research.maxSeconds : Math.round(RESEARCH_BUDGET[mode].maxMs / 1000) },
        report: report ? { sections: report.sections.length, figures: report.figures, timeline: report.timeline, differences: report.differences, uncertain: report.gaps } : null,
      } : wide ? { mode, rounds: 1, pages: okPages, relevant: classification ? classification.totals.relevant : 0, abstracts: 0, sites: classification ? classification.totals.sites : 0, screened, seconds: Math.round((Date.now() - t0) / 1000), stopped: '', queries: [], subtopics: [], found: [], budget: null, report: null } : null;

      // conversation context for follow-ups (kept by the client, sent back with the next question)
      const newEntities = [];
      const pushEntity = (e) => { if (e && e.name && !newEntities.some((x) => x.name.toLowerCase() === e.name.toLowerCase())) newEntities.push(e); };
      const evidenceText = (name) => { const last = name.split(' ').pop().toLowerCase(); return (ranks[0] ? ranks[0].ranked.sentences : []).filter((s) => s.text.toLowerCase().includes(last)).slice(0, 25).map((s) => s.text).join(' '); };
      results.forEach((r) => { if (r.answerEntity) pushEntity({ name: r.answerEntity.name, kind: r.answerEntity.kind === 'person' || r.answerEntity.kind === 'place' ? r.answerEntity.kind : 'unknown', gender: r.answerEntity.kind === 'person' ? inferGender(evidenceText(r.answerEntity.name)) : '', plural: false }); });
      analysis.parts.forEach((p, i) => {
        for (const nm of p.compare && p.compare.items.length ? p.compare.items : [p.focus].filter(Boolean)) {
          const di = entityDocs.get(nm.toLowerCase());
          const d = di != null ? docs[di] : null;
          const lead = d ? d.blocks.filter((b) => b.type === 'p').slice(0, 3).map((b) => b.text).join(' ') : '';
          const info = partFacts[i] && partFacts[i].entity && nm === p.focus ? partFacts[i].entity : null;
          const kind = info ? (info.isHuman ? 'person' : /country|city|state|capital|town|village|island|river|mountain|continent|region|province/.test(info.types.join(' ')) ? 'place' : 'thing') : d ? inferKind(lead) : 'unknown';
          pushEntity({ name: d && !p.compare ? d.title : nm, kind, gender: info ? info.gender : kind === 'person' ? inferGender(lead) : '', plural: !d && /[^s]s$/.test(nm) });
        }
      });
      const lastPart = analysis.parts[analysis.parts.length - 1] || null;
      const predicates = [...analysis.parts.filter((p) => p.verb && p.object).map((p) => ({ verb: p.verb.lemma, object: p.object, subject: p.subject })).reverse(), ...(context.predicates || [])].slice(0, 5);
      const cmpItems = analysis.parts.map((p) => p.compare && p.compare.items.length >= 2 ? p.compare.items : null).filter(Boolean).pop() || null;
      const brainAfter = noteWeb(brainState, { level: confidence ? confidence.level : '', score: confidence ? confidence.score : 0, sources: sources.length, topic: analysis.intent === 'url' ? '' : (analysis.parts[analysis.parts.length - 1] || {}).focus || '' });
      const newContext = analysis.intent === 'url' ? { ...context, turn: (context.turn || 0) + 1, brain: brainAfter } : {
        entities: [...newEntities, ...(context.entities || []).filter((e) => !newEntities.some((x) => x.name.toLowerCase() === e.name.toLowerCase()))].slice(0, 8),
        topic: lastPart ? lastPart.focus || context.topic || '' : context.topic || '', predicates, compare: cmpItems || context.compare || null,
        lastQuestion: analysis.metaOf ? context.lastQuestion : analysis.resolved || question, lastFocus: lastPart ? lastPart.focus : '', lastKeywords: lastPart ? lastPart.keywords.filter((k) => !(lastPart.focus || '').toLowerCase().includes(k.toLowerCase())).join(' ') : '',
        lastAnswerType: lastPart ? lastPart.answerType : '', lastSources: sources.slice(0, 10).map((s) => ({ title: s.title, url: s.url, domain: s.domain })), turn: (context.turn || 0) + 1, brain: brainAfter,
      };

      const citedKeys = new Set(cited.map((d) => d.key));
      let graph = null, related = [];
      const learn = { providers: {}, domains: {}, vocab: [] };
      if (final) {
        graph = buildGraph({
          question: analysis.resolved || question, parts: analysis.parts.length ? analysis.parts.map((p) => ({ text: p.text })) : [{ text: question }],
          entities: newEntities.slice(0, 6), claims: allClaims.slice(0, 80).map((c) => ({ text: c.text, passage: c.passage, heading: c.heading, source: c.source, alsoSupportedBy: c.alsoSupportedBy, nature: c.nature, temporal: c.temporal, part: c.part || 0 })),
          sources: sources.slice(0, 80), conflicts: results.flatMap((r) => r.conflicts || []), relations,
        });
        // what the client may remember (statistics only — clearable, never used as an answer)
        for (const s of searchLog) { const p = (learn.providers[s.provider] = learn.providers[s.provider] || { ok: 0, failed: 0 }); if (s.ok && s.results) p.ok++; else p.failed++; }
        const dom = (name) => (learn.domains[name] = learn.domains[name] || { fetched: 0, failed: 0, cited: 0 });
        for (const f of fetchLog.slice(0, 400)) { if (Object.keys(learn.domains).length >= 120 && !learn.domains[f.domain]) continue; const d = dom(f.domain); if (f.ok) d.fetched++; else d.failed++; }
        for (const s of sources) { if (Object.keys(learn.domains).length >= 150 && !learn.domains[s.domain]) continue; dom(s.domain).cited++; }
        if (partsAnswered) analysis.parts.forEach((p, i) => { if (results[i] && !results[i].stats.insufficient && ranks[i]) { const fb = (ranks[i].feedback || []).slice(0, 4).map((f) => f.word); const key = p.terms.filter((t) => t.weight >= 1).map((t) => t.stem)[0]; if (key && fb.length) learn.vocab.push({ term: key, related: fb }); } });
        // follow-up suggestions: fixed templates, offered only for sections that exist in the pages just read
        if (partsAnswered && lastPart && analysis.intent !== 'url' && !timeSensitive && !lastPart.compare) {
          const topicEnt = newEntities.find((e) => lastPart.focus && e.name.toLowerCase() === lastPart.focus.toLowerCase()) || newEntities.find((e) => e.kind !== 'person' || !results.some((r) => r.answerEntity && r.answerEntity.name === e.name));
          related = relatedQuestions({
            question: analysis.resolved || question, focus: lastPart.focus || '', kind: topicEnt && lastPart.focus && topicEnt.name.toLowerCase() === lastPart.focus.toLowerCase() ? topicEnt.kind : '',
            answerType: lastPart.answerType, plural: /[^s]s$/.test(lastPart.focus || ''), answer: results.map((r) => r.answerEntity).filter(Boolean)[0] || null,
            docs: docs.filter((d) => !d.news && !d.structured && !d.offTopic && (!d.digest || d.entity || citedKeys.has(d.key))).slice(0, 80).map((d) => ({ entity: !!d.entity, cited: citedKeys.has(d.key), sid: d.sid || null, title: d.title, blocks: d.blocks })),
          });
        }
      }
      const httpStats = http.stats();
      const result = {
        ...base, kind: analysis.intent === 'url' ? 'url' : 'retrieval', question: question.slice(0, 600),
        interpretation: { resolved: analysis.resolved || '', rewrites: analysis.rewrites, followUp: analysis.followUp, metaOf: analysis.metaOf || null, parts: analysis.parts.map((p) => ({ text: p.text, qtype: p.qtype, answerType: p.answerType, focus: p.focus, keywords: p.keywords })) },
        answer: { blocks: preface ? [P(preface), ...blocks] : blocks }, sources, confidence, timeSensitive, style, depth: { asked, used: mode || depth, ...(limited ? { limited } : {}) }, run, classification,
        consulted: docs.filter((d) => !citedKeys.has(d.key) && !d.structured && !d.offTopic).slice(0, 30).map((d) => ({ url: d.url, title: d.title, domain: d.domain, evidenceLevel: d.evidenceLevel, published: d.published || '' })),
        unavailable: fetchLog.filter((f) => !f.ok).slice(0, final ? 60 : 0).map((f) => ({ url: f.url, domain: f.domain, error: f.error })),
        research: {
          plan: plan ? { depth: mode || plan.depth, subquestions: plan.subquestions, tasks: plan.tasks.map((t) => ({ id: t.id, kind: t.kind, label: t.label })), notes: plan.notes, synthesis: plan.synthesis } : null,
          searches: final ? searchLog.slice(0, 220) : [], fetches: final ? fetchLog.slice(0, 260).map(({ type, ...f }) => f) : [], timings: { ...timings }, graph,
          counts: { searches: searchLog.length, searchResults, pagesFetched: okPages, pagesFailed: failed, documents: docs.length, passages: ranks[0] ? ranks[0].ranked.passages.length : 0, claims: allClaims.length, bytes, cacheHits, abstracts: research ? research.abstracts : 0, screened },
          passages: allClaims.slice(0, final ? 40 : 0).map((c) => ({ text: c.text, source: c.source, heading: c.heading, nature: c.nature, temporal: c.temporal, alsoSupportedBy: c.alsoSupportedBy })),
          http: { requests: httpStats.requests, cacheEntries: httpStats.cacheEntries },
        },
        context: newContext, learn, related, answerEntities: results.map((r) => r.answerEntity).filter(Boolean),
      };
      if (!final) { result.draft = true; result.elapsedMs = Date.now() - t0; result.answer.text = blocksToText(result.answer.blocks); }
      result._detail = { parts: results.length, answered: answered.length, claims: allClaims.length };
      return result;
    }

    let finalResult = null;
    if (inspect) inspect({ docs, ranks, analysis, aspects, research });          // development hook (never set by the server)
    await stage('constructing', async () => { finalResult = assemble(true); const detail = finalResult._detail; delete finalResult._detail; return detail; });
    return finish(finalResult);
  }

  /** Text preview of a source page (same guarded fetch path; returns extracted text only, never raw HTML). */
  async function preview(url, { signal } = {}) {
    if (wikipedia.handles(url)) { const p = await wikipedia.fetch(url, { http, cfg, signal }); return { url, title: p.title, site: p.site, published: '', modified: p.modified || '', blocks: p.blocks.slice(0, 60) }; }
    const res = await http.getText(url, { robots: true, signal, timeoutMs: 7000 });
    const page = extractPage(res.text, res.url);
    return { url: res.url, title: page.title, site: page.site, author: page.author, published: page.published, modified: page.modified, blocks: page.blocks.slice(0, 60), quality: page.quality };
  }

  /**
   * For the learning pipeline (learning/): the same search providers and the same guarded fetch path as answering uses,
   * so training data is found and read under the same rules (robots.txt, rate budgets, SSRF guard, size limits).
   */
  async function discover(query, { signal = null, limit = 6, off = [] } = {}) {
    const pctx = { http, cfg, signal, limit, timeoutMs: 7000 };
    const log = [], seen = new Set(), out = [];
    const add = (list, provider) => { for (const r of list || []) { if (!r || !r.url || seen.has(r.url)) continue; seen.add(r.url); out.push({ url: r.url, title: r.title || '', snippet: r.snippet || '', provider: r.provider || provider }); } };
    const offSet = new Set(off);
    if (isEnabled('wikipedia', cfg, offSet)) { try { add(await wikipedia.search(query, pctx), 'wikipedia'); } catch (e) { log.push({ provider: 'wikipedia', error: String(e && e.message) }); } }
    try { add(await webSearch(query, pctx, (e) => log.push(e), { off: offSet }), 'web'); } catch (e) { log.push({ provider: 'web', error: String(e && e.message) }); }
    return { results: out.slice(0, limit * 2), log };
  }
  async function acquire(url, { signal = null, maxBytes = 1_500_000 } = {}) {
    if (wikipedia.handles(url)) {
      const p = await wikipedia.fetch(url, { http, cfg, signal });
      return { url: p.url || url, via: 'wikipedia-api', html: '', headers: {}, page: { title: p.title, site: p.site, author: '', published: '', modified: p.modified || '', lang: (new URL(url)).hostname.split('.')[0], robots: '', blocks: p.blocks, quality: { chars: p.blocks.reduce((a, b) => a + String(b.text || '').length, 0), fallback: false, jsRequired: false, truncated: false, linkDensity: 0 } } };
    }
    const res = await http.getText(url, { robots: true, signal, timeoutMs: 9000, maxBytes });
    return { url: res.url, via: 'http', html: res.text, headers: res.headers || {}, page: extractPage(res.text, res.url, { lastModified: res.headers && res.headers['last-modified'] }) };
  }

  return {
    ask, preview, config: cfg, http, discover, acquire,
    providers: (offList = []) => listProviders(cfg, new Set(offList)),
    brain,
    status: () => ({ version: VERSION, uptimeS: Math.round((Date.now() - totals.startedAt) / 1000), totals: { ...totals }, research: { enabled: !!cfg.research.enabled, running: researchLoad.running, startedLastHour: researchLoad.starts.filter((t) => Date.now() - t < 3600_000).length, maxConcurrent: cfg.research.maxConcurrent, perHour: cfg.research.perHour, maxPages: cfg.research.maxPages, maxSeconds: cfg.research.maxSeconds }, brain: brain.stats(), http: http.stats(), wikimediaBudget: http.remaining('wikimedia-api'), contactConfigured: !!cfg.contact, ...(cfg.keys.langsearch ? { langsearch: langsearchUsage() } : {}) }),
    clearCaches: () => { http.clearCache(); resetCooling(); },
    close: () => http.close(),
  };
}
