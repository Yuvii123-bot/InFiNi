// INFINI AI — research requests.
// "Do deep research on X", "write a detailed report about X", "what does the research say about X": the words that ask
// for research are an instruction about *how* to answer, not part of the topic. They are taken off before the question
// is analysed, and they set the depth when the depth is left on automatic.

const LEAD = '(?:please\\s+|kindly\\s+|can you\\s+|could you\\s+|would you\\s+|i (?:want|need|would like)(?: you)? to\\s+|i(?:\'d| would) like(?: you)? to\\s+|let\'?s\\s+|go\\s+(?:and\\s+)?)?';
const VERB = '(?:do|run|make|conduct|perform|carry out|give me|write(?: me)?|prepare|create|compile|produce|generate|get me|i need|i want|show me|put together)';
const STRONG = '(deep|deeper|in-?depth|thorough|detailed|comprehensive|full|extensive|complete|exhaustive|serious|proper|massive|big)';
const KIND = '(research report|research paper|research|report|investigation|literature review|review of the literature|deep dive|deep-dive|dossier|white ?paper|analysis|study|survey|overview|briefing|summary of the research|fact[- ]?check)';
const PREP = '(?:on|about|into|of|regarding|concerning|covering|for|around)';
const RE_REQUEST = new RegExp(`^${LEAD}(?:${VERB}\\s+)?(?:(?:a|an|some|the|your)\\s+)?(?:(?:very|really|super)\\s+)?(?:${STRONG}\\s+)?(?:and\\s+${STRONG}\\s+)?${KIND}\\s+${PREP}\\s+(.{3,})$`, 'i');
// "research shows that …", "research papers on …", "research things for me" are not requests to research the words that follow
const NOT_A_TOPIC = '(?!(?:shows?|showed|says?|said|suggests?|suggested|indicates?|indicated|finds?|found|has|have|had|is|are|was|were|proves?|proved|reveals?|revealed|confirms?|confirmed|demonstrates?|papers?|articles?|grants?|funding|institutes?|cent(?:er|re)s?|labs?|laborator(?:y|ies)|gate|assistants?|scientists?|methods?|methodology|questions?|things|stuff|topics?|something|anything|for me|for us|and development|& development)\\b)';
const RE_VERB = new RegExp(`^${LEAD}(deep(?:ly)?\\s+|thoroughly\\s+|carefully\\s+)?research\\s+(?:${PREP}\\s+)?${NOT_A_TOPIC}(.{3,})$`, 'i');
const RE_WEB = new RegExp(`^${LEAD}(?:search|scan|scour|crawl|comb|check|look)\\s+(?:through\\s+|across\\s+|all over\\s+)?(?:the\\s+)?(?:whole|entire|full|complete|all of the)\\s+(?:web|internet|net|world wide web)\\s+(?:for|about|on|regarding)\\s+(.{3,})$`, 'i');
const RE_ALL = new RegExp(`^${LEAD}(?:find|tell me|give me|show me|get me|gather|collect|look up|dig up|pull up|search for|search)\\s+(?:me\\s+)?(?:out\\s+)?(everything|all(?: of)?(?: the)?(?: available)? (?:information|info|details|facts|data|sources)|as much(?: information| info)? as (?:possible|you can)(?: find)?)\\s+(?:that\\s+)?(you can(?: find)?\\s+|there is(?: to know)?\\s+|that is known\\s+|known\\s+|available\\s+)?(?:about|on|regarding|for)\\s+(.{3,})$`, 'i');
const RE_INVESTIGATE_PLAIN = new RegExp(`^${LEAD}(?:investigate|look deep(?:ly)? into)\\s+(.{3,})$`, 'i');
const RE_DIVE = new RegExp(`^${LEAD}(?:(?:do|take|give me)\\s+a\\s+)?(?:deep[- ]dive|dig deep|dig)\\s+(?:in)?to\\s+(.{3,})$`, 'i');
const RE_INVESTIGATE = new RegExp(`^${LEAD}(?:investigate|look into|examine|analy[sz]e|study)\\s+(.{3,}?)\\s+(?:thoroughly|in depth|in-depth|in detail|deeply|comprehensively|exhaustively)[.!?]*$`, 'i');
const RE_SAYS = /^what (?:does|do|did) (?:the |current |recent |scientific |latest |available )*(research|science|evidence|literature|studies|data|scientists|experts|researchers) (?:actually |really |currently )?(?:say|says|show|shows|tell us|suggest|suggests|indicate|indicates|think|conclude|find|found)(?: so far)? (?:about|on|regarding|concerning) (.{3,})$/i;
const RE_SUFFIX = /^(.{6,}?)[,;]?\s+(?:(?:in|with)\s+(?:great |full |more )?(?:depth|detail)|thoroughly|comprehensively|exhaustively|using (?:as )?many sources(?: as (?:possible|you can))?|from (?:as )?many sources(?: as (?:possible|you can))?|with (?:a )?(?:deep|full|thorough) research)[.!?]*$/i;
// "can you do deep research on lithium mining?": the question mark belongs to the request, not to the topic — unless the topic is itself a question
const tidy = (t) => {
  let s = String(t).trim().replace(/[.!\s]+$/, '').replace(/^(?:the (?:topic|subject|question) of\s+)/i, '');
  if (!/^(?:what|why|how|who|whom|whose|when|where|which|is|are|was|were|do|does|did|can|could|should|will|would|has|have)\b/i.test(s)) s = s.replace(/[?\s]+$/, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
};

/**
 * Returns null, or { question, depth: 'research' | 'deep', scholarly, reason }.
 * `question` is the topic with the instruction removed.
 */
export function researchDirective(raw) {
  const q = String(raw || '').trim().replace(/\s+/g, ' ');
  if (q.length < 8 || q.length > 600) return null;
  let m;
  if ((m = q.match(RE_REQUEST))) {
    const strong = !!(m[1] || m[2]);
    const kind = m[3].toLowerCase();
    const heavy = /research|investigation|literature|deep|dossier/.test(kind);          // these words ask for a full research run by themselves
    const medium = /report|white|fact/.test(kind);                                      // a report: thorough, but a full run only when emphasised ("detailed report")
    // "an overview of X" or "an analysis of X" without any emphasis is an ordinary question, phrased as a noun
    if (!heavy && !medium && !strong) return null;
    return { question: tidy(m[4]), depth: heavy || (medium && strong) ? 'research' : 'deep', scholarly: /literature|research paper|review of/.test(kind), reason: 'research request — the topic was taken from it' };
  }
  if ((m = q.match(RE_VERB))) return { question: tidy(m[2]), depth: 'research', scholarly: false, reason: 'research request — the topic was taken from it' };
  if ((m = q.match(RE_DIVE))) return { question: tidy(m[1]), depth: 'research', scholarly: false, reason: 'research request — the topic was taken from it' };
  if ((m = q.match(RE_INVESTIGATE))) return { question: tidy(m[1]), depth: 'research', scholarly: false, reason: 'research request — the topic was taken from it' };
  if ((m = q.match(RE_WEB))) return { question: tidy(m[1]), depth: 'research', scholarly: false, reason: 'asked to search as widely as possible — the topic was taken from the request' };
  // "find everything you can about X" asks for a full run; "tell me everything about X" for a thorough answer
  if ((m = q.match(RE_ALL))) return { question: tidy(m[3]), depth: m[2] || /as much/i.test(m[1]) ? 'research' : 'deep', scholarly: false, reason: 'asked for everything on a topic — reading many more sources' };
  if ((m = q.match(RE_INVESTIGATE_PLAIN))) return { question: tidy(m[1]), depth: 'deep', scholarly: false, reason: 'asked to investigate — reading more sources' };
  if ((m = q.replace(/\?+$/, '').match(RE_SAYS))) return { question: tidy(m[2]), depth: 'deep', scholarly: true, reason: `asked what the ${m[1].toLowerCase()} says — searching scholarly indexes as well` };
  if ((m = q.match(RE_SUFFIX)) && m[1].split(/\s+/).length >= 2) return { question: tidy(m[1]) + (/^(what|why|how|who|when|where|which|is|are|do|does|did|can|could|should|will|was|were)\b/i.test(m[1]) ? '?' : ''), depth: 'deep', scholarly: false, reason: 'asked for depth — reading more sources' };
  return null;
}
