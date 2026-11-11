// INFINI AI — search planning: turns the question analysis into concrete, budgeted retrieval tasks.
// Each task corresponds to one real network operation that the orchestrator executes and reports.

import { uniq } from '../util/text.js';
import { matchRelations } from '../providers/wikidata.js';
import { GENERIC } from '../nlp/analyze.js';
import { selectFeeds } from '../providers/feeds.js';

export const DEPTH = {
  fast: { webQueries: 1, wikiSearches: 1, pages: 3, wikiFull: 1, timeMs: 9000, iterate: 0, sentences: 3 },
  balanced: { webQueries: 2, wikiSearches: 2, pages: 6, wikiFull: 2, timeMs: 15000, iterate: 1, sentences: 5 },
  deep: { webQueries: 4, wikiSearches: 3, pages: 10, wikiFull: 4, timeMs: 25000, iterate: 1, sentences: 8 },
};

const PROGRAMMING = /\b(javascript|typescript|python|java|c\+\+|c#|rust|golang|php|ruby|swift|kotlin|sql|html|css|regex|api|json|xml|git|github|docker|kubernetes|linux|bash|shell|node\.?js|nodejs|react|vue|angular|django|flask|array|arrays|function|variable|loop|compile|compiler|runtime|exception|debug|code|coding|programming|algorithm|database|framework|npm|pip|async|promise|pointer|recursion|syntax|terminal|command line|script|stack trace|segfault|null pointer|dataframe|pandas|numpy|sdk|endpoint|localhost|ai agents?|chatbot|llm|web ?app|website|web scraper|bot)\b/i;
const WEBDEV = /\b(javascript|html|css|dom|web api|fetch api|browser api|cors|svg|canvas|webassembly|service worker|array|promise|json|flexbox|grid layout|http header|cookie|localstorage|indexeddb|websocket)\b/i;
const RESEARCH = /\b(research|study|studies|paper|papers|preprint|state of the art|sota|scientific evidence|literature|peer[- ]reviewed|experiment|arxiv|theorem|hypothesis|benchmark)\b/i;
const SCIENCE = /\b(quantum|physics|neural network|machine learning|deep learning|astronomy|cosmology|particle|genome|protein|relativity|entropy|superconduct|transformer|language model|reinforcement learning|cryptograph|qubit|dark matter|black hole|ai agents?|prompt injection)\b/i;
const TECH = /\b(ai|artificial intelligence|startup|tech|software|openai|google|apple|microsoft|nvidia|chip|cyber|hack|llm|robot|agents?|programming|developer)\b/i;

// Which Stack Exchange community fits the vocabulary of the question (routing configuration, not knowledge).
const SE_SITES = [
  ['ai', /\b(ai agents?|llm|language model|neural network|machine learning|deep learning|artificial intelligence|reinforcement learning|chatbot|prompt)\b/],
  ['security', /\b(security|vulnerabilit(y|ies)|encryption|password|malware|phishing|exploit|firewall|prompt injection|cyber\w*)\b/],
  ['astronomy', /\b(stars?|planets?|galax(y|ies)|moon|sun|orbit|telescope|black holes?|solar system|comet|asteroid|nebula|supernova|universe)\b/],
  ['physics', /\b(physics|quantum|gravity|relativity|photon|electron|particle|magnet\w*|thermodynamic\w*|entropy|velocity|momentum|wavelength|sky)\b/],
  ['math', /\b(math\w*|theorem|integral|derivative|prime numbers?|algebra|geometry|probability|matrix|calculus)\b/],
  ['chemistry', /\b(chemistry|chemical|molecules?|reaction|acid|oxidation|compound|periodic table)\b/],
  ['biology', /\b(biology|cells?|dna|genes?|evolution|species|proteins?|bacteria|virus(es)?|photosynthesis|enzyme|vaccines?|immune)\b/],
  ['earthscience', /\b(climate|weather|earthquakes?|volcano(es)?|ocean|atmosphere|geology|tectonic|glacier|rain|tides?)\b/],
  ['history', /\b(history|historical|war|empire|ancient|medieval|revolution|dynasty|civilization|roman|colonial)\b/],
  ['cooking', /\b(cook\w*|recipe|bak(e|ing)|ingredient|boil|fry|oven)\b/],
  ['money', /\b(invest\w*|tax(es)?|loan|mortgage|savings|credit card|retirement)\b/],
  ['economics', /\b(econom\w*|inflation|gdp|recession|interest rates?|monetary)\b/],
  ['unix', /\b(linux|ubuntu|bash|shell script|terminal|command line|unix)\b/],
  ['english', /\b(grammar|synonym|idiom|etymology|pronunciation)\b/],
  ['electronics', /\b(circuit|resistor|voltage|capacitor|transistor|arduino)\b/],
  ['law', /\b(legal|illegal|lawsuit|copyright|contract law|patent)\b/],
  ['philosophy', /\b(philosoph\w*|ethics|free will|consciousness|epistemolog\w*)\b/],
];
export function seSite(lower, programming) {
  for (const [site, re] of SE_SITES) if (re.test(lower)) return programming && !/^(ai|security|unix)$/.test(site) ? 'stackoverflow' : site;
  return programming ? 'stackoverflow' : null;
}

const clip = (s, n = 160) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') : s);
const stripLead = (s) => s.replace(/^(?:explain|describe|define|summari[sz]e|tell me about|list|name|outline|discuss)\s+/i, '');

/** CirrusSearch query: focus words are required, the remaining content words are optional alternatives. */
export function wikiQuery(part) {
  const focusWords = (part.focus || '').split(/\s+/).filter((w) => w && !/^(the|a|an|of|and|in|to)$/i.test(w));
  const focusSet = new Set(focusWords.map((w) => w.toLowerCase()));
  const others = part.terms.filter((t) => t.weight >= 0.5 && !focusSet.has(t.word) && ![...focusSet].some((f) => f.startsWith(t.word) || t.word.startsWith(f))).map((t) => t.word);
  if (!focusWords.length) return others.slice(0, 6).join(' ');
  const q = focusWords.slice(0, 5).join(' ') + (others.length ? ' ' + others.slice(0, 5).join(' OR ') : '');
  return q.replace(/["()]/g, ' ').trim();
}

function lookupTitles(part) {
  const out = [];
  if (part.phrase) out.push(part.phrase);
  if (part.compare && part.compare.items.length) out.push(...part.compare.items);
  if (part.focus) out.push(part.focus);
  for (const e of part.entities) if (e.proper) out.push(e.text);
  if (part.qtype === 'who' && part.object) out.push(part.object.replace(/^(?:the|a|an)\s+/i, ''));
  if (!out.length) for (const np of part.nps.slice(0, 2)) if (!GENERIC.has(np.toLowerCase())) out.push(np);
  return uniq(out.map((t) => t.replace(/^(?:the|a|an)\s+/i, '').replace(/[?"]/g, '').trim()).filter((t) => t.length >= 2 && t.length <= 80 && t.split(' ').length <= 7), (t) => t.toLowerCase());
}

/**
 * Build the plan. opts: {depth, enabled(id) → bool, wikiBudget (requests left this minute), simple}
 */
export function buildPlan(analysis, opts = {}) {
  const depthName = DEPTH[opts.depth] ? opts.depth : 'balanced';
  const budget = { ...DEPTH[depthName] };
  const enabled = opts.enabled || (() => true);
  const tasks = [], subquestions = [];
  let n = 0;
  const task = (t) => { const id = `t${++n}`; tasks.push({ id, ...t }); return id; };
  const sub = (text, purpose, ids) => subquestions.push({ id: `s${subquestions.length + 1}`, text, purpose, tasks: ids.filter(Boolean) });
  const whole = analysis.parts.map((p) => p.text).join(' ');
  const lower = whole.toLowerCase();
  const isNews = analysis.parts.some((p) => p.answerType === 'news');
  const programming = PROGRAMMING.test(lower);
  let wikiLeft = Math.min(budget.wikiSearches, Math.max(0, (opts.wikiBudget ?? 99) - 3));
  let webLeft = budget.webQueries;
  const notes = [];
  if ((opts.wikiBudget ?? 99) < 4) notes.push('Wikimedia API budget for this minute is nearly used up; using fewer Wikipedia API calls.');

  // 1) entity lookups: one batched request for all parts
  const titles = uniq(analysis.parts.filter((p) => p.answerType !== 'news').flatMap(lookupTitles), (t) => t.toLowerCase()).slice(0, 8);
  let lookupId = null;
  if (titles.length && enabled('wikipedia')) {
    lookupId = task({ kind: 'lookup', provider: 'wikipedia', titles, label: `Identify ${titles.slice(0, 4).map((t) => `“${t}”`).join(', ')}${titles.length > 4 ? '…' : ''}`, lang: 'en' });
    sub(`What ${titles.length > 1 ? 'are' : 'is'} ${titles.slice(0, 3).join(', ')}?`, 'Identify the entities and concepts in the question', [lookupId]);
    if (opts.simple) task({ kind: 'lookup', provider: 'wikipedia', titles: titles.slice(0, 3), label: `Simple English Wikipedia: ${titles.slice(0, 3).join(', ')}`, lang: 'simple' });
  }

  analysis.parts.forEach((part, pi) => {
    const ids = [];
    const natural = clip(stripLead(part.core).replace(/[?]+$/, ''));
    const keywordQ = clip(part.keywords.slice(0, 8).join(' '));
    if (part.answerType === 'news') {
      ids.push(task({ kind: 'feeds', part: pi, provider: 'feeds', query: whole, fresh: part.temporal.freshness || 'week', label: `Read current publisher news feeds${part.focus ? ' for ' + part.focus : ''}` }));
      if (!part.focus && enabled('wikipedia')) ids.push(task({ kind: 'current-events', part: pi, provider: 'wikipedia', label: 'Wikipedia “Current events” portal' }));
      if (part.focus && TECH.test(lower) && enabled('hackernews')) ids.push(task({ kind: 'vertical', part: pi, provider: 'hackernews', query: part.focus, fresh: part.temporal.freshness || 'week', label: `Hacker News stories: ${part.focus}` }));
      if (part.focus && webLeft > 0 && !selectFeeds(whole).some((f) => f.regional)) { webLeft--; ids.push(task({ kind: 'web', part: pi, query: `${part.focus} news`, fresh: part.temporal.freshness || 'week', label: `Web search (recent): ${part.focus} news` })); }
      sub(part.text, 'Find what publishers reported in the requested time window', ids);
      return;
    }
    // 2) Wikipedia full-text search
    if (enabled('wikipedia') && wikiLeft > 0) {
      const wq = wikiQuery(part);
      if (wq && !tasks.some((t) => t.kind === 'wiki' && t.query === wq)) { wikiLeft--; ids.push(task({ kind: 'wiki', part: pi, provider: 'wikipedia', query: wq, label: `Wikipedia search: ${wq}` })); }
    }
    // 3) general web search (provider chain with failover)
    if (webLeft > 0 && natural.length > 2) {
      webLeft--;
      ids.push(task({ kind: 'web', part: pi, query: natural, fresh: part.temporal.freshness, label: `Web search: ${natural}` }));
      if (webLeft > 0 && (depthName === 'deep' || analysis.parts.length === 1) && keywordQ && keywordQ.toLowerCase() !== natural.toLowerCase() && part.keywords.length >= 2 && depthName !== 'fast') {
        const reform = part.answerType === 'procedure' ? `${keywordQ} tutorial` : part.answerType === 'comparison' && part.compare.items.length >= 2 ? `${part.compare.items.join(' vs ')}${part.compare.aspect ? ' ' + part.compare.aspect : ''}` : part.answerType === 'reason' ? `${keywordQ} cause` : keywordQ;
        if (depthName === 'deep' || part.answerType === 'procedure' || part.answerType === 'comparison') { webLeft--; ids.push(task({ kind: 'web', part: pi, query: clip(reform), fresh: part.temporal.freshness, label: `Reformulated search: ${clip(reform)}` })); }
      }
    }
    // 4) vertical sources chosen from the vocabulary of the question
    const site = seSite(part.core.toLowerCase(), programming);
    if (site && enabled('stackexchange') && depthName !== 'fast' && ['procedure', 'reason', 'description', 'mechanism', 'yesno', 'comparison', 'list', 'recommendation'].includes(part.answerType)) ids.push(task({ kind: 'vertical', part: pi, provider: 'stackexchange', site, query: clip(part.keywords.slice(0, 6).join(' ') || natural, 100), label: `${site === 'stackoverflow' ? 'Stack Overflow' : site + '.stackexchange.com'}: ${part.keywords.slice(0, 6).join(' ') || natural}` }));
    if (TECH.test(lower) && enabled('hackernews') && depthName !== 'fast' && !part.temporal.timeSensitive && ['procedure', 'mechanism', 'recommendation', 'yesno', 'list', 'description'].includes(part.answerType)) ids.push(task({ kind: 'vertical', part: pi, provider: 'hackernews', query: clip(part.keywords.slice(0, 5).join(' ') || natural, 100), label: `Hacker News (links to articles): ${part.keywords.slice(0, 5).join(' ') || natural}` }));
    if (programming && WEBDEV.test(lower) && enabled('mdn')) ids.push(task({ kind: 'vertical', part: pi, provider: 'mdn', query: keywordQ || natural, label: `MDN Web Docs: ${keywordQ || natural}` }));
    if ((RESEARCH.test(lower) || (depthName === 'deep' && SCIENCE.test(lower))) && enabled('arxiv')) ids.push(task({ kind: 'vertical', part: pi, provider: 'arxiv', query: keywordQ || natural, label: `arXiv: ${keywordQ || natural}` }));
    if (part.temporal.timeSensitive && TECH.test(lower) && enabled('hackernews') && depthName !== 'fast') ids.push(task({ kind: 'vertical', part: pi, provider: 'hackernews', query: part.focus || keywordQ, fresh: part.temporal.freshness || 'month', label: `Hacker News: ${part.focus || keywordQ}` }));
    if (part.temporal.timeSensitive && part.temporal.freshness && part.focus) ids.push(task({ kind: 'feeds', part: pi, provider: 'feeds', query: whole, fresh: part.temporal.freshness, label: 'Publisher news feeds (time-sensitive question)' }));
    // 5) structured facts
    const factual = ['time', 'place', 'person', 'quantity', 'attribute', 'entity'].includes(part.answerType);
    if (factual && part.focus) {
      const qt = { time: 'time', place: 'place', person: 'person', quantity: 'quantity' }[part.answerType] || null;
      let rels = matchRelations(`${part.attribute || ''} ${part.core}`, qt);
      if (!rels.length && qt) rels = matchRelations(`${part.attribute || ''} ${part.core}`, null);
      if (rels.length) ids.push(task({ kind: 'facts', part: pi, provider: 'wikidata', entity: part.focus, relations: rels.map((r) => ({ p: r.p, label: r.label })), label: `Wikidata: ${rels.map((r) => r.label).join(' / ')} of ${part.focus}`, needs: lookupId }));
    }
    if (part.answerType === 'comparison' && part.compare.items.length >= 2) ids.push(task({ kind: 'compare', part: pi, provider: 'wikidata', items: part.compare.items.slice(0, 3), label: `Wikidata: properties shared by ${part.compare.items.slice(0, 3).join(' and ')}`, needs: lookupId }));
    sub(part.text, { definition: 'Find a definition and the key facts', reason: 'Find the cause or explanation', mechanism: 'Find how it works', procedure: 'Find step-by-step instructions', comparison: 'Find the similarities and differences', yesno: 'Find evidence for and against', list: 'Find the items asked for', prediction: 'Find what sources project', recommendation: 'Find what sources recommend' }[part.answerType] || 'Find the specific fact asked for', ids);
  });

  // cross-part search: entity + aspect of a later part (e.g. "AI agents security risks")
  if (analysis.parts.length > 1 && !isNews && !analysis.parts.some((p) => p.propositional)) {
    const first = analysis.parts[0], last = analysis.parts[analysis.parts.length - 1];
    const lastOwn = (last.original || last.text).replace(/[?]/g, '').split(/\s+/).filter((w) => last.keywords.some((k) => k.toLowerCase() === w.toLowerCase()));
    const q = clip(uniq([...(first.focus ? first.focus.split(' ') : []), ...lastOwn], (w) => w.toLowerCase()).join(' '));
    if (q && first.focus && lastOwn.length && !tasks.some((t) => t.query === q)) {
      const ids = [];
      if (enabled('wikipedia') && (opts.wikiBudget ?? 99) > 5) ids.push(task({ kind: 'wiki', part: analysis.parts.length - 1, provider: 'wikipedia', query: q, label: `Wikipedia search: ${q}` }));
      ids.push(task({ kind: 'web', part: analysis.parts.length - 1, query: q, label: `Web search: ${q}` }));
      sub(q, 'Connect the parts of the question', ids);
    }
  }
  return { depth: depthName, budget, tasks, subquestions, notes, programming, synthesis: analysis.parts.length > 1 ? 'Answer each part, then combine' : 'Rank evidence, compare sources, construct a cited answer' };
}

/** Second-round queries when the first round did not produce direct evidence. */
export function reformulate(part, feedback = []) {
  const out = [];
  const kw = part.keywords.slice(0, 6).join(' ');
  if (part.focus && feedback.length) out.push(`${part.focus} ${feedback.slice(0, 2).map((f) => f.word).join(' ')}`);
  const strong = part.terms.filter((t) => t.weight >= 1).map((t) => t.word);
  if (strong.length >= 2 && strong.join(' ') !== kw.toLowerCase()) out.push(strong.slice(0, 4).join(' '));
  if (part.answerType === 'reason') out.push(`${kw} explanation`);
  if (part.answerType === 'procedure') out.push(`${kw} guide`);
  return uniq(out.map((q) => clip(q.trim())).filter(Boolean), (q) => q.toLowerCase()).slice(0, 2);
}
