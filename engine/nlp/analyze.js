// INFINI AI — rule-based question understanding.
// normalise → small-talk/meta/calculation detection → multi-part split → reference resolution against the
// conversation context → per-part classification, chunking and weighted query terms.
// Everything here is deterministic rules over closed-class words and morphology; no model, no training data.

import { squash, tokenizeFull, tokenize, stem, STOPWORDS, splitSentences, uniq, capitalize } from '../util/text.js';
import { DET, PREP, PRON, WH, AUX, BE, MODAL, CONJ, ADV, NEG, VERBS, IRREGULAR, lemma, gerund, pastTense, SYNONYM_GROUPS } from './lexicon.js';
import { calc } from '../math/calc.js';

const words = (s) => new Set(s.trim().split(/\s+/));
const SUBJ_WH_VERBS = words('cause make happen determine affect trigger drive lead define constitute mean create produce prevent kill give keep stop let allow enable control influence form distinguish separate set');
const COMMANDS = words('explain describe compare contrast list define tell show give find summarize summarise name calculate convert outline discuss elaborate enumerate identify suggest recommend');
export const GENERIC = words('type types kind kinds sort sorts way ways thing things example examples reason reasons cause causes effect effects difference differences people person someone name number amount lot lots bit part parts form forms use uses time times year years date day place something anything one ones purpose meaning definition role idea concept term fact facts detail details information info overview summary explanation answer question main major key important common different various general basic first best good');
// ordinals and superlatives are constraints of the question ("the FIRST person to…", "the LARGEST planet"), not filler
const CONSTRAINT = words('first last second third only largest smallest biggest oldest youngest tallest highest lowest longest shortest fastest slowest earliest latest deepest richest heaviest closest nearest farthest hottest coldest');
const STATIVE = words('be born die live have exist become remain seem know mean happen occur do');
const COMPARATIVE = words('better worse faster slower cheaper safer bigger smaller larger older newer stronger weaker easier harder healthier taller shorter heavier lighter hotter colder richer poorer longer higher lower greater smarter younger closer farther further deeper wider quicker brighter denser louder cleaner simpler best worst');
const EXTRA_VERB_FORMS = new Map([['born', 'born'], ['located', 'locate'], ['situated', 'situate'], ['called', 'call'], ['named', 'name'], ['made', 'make'], ['used', 'use']]);
const LY_NOT_ADV = words('family italy july supply apply reply fly rely ally belly holy jelly lily only early daily assembly monopoly anomaly butterfly');
const ASPECT_HEADS = words('types kinds benefits advantages disadvantages risks dangers causes effects symptoms features examples uses applications steps components parts stages phases principles challenges problems limitations pros cons differences requirements ways methods reasons factors functions properties characteristics signs consequences implications impacts rules elements ingredients sources forms threats issues drawbacks strengths weaknesses side-effects complications treatments tips techniques tools basics fundamentals');

const SYN = new Map();
for (const g of SYNONYM_GROUPS) { const ws = g.split(' '); for (const w of ws) { const k = stem(w); if (!SYN.has(k)) SYN.set(k, new Set()); for (const o of ws) if (o !== w) SYN.get(k).add(o); } }
export function synonymsOf(word) { return [...(SYN.get(stem(word)) || [])]; }

const CONTRACTIONS = [
  [/\b(what|who|where|when|why|how|that|it|there|here|he|she)'s\b/gi, '$1 is'], [/\b(what|who|where|when|why|how|they|we|you)'re\b/gi, '$1 are'],
  [/\bi'm\b/gi, 'I am'], [/\b(i|you|we|they|who|what|would|could|should)'ve\b/gi, '$1 have'], [/\b(i|you|he|she|it|we|they|who|what|that)'ll\b/gi, '$1 will'],
  [/\b(i|you|he|she|we|they|who)'d\b/gi, '$1 would'], [/\bwhats\b/gi, 'what is'], [/\bwhos\b/gi, 'who is'], [/\bwanna\b/gi, 'want to'], [/\bgonna\b/gi, 'going to'],
  [/\bhow come\b/gi, 'why'], [/\blet's\b/gi, 'let us'],
];
const LEAD_NOISE = [
  [/^(?:hey|hi|hello|ok|okay|so|well|um|uh|please|pls|yo|alright|right|now|then|btw|by the way)[,!.]?\s+(?=\S)/i, null],
  [/^(?:quick |one more |another |next |follow[- ]up )?question\s*[:,-]\s*/i, null],
  [/^(?:can|could|would|will) (?:you|u|someone|anyone) (?:please |kindly |briefly |quickly |also |now )*(tell me|explain to me|explain|describe|show me|let me know|help me understand|give me|clarify|elaborate on|say|share|find out|find|look up|search for|check|teach me|list|summari[sz]e|compare|define)\b\s*/i, 1],
  [/^(?:do you (?:happen to )?know|have you any idea|any idea|do you have any idea|got any idea)\b\s*/i, null],
  [/^(?:i (?:want|need|would like|wish|am trying|was hoping) to (?:know|understand|learn|find out|ask|hear)|i am (?:wondering|curious|interested)(?: to know)?|i was (?:wondering|curious)|i wonder|just (?:wondering|curious)|wondering)\b[,:]?\s*/i, null],
  [/^(tell me|let me know|show me|teach me|help me understand)\b[,:]?\s*/i, 1],
  [/^(?:please|kindly)\s+/i, null],
];
const STYLE = {
  simple: /\b(?:in (?:very )?simple (?:terms|words|language|english)|in layman'?s? terms|for (?:a )?(?:beginner|beginners|kid|kids|child|children|dummies|(?:5|five)[- ]year[- ]old)|like i am (?:5|five|a child|a kid)|eli5|in plain english|more simply|simply)\b[,]?/i,
  detail: /\b(?:in (?:more |great |full )?detail|in[- ]depth|thoroughly|comprehensively)\b[,]?/i,
  brief: /\b(?:briefly|in brief|in short|in (?:one|a single|1) sentence|in a few words|short answer|quick answer|tl;?dr|concisely|in a nutshell)\b[,]?/i,
  steps: /\bstep[- ]by[- ]step\b/i,
};
const META_WORDS = words(`can could would you please now explain say put describe rephrase rewrite make give me us that this it the last previous above answer explanation response reply again but in a an using with more much even way to be bit little terms words language version understand simpler simply simplified simple simplify easier easy eli5 plain english layman laymans less technical like i am 5 five child kid kids for beginner beginners shorter short brief briefly summarize summarise summary tl dr tldr sentence one detail details detailed elaborate expand on further deeper deep go tell continue keep going info information and of so ok okay just some its also do did is was were what how your any point points greater about`);
const META_CUES = [
  ['simplify', /\b(simpl(er|y|ified|e|ify)|easier|eli5|plain english|layman|less technical|like i am (5|five|a (child|kid))|for (a )?(beginner|kid|child))\b/],
  ['shorten', /\b(shorter|short version|summari[sz]e|summary|tl;?dr|in (one|a) sentence|briefly|in brief|more concise)\b/],
  ['elaborate', /\b(tell me more|more (detail|details|info|information)|elaborate|expand|explain (more|further)|go (deeper|on)|in (more|greater) detail|continue|keep going|say more|more please)\b|^more$/],
];
const TIME_CUES = [
  ['day', /\b(today|tonight|this (?:morning|afternoon|evening)|right now|at the moment|breaking|just now|so far today)\b/], ['day', /\byesterday\b/],
  ['week', /\b(this week|past week|last week|recently|recent|lately|these days|past few days|last few days|latest|newest|current events|nowadays)\b/],
  ['month', /\b(this month|past month|last month)\b/], ['year', /\b(this year|past year|last year)\b/],
];
const SENSITIVE = /\b(now|currently|current|present|presently|latest|newest|news|headlines?|updates?|price|prices|cost of|stock|weather|forecast|score|standings|schedule|upcoming|still|as of|trending|exchange rate|net worth|richest|tallest|largest|fastest|record|ranking|reigning|incumbent|version|release|released)\b/;
const ROLE = /\b(president|prime minister|king|queen|ceo|chancellor|governor|mayor|leader|head of state|head of government|champion|chairman|secretary general|pope|monarch|minister)\b/;

export function normalizeQuestion(raw) {
  let s = squash(String(raw || '')).slice(0, 600).replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  return s.trim();
}

function metaKind(l) {
  if (/^(what are (your|the) sources|(show|list|give)( me)?( the| your)? sources|where did you (get|find) (that|this|it)|cite( your)? sources|sources|source|how do you know( that| this)?|where is (that|this) from)$/.test(l)) return 'sources';
  if (/^(double[- ]check( that| this| it)?|verify (that|this|it)|check again|check (that|this|it) again|fact[- ]check( that| this| it)?)$/.test(l)) return 'verify';
  for (const [kind, re] of META_CUES) {
    if (!re.test(l)) continue;
    const rest = l.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !META_WORDS.has(w));
    if (!rest.length) return kind;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// tagging and chunking
function tagTokens(tokens) {
  const n = tokens.length;
  const tags = new Array(n);
  for (let i = 0; i < n; i++) {
    const tk = tokens[i], w = tk.l;
    tags[i] = tk.kind === 'punct' ? 'PUNCT' : tk.kind === 'num' ? 'NUM' : WH.has(w) ? 'WH' : MODAL.has(w) && !(tk.cap && w === 'may' && i > 0) ? 'MODAL' : AUX.has(w) ? 'AUX'
      : DET.has(w) ? 'DET' : PRON.has(w) ? 'PRON' : PREP.has(w) ? 'PREP' : CONJ.has(w) ? 'CONJ' : NEG.has(w) ? 'NEG'
        : (ADV.has(w) || (w.length > 4 && w.endsWith('ly') && !LY_NOT_ADV.has(w) && !tk.cap)) ? 'ADV' : COMPARATIVE.has(w) ? 'ADJ' : 'N';
  }
  const vlemma = (i) => EXTRA_VERB_FORMS.get(tokens[i].l) || lemma(tokens[i].l);
  const capable = (i) => tags[i] === 'N' && !(tokens[i].cap && i > 0) && (VERBS.has(vlemma(i)) || EXTRA_VERB_FORMS.has(tokens[i].l));
  const prevIdx = (i) => { let j = i - 1; while (j >= 0 && (tags[j] === 'ADV' || tags[j] === 'NEG')) j--; return j; };
  const inflectedPast = (i) => { const w = tokens[i].l; return EXTRA_VERB_FORMS.has(w) || (w !== vlemma(i) && (w.endsWith('ed') || (IRREGULAR.has(w) && !VERBS.has(w)))); };
  const subjectPron = words('i you we they he she it who');
  let found = false;
  for (let i = 0; i < n; i++) {
    if (!capable(i)) continue;
    const w = tokens[i].l, j = prevIdx(i), pt = j >= 0 ? tags[j] : '', pw = j >= 0 ? tokens[j].l : '';
    let verb = false;
    if (i === 0) verb = n > 1 && COMMANDS.has(w);
    else if (pw === 'to' && !(i + 1 < n && tags[i + 1] === 'N' && inflectedPast(i))) verb = true;
    else if (pt === 'PRON' && subjectPron.has(pw)) verb = true;
    else if (pt === 'MODAL') verb = true;
    else if (pt === 'AUX') verb = BE.has(pw) ? (w !== vlemma(i) && (inflectedPast(i) || w.endsWith('ing'))) : !(i + 1 < n && tags[i + 1] === 'N');
    else if (pt === 'WH') verb = pw === 'who' || SUBJ_WH_VERBS.has(vlemma(i)) || inflectedPast(i);
    else if ((pt === 'N' || pt === 'NUM') && inflectedPast(i) && !(i + 1 < n && tags[i + 1] === 'N' && tokens[i + 1].cap)) verb = true;
    if (verb) { tags[i] = 'VERB'; if (i > 0) found = true; }
  }
  const hasDo = tokens.some((t, i) => tags[i] === 'MODAL' || (tags[i] === 'AUX' && /^(do|does|did|don't|doesn't|didn't)$/.test(t.l)));
  const hasBe = tokens.some((t, i) => tags[i] === 'AUX' && BE.has(t.l));
  if (!found && (hasDo || (!hasBe && tags.includes('WH')))) {
    for (let i = n - 1; i > 0; i--) {
      if (!capable(i) || tokens[i].l.endsWith('ing')) continue;
      const j = prevIdx(i), pt = j >= 0 ? tags[j] : '', pw = j >= 0 ? tokens[j].l : '';
      if (pt === 'PREP' || (pt === 'DET' && !/^(this|that|these|those)$/.test(pw))) continue;
      if (j < 0) continue;
      if (i < n - 1 && tags[i + 1] === 'N' && !tokens[i].l.endsWith('s') && pt === 'N' && tags.slice(i + 1).filter((t) => t === 'N').length > 1) continue;
      tags[i] = 'VERB';
      break;
    }
  }
  return { tags, vlemma };
}

function chunk(tokens, tags) {
  const nps = [];
  let cur = null;
  const flush = () => { if (cur) { nps.push(cur); cur = null; } };
  for (let i = 0; i < tokens.length; i++) {
    const t = tags[i], tk = tokens[i];
    if (t === 'N' || t === 'NUM') { if (!cur) cur = { start: i, end: i }; cur.end = i; continue; }
    // glue inside proper names: "University of Oxford", "Lord of the Rings"
    if (cur && /^(of|de|del|van|von|da)$/.test(tk.l) && tokens[cur.end].cap) {
      let k = i + 1;
      if (k < tokens.length && tokens[k].l === 'the') k++;
      if (k < tokens.length && tags[k] === 'N' && tokens[k].cap) { cur.end = k; i = k; continue; }
    }
    flush();
  }
  flush();
  return nps.map((c) => {
    const toks = tokens.slice(c.start, c.end + 1);
    const text = toks.map((x) => x.t).join(' ').replace(/ (?='s\b)/g, '');
    const proper = toks.some((x, k) => (x.cap && (c.start + k > 0 || toks.length > 1 && toks[1] && toks[1].cap)) || /^[A-Z0-9]{2,}$/.test(x.t));
    return { text, start: c.start, end: c.end, proper, head: toks[toks.length - 1].l, generic: toks.every((x) => GENERIC.has(x.l)) };
  });
}

// ---------------------------------------------------------------------------------------------------
// comparison items
const stripDet = (s) => s.replace(/^(?:the|a|an|both|either)\s+/i, '').trim();
function splitItems(a, b) {
  const items = [];
  for (const side of [a, b]) for (const p of side.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s+or\s+|\s+vs\.?\s+|\s+versus\s+/i)) { const c = stripDet(p.trim()); if (c) items.push(c); }
  return items.slice(0, 4);
}
function compareItems(l, text) {
  const tests = [
    [/^(?:compare|contrast)\s+(?:the\s+)?(?:differences? between\s+)?(.+?)\s+(?:and|with|to|vs\.?|versus|against)\s+(.+)$/i, 1, 2],
    [/^(?:compare|contrast)\s+(.+)$/i, 1, 0],
    [/^(?:what (?:is|are|was|were)\s+)?(?:the\s+)?(?:main |key |major |biggest |real |actual )?(?:differences?|distinction|similarit(?:y|ies))\s+(?:between|of|among)\s+(.+?)\s+(?:and|vs\.?|versus|or)\s+(.+)$/i, 1, 2],
    [/^how (?:does|do|is|are|did|was|were)\s+(.+?)\s+(?:differ|different|compare|compared|stack up)\s*(?:from|to|with|against)\s+(.+)$/i, 1, 2],
    [/^(?:which|what) (?:one )?(?:is|are|was|would be)\s+(?:the\s+)?(?:[\w-]+[,:]? ){1,3}?(.+?)\s+or\s+(.+)$/i, 1, 2, 'cmpword'],
    [/^(?:is|are|was|were)\s+(.+?)\s+(?:(\w+)|more \w+|less \w+|as \w+)\s+(?:than|as)\s+(.+)$/i, 1, 3, 'cmp2'],
    [/^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i, 1, 2],
    [/^should i (?:use|learn|choose|buy|pick|get|study|take|go with)\s+(.+?)\s+or\s+(.+)$/i, 1, 2, 'reco'],
  ];
  for (const [re, ia, ib, flag] of tests) {
    const m = text.match(re);
    if (!m) continue;
    if (flag === 'cmpword' && !l.split(' ').slice(0, 7).some((w) => COMPARATIVE.has(w) || w === 'more' || w === 'less' || w === 'most')) continue;
    if (flag === 'cmp2' && m[2] && !COMPARATIVE.has(m[2].toLowerCase())) continue;
    let a = m[ia], b = ib ? m[ib] : '';
    let aspect = '';
    const tail = (ib ? b : a).match(/^(.+?)\s+(?:in terms of|regarding|with respect to|when it comes to|based on|for)\s+(.+)$/i);
    if (tail) { if (ib) b = tail[1]; else a = tail[1]; aspect = tail[2]; }
    const items = ib ? splitItems(a, b) : splitItems(a, '');
    const unresolved = items.length < 2 || items.some((it) => /^(these|those|them|they|both|the two|the three|it|this|that)\b/i.test(it) || /^(two|three|2|3)\b/i.test(it));
    const category = unresolved ? stripDet((items[0] || a).replace(/^(these|those|them|they|both|the)\s*/i, '').replace(/^(two|three|2|3)\s*/i, '')) : '';
    return { items: unresolved ? [] : items, unresolved, category, aspect, reco: flag === 'reco' };
  }
  if (!/^(what|why|how|when|where|who|which|is|are|was|were|do|does|did|can|could|should|will|would)\b/.test(l)) {
    const m = text.match(/^(.{2,40}?)\s+or\s+(.{2,40})$/i);
    if (m && m[1].split(' ').length <= 4 && m[2].split(' ').length <= 4) return { items: splitItems(m[1], m[2]), unresolved: false, category: '', aspect: '' };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// classification
const QUANT = /^how (many|much|long|far|tall|old|big|large|fast|high|deep|heavy|often|wide|hot|cold|close|small|late|early|soon|thick|strong|expensive|far away|long ago)\b/;
const PRED = /^(?:will|is .{2,60} going to|are .{2,60} going to|when will|who will|what will|how will|where will)\b|\b(in the future|future of|by (?:20[3-9]\d|2[1-9]\d\d)|next (?:year|decade|century)|forecast|predictions?|predicted|outlook|will .{2,60} (?:ever|happen|replace|become|win|rise|fall|collapse|end))\b/;
const RECO = /\b(should i|should we|what should|which should|recommend|recommendations?|recommended|suggestions?|best way|what is the best(?!-)|what are the best(?!-)|which is the best(?!-)|top \d+|is it worth|worth (?:buying|learning|it|reading|watching)|what is a good|what are good|which .{2,40} should)\b/;

function classify(l, hint) {
  const l2 = l.replace(/^(?:in|at|on|for|to|of|from|with|by|under|during|since|until|about)\s+(?=(?:what|which|whom|whose|when|where|how)\b)/, '');
  let m;
  const R = (qtype, answerType, extra = {}) => ({ qtype, answerType, ...extra });
  if ((m = l2.match(/^(?:explain|describe|discuss|elaborate on|outline|clarify|understand)\s+((?:how|why|what|when|where|who|whether|if)\b.+)$/))) { const r = classify(m[1]); return { ...r, explain: true, strip: l2.length - m[1].length }; }
  if (/^(?:whether|if)\s+/.test(l2)) return R('whether', 'yesno', { strip: l2.match(/^(?:whether|if)\s+/)[0].length });
  if (/^why\b/.test(l2)) return R('why', 'reason');
  if (/^what (?:is|are|was|were) (?:the )?(?:main |primary |real )?(?:reasons?|causes?)\b/.test(l2) || /^what (?:causes|caused|makes|made|leads to|led to|triggers|triggered)\b/.test(l2)) return R('what', 'reason');
  if (/^how\b/.test(l2)) {
    if (QUANT.test(l2)) return R('how', 'quantity', { quantityCue: l2.match(QUANT)[1] });
    if (/^how (?:to|do i|do you|do we|can i|can you|can we|could i|should i|would i|does one|might i|do people|can one|would you|should we|should you|does someone|can someone)\b/.test(l2) && !/^how do you (know|feel|think)\b/.test(l2)) return R('how', 'procedure');
    if (/^how (?:likely|common|rare|dangerous|safe|hard|difficult|easy|good|bad|accurate|effective|important|reliable|serious|popular)\b/.test(l2)) return R('how', 'description');
    return R('how', 'mechanism');
  }
  if (/^(?:when|since when|until when)\b/.test(l2) || /^(?:what|which) (?:year|date|time|day|month|century|decade|period|era)\b/.test(l2)) return R('when', 'time');
  if (/^(?:where|from where)\b/.test(l2) || /^(?:what|which) (?:country|city|place|state|continent|region|town|location|planet|island|province)\b/.test(l2)) return R(/^wh(at|ich)/.test(l2) ? 'which' : 'where', 'place');
  if ((m = l2.match(/^(what|who) (?:is|are|was|were) (.+?)(?:'s|s') (.{1,40})$/))) return R(m[1], m[1] === 'who' ? 'person' : 'attribute', { attribute: m[3], entity: m[2] });
  if (/^(?:who|whom|whose)\b/.test(l2)) {
    if ((m = l2.match(/^who (?:is|was|are|were) (.+)$/)) && !/\b(of|in|for|to|that|who|behind|from)\b/.test(m[1]) && !/^(the|a|an) /.test(m[1])) return R('who', 'definition', { target: m[1], person: true });
    return R('who', 'person');
  }
  // "What happened to the temple in the 2015 earthquake?", "what happened at the Battle of Hastings": history, not this week's news
  if (/^what (?:happened|occurred|took place|went on)\b/.test(l2) && ((l2.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []).some((y) => Number(y) < new Date().getUTCFullYear()) || /\b(?:centur(?:y|ies)|ancient|medieval|world war|civil war|war of|battle of|siege of|revolution|dynasty|empire|bce?|decades? ago|years ago|in history|historically|in the past)\b/.test(l2))) return R('what', 'description');
  if (/^what (?:happened|is happening|has happened|happens|is going on|went on|is new|occurred|took place)\b/.test(l2) || /^(?:any |the )?(?:latest |recent |top |breaking )?(?:news|headlines)\b/.test(l2) || /\b(?:latest|recent|today's|top|breaking) (?:news|headlines|developments|updates)\b/.test(l2) || /^what is (?:the )?(?:latest|new)\b/.test(l2)) return R('what', 'news');
  if (/^which\b/.test(l2)) {
    const noun = (l2.match(/^which (?:of the |of these |of those )?(\w+)/) || [])[1] || '';
    if (/^(person|president|scientist|author|king|queen|leader|actor|actress|player|artist|inventor|director|writer|singer|company|team)s?$/.test(noun)) return R('which', 'person');
    return R('which', 'entity');
  }
  if (/^what\b/.test(l2)) {
    if ((m = l2.match(/^what (?:does|do|did) (.+?) (?:mean|means|stand for|stands for|refer to)$/))) return R('what', 'definition', { target: m[1] });
    // "What does X do (in Y)?" asks for X's function: the answer is a sentence in which X performs an action
    if ((m = l2.match(/^what (?:does|do|did) (?:the |a |an )?(.+?) (?:actually |really |exactly )?do(?: (?:in|on|for|with|when|to|inside|within) .+)?$/)) && m[1].split(' ').length <= 6) return R('what', 'description', { target: m[1], fn: true });
    if ((m = l2.match(/^what (?:is|are|was|were) (?:the )?(?:meaning|definition) of (.+)$/))) return R('what', 'definition', { target: m[1] });
    if ((m = l2.match(/^what (?:is|are|was|were) (?:some |the |all the |all |some of the )?(?:main |major |key |different |various |common |most common |primary |biggest |potential |possible |known )?([a-z-]+)(?: and ([a-z-]+))? (?:of|for|in|to|with|from|behind|associated with|between|about) (.+)$/)) && ASPECT_HEADS.has(m[1])) return R('what', 'list', { aspect: m[2] ? `${m[1]} ${m[2]}` : m[1], entity: m[3] });
    if ((m = l2.match(/^what (?:kind of |kinds of |sort of |types of )?((?:[a-z-]+ ){0,2}[a-z-]+) (?:do|does|did|can|could|will|would|should|might) (.+?) (?:create|cause|pose|have|bring|carry|introduce|raise|present|face|involve|entail|offer|provide|give|lead to|come with)$/)) && ASPECT_HEADS.has(m[1].split(' ').pop())) return R('what', 'list', { aspect: m[1], entity: m[2] });
    if (/^what (?:are|were) some\b/.test(l2)) return R('what', 'list');
    if ((m = l2.match(/^what (?:is|are|was|were) (?:the |a |an )?(.{1,40}?) (?:of|in|for|on|at) (?:the |a |an )?(.+)$/)) && m[1].split(' ').length <= 4) return R('what', 'attribute', { attribute: m[1], entity: m[2], phrase: `${m[1]} of ${m[2]}` });
    if ((m = l2.match(/^what (?:is|are|was|were) (?:the |a |an )?(.+?)(?: (?:used for|made of|made from|known for|famous for|like|called|about|composed of|responsible for|good for))$/))) return R('what', 'description', { target: m[1] });
    if ((m = l2.match(/^what (?:is|are|was|were) (?:the |a |an )?(.+)$/))) return R('what', 'definition', { target: m[1] });
    if ((m = l2.match(/^what (?:the |a |an )?(.+?) (?:is|are|was|were)$/))) return R('what', 'definition', { target: m[1] });
    if (/^what (?:[a-z-]+ ){1,3}(?:do|does|did|is|are|was|were|can|could|will|should|has|have)\b/.test(l2)) return R('what', 'entity');
    return R('what', 'description');
  }
  if ((m = l2.match(/^(?:define|definition of|meaning of|the meaning of|the definition of)\s+(.+)$/))) return R('explanation', 'definition', { target: m[1], strip: l2.length - m[1].length });
  if ((m = l2.match(/^(?:explain|describe|summari[sz]e|outline|discuss|overview of|an overview of|introduction to|an introduction to|about|information (?:on|about)|info (?:on|about)|talk about|write about|elaborate on|give (?:me )?(?:an? )?(?:overview|summary|explanation|introduction|description|rundown) (?:of|to|about|on))\s+(.+)$/))) return R('explanation', 'definition', { target: m[1], explain: true, strip: l2.length - m[1].length });
  if ((m = l2.match(/^(?:list|name|enumerate|identify|give (?:me )?(?:a list of|some|examples of|the)|show (?:me )?(?:some|the|a list of)|examples of)\s+(.+)$/))) {
    const a = m[1].match(/^(?:some |the |all the |all )?(?:main |major |key |different |various |common )?([a-z-]+) (?:of|for|in|to|with) (.+)$/);
    return a && ASPECT_HEADS.has(a[1]) ? R('explanation', 'list', { aspect: a[1], entity: a[2] }) : R('explanation', 'list', { target: m[1], strip: l2.length - m[1].length });
  }
  if ((m = l2.match(/^(?:steps|instructions|guide|tutorial|way|ways|method|methods)\s+(?:to|for|on)\s+(.+)$/))) return R('how', 'procedure');
  const first = l2.split(' ')[0];
  if (AUX.has(first) || MODAL.has(first)) return R('whether', 'yesno');
  if (hint === 'explain') return R('explanation', 'definition', { target: l2, explain: true });
  if (/\b(news|headlines)\b/.test(l2)) return R('what', 'news');
  if ((m = l2.match(/^(?:the |a |an )?(.{1,40}?) of (?:the |a |an )?(.+)$/)) && m[1].split(' ').length <= 3) return R('statement', 'attribute', { attribute: m[1], entity: m[2], phrase: `${m[1]} of ${m[2]}`, keywordQuery: true });
  return R('statement', l2.split(' ').length <= 5 ? 'definition' : 'description', { target: l2.split(' ').length <= 5 ? l2 : undefined, keywordQuery: true });
}

// ---------------------------------------------------------------------------------------------------
function analyzePart(text, { now = Date.now(), hint = null } = {}) {
  let work = text.replace(/[?!.]+$/, '').trim();
  const style = {};
  for (const [k, re] of Object.entries(STYLE)) if (re.test(work)) { style[k] = true; const w2 = work.replace(re, ' ').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim(); if (w2.split(' ').length >= 2) work = w2; }
  work = work.replace(/[,;:]\s*$/, '').replace(/\s+please$/i, '').trim();
  const quoted = [...work.matchAll(/"([^"]{2,80})"/g)].map((m) => m[1]);
  const l = work.toLowerCase().replace(/[,;:"()]/g, ' ').replace(/\s+/g, ' ').trim();
  const cmp = compareItems(l, work.replace(/[?"]/g, '').trim());
  let cls = classify(l, hint);
  const leadWh = cls.qtype;
  if (cmp && (cmp.unresolved || cmp.items.length >= 2) && !['why', 'when', 'where', 'who'].includes(leadWh) && !(leadWh === 'how' && cls.answerType !== 'mechanism')) cls = { qtype: cmp.reco ? 'recommendation' : 'comparison', answerType: 'comparison', lead: leadWh };
  else if (PRED.test(l) && !['why', 'comparison'].includes(cls.qtype) && cls.answerType !== 'procedure') cls = { ...cls, qtype: 'prediction', answerType: cls.answerType === 'yesno' || cls.answerType === 'definition' ? 'prediction' : cls.answerType, lead: leadWh, prediction: true };
  else if (RECO.test(l) && cls.qtype !== 'why') cls = { ...cls, qtype: 'recommendation', answerType: cls.answerType === 'procedure' ? 'procedure' : 'recommendation', lead: leadWh };

  const tokens = tokenizeFull(work).filter((t) => !(t.kind === 'punct' && !/^['-]$/.test(t.t)));
  const { tags, vlemma } = tagTokens(tokens);
  const nps = chunk(tokens, tags);
  const verbs = [];
  tokens.forEach((t, i) => { if (tags[i] === 'VERB' && !(i === 0 && COMMANDS.has(t.l))) verbs.push({ i, surface: t.l, lemma: vlemma(i) }); });
  const mainVerb = verbs.find((v) => !/^(mean|stand|refer|happen)$/.test(v.lemma)) || verbs[0] || null;

  // predicate: verb + object (NPs after the verb, joined across prepositions) and subject (NP before it)
  let object = '', subject = '';
  if (mainVerb) {
    const after = nps.filter((np) => np.start > mainVerb.i);
    if (after.length) object = tokens.slice(after[0].start - (after[0].start > 0 && tags[after[0].start - 1] === 'DET' && after[0].start - 1 > mainVerb.i ? 1 : 0), after[after.length - 1].end + 1).map((t) => t.t).join(' ');
    const before = nps.filter((np) => np.end < mainVerb.i && !np.generic);
    if (before.length) subject = before[before.length - 1].text;
    if (!object && before.length && tags.includes('WH')) { const first = nps.find((np) => np.end < mainVerb.i); if (first && first !== before[before.length - 1]) object = first.text; }
  }

  // focus selection
  const NEWSW = /^(latest|news|headlines?|recent|today's|top|breaking|updates?|developments?|new|current|events?|stories|story)$/;
  for (const np of nps) {
    if (cls.answerType === 'news') { const keep = tokens.slice(np.start, np.end + 1).filter((t) => !NEWSW.test(t.l)); if (!keep.length) np.generic = true; else if (keep.length < np.end - np.start + 1) np.text = keep.map((t) => t.t).join(' '); }
    // "Is the Great Wall of China visible …" / "Is machine learning hard?" → subject | predicate adjective
    const beAt = BE.has(tokens[0].l) ? 0 : tokens.length > 1 && BE.has(tokens[1].l) && /^(why|how)$/.test(tokens[0].l) ? 1 : -1;      // "Is X adj?", "Why is X adj?"
    if (beAt >= 0 && (cls.answerType === 'yesno' || cls.answerType === 'reason' || cls.answerType === 'mechanism' || cls.answerType === 'description') && np === nps[0] && np.start <= beAt + 2 && np.end > np.start && (np.end === tokens.length - 1 || tags[np.end + 1] === 'PREP')) {
      let k = np.end;
      if (np.proper) { while (k > np.start && !tokens[k].cap && !/^[A-Z0-9]{2,}$/.test(tokens[k].t)) k--; if (k === np.end || !(tokens[k].cap || /^[A-Z0-9]{2,}$/.test(tokens[k].t))) k = np.end; }
      else k = np.end - 1;
      if (k < np.end) { np.end = k; np.text = tokens.slice(np.start, k + 1).map((t) => t.t).join(' '); }
    }
  }
  // "How long do batteries last?", "How old is the universe?", "how much does a tesla cost": the degree word after "how"
  // asks for the measure — it is not what the question is about
  if (tokens.length > 2 && tokens[0].l === 'how') for (const np of nps) { if (np.start === 1 && np.end === 1 && !tokens[1].cap && nps.length > 1 && /^(?:long|old|much|many|far|tall|big|large|small|often|fast|quickly|slow|deep|high|low|heavy|wide|hot|cold|strong|likely|common|rare|expensive|cheap|safe|dangerous|hard|difficult|easy|soon|late|early|good|bad|accurate|effective|reliable|popular|close|near|thick|thin|short|young|new|dense|bright|loud|rich|poor|healthy|serious|severe|frequent|frequently|well|important|useful|powerful|efficient)$/.test(tokens[1].l)) np.generic = true; }
  // "the impact of remote work on productivity", "the relationship between sleep and memory", "the future of fusion":
  // the noun that names the relation is what is asked about the topic, not the topic
  if (nps.length > 1) for (const np of nps) { if (np.start === np.end && !np.proper && tokens[np.end + 1] && /^(?:of|between)$/.test(tokens[np.end + 1].l) && /^(?:impacts?|influences?|relationships?|links?|connections?|correlations?|associations?|interactions?|consequences|implications|significance|importance|benefits?|advantages?|disadvantages?|drawbacks?|risks?|dangers?|pros|cons|future|history|origins?|evolution|rise|decline|status|roles?|effects?|causes?|symptoms?|treatments?|prevention|economics|ethics|science|psychology|politics|basics|fundamentals|principles|limits|limitations|challenges|problems|applications|uses)$/.test(tokens[np.start].l)) np.generic = true; }
  const nonGeneric = nps.filter((np) => !np.generic && !(np.start === 0 && COMMANDS.has(tokens[0].l)));
  const byText = (s) => s && nonGeneric.find((np) => np.text.toLowerCase() === stripDet(s).toLowerCase());
  const targetOf = (s) => { if (!s) return ''; const want = stripDet(s).toLowerCase(); const i = work.toLowerCase().lastIndexOf(want); return i >= 0 ? work.slice(i, i + want.length) : stripDet(s); };
  let focus = '', attribute = cls.attribute || cls.aspect || '';
  if (cls.answerType === 'comparison') focus = cmp && cmp.items.length ? cmp.items[cmp.items.length - 1] : '';
  else if (cls.entity) focus = targetOf(cls.entity);
  else if (cls.target) focus = targetOf(cls.target);
  if (cls.qtype === 'who' && mainVerb && object && !cls.entity && !cls.target) focus = object;
  if (!focus || (!byText(focus) && focus.split(' ').length > 3 && !/\bof\b/.test(focus))) {
    const proper = nonGeneric.filter((np) => np.proper);
    const pick = proper[proper.length - 1] || (cls.answerType === 'procedure' || cls.qtype === 'who' ? nonGeneric[nonGeneric.length - 1] : nonGeneric[0]) || nps[0];
    if (pick && cls.answerType !== 'comparison') focus = pick.text;
  }
  focus = focus.replace(/^(?:the|a|an)\s+/i, '');
  if (cls.answerType === 'attribute' && !attribute) attribute = '';
  if (!attribute && cls.answerType !== 'definition' && cls.answerType !== 'comparison' && cls.answerType !== 'procedure' && nonGeneric.length > 1) {          // "X of Y" style attribute for other question types
    const f = nonGeneric.find((np) => np.text.replace(/^(?:the|a|an)\s+/i, '') === focus);
    const prev = f && nonGeneric[nonGeneric.indexOf(f) - 1];
    if (prev && f.start - prev.end === 2 + (tags[f.start - 1] === 'DET' ? 1 : 0) - (tags[f.start - 1] === 'DET' ? 0 : 0) && tags[prev.end + 1] === 'PREP') attribute = prev.text;
  }

  // temporal analysis
  const temporal = { timeSensitive: false, freshness: null, when: '', years: [] };
  for (const [fresh, re] of TIME_CUES) { const m = l.match(re); if (m) { temporal.freshness = temporal.freshness || fresh; temporal.when = temporal.when || m[1] || m[0]; temporal.timeSensitive = true; } }
  temporal.years = (l.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []).map(Number);
  const thisYear = new Date(now).getUTCFullYear();
  const pastTenseQ = /\b(was|were|did)\b/.test(l) && !/\b(latest|current|now|today)\b/.test(l);
  if (!temporal.timeSensitive && (SENSITIVE.test(l) || (ROLE.test(l) && /\b(is|are|who is)\b/.test(l) && !pastTenseQ) || cls.answerType === 'news' || cls.prediction || temporal.years.some((y) => y >= thisYear))) temporal.timeSensitive = true;
  if (cls.answerType === 'news' && !temporal.freshness) temporal.freshness = 'week';
  if (temporal.years.length && temporal.years.every((y) => y < thisYear - 1) && !temporal.freshness) temporal.timeSensitive = false;

  // weighted terms
  const terms = new Map();
  const constraints = [];
  // A hyphenated or dotted word ("solid-state", "covid-19", "node.js") is matched against text that is split at those marks,
  // so it enters the model as its parts — otherwise it could never be found in any passage.
  const add = (word, weight, kind) => {
    const w = word.toLowerCase().replace(/'s$|'$/, '');
    const parts = /[-.'’/]/.test(w) ? tokenize(w) : [w];
    for (const p of parts) {
      if ((p.length < 2 && !/\d/.test(p)) || (parts.length > 1 && STOPWORDS.has(p))) continue;
      const s = stem(p); const cur = terms.get(s);
      if (!cur || cur.weight < weight) terms.set(s, { stem: s, word: p, weight, kind });
    }
  };
  const timeWords = /^(today|tonight|yesterday|now|currently|latest|recent|recently|news|headlines|week|month|year)$/;
  const focusStems = new Set(tokenizeFull(focus).map((t) => stem(t.l)));
  const attrStems = new Set(tokenizeFull(attribute).map((t) => stem(t.l)));
  tokens.forEach((t, i) => {
    const tag = tags[i];
    if (tag === 'ADJ') { add(t.l, 0.7, 'noun'); return; }
    if (tag !== 'N' && tag !== 'NUM' && tag !== 'VERB') return;
    if (i === 0 && COMMANDS.has(t.l)) return;
    if (STOPWORDS.has(t.l) && !(t.cap && i > 0)) return;
    const st = stem(t.l);
    let w = tag === 'VERB' ? 0.9 : tag === 'NUM' ? 0.8 : 1;
    if (GENERIC.has(t.l)) w = 0.35;
    if (CONSTRAINT.has(t.l)) { w = 1; constraints.push(t.l); }
    if (timeWords.test(t.l) && temporal.timeSensitive) w = 0.15;
    if (focusStems.has(st)) w = Math.max(w, 1.25);
    if (attrStems.has(st)) w = Math.max(w, 1.2);
    if (tag === 'VERB' && /^(use|make|do|get|work|go|take|give|find|tell|show|know|happen|mean|come|become|function|operate)$/.test(vlemma(i)) && cls.answerType !== 'yesno') w = Math.min(w, 0.4);   // light verbs carry no topic
    add(tag === 'VERB' ? vlemma(i) : t.l, w, tag === 'VERB' ? 'verb' : (t.cap && i > 0) || /^[A-Z0-9]{2,}$/.test(t.t) ? 'proper' : 'noun');
  });
  for (const q of quoted) for (const t of tokenizeFull(q)) if (t.kind !== 'punct') add(t.l, 1.3, 'proper');
  const expansions = new Map();
  for (const t of terms.values()) {
    if (t.kind === 'proper' || t.weight < 0.5) continue;
    for (const syn of synonymsOf(t.word)) { const s = stem(syn); if (!terms.has(s) && !expansions.has(s)) expansions.set(s, { stem: s, word: syn, weight: 0.35 * t.weight, of: t.word }); }
  }
  const keywords = uniq(tokens.filter((t, i) => (tags[i] === 'N' || tags[i] === 'NUM' || tags[i] === 'VERB') && !STOPWORDS.has(t.l) && !(i === 0 && COMMANDS.has(t.l)) && !(timeWords.test(t.l) && temporal.timeSensitive)).map((t) => t.t), (x) => x.toLowerCase());
  const entities = uniq([...quoted.map((q) => ({ text: q, proper: true })), ...nonGeneric.filter((np) => np.proper).map((np) => ({ text: np.text, proper: true })), ...(cmp && !cmp.unresolved ? cmp.items.map((x) => ({ text: x, proper: false })) : []), ...(focus ? [{ text: focus, proper: false }] : [])], (e) => e.text.toLowerCase());

  return {
    text, core: work, qtype: cls.qtype, lead: cls.lead || leadWh, answerType: cls.answerType, explain: !!cls.explain, fn: !!cls.fn, person: !!cls.person,
    focus, attribute, phrase: cls.phrase ? targetOf(cls.phrase) || cls.phrase : '', quantityCue: cls.quantityCue || '',
    entities, nps: nonGeneric.map((np) => np.text), keywords,
    verb: mainVerb ? { lemma: mainVerb.lemma, surface: mainVerb.surface } : null, subject, object,
    compare: cmp ? { items: cmp.items, unresolved: cmp.unresolved, category: cmp.category, aspect: cmp.aspect } : null,
    temporal, style, constraints, negated: tags.includes('NEG') || /\b(not|never|no longer)\b/.test(l),
    terms: [...terms.values()], expansions: [...expansions.values()],
    isQuestion: cls.qtype !== 'statement' || /\?\s*$/.test(text),
  };
}

// ---------------------------------------------------------------------------------------------------
// multi-part splitting
const COORD = /\s*[,;]?\s+(?:and|but|plus|also)\s+(?:also\s+|then\s+|if so,?\s+)?(?=(?:what|why|how|when|where|who|whom|whose|which|is|are|was|were|do|does|did|can|could|should|will|would|has|have)\b)|\s*;\s+/i;
function splitParts(text) {
  const out = [];
  for (const sent of splitSentences(text)) {
    if (compareItems(sent.toLowerCase(), sent.replace(/[?.!]+$/, ''))?.items?.length >= 2 && !COORD.test(sent.replace(/^(.+?\b(?:and|or|vs|versus)\b)/i, ''))) { out.push(sent); continue; }
    let segs = sent.split(COORD).map((s) => s && s.trim()).filter(Boolean);
    const last = segs[segs.length - 1];
    const tail = last && last.match(/^(.+?)\s*,?\s+and\s+(when|where|why|how|by whom|who)\s*\??$/i);
    if (tail) segs = [...segs.slice(0, -1), tail[1], tail[2]];
    for (const s of segs) if (s.replace(/[?!.\s]/g, '').length > 1) out.push(s);
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------------------------------------------
// reference resolution
const PLEON = /\b(?:is|was|will|would|does|did|has) it (?:true|possible|safe|okay|ok|legal|illegal|worth|necessary|common|normal|bad|good|hard|easy|difficult|better|important|required|mandatory|raining|snowing|going|matter|take|seem|appear)\b|\bwhat time is it\b|\bhow is it going\b|\bit (?:is|was) (?:said|known|believed|thought|estimated|reported|true|possible|raining)\b|\bhow (?:long|much|far) (?:does|did|will|would) it (?:take|cost)\b/i;

function pickAntecedent(kind, ante) {
  const ents = ante.entities || [];
  const person = (g) => ents.find((e) => e.kind === 'person' && (!g || !e.gender || e.gender === g));
  const nameLike = () => ents.find((e) => e.kind === 'unknown' && /^\p{Lu}[\p{L}.'-]+(?:\s+(?:\p{Lu}[\p{L}.'-]+|de|van|von|bin|al))+$/u.test(e.name));     // "he" never binds to a thing
  if (kind === 'he') return person('m') || ents.find((e) => e.kind === 'person') || nameLike() || null;
  if (kind === 'she') return person('f') || ents.find((e) => e.kind === 'person') || nameLike() || null;
  if (kind === 'there') return ents.find((e) => e.kind === 'place') || ents.find((e) => e.kind !== 'person') || null;
  if (kind === 'they') {
    if (ante.compare && ante.compare.length >= 2) return { name: ante.compare.join(' and ') };
    return ents.find((e) => e.plural) || ents.find((e) => e.kind !== 'person') || ents[0] || null;
  }
  return ents.find((e) => e.kind !== 'person') || (ante.topic ? { name: ante.topic } : null) || ents[0] || null;       // it / this / that
}
function predicatePhrase(ante, form) {
  const p = (ante.predicates || []).find((x) => x.verb && x.object && !STATIVE.has(x.verb));
  if (!p) return null;
  const v = form === 'past' ? pastTense(p.verb) : form === 'gerund' ? gerund(p.verb) : p.verb;
  return `${v} ${p.object}`;
}

/** Rewrite pronouns, demonstratives and elliptical follow-ups using antecedents. Returns {text, rewrites[], unresolved[]}. */
export function resolveReferences(text, ante = {}) {
  const rewrites = [], unresolved = [];
  const bare = text.replace(/[?!.]+$/, '').trim();
  const l = bare.toLowerCase();
  const hasAnte = (ante.entities && ante.entities.length) || ante.topic || ante.proposition;
  let m;
  // --- ellipsis -------------------------------------------------------------
  if (ante.lastQuestion) {
    const lastQ = ante.lastQuestion.replace(/[?!.]+$/, '');
    if ((m = bare.match(/^(?:and |but |so |ok |okay )?(?:what|how) about (?:the |in |for |on |with )?(.+)$/i)) || ((m = bare.match(/^(?:and|or) (?:what about |in |for |the )?(.+)$/i)) && m[1].split(' ').length <= 6 && !/^(what|why|how|when|where|who|which|is|are|was|were|do|does|did|can|could|should|will|would)\b/i.test(m[1]))) {
      const repl = m[1].trim();
      if (!/\b(it|its|that|this|them|they|their|him|his|her|he|she|there)\b/i.test(repl)) {
        const f = ante.lastFocus || '';
        const idx = f ? lastQ.toLowerCase().lastIndexOf(f.toLowerCase()) : -1;
        const out = idx >= 0 ? lastQ.slice(0, idx) + repl + lastQ.slice(idx + f.length) : `${repl} ${ante.lastKeywords || ''}`.trim();
        rewrites.push({ from: bare, to: out, reason: 'elliptical follow-up completed from the previous question' });
        return { text: out + '?', rewrites, unresolved };
      }
    }
    if ((m = l.match(/^(?:and |but |so )?(why|how|when|where|who|how so|why not|since when|by whom|how much|how many|how long|how old|why is that|how is that|why is that so|when was that|where was that|when was it|where is that|where is it)$/))) {
      const wh = m[1].replace(/ (is|was) (that|it)( so)?$/, '').replace(/^how so$/, 'how').replace(/^why not$/, 'why');
      const stripped = lastQ.replace(/^(?:what|why|how (?:many|much|long|old)?|when|where|who|whom|which)\b\s*/i, '');
      const out = `${capitalize(wh)} ${stripped === lastQ ? lastQ.charAt(0).toLowerCase() + lastQ.slice(1) : stripped}`;
      rewrites.push({ from: bare, to: out, reason: 'question word applied to the previous question' });
      return { text: out + '?', rewrites, unresolved };
    }
  }
  // --- "do it" / "did that" ---------------------------------------------------
  let out = bare.replace(/\b(to do|do|did|does|done|doing) (it|that|this|so|the same)\b(?!\s+(?!too|first|again|before|alone|earlier|also|either|then|now|as well)[a-z])/gi, (all, verb, _o, offset) => {
    const before = bare.slice(0, offset).trim().split(/\s+/).pop() || '';
    if (!before || WH.has(before.toLowerCase())) return all;                 // "How does it …" is do-support, not a pro-verb
    const form = /did|done/i.test(verb) ? 'past' : /doing/i.test(verb) ? 'gerund' : 'base';
    const ph = predicatePhrase(ante, form);
    if (!ph) return all;
    const repl = (/^to /i.test(verb) ? 'to ' : '') + ph;
    rewrites.push({ from: all, to: repl, reason: 'refers to the action in an earlier question' });
    return repl;
  });
  // --- pronouns ---------------------------------------------------------------
  const tokens = tokenizeFull(out);
  const { tags } = tagTokens(tokens);
  const pieces = [];
  let pos = 0;
  const pleon = PLEON.test(out);
  const firstContent = tokens.findIndex((t, i) => tags[i] === 'N');
  const whPhraseEnd = (() => { if (!tokens.length || tags[0] !== 'WH') return -1; let i = 1; while (i < tokens.length && (tags[i] === 'N' || tags[i] === 'DET')) i++; return i - 1; })();
  const properBefore = (i) => tokens.some((t, k) => k < i && tags[k] === 'N' && ((t.cap && k > 0) || /^[A-Z]{2,}$/.test(t.t)));
  const nounBefore = (i) => tokens.some((t, k) => k < i && k > whPhraseEnd && tags[k] === 'N' && !GENERIC.has(t.l));
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], w = t.l;
    const next = tokens[i + 1], nt = tags[i + 1] || 'END', pt = i > 0 ? tags[i - 1] : 'START';
    let kind = null, poss = false;
    if (/^(he|him|himself)$/.test(w)) kind = 'he';
    else if (w === 'his') { kind = 'he'; poss = true; }
    else if (/^(she|herself|hers)$/.test(w)) kind = 'she';
    else if (w === 'her') { kind = 'she'; poss = nt === 'N' || nt === 'NUM'; }
    else if (w === 'it' || w === 'itself') { if (!pleon) kind = 'it'; }
    else if (w === 'its') { kind = 'it'; poss = true; }
    else if (/^(they|them|themselves)$/.test(w)) kind = 'they';
    else if (w === 'their' || w === 'theirs') { kind = 'they'; poss = true; }
    else if (/^(this|that|these|those)$/.test(w)) {
      const pronominal = nt === 'END' || nt === 'AUX' || nt === 'MODAL' || nt === 'VERB' || nt === 'PREP' || nt === 'PUNCT' || nt === 'ADV' || (next && /^(true|correct|right|possible|safe|legal|real|so|bad|good|accurate|why|work|happen|mean|matter)$/.test(next.l));
      const relative = w === 'that' && (pt === 'N' || pt === 'VERB') && nt !== 'END' && !/^(explain|describe|summarize|simplify|verify|about)$/.test(tokens[i - 1].l);
      if (pronominal && !relative && !(w === 'that' && i > 0 && /^(so|such|now|given|provided|true|said|believed)$/.test(tokens[i - 1].l))) kind = /^(these|those)$/.test(w) ? 'they' : 'it';
    } else if (w === 'there') {
      const existential = (next && /^(is|are|was|were|will|has|have|been|any|a|an|no|exist|exists|existed|many|much|more|some)$/.test(next.l)) || (i > 0 && /^(is|are|was|were)$/.test(tokens[i - 1].l) && i <= 2);
      if (!existential) kind = 'there';
    }
    if (!kind) continue;
    if ((kind === 'he' || kind === 'she') && properBefore(i)) continue;
    if (kind === 'there' ? properBefore(i) : (kind === 'it' || kind === 'they') && (nounBefore(i) || properBefore(i))) continue;
    let repl = null, ant = null;
    if (kind === 'it' && ante.proposition && /^(this|that)$/.test(w)) repl = ante.proposition;
    else { ant = pickAntecedent(kind, ante); repl = ant && ant.name; }
    if (!repl) { unresolved.push(t.t); continue; }
    let to, endTok = i;
    if (poss) {                                                    // "his nationality" → "the nationality of X"
      let k = i; while (k + 1 < tokens.length && (tags[k + 1] === 'N' || tags[k + 1] === 'NUM' || tags[k + 1] === 'ADJ')) k++;
      if (k > i) { to = `the ${out.slice(tokens[i + 1].start, tokens[k].end)} of ${repl}`; endTok = k; } else to = repl + (/s$/i.test(repl) ? "'" : "'s");
    } else if (kind === 'there') to = (pt === 'PREP' ? '' : 'in ') + repl;
    else if (kind === 'they' && ant && ant.kind === 'place' && /^(they|them)$/.test(w)) to = `people in ${repl}`;
    else to = repl;
    pieces.push(out.slice(pos, t.start), to);
    pos = tokens[endTok].end;
    i = endTok;
    rewrites.push({ from: t.t, to, reason: kind === 'it' && ante.proposition && /^(this|that)$/.test(w) ? 'refers to the previous part of the question' : 'pronoun resolved from the conversation' });
  }
  pieces.push(out.slice(pos));
  out = pieces.join('');
  if (rewrites.length) out = out.replace(/^(?:and|also|but|so|plus)\s+/i, '');
  // --- comparison placeholders ("the former", "the latter", "the first one") ------
  if (ante.compare && ante.compare.length >= 2) {
    out = out.replace(/\bthe (former|first one|first)\b/gi, (all) => { rewrites.push({ from: all, to: ante.compare[0], reason: 'refers to the earlier comparison' }); return ante.compare[0]; })
      .replace(/\bthe (latter|second one|second)\b/gi, (all) => { rewrites.push({ from: all, to: ante.compare[1], reason: 'refers to the earlier comparison' }); return ante.compare[1]; });
  }
  // --- attribute-only fragments: "and its population?" handled above; "the population?" needs an entity
  if (!rewrites.length && hasAnte && firstContent >= 0 && /^(?:and|also|plus)\b/i.test(bare) && tokens.length <= 6) {
    const a = pickAntecedent('it', ante);
    if (a) { out = `${out.replace(/^(?:and|also|plus)\s+/i, '')} of ${a.name}`; rewrites.push({ from: bare, to: out, reason: 'fragment attached to the current topic' }); }
  }
  return { text: out + (/[?]$/.test(text) ? '?' : ''), rewrites, unresolved };
}

// ---------------------------------------------------------------------------------------------------
/**
 * Analyse a user message.
 * context: {entities:[{name,kind,gender,plural}], topic, predicates:[{verb,object,subject}], compare:[..], lastQuestion, lastFocus, lastKeywords, hasAnswer}
 */
export function analyze(raw, context = {}, opts = {}) {
  const now = opts.now || Date.now();
  let text = normalizeQuestion(raw);
  const base = { raw: String(raw || '').slice(0, 600), text, intent: 'question', parts: [], multi: false, rewrites: [], unresolved: [], urls: [], followUp: false };
  if (!text.replace(/[^\p{L}\p{N}]/gu, '')) return { ...base, intent: 'empty' };
  const urls = [...text.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));
  if (urls.length) {
    const rest = urls.reduce((s, u) => s.replace(u, ' '), text).replace(/\s+/g, ' ').trim();
    const part = rest.replace(/[^\p{L}]/gu, '').length > 3 ? analyzePart(rest, { now }) : null;
    const summarize = !part || /^(?:please |can you |could you )*(summari[sz]e|read|open|tl;?dr|what (is|does) (this|it)( page| article| say)?|explain( this)?|describe)\b/i.test(rest) || part.terms.length === 0;
    return { ...base, intent: 'url', urls: urls.slice(0, 3), parts: summarize ? [] : [part], urlTask: summarize ? 'summarize' : 'question' };
  }
  const lower = text.toLowerCase().replace(/[?!.,]+$/g, '').replace(/[,]/g, '').trim();
  const c = calc(text);
  if (c) return { ...base, intent: 'calc', calc: c };
  const mk = metaKind(lower);
  if (mk) return { ...base, intent: 'meta', meta: mk, followUp: true };

  // strip conversational scaffolding ("can you tell me …", "I was wondering …")
  let hint = null;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const [re, grp] of LEAD_NOISE) {
      const m = text.match(re);
      if (m && text.length - m[0].length >= 2) {
        if (grp && m[grp]) { const v = m[grp].toLowerCase(); if (/explain|describe|clarify|elaborate|understand/.test(v)) hint = 'explain'; if (/^(list|summari[sz]e|compare|define)$/.test(v)) { text = v + ' ' + text.slice(m[0].length); changed = true; continue; } }
        text = text.slice(m[0].length); changed = true;
      }
    }
    if (!changed) break;
  }
  text = text.replace(/^about\s+/i, () => { hint = hint || 'explain'; return ''; });
  text = capitalize(text.trim());

  const rawParts = splitParts(text);
  const ante = {
    entities: [...(context.entities || [])], topic: context.topic || '', predicates: [...(context.predicates || [])], compare: context.compare || null,
    lastQuestion: context.lastQuestion || '', lastFocus: context.lastFocus || '', lastKeywords: context.lastKeywords || '', proposition: null,
  };
  const parts = [], rewrites = [], unresolved = [];
  for (let i = 0; i < rawParts.length; i++) {
    let ptext = rawParts[i];
    // bare question word after an earlier part: "Who invented the telephone and when?"
    if (parts.length && /^(when|where|why|how|by whom|who)\??$/i.test(ptext)) {
      const prev = parts[parts.length - 1];
      const rest = prev.core.replace(/^(?:what|why|how|when|where|who|whom|which)\b\s*/i, '');
      const to = `${capitalize(ptext.replace(/\?$/, '').toLowerCase())} ${rest}`;
      rewrites.push({ from: ptext, to, reason: 'question word applied to the first part' });
      ptext = to;
    }
    const res = resolveReferences(ptext, ante);
    rewrites.push(...res.rewrites); unresolved.push(...res.unresolved);
    const part = analyzePart(res.text, { now, hint: i === 0 ? hint : null });
    part.original = rawParts[i];
    // "…and what risks does that create?": the topic is still the subject of the earlier part, not the whole clause
    if (parts.length && res.rewrites.some((r) => r.reason === 'refers to the previous part of the question')) { const prev = parts[parts.length - 1]; part.focus = prev.subject || prev.focus || part.focus; part.entities = [{ text: part.focus, proper: false }]; part.propositional = true; }
    parts.push(part);
    // this part becomes an antecedent source for the following parts
    const mentioned = part.entities.filter((e) => !ante.entities.some((x) => x.name.toLowerCase() === e.text.toLowerCase())).map((e) => ({ name: e.text, kind: part.person && e.text === part.focus ? 'person' : 'unknown', gender: '', plural: /s$/.test(e.text) && !/ss$/.test(e.text) }));
    ante.entities = [...mentioned, ...ante.entities];
    if (part.focus) ante.topic = part.focus;
    if (part.verb && part.object) ante.predicates.unshift({ verb: part.verb.lemma, object: part.object, subject: part.subject });
    ante.proposition = part.verb && part.subject ? `${part.subject} ${gerund(part.verb.lemma)}${part.object ? ' ' + part.object : ''}` : part.focus || null;
    if (part.compare && part.compare.items.length >= 2) ante.compare = part.compare.items;
  }
  // statements that only set the scene ("I have a Python list. How do I sort it?") are context, not questions
  const questions = parts.filter((p) => p.isQuestion);
  const finalParts = questions.length && questions.length < parts.length ? questions.map((q) => ({ ...q, contextTerms: parts.filter((p) => !p.isQuestion).flatMap((p) => p.terms.map((t) => ({ ...t, weight: t.weight * 0.6 }))) })) : parts;
  for (const p of finalParts) if (p.contextTerms) { const have = new Set(p.terms.map((t) => t.stem)); for (const t of p.contextTerms) if (!have.has(t.stem)) { p.terms.push(t); have.add(t.stem); } }

  // unresolved comparison ("compare these two languages") → try the conversation, otherwise ask
  let clarification = null;
  for (const p of finalParts) {
    if (p.compare && p.compare.unresolved) {
      const known = context.compare && context.compare.length >= 2 ? context.compare : (context.entities || []).filter((e) => e.kind !== 'person').slice(0, 2).map((e) => e.name);
      if (known.length >= 2) { p.compare = { ...p.compare, items: known.slice(0, 3), unresolved: false }; p.focus = known[known.length - 1]; p.entities = known.map((k) => ({ text: k, proper: true })); rewrites.push({ from: p.core, to: `Compare ${known.join(' and ')}`, reason: 'items taken from the conversation' }); for (const k of known) for (const t of tokenizeFull(k)) if (t.kind !== 'punct') p.terms.push({ stem: stem(t.l), word: t.l, weight: 1.25, kind: 'proper' }); }
      else clarification = { reason: 'compare-items', category: p.compare.category || 'things' };
    }
  }
  if (!clarification && finalParts.length === 1 && unresolved.length && !rewrites.length && finalParts.every((p) => !p.entities.some((e) => e.proper)) && finalParts[0].keywords.length <= 2) clarification = { reason: 'no-referent', words: uniq(unresolved) };
  return { ...base, text, parts: finalParts, multi: finalParts.length > 1, rewrites, unresolved: uniq(unresolved), followUp: rewrites.length > 0, clarification, resolved: finalParts.map((p) => capitalize(p.text.replace(/[?.!]*$/, p.isQuestion ? '?' : ''))).join(' ') };
}
