// Follow-up suggestions, without a language model.
//
// A suggestion is a fixed question template with one slot, and the slot is filled with the subject of the
// conversation. A template is offered only when a page that was just read has a section on that aspect
// (its heading matches), or when a structured fact about the named answer was retrieved. Nothing here
// generates text: the list of templates below is everything this module can ever say.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// [aspect, heading pattern, template]. `np` = subject as a noun phrase ("the telephone"), `bare` = without article,
// `be` = "is" / "are", `does` = "does" / "do".
const ASPECTS = [
  ['mechanism', /^(how (it|they) works?|mechanism|principles?( of operation)?|operation|working principle|function(s|ing)?|process|theory of operation)\b/i, (v) => `How ${v.does} ${v.np} work?`],
  ['use', /^(applications?|uses?|usage|use cases|practical applications)\b/i, (v) => `What ${v.be} ${v.np} used for?`],
  ['history', /^(history|origins?|background|historical background|early history|invention|discovery|timeline)\b/i, (v) => `What is the history of ${v.np}?`],
  ['types', /^(types?|kinds|classification|variants|varieties|categories|forms|taxonomy)\b/i, (v) => `What types of ${v.bare} are there?`],
  ['cause', /^(causes?|etiology|risk factors)\b/i, (v) => `What causes ${v.np}?`],
  ['symptoms', /^(signs and symptoms|symptoms|clinical (features|presentation))\b/i, (v) => `What are the symptoms of ${v.np}?`],
  ['treatment', /^(treatments?|management|therapy)\b/i, (v) => `How ${v.be} ${v.np} treated?`],
  ['prevention', /^(prevention|mitigation)\b/i, (v) => `How can ${v.np} be prevented?`],
  ['advantages', /^(advantages|benefits|strengths|pros\b)/i, (v) => `What are the advantages of ${v.np}?`],
  ['limits', /^(disadvantages|limitations|drawbacks|challenges|criticisms?|problems|issues|risks|controvers(y|ies)|obstacles)\b/i, (v) => `What are the limitations of ${v.np}?`],
  ['structure', /^(structure|anatomy|components|architecture|composition|parts)\b/i, (v) => `What is the structure of ${v.np}?`],
  ['effects', /^(effects?|impacts?|consequences|significance|importance)\b/i, (v) => `What are the effects of ${v.np}?`],
  ['examples', /^(examples?|notable examples|instances)\b/i, (v) => `What are some examples of ${v.bare}?`],
  ['name', /^(etymology|name|naming|terminology|nomenclature)\b/i, (v) => `Where does the name “${v.label}” come from?`],
  ['future', /^(future|outlook|future (developments?|directions|prospects)|prospects)\b/i, (v) => `What is the future of ${v.np}?`],
  ['making', /^(production|manufactur(e|ing)|synthesis|preparation|construction)\b/i, (v) => `How ${v.be} ${v.np} made?`],
  ['diseases', /^(clinical significance|diseases?|disorders|pathology)\b/i, (v) => `What diseases affect ${v.np}?`],
  ['diagnosis', /^(diagnosis|detection|screening)\b/i, (v) => `How ${v.be} ${v.np} diagnosed?`],
  ['properties', /^(properties|characteristics|features)\b/i, (v) => `What are the properties of ${v.np}?`],
  ['health', /^(health effects|side effects|adverse effects|toxicity|safety)\b/i, (v) => `What are the health effects of ${v.np}?`],
  ['syntax', /^(syntax|parameters|return value|usage notes)\b/i, (v) => `What is the syntax of ${v.np}?`],
];
const PERSON = [
  ['life', /^(early life|biography|life|early years|childhood|education)\b/i, (v) => `What was the early life of ${v.bare} like?`],
  ['work', /^(career|work|works|contributions|achievements|research|inventions|scientific career)\b/i, (v) => `What is ${v.bare} known for?`],
  ['legacy', /^(legacy|influence|recognition|honou?rs|awards|legacy and (honou?rs|recognition))\b/i, (v) => `What is the legacy of ${v.bare}?`],
  ['death', /^(death|later life|later years|final years|death and legacy)\b/i, (v) => `How did ${v.bare} die?`],
];
const PLACE = [
  ['geography', /^(geography|location|topography|physical geography)\b/i, (v) => `What is the geography of ${v.bare} like?`],
  ['history', /^(history)\b/i, (v) => `What is the history of ${v.bare}?`],
  ['economy', /^(economy|industry|economics)\b/i, (v) => `What is the economy of ${v.bare} based on?`],
  ['climate', /^(climate|weather)\b/i, (v) => `What is the climate of ${v.bare} like?`],
  ['people', /^(demographics|population|people|languages?|religion)\b/i, (v) => `What is the population of ${v.bare}?`],
  ['government', /^(government|politics|administration|government and politics)\b/i, (v) => `How is ${v.bare} governed?`],
  ['culture', /^(culture|arts|cuisine|festivals)\b/i, (v) => `What is the culture of ${v.bare} like?`],
  ['tourism', /^(tourism|landmarks|attractions|places of interest)\b/i, (v) => `What are the main attractions in ${v.bare}?`],
  ['name', /^(etymology|name|toponymy)\b/i, (v) => `Where does the name “${v.label}” come from?`],
];
// which aspect a question already asked about → not suggested again
const ASKED = { mechanism: 'mechanism', reason: 'cause', procedure: 'making', time: 'history' };
const ASKED_WORDS = [['history', /\b(history|origins?|invented|discovered)\b/i], ['use', /\bused for|\buses?\b|applications?\b/i], ['types', /\b(types?|kinds)\b/i], ['cause', /\bcauses?\b/i], ['symptoms', /\bsymptoms?\b/i], ['treatment', /\btreat(ed|ment)?\b/i], ['advantages', /\b(advantages|benefits)\b/i], ['limits', /\b(limitations|disadvantages|risks|problems)\b/i], ['structure', /\b(structure|anatomy|components)\b/i], ['effects', /\beffects?\b/i], ['examples', /\bexamples?\b/i], ['name', /\b(name|etymology)\b/i], ['future', /\bfuture\b/i], ['mechanism', /\bhow (does|do|did) .* work\b|\bwhat (does|do) .* do\b/i]];

/**
 * @param {object} o
 * @param {string} o.question   the question that was just answered (resolved form)
 * @param {string} o.focus      its subject, as analysed ("telephone")
 * @param {string} o.kind       'person' | 'place' | 'thing' | …   kind of the subject
 * @param {string} o.answerType analysed answer type of the question
 * @param {boolean} o.plural
 * @param {Array}  o.docs       documents that were read: {entity, cited, sid, title, blocks:[{type:'heading', text}]}
 * @param {object} [o.answer]   named answer of a factoid question: {name, kind}
 * @returns {Array<{question:string, aspect:string, basis:string, source:(number|null)}>}
 */
export function relatedQuestions({ question = '', focus = '', kind = '', answerType = '', plural = false, docs = [], answer = null, max = 3 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (q, aspect, basis, source) => { const k = q.toLowerCase(); if (!seen.has(k) && k !== question.trim().toLowerCase()) { seen.add(k); out.push({ question: q, aspect, basis, source: source == null ? null : source }); } };

  // 1. the named answer of a factoid ("Who invented the telephone?" → Alexander Graham Bell)
  if (answer && answer.name && answer.name.length <= 60 && /^[\p{L}\p{N} .,'’()-]+$/u.test(answer.name)) {
    if (answer.kind === 'person') { push(`Who was ${answer.name}?`, 'person', 'the name given in the answer', null); push(`When was ${answer.name} born?`, 'person', 'the name given in the answer', null); }
    else if (answer.kind === 'place') push(`Where is ${answer.name}?`, 'place', 'the place named in the answer', null);
  }

  // 2. sections of the pages that were read
  const bare = String(focus || '').replace(/^(the|a|an)\s+/i, '').trim();
  if (bare && bare.length <= 60 && /^[\p{L}\p{N} .,'’()+#/-]+$/u.test(bare)) {
    const hadArticle = new RegExp(`\\b(the|an?)\\s+${esc(bare)}\\b`, 'i').test(question);
    const proper = kind === 'person' || kind === 'place';
    const v = { bare, label: bare, np: !proper && hadArticle ? `the ${bare}` : bare, be: plural ? 'are' : 'is', does: plural ? 'do' : 'does' };
    // a page counts only if it is about the subject itself (its title names it) — a section of some other page says nothing about this subject
    const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean).map((w) => (w.length > 3 ? w.replace(/(es|s)$/, '') : w));
    const want = norm(bare);
    const about = (d) => { const have = new Set(norm(d.title)); return want.length > 0 && want.every((w) => have.has(w)); };
    const table = kind === 'person' ? PERSON : kind === 'place' ? PLACE : ASPECTS;
    const asked = new Set([ASKED[answerType], ...ASKED_WORDS.filter(([, re]) => re.test(question)).map(([a]) => a)].filter(Boolean));
    const pages = docs.filter((d) => d && Array.isArray(d.blocks) && (d.entity || d.cited) && about(d)).sort((a, b) => (b.entity ? 1 : 0) - (a.entity ? 1 : 0));
    const own = pages.find((d) => d.entity && d.title && d.title.length <= 40 && norm(d.title).length === want.length);
    if (own) v.label = own.title;
    const found = [];
    for (const d of pages) {
      for (const b of d.blocks) {
        if (b.type !== 'heading' || (b.level || 2) > 2 || !b.text || b.text.length > 60) continue;   // top-level sections only: sub-sections belong to sub-topics
        const head = b.text.replace(/^\d+[.)]?\s*/, '').trim();
        const hit = table.find(([, re]) => re.test(head));
        if (!hit || asked.has(hit[0]) || found.some((f) => f.aspect === hit[0])) continue;
        found.push({ aspect: hit[0], q: hit[2](v), basis: `section “${head}” of ${d.title || 'a page that was read'}`, source: d.sid || null, rank: table.indexOf(hit) });
      }
    }
    found.sort((a, b) => a.rank - b.rank).forEach((f) => push(f.q, f.aspect, f.basis, f.source));
  }
  return out.slice(0, max);
}
