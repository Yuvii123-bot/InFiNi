// INFINI AI — passage and sentence ranking (non-neural).
// BM25-style lexical statistics computed on the fly from the pages retrieved for *this* question, weighted query
// terms from the question analysis, answer-type cue patterns, implicit-subject credit from headings/titles,
// pseudo-relevance feedback for vocabulary the question did not contain, and MMR for diverse selection.

import { terms as stemTerms, tokenize, stem, STOPWORDS, splitSentences, squash, jaccard } from '../util/text.js';

export const CUES = {
  reason: /\b(because|due to|caused by|causes?|caused|result(?:s|ed|ing)? (?:of|from|in)|as a result|therefore|thus|hence|so that|leads? to|led to|owing to|thanks to|in order to|generat(?:es|ed|ing)|produc(?:es|ed|ing)|releas(?:es|ed|ing)|powered by|driven by|explains?|reason|responsible for|arises? from|stems? from|attributed to|by (?:fusing|burning|converting|releasing|means of)|allows?|enables?|makes? it)\b/i,
  procedure: /^(?:\d+[.)]\s*)?(?:first|then|next|finally|start|begin|install|create|run|use|add|open|click|select|choose|configure|define|set|write|import|call|make|build|download|go to|navigate|enter|type|press|save|copy|connect|enable|deploy|test|pick|decide|identify|gather|train|design|plan|implement|give|equip|integrate)\b|\b(step \d|you (?:can|need|should|must|will)|to do this|make sure|be sure to)\b/i,
  definition: /\b(?:is|are|was|were) (?:a|an|the|one of|any|defined as|known as|called)\b|\brefers? to\b|\bis defined as\b|\bmeans\b|\bdescribes\b/i,
  comparison: /\b(whereas|while|unlike|compared (?:to|with)|in contrast|by contrast|on the other hand|than|both|differ(?:s|ence|ent)?|similar(?:ly|ity)?|in common|alike|versus|vs\.?|rather than|as opposed to|faster|slower|safer|simpler|easier|harder)\b/i,
  place: /\b(?:in|at|near|from|located|situated|found|lies|native to|across|throughout|capital|headquartered|based in)\b/i,
  person: /\b(?:by|invented|discovered|founded|created|written|wrote|developed|designed|built|led|credited|named after|patented|introduced|proposed|pioneered|awarded)\b/i,
  quantity: /\d/,
  time: /\b(?:1[0-9]{3}|20[0-9]{2})\b|\b(?:century|decade|BC|AD|BCE|CE)\b/,
  prediction: /\b(will|expected to|projected|forecasts?|predict(?:s|ed|ions?)?|estimate[sd]?|by (?:20[2-9]\d|2[1-9]\d\d)|likely to|could|may|might|in the (?:coming|next)|future|outlook|anticipate[sd]?)\b/i,
  recommendation: /\b(recommend(?:s|ed)?|should|best|ideal|suggest(?:s|ed)?|advis(?:e|ed|able)|consider|good (?:choice|option|idea)|worth|prefer(?:red)?|suitable|great for|better (?:for|to)|start with|tip)\b/i,
  list: /\b(include|includes|including|such as|types? of|kinds? of|for example|e\.g\.|among|consists? of|range from|namely|several|various|main|major|common)\b/i,
  mechanism: /\b(through|via|using|uses?|works? by|process|when|converts?|absorbs?|produces?|then|first|causes?|allows?|mechanism|function(?:s|ing)?|consists? of|step|stage|during|into|transfers?|triggers?|stimulates?|reacts?)\b/i,
  // what something does: it is the subject of an action
  function: /\b(creates?|returns?|calls?|executes?|runs?|adds?|appends?|inserts?|removes?|deletes?|converts?|iterates?|loops?|applies|transforms?|sorts?|filters?|combines?|joins?|splits?|checks?|tests?|finds?|searches|copies|merges?|sets?|gets?|allows?|lets?|enables?|provides?|performs?|produces?|generates?|takes?|accepts?|specifies|defines?|declares?|pauses?|stops?|starts?|waits?|sends?|receives?|reads?|writes?|opens?|closes?|stores?|loads?|prints?|displays?|regulates?|controls?|carries|pumps?|protects?|breaks? down|is used (?:to|for)|are used (?:to|for)|used to|responsible for)\b/i,
};
const TYPE_BOOST = { function: 0.15, reason: 0.45, procedure: 0.35, definition: 0.3, comparison: 0.3, place: 0.15, person: 0.2, quantity: 0.25, time: 0.3, prediction: 0.35, recommendation: 0.3, list: 0.25, mechanism: 0.25 };
const JUNK = /\b(click here|subscribe|sign up|sign in|log in|cookies?|privacy policy|terms of (?:use|service)|all rights reserved|read more|advertis|newsletter|share this|follow us|javascript (?:is|must be) (?:disabled|enabled)|loading\.\.\.|©)\b/i;
const DANGLING = /^(?:however|but|also|this|these|those|it|they|he|she|such|that|there|then|thus|therefore|moreover|furthermore|additionally|in addition|for example|for instance|similarly|instead|otherwise|meanwhile|as a result|nevertheless|hence|consequently|his|her|its|their|another|the latter|the former|both|some|others?|in contrast|on the other hand|as such|so)\b/i;
// "The liver is also …" continues an earlier statement, so it cannot open an answer.
// "If that hybrid path is what interests you, …" points back at text that will not be quoted.
const REFER_RE = /^(?:if|when|while|since|because|although|though|as|once|after|before|unless|given)\s+(?:this|that|these|those|it|they|he|she|such)\b|\b(?:the )?(?:aforementioned|above-?mentioned|afore-?said)\b|\bas (?:mentioned|noted|described|discussed|stated|shown|outlined|seen) (?:above|earlier|previously|before|below)\b|\b(?:mentioned|described|discussed|outlined) (?:above|earlier|previously)\b/i;
const VERBISH = /\b(?:is|are|was|were|be|been|being|has|have|had|can|could|will|would|may|might|must|should|do|does|did|include[sd]?|supports?|contains?|consists?|provides?|offers?|creates?|returns?|allows?|makes?|means?|refers?|comprises?|became|become|becomes)\b/i;
/** True for a comma-separated run of short keyword phrases with no verb. */
export function isKeywordRun(text) {
  const segs = String(text).split(/\s*[,;|·•]\s*/).filter(Boolean);
  if (segs.length < 6) return false;
  const short = segs.filter((x) => x.split(/\s+/).length <= 4).length;
  return short / segs.length >= 0.8 && !VERBISH.test(text);
}
/** True for an editorial aside about the page rather than a statement about its subject: "(Note: This article describes ...". */
export function isAside(text) {
  const t = String(text).trim();
  if (/^\(/.test(t) && !/\)/.test(t)) return true;                                   // a bracket that opens the sentence and never closes
  return /^\(?\s*(?:note|please note|n\.b\.|nb|disclaimer|editor['’]?s note|author['’]?s note|update|updated|see also|read more|related|source|photo|image|credit)\s*[:—–-]\s/i.test(t) || /^\(?\s*this (?:article|page|post|section|guide|entry|story) (?:is about|describes|covers|discusses|explains|deals with|was (?:originally|first|last)|has been|needs|may|contains|includes)\b/i.test(t);
}
// How a paper was made or what it covers ("We searched PubMed …", "… are also discussed"): about the document, not about the world.
// a database search string quoted in a paper: [‘Health effects’ OR ‘Health impacts’ OR …] (capitals matter here)
const BOOLEAN_QUERY = /(?:\bOR\b[^.]*){2,}|\[[‘'"“][^\]]{3,80}\bOR\b|\bAND\b[^.]*\bOR\b|\bOR\b[^.]*\bAND\b/;
// "… has attracted increasing attention", "… is a growing concern": the sentence that opens a text, reporting nothing yet
const ATTENTION = /\bquestions? (?:have|has|had|are|were|is|was) (?:also |often |long |recently )?(?:been |being )?(?:asked|raised|posed)\b|\b(?:rais|pos)(?:e|es|ed|ing) (?:\w+ ){0,3}questions?\b|\b(?:attract(?:ed|ing|s)?|draw(?:n|ing|s)?|drew|receiv(?:ed|ing|es)|gain(?:ed|ing|s)?|garner(?:ed|ing|s)?|rais(?:ed|ing|es)|spark(?:ed|ing|s)?|prompt(?:ed|ing|s)?)\s+(?:\w+\s+){0,4}?(?:attention|concerns?|apprehension|interest|awareness|alarm|debate|worr(?:y|ies))\b|\b(?:increasing|growing|rising|mounting|emerging|major|global|serious|great|considerable|pressing)\s+(?:\w+\s+){0,2}?(?:concern|apprehension|attention|interest|awareness|worry)\b|\b(?:concern|interest|attention|awareness)s? (?:\w+ )?(?:is|are|has been|have been) (?:growing|increasing|rising|mounting)\b|\bnumber of (?:published |available |existing |recent )?(?:studies|papers|publications|articles|reports)\b|\b(?:growing|increasing|large|substantial|emerging|expanding) body of (?:evidence|literature|research|work|studies)\b/i;
const PAPER_TALK = /^(?:(?:in this (?:brief |short |present |current )?(?:paper|study|work|article|review|chapter|report|survey)|(?:this|the present|the current|our) (?:\w+ )?(?:paper|study|review|article|chapter|work|report|survey|project|research|analysis|meta-analysis|overview|manuscript|thesis|commentary|perspective) (?:(?:aim|present|review|summari[sz]e|describe|discuss|provide|examine|investigate|explore|focus|propose|report|highlight|address|offer|outline|analy[sz]e|evaluate|assess|shed|attempt|intend|compile|synthesi[sz]e|cover|survey|consider|seek|look|set|draw|bring|identif(?:y|ie)|review)(?:s|es|d|ed)?|sought|was (?:conducted|designed|undertaken|carried out|performed|aimed|intended)|is (?:aimed|intended|designed|devoted|dedicated|focused))|(?:here(?:in)?,? )?we (?:have )?(?:also |then |first |further |briefly |specifically |particularly |mainly |primarily |therefore |thus )?(?:aim|aimed|present|review|reviewed|compiled|collected|gathered|introduce|introduced|summari[sz]e|summari[sz]ed|describe|discuss|provide|examine|investigate|investigated|explore|propose|report|conducted|performed|searched|analy[sz]ed|evaluated|assessed|highlight|outline|sought|focus|focused|concentrate|concentrated|address|addressed|cover|covered|survey|surveyed|synthesi[sz]e|synthesi[sz]ed|delve|delved|offer|draw (?:on|upon|together)|bring together|take stock|set out|begin|start|conclude (?:by|with))|the (?:aim|purpose|objective|goal|argument|focus|scope) of (?:this|the present|our)|our (?:aim|objective|goal) (?:is|was))\b|(?:objectives?|aims?|purpose|background and aims?|methods?|methodology|materials and methods|design|setting|data sources|study selection|search strategy)\s*:|case (?:presentation|report|description|summary)\b|(?:an? )?(?:(?:systematic|scoping|narrative|literature|rapid|umbrella|critical|integrative|brief|mini) )*(?:review|meta-analysis|study|trial|survey) protocol\b|protocol (?:for|of) an? \w+)|\b(?:pubmed|scopus|web of science|embase|medline|google scholar|cochrane library|prisma)\b|\b(?:systematic|literature|database|databases) search(?:es)?\b|\bsearch (?:strategy|terms|yielded|identified)\b|\b(?:inclusion|exclusion|eligibility) criteria\b|\bfull[- ]text (?:papers|articles|studies)\b|\b(?:is|are|were|was|will be) (?:also |then |further |briefly )?(?:discussed|reviewed|summari[sz]ed|presented|outlined|highlighted|addressed)(?:\s+(?:here|below|in (?:this|the) \w+))?[.;]|\bsheds? light on\b|\b(?:the|this) (?:article|post|guide|page|piece|video|episode|chapter|section|paper|essay) (?:then |also |first |next |further |below )?(?:explains?|describes?|discusse?s?|covers?|outlines?|looks at|goes on|walks|breaks down|explores?|reviews?|examines?|introduces?|summari[sz]es?)\b|\bwe (?:then |first |also |next |subsequently |therefore |thus )?(?:induced|measured|assigned|randomi[sz]ed|recruited|administered|enrolled|exposed|treated|fed|dosed|sampled|prepared|incubated|cultured|collected|applied|employed|utili[sz]ed|used|performed|conducted|carried out|tested|quantified|isolated|extracted|sequenced|genotyped|interviewed|surveyed|modell?ed|simulated|trained|implemented|developed|designed|built|constructed|synthesi[sz]ed|fabricated)\b|\b(?:articles|papers|studies|publications|records|reports|trials|reviews|sources) (?:[^.;]{0,420} )?(?:were|was|are) (?:included|excluded|selected|screened|identified|retrieved|eligible|considered eligible)\b|\b(?:is|are|were|was|will be) (?:also |then |further |briefly |all |each |thoroughly |critically |comprehensively |systematically )*(?:discussed|reviewed|summari[sz]ed|presented|outlined|highlighted|addressed|examined|explored|investigated|analy[sz]ed|considered|described|covered|evaluated|assessed) (?:here|below|in (?:this|the|our) (?:\w+ )?(?:essay|paper|review|article|chapter|study|work|report|section|survey|thesis|manuscript))\b|\b(?:this|the|our|the present|the current) (?:\w+ )?(?:study|paper|research|review|article|chapter|analysis|report|survey|thesis|work|investigation|project|essay|dissertation)(?:'s|’s)? (?:(?:explore|examine|investigate|aim|seek|attempt|addresse?|analy[sz]e|evaluate|assesse?|focuse?|review|present|discusse?|describe|consider|look|intend|propose|set|contribute|offer|provide|trie|try|endeavou?r|delve|probe|scrutini[sz]e|unpack|map|trace|compare|draw)(?:s|es|d|ed)?\b(?! that| a (?:significant|positive|negative|strong|clear))|(?:is|was) (?:aimed|intended|designed|conducted|carried out|undertaken|devoted|based on)\b|sought\b|(?:main |primary |principal |overall )?(?:aim|purpose|objective|goal)s?\b)|^(?:research|study|main|primary|specific)? ?(?:aims?|objectives?|purpose|goals?|questions?|hypothes[ei]s|design|approach|methodology|originality|implications|limitations|keywords|value|contribution)(?:\/\w+)?\s*:|\bwe (?:firstly|first|then|also|further|subsequently|next|additionally|finally|secondly) (?:examined?|investigated?|explored?|analy[sz]ed?|assess(?:ed)?|evaluated?|test(?:ed)?|studied|study|look(?:ed)?|consider(?:ed)?|compared?|discuss(?:ed)?)\b|\((?:RQ|H)\d\)|\bresearch questions?\b|\b(?:reviews?|meta-analys[ei]s|surveys?|papers?|articles?|reports?) (?:have |has |had )?(?:recently )?(?:synthesi[sz]ed|evaluated|examined|assessed|summari[sz]ed|compiled|collated|explored|addressed|analy[sz]ed|appraised|covered) (?:the |available |existing |current |recent )*(?:evidence|literature|data|research|studies|knowledge|findings)\b|\bthe (?:flow ?chart|figure|table|diagram|graph|chart|schematic|infographic|conceptual (?:model|framework)) (?:\w+ ){0,5}?(?:traces|illustrates|depicts|summari[sz]es|shows|presents|outlines|maps)\b|\b(?:we|authors) (?:searched|screened|included|excluded|recruited|enrolled|surveyed|interviewed|reviewed the literature|provide an? (?:overview|summary|synopsis)|present an? (?:overview|summary|review))\b|\b(?:questionnaire|subscales?|likert|cronbach)\b|\bthe scale (?:comprises|includes|consists)\b|\b(?:can be found|is given|are given|as shown|see) in (?:chapter|section|table|figure|appendix)\b|\bsection \d+\.\d+\b|\b(?:study|trial|experiment|analysis|survey|review|investigation|meta-analysis|assessment|evaluation) (?:was|were|is|has been) (?:conducted|performed|carried out|undertaken|designed|done)\b|\b(?:articles?|papers?|studies|publications?|records?|reports?)\b[^.;]{0,220}\b(?:were|was) (?:included|excluded|selected|identified|retrieved|screened|eligible)\b|\b(?:focus|emphasis|attention) (?:is|was|will be) (?:directed|placed|given|paid|put)\b|\b(?:the |our |a )?proposed (?:methodology|method|approach|framework|model|strategy|scheme)\b|\b(?:is|are|was|were) (?:also |finally |then )?proposed\b|\bin chapter (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b|\b(?:each|every|the (?:first|second|third|fourth|fifth|last|final|next|following)) chapter\b|\bsubdivisions? are\b|\b(?:views?|chapters?|essays?|sections?|perspectives?) (?:are|is) presented\b|\bthis (?:book|volume|anthology|collection|thesis|dissertation|essay) (?:\w+ )?(?:argues|presents|examines|explores|offers|traces|provides|covers|describes|contains|collects|brings)\b/i;
// "Although the adverse effects of X are well documented, the legal system does not address X": what the question asks about stands
// in the concession, and the sentence itself states something else. Group 1 is the clause after the concession. A clause that goes on
// with "they / these / it …" still speaks about the same thing and is left alone.
const CONCESSION = /^(?:although|even though|though|while|whilst|whereas|despite|in spite of|notwithstanding)\b[^,;]{10,240},\s+(?!(?:they|it|these|those|this|such|some|many|most|several|its|their|both|there)\b)(.{20,})$/i;
// "Given …, we sought to understand how …", "we hypothesised that …": what a study set out to do, wherever it stands in the sentence
const AIM_TALK = /\bwe (?:therefore |thus |then |also |further |first |next |here )?(?:sought|aimed|set out|wanted|wished|intended|attempted|hypothesi[sz]ed?|aim|seek|intend|attempt) (?:to|that)\b/i;
// "If the FDA determines … that X harms health, the FDA can take regulatory action": what an authority may do, not a finding (capitals matter)
const AUTHORITY_IF = /^(?:If|Should|Once|When|Where) (?:the |an? )?(?:[A-Z][\w&.-]*\s){1,4}(?:determines?|finds?|concludes?|decides?|establish(?:es)?|confirms?|rules?)\b[^.]{0,80}?\b(?:that|whether)\b/;
// A statement that something is not known yet. Worth reporting once, in its own place — not an answer to "what are the effects of …".
const GAP = /\b(?:more|further|additional|future|much more) (?:research|studies|study|investigations?|work|evidence|data|trials) (?:is|are|will be|would be|remains?) (?:still )?(?:needed|required|necessary|warranted|essential)\b|\b(?:further|more|additional) (?:research|studies|investigation) (?:should|must|needs? to|is needed to|are needed to)\b|\bfuture (?:research|studies|work) (?:should|must|needs? to|will need to|on)\b|\blittle is (?:currently |yet )?known\b|\bpoorly understood\b|\bnot (?:yet |currently |fully |well |completely |clearly ){1,2}(?:understood|known|established|clear|elucidated|characteri[sz]ed)\b|\bremains? (?:largely |still |poorly |relatively )?(?:unclear|unknown|uncertain|limited|scarce|elusive|unexplored|to be (?:seen|determined|established|elucidated))\b|\b(?:is|are) still (?:unclear|unknown|limited|scarce|lacking|in (?:its|their) infancy|under investigation|being (?:studied|investigated)|little done)\b|\bin (?:its|their) (?:infancy|early stages?)\b|\bis just beginning\b|\b(?:subject|matter|topic|area) of ongoing (?:study|research|investigation|debate)\b|\black of (?:knowledge|data|evidence|information|studies|research)\b|\bknowledge (?:gaps?|deficienc(?:y|ies)|deficits?|shortfalls?|lacunae)\b|\bgaps? in (?:our |the |current |scientific )*(?:knowledge|understanding|evidence|literature)\b|\b(?:data|evidence|studies|information|research) (?:on [^.]{3,80} )?(?:is|are|remains?) (?:still |very |relatively |currently |largely |entirely |almost |completely )*(?:scarce|limited|lacking|sparse|inconclusive|insufficient|absent|missing|unavailable|not available|non-?existent)\b|\b(?:no|insufficient|limited|little) (?:clear |conclusive |direct |definitive |robust )?(?:evidence|data|information)\b|\bwe (?:do not|don't|still do not) (?:yet |currently |really )?know\b|\bnot known whether\b|\byet to be (?:determined|established|understood|studied)\b|\b(?:unclear|unknown|uncertain) (?:whether|if|how|what)\b|\bstill under investigation\b|\bresearch is ongoing\b|\bneeds? (?:to be )?(?:further )?(?:studied|investigated|research|study|investigation)\b|\b(?:has|have|had)(?: not|n[’']t) (?:yet )?been (?:as |well |fully |extensively |thoroughly |widely |systematically |adequately |sufficiently )*(?:studied|investigated|examined|established|explored|characteri[sz]ed|evaluated|assessed|determined|tested)\b|\b(?:is|are) (?:still |currently )?being (?:studied|investigated|tested|evaluated|researched)\b/i;
const INQUIRY_NOUN = 'awareness|knowledge|perceptions?|attitudes?|concerns?|understanding|education|literacy|questions?|debates?|discussions?|research|studies|study|investigations?|assessments?|evaluations?|reviews?|overview|summary|synopsis|insights?|literature|attention|interest|uncertaint(?:y|ies)|curriculum|guidance|consensus';
const INQUIRY_LINK = 'of|on|about|over|into|regarding|concerning|towards?|around|surrounding|as to|how|whether|what|if';
const INQUIRY_VERB = 'evaluat(?:e|es|ed|ing)|assess(?:es|ed|ing)?|investigat(?:e|es|ed|ing)|examin(?:e|es|ed|ing)|explor(?:e|es|ed|ing)|determin(?:e|es|ed|ing)|understand(?:ing)?|describ(?:e|es|ed|ing)|discuss(?:es|ed|ing)?|address(?:es|ed|ing)?|characteri[sz](?:e|es|ed|ing)|quantif(?:y|ies|ied|ying)|clarif(?:y|ies|ied|ying)|elucidat(?:e|es|ed|ing)|studying|analy[sz](?:e|es|ed|ing)|summari[sz](?:e|es|ed|ing)|introduc(?:e|es|ed|ing)|monitor(?:s|ed|ing)?';
// A sentence cut off by the page's markup ("… harmful to humans and.")
const BROKEN_END = /(?:\b(?:and|or|to|of|the|a|an|in|on|for|with|by|from|as|at|than|that|which|including|is|are|was|were|their|its)|,)\s*[.!?]$/i;
// "X includes a, b and c", "such as …": a sentence that names instances
const ENUMERATES = /\b(?:includ(?:e|es|ed|ing)|such as|e\.g\.|for example|ranging from|namely|consists? of|comprises?)\b|(?:[^,;]{3,40},){2,}\s*(?:and|or)\s/i;
const ALSO_RE = /^(?:[\w'’()-]+ ){1,5}(?:is|are|was|were|can|may|has|have|will) also\b/i;
const OPINION = /\b(i think|i believe|i feel|in my opinion|imo|imho|personally|i would|i'd say|arguably|seems? to me|my favou?rite|i love|i hate|we believe|in our view|should(?:n't)? be|must be|best|worst|terrible|awesome|amazing|overrated|underrated)\b/i;
const HEDGE = /\b(may|might|could|possibly|perhaps|reportedly|allegedly|is said to|rumou?red|unconfirmed|claims?|claimed|according to|suggests?|appears? to|is thought to|is believed to|estimated|likely|probably)\b/i;

export const stemsOf = (text) => stemTerms(text);

/** Remove reference markers and pronunciation clutter so that extracted sentences read cleanly. */
export function cleanSentence(s) {
  return squash(String(s)
    .replace(/\[(?:\d{1,3}|citation needed|note \d+|[a-z]|edit|update|when\?|who\?|clarification needed|better source needed)\]/gi, '')
    .replace(/\s*\((?:[^()]*?(?:\/[^()\/]{2,}\/|ⓘ|listen|pronounced|pronunciation|IPA)[^()]*?)\)/g, (m) => { const keep = m.replace(/^[\s(]+|\)$/g, '').split(/;\s*/).filter((p) => !/\/[^\/]{2,}\/|ⓘ|listen|pronounced|pronunciation|IPA/.test(p)).join('; '); return keep ? ` (${keep})` : ''; })
    .replace(/\s*\((?:\d{1,3}\s*[,–-]\s*)+\d{1,3}\)/g, '').replace(/^\(\d{1,3}\)\s+(?=\p{Lu})/u, '').replace(/\s*\[\s*[,;–-]*\s*\]/g, '')       // "(27,28)", "[,,]": what is left of numbered citations
    .replace(/\s+([,.;:!?])/g, '$1').replace(/\(\s*[;,]\s*/g, '(').replace(/\(\s*\)/g, ''));
}

/** Turn an extracted document into rankable passages (one per content block) with their sentences. */
// "Results: X was …", "Abstract With most of …", "• Inhaled particles …": the label or bullet in front is not part of the statement
const LABEL = /^(?:[•·▪◦*–—-]\s+)?(?:(?:abstract|summary|background|introduction|conclusions?|results?|findings|discussion|significance|importance|context|rationale|interpretation|implications?|key (?:points?|findings|messages?)|highlights?|main (?:results|findings)|take-?home message)\s*[:—–]\s*(?=\S)|abstract\s+(?=[A-Z]))?/i;
const stripLabel = (t) => { const m = LABEL.exec(t); return m && m[0] ? t.slice(m[0].length) : t; };

export function docPassages(doc, di) {
  const out = [];
  let order = 0;
  for (const b of doc.blocks || []) {
    let text = '', sentences = [];
    if (b.type === 'p') { text = cleanSentence(b.text); sentences = splitSentences(text).map(stripLabel).filter((s) => s.length >= 25 && s.length <= 520); }
    else if (b.type === 'list') {
      // an item that is a paragraph of its own ("While many studies … is increasing. This review aimed to …") is read sentence by sentence
      sentences = b.items.flatMap((i) => { const t = cleanSentence(i.text); if (t.length < 220) return [t]; const parts = splitSentences(t); return parts.length > 1 && parts.every((x) => x.length >= 25) ? parts : [t]; }).filter((s) => s.length >= 3 && s.length <= 520);
      text = sentences.join('\n');
    }
    else if (b.type === 'table') {
      const hdr = b.header || [];
      sentences = (b.rows || []).slice(0, 60).map((r) => r.map((c, j) => (hdr[j] && r.length > 1 && j > 0 ? `${hdr[j]}: ${c}` : c)).filter(Boolean).join(r.length === 2 && !hdr.length ? ': ' : '; ')).map(cleanSentence).filter((s) => s.length >= 3 && s.length <= 400);
      text = (b.caption ? b.caption + '\n' : '') + sentences.join('\n');
    } else if (b.type === 'code') { text = b.text; }
    else continue;
    if (!text || (b.type === 'p' && text.length < 25)) continue;
    // a page kept as a digest (only its relevant blocks) records where each block stood in the full page
    out.push({ di, order: b.pos != null ? b.pos : order++, type: b.type, heading: b.heading || '', block: b, text, sentences, score: 0 });
  }
  return out;
}

// The passages of a document do not depend on the question, and during research the same documents are ranked many
// times (once per part, per round and per sub-topic). They are computed once per block list and reused; each ranking
// works on shallow copies, so scores of one ranking never leak into another.
const PASSAGE_CACHE = new WeakMap();
function basePassages(doc) {
  const blocks = doc.blocks;
  if (!Array.isArray(blocks)) return [];
  let hit = PASSAGE_CACHE.get(blocks);
  if (!hit || hit.n !== blocks.length) {
    const list = docPassages(doc, 0);
    for (const p of list) { p.stems = stemsOf(p.text); p.stemSet = new Set(p.stems); p.headSet = new Set(stemsOf(p.heading)); p.sent = new Array(p.sentences.length); }
    hit = { n: blocks.length, list };
    PASSAGE_CACHE.set(blocks, hit);
  }
  return hit.list;
}
/** Query-independent facts about one sentence (computed once, shared between rankings; never mutated). */
function sentenceStems(p, si) {
  let x = p.sent[si];
  if (!x) { const st = stemsOf(p.sentences[si]); x = { st, set: new Set(st), full: false }; p.sent[si] = x; }
  return x;
}
function sentenceInfo(p, si) {
  const x = sentenceStems(p, si);
  if (x.full) return x;
  const text = p.sentences[si];
  let nameOnly = null;
  if (/\s\p{Lu}/u.test(text)) {                       // words used only inside a capitalised name/title ("The Stars Shine Down")
    const lowerUse = new Set(), capUse = new Set();
    let first = true;
    for (const m of text.matchAll(/[\p{L}][\p{L}\p{N}'’-]*/gu)) { const w = m[0]; (first || !/^\p{Lu}/u.test(w) ? lowerUse : capUse).add(stem(w.toLowerCase())); first = false; }
    nameOnly = new Set([...capUse].filter((y) => !lowerUse.has(y)));
  }
  const words = text.split(/\s+/).length;
  let pen = 1, mult = 1;
  if (p.type === 'p') pen = words < 6 ? 0.45 : words < 9 ? 0.8 : words > 60 ? 0.7 : words > 45 ? 0.88 : 1;
  // a paragraph "sentence" with no end punctuation is a headline, caption or teaser rather than a statement
  if (p.type === 'p' && words < 14 && !/[.!?…"”’')\]]$/.test(text)) pen *= 0.55;
  // "Remote Work Attrition and Retention Statistics 2026 - turnover rates, RTO impact, and retention strategies": a page title
  // or headline in Title Case without a closing full stop, whatever its length
  if (!/[.!?…"”’')\]]$/.test(text) && words >= 5) {
    const ws = text.split(/\s+/).filter((w) => /^\p{L}{4,}/u.test(w));
    if (ws.length >= 4 && ws.filter((w) => /^\p{Lu}/u.test(w)).length / ws.length >= 0.6) pen *= 0.3;
  }
  // "map method, new array creation, callback function, …" is a tag line for search engines, not a statement
  if (p.type === 'p' && isKeywordRun(text)) pen *= 0.15;
  // "(Note: This article describes ..." is about the page, not about the subject
  if (isAside(text)) pen *= 0.2;
  const dangling = p.type === 'p' && (DANGLING.test(text) || ALSO_RE.test(text) || REFER_RE.test(text));
  if (dangling) mult *= si === 0 ? 0.9 : 0.72;
  if (/\?\s*$/.test(text)) mult *= 0.3;
  if (JUNK.test(text)) mult *= 0.2;
  const proc = PAPER_TALK.test(text) || BOOLEAN_QUERY.test(text) || AIM_TALK.test(text) || AUTHORITY_IF.test(text);
  if (proc) mult *= 0.35;                              // "In this review we summarise …" describes a paper, not the world
  if (p.type === 'p' && BROKEN_END.test(text)) mult *= 0.25;
  if (!/[a-z]{3,}/i.test(text)) mult *= 0.3;
  if (/\\displaystyle|\\[a-z]+\{|[a-z]{3,}[A-Z]:?=|[⟩⟨∑∫]|\^\{|_\{|[a-z]{4,}[A-Z]\b/.test(text)) mult *= 0.3;      // formula residue from markup
  Object.assign(x, { full: true, nameOnly, words, pen, mult, dangling, opinion: OPINION.test(text), hedged: HEDGE.test(text), proc, gap: GAP.test(text), lists: ENUMERATES.test(text), intro: ATTENTION.test(text) });
  return x;
}

const CREATIVE_TITLE = /\((?:[^()]*\s)?(?:film|movie|album|song|single|novel|novella|short story|board game|video game|game|tv series|television series|miniseries|series|episode|play|musical|opera|poem|painting|comics?|manga|anime|soundtrack|band|ep|documentary|podcast|franchise)\)\s*(?:[-–—|]\s*wikipedia)?\s*$/i;
const CREATIVE_WORD = /\b(?:film|movie|album|song|novel|game|series|episode|play|musical|opera|poem|painting|comic|manga|anime|soundtrack|band|documentary|podcast|show|book|character|plot|cast|director|starring)\b/i;
const CAUSAL_STEM = /^(?:caus|reason|becaus|due|result|lead|led|trigger|origin|factor|explain|explan|whi)$/;
const IRREGULAR_PAST = [['fall', 'fell'], ['rise', 'rose'], ['ris', 'rose'], ['begin', 'began'], ['lose', 'lost'], ['los', 'lost'], ['win', 'won'], ['break', 'broke'], ['sink', 'sank|sunk'], ['grow', 'grew'], ['leav', 'left'], ['becom', 'became'], ['go', 'went'], ['die', 'died|dying|death|dead'], ['fail', 'failure']];
const CAUSE_BACK = 'because(?: of)?|due (?:\\w+ )?to|owing to|as a (?:result|consequence) of|a (?:result|consequence) of|result(?:s|ed)? from|caused (?:\\w+ )?by|brought about by|attributed to|blamed on|stem(?:s|med)? from|arose from|arises? from|thanks to|on account of|driven by|triggered by';
// "The causes of the fall of X have long been debated", "the first to attempt an explanation of the causes": about the question, not an answer to it
const META_REASON = /\b(?:explanations?|theor(?:y|ies)|accounts?|interpretations?|analys[ei]s|stud(?:y|ies)|debates?|questions?|historiography|discussions?|views?)\s+(?:of|about|on|over|for|as to)\s+(?:the\s+)?(?:\w+\s+){0,2}?(?:causes?|reasons?|why)\b|\b(?:causes?|reasons?)\s+(?:and \w+\s+)?(?:of|for|behind)\b[^.;]{0,110}?\b(?:are|is|was|were|remain|remains|have(?: long)? been|has(?: long)? been)\s+(?:\w+\s+){0,3}?(?:debated|discussed|disputed|studied|an? (?:\w+ )?(?:theme|topic|subject|question|matter)|controversial|unclear|contested|examined|explored|analy[sz]ed)\b|\b(?:leads?|led|leading) to an? (?:\w+ )?(?:explanation|understanding|account|discussion|analysis|reassessment|re-?examination)\b|\b(?:why|reasons? (?:why|for)|causes? of)\b[^.;]{0,80}\b(?:is|are|remains?) (?:\w+ )?(?:debated|disputed|unclear|unknown|controversial|contested)\b/i;
const CAUSE_FWD = 'led to|leads? to|leading to|caus(?:e|es|ed|ing)(?!\\s+(?:of|for)\\b)|contribut(?:e|es|ed|ing) to|result(?:s|ed|ing)? in|brought about|bring(?:s|ing)? about|hasten(?:s|ed|ing)?|trigger(?:s|ed|ing)?|precipitat(?:e|es|ed|ing)|accelerat(?:e|es|ed|ing)|responsible for|play(?:s|ed)? (?:a|an|the) (?:\\w+ )?(?:role|part) in|which is why|that is why|this is why|is why|explains? why|reasons? why';

// "What are the effects / causes / benefits / risks / symptoms / uses of X?" asks for a relation. A sentence may state
// it without the noun itself ("X causes inflammation" names an effect): these wordings count as the aspect being present.
const RELATION_CUES = [
  [/^(?:effect|impact|consequ|influenc|outcom|implic|affect)/, /\b(?:caus(?:e|es|ed|ing)|leads? to|led to|leading to|results? in|resulted in|resulting in|induc(?:e|es|ed|ing)|trigger(?:s|ed|ing)?|associated with|linked (?:to|with)|contribut(?:e|es|ed|ing) to|increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|reduc(?:e|es|ed|ing)|damag(?:e|es|ed|ing)|disrupt(?:s|ed|ing)?|impair(?:s|ed|ing)?|affect(?:s|ed|ing)?|harm(?:s|ed|ing)?|exacerbat(?:e|es|ed|ing)|promot(?:e|es|ed|ing)|alter(?:s|ed|ing)?|inhibit(?:s|ed|ing)?|improv(?:e|es|ed|ing)|worsen(?:s|ed|ing)?|accelerat(?:e|es|ed|ing)|weaken(?:s|ed|ing)?|toxic(?:ity)?)\b/i],
  [/^(?:caus|reason|origin|factor|driver|trigger|sourc)/, /\b(?:caused by|due to|because of|results? from|resulted from|arises? from|arose from|stems? from|stemmed from|attributed to|driven by|triggered by|brought about by|responsible for|leads? to|led to|owing to|as a result of|contribut(?:e|es|ed|ing) to|comes? from|originat(?:e|es|ed|ing))\b/i],
  [/^(?:benefit|advantag|upsid|strength|pro$)/, /\b(?:improv(?:e|es|ed|ing)|reduc(?:e|es|ed|ing)|lower(?:s|ed|ing)?|help(?:s|ed|ing)?|protect(?:s|ed|ing)?|prevent(?:s|ed|ing)?|boost(?:s|ed|ing)?|enhanc(?:e|es|ed|ing)|support(?:s|ed|ing)?|effective|allows?|enabl(?:e|es|ed|ing)|sav(?:e|es|ed|ing)|faster|cheaper|easier|safer|increas(?:e|es|ed|ing))\b/i],
  [/^(?:risk|danger|hazard|harm|threat|disadvantag|downsid|drawback|complic|problem|issu|limit|challeng|concern|weak|con$)/, /\b(?:danger(?:ous)?|hazard(?:ous)?|harm(?:s|ful|ed)?|threat(?:en|ens|ened)?|increas(?:e|es|ed|ing) the (?:risk|likelihood|chance)|adverse|side effects?|complications?|toxic(?:ity)?|unsafe|linked to|associated with|caus(?:e|es|ed|ing)|damag(?:e|es|ed|ing)|difficult|costly|expensive|fails?|failure|lacks?|suffers? from|vulnerab\w+|prone to|requires?)\b/i],
  [/^(?:symptom|sign$)/, /\b(?:includ(?:e|es|ing)|experienc(?:e|es|ed|ing)|presents? with|characteri[sz]ed by|pain|fever|fatigue|nausea|vomiting|headaches?|swelling|rash|cough|shortness of breath|dizziness|weakness|loss of)\b/i],
  [/^(?:us$|use|applic|purpos|role)/, /\b(?:used (?:to|for|in|as)|is used|are used|uses|applications?|appli(?:ed|es)|employ(?:s|ed)?|serves? (?:as|to)|utili[sz]ed?|allows?|enabl(?:e|es|ed|ing))\b/i],
  [/^(?:treat|therap|cure|remed|solut|prevent|intervent|mitig|manag)/, /\b(?:treat(?:s|ed|ing|ment)?|therap(?:y|ies)|cur(?:e|es|ed)|prescrib(?:e|ed)|medications?|drugs?|surgery|prevent(?:s|ed|ing|ion)?|reduc(?:e|es|ed|ing)|manag(?:e|es|ed|ing)|reliev(?:e|es|ed|ing)|recommend(?:s|ed)?|avoid(?:s|ed|ing)?|mitigat(?:e|es|ed|ing|ion))\b/i],
];
export function relationCue(attribute) {
  const stems = stemsOf(attribute || '');
  for (const [re, cue] of RELATION_CUES) if (stems.some((st) => re.test(st))) return cue;
  return null;
}

/** The words of an asked aspect that name the relation itself ("effects" in "health effects"). */
export function relationStems(attribute) { return new Set(stemsOf(attribute || '').filter((st) => RELATION_CUES.some(([re]) => re.test(st)))); }

/** Build the weighted query model for one part of the question. */
export function queryModel(part, extra = []) {
  const terms = new Map();
  for (const t of part.terms) terms.set(t.stem, { w: t.weight, core: t.weight >= 0.5, word: t.word, kind: t.kind });
  for (const t of part.expansions || []) if (!terms.has(t.stem)) terms.set(t.stem, { w: t.weight, core: false, word: t.word, of: t.of });
  for (const t of extra) if (!terms.has(t.stem)) terms.set(t.stem, { w: t.weight, core: false, word: t.word, learned: true });
  const focus = new Set(stemsOf(part.focus || ''));
  const properStems = new Set(part.entities.filter((e) => e.proper).flatMap((e) => stemsOf(e.text)));
  // the aspect asked about ("security risks of …", "capital of …") must be present, as the word itself or a listed synonym
  const required = new Set();
  if (part.attribute && ['list', 'attribute', 'person', 'place', 'time', 'quantity', 'entity'].includes(part.answerType)) {
    for (const st of stemsOf(part.attribute)) { required.add(st); for (const [k, t] of terms) if (t.of && stemsOf(t.of)[0] === st) required.add(k); }
  }
  // each ordinal/superlative of the question must be present too (as itself or a listed synonym)
  const requiredAll = (part.constraints || []).map((c) => { const st = stemsOf(c)[0] || c; const alts = new Set([st]); for (const [k, t] of terms) if (t.of && stemsOf(t.of)[0] === st) alts.add(k); return alts; });
  const relCue = required.size ? relationCue(part.attribute) : null;
  const relStems = relCue ? relationStems(part.attribute) : new Set();
  return { terms, focus, properStems, required, requiredAll, relCue, relStems, answerType: part.answerType, part };
}

/**
 * Rank all sentences of the retrieved documents against the query model.
 * Returns {passages, sentences (best first), idf, df, N}.
 */
export function rankEvidence(docs, qm, { now = Date.now(), fresh = null } = {}) {
  const passages = [];
  docs.forEach((d, di) => { for (const p of basePassages(d)) passages.push({ ...p, di, score: 0 }); });
  const N = Math.max(1, passages.length);
  const df = new Map();
  for (const p of passages) for (const s of p.stemSet) df.set(s, (df.get(s) || 0) + 1);
  const rawIdf = (s) => Math.log(1 + (N - (df.get(s) || 0) + 0.5) / ((df.get(s) || 0) + 0.5));
  let maxIdf = 0;
  for (const s of qm.terms.keys()) maxIdf = Math.max(maxIdf, rawIdf(s));
  const idf = (s) => Math.max(rawIdf(s), 0.22 * (maxIdf || 1));
  let coreTotal = 0;
  for (const [s, t] of qm.terms) if (t.core) coreTotal += t.w * idf(s);
  coreTotal = coreTotal || 1;
  const avgLen = passages.reduce((a, p) => a + p.stems.length, 0) / N || 1;
  const titleSets = docs.map((d) => new Set(stemsOf(d.title || '')));
  const type = qm.part.fn ? 'function' : qm.answerType === 'attribute' || qm.answerType === 'entity' || qm.answerType === 'description' || qm.answerType === 'news' || qm.answerType === 'yesno' ? null
    : qm.answerType === 'person' ? 'person' : qm.answerType;
  const cue = type && CUES[type];
  const boost = type ? TYPE_BOOST[type] || 0.2 : 0;
  const focusArr = [...qm.focus];
  const askedCreative = CREATIVE_WORD.test(qm.part.text || '');
  const defLike = qm.answerType === 'definition' || !!qm.part.explain;
  const coreStems = [...qm.terms].filter(([, t]) => t.core).map(([s]) => s);
  const coreSet = new Set(coreStems);
  // predicate terms: what is asked *about* the focus (verb, attribute, other content words) and their listed synonyms
  const predTerms = [...qm.terms].filter(([s, t]) => t.core && !qm.focus.has(s));
  const predTotal = predTerms.reduce((a, [, t]) => a + t.w, 0);
  const synOf = new Map();
  for (const [s, t] of qm.terms) if (t.of) { const base = stemsOf(t.of)[0]; if (base) { if (!synOf.has(base)) synOf.set(base, []); synOf.get(base).push(s); } }
  // "Concerns about the health effects of X are growing", "… to understand the impact of X": such a sentence is about
  // the study of what was asked, and says nothing about it. Recognised by an inquiry word that governs the asked aspect.
  // For "why did X fall?": a sentence in which the event only dates something else ("after the fall of X, …") explains nothing about it.
  let anchorRe = null;
  if ((qm.answerType === 'reason' || qm.answerType === 'mechanism') && predTerms.length) {
    const ev = predTerms.map(([st]) => st).filter((st) => /^[a-z]{3,}$/.test(st)).map((st) => `${st}\\w*`).join('|');
    if (ev) anchorRe = new RegExp(`\\b(?:after|since|following|before|until|during|by the time of|in the wake of|prior to|from)\\s+(?:the\\s+|its\\s+|their\\s+)?(?:\\w+\\s+){0,2}?(?:${ev})\\b`, 'i');
  }
  // For a why-question the causal wording must govern what was asked about: "X fell because …", "… led to the fall of X".
  // "Latin flourished after the decline of X because it became …" has both the event and a "because", yet explains something else.
  let governRe = null, maskForeign = (t) => t;
  if (qm.answerType === 'reason') {
    const alpha = (st) => /^[a-z]{3,}$/.test(st) && !CAUSAL_STEM.test(st);
    let ev = [...new Set([...predTerms.map(([st]) => st), ...[...qm.terms].filter(([, t]) => t.of && !CAUSAL_STEM.test(stemsOf(t.of)[0] || '')).map(([st]) => st)])].filter(alpha);
    if (!ev.length && focusArr.length) ev = [focusArr[focusArr.length - 1]].filter(alpha);       // "what caused the 2008 financial crisis?": the event is the topic itself
    if (ev.length) {
      const forms = ev.map((st) => `${st}\\w*`);
      for (const [base, past] of IRREGULAR_PAST) if (ev.includes(base)) forms.push(past);
      const EV = `(?:${forms.join('|')})`;
      // "the fall of Troy", "the fall of Constantinople": the same word, but another event
      const focusHeads = focusArr.map((f) => f.slice(0, 3));
      const foreign = new RegExp(`\\b${EV}(\\s+of\\s+(?:[\\w'’-]+\\s+){0,3}[\\w'’-]+)`, 'gi');
      maskForeign = (text) => (focusHeads.length ? text.replace(foreign, (m, tail) => (/\b(?:its?|their|this|that|these|those)\b/i.test(tail) || stemsOf(tail).some((w) => focusHeads.some((h) => w.startsWith(h))) ? m : `EVENTX${tail}`)) : text);
      governRe = new RegExp([
        `\\b${EV}\\b(?:\\W+\\w+){0,9}?\\W+(?:${CAUSE_BACK})\\b`,
        `\\b(?:${CAUSE_FWD})\\b(?:\\W+\\w+){0,7}?\\W+${EV}\\b`,
        `\\b(?:causes?|reasons?|factors?|explanations?)\\W+(?:of|for|in|behind)\\W+(?:\\w+\\W+){0,6}?${EV}\\b(?:\\W+\\w+){0,8}?\\W+(?:was|were|is|are|include[sd]?|lay|lies?)\\b`,
        `\\b(?:was|were|is|are|as|been|be)\\W+(?:\\w+\\W+){0,6}?(?:causes?|reasons?|factors?)\\W+(?:of|for|in|behind)\\W+(?:\\w+\\W+){0,5}?${EV}\\b`,
        // "sees the causes of the collapse … in endless civil wars", "attributes the fall to …", "blamed the decline on …"
        `\\b(?:sees?|saw|finds?|found|locat(?:e|es|ed)|identif(?:y|ies|ied)|plac(?:e|es|ed)|trac(?:e|es|ed))\\W+(?:\\w+\\W+){0,3}?(?:causes?|reasons?|roots?|origins?)\\W+(?:of|for)\\W+(?:\\w+\\W+){0,5}?${EV}\\b[^.;]{0,90}?\\b(?:in|to|as|with)\\b`,
        `\\b(?:attribut(?:e|es|ed|ing)|ascrib(?:e|es|ed|ing)|trac(?:e|es|ed|ing)|blam(?:e|es|ed|ing)|link(?:s|ed|ing)?|t(?:ie|ies|ied))\\W+(?:\\w+\\W+){0,5}?${EV}\\b(?:\\W+\\w+){0,6}?\\W+(?:to|on|with)\\b`,
      ].join('|'), 'i');
    }
  }
  let aboutRe = null;
  if (predTerms.length && ['attribute', 'list', 'reason', 'mechanism', 'yesno', 'description', 'entity'].includes(qm.answerType)) {
    const alt = [...new Set([...predTerms.map(([st]) => st), ...[...qm.terms].filter(([, t]) => t.of).map(([st]) => st)])].filter((st) => /^[a-z]{3,}$/.test(st)).map((st) => `${st}\\w*`).join('|');
    if (alt) aboutRe = new RegExp(`\\b(?:${INQUIRY_NOUN})\\s+(?:${INQUIRY_LINK})\\b(?:\\W+\\w+){0,7}?\\W+(?:${alt})|\\b(?:${INQUIRY_VERB})\\b(?:\\W+\\w+){0,6}?\\W+(?:${alt})`, 'i');
  }

  // passage scores (BM25 with heading field)
  let maxP = 0;
  for (const p of passages) {
    const tf = new Map();
    for (const s of p.stems) if (qm.terms.has(s)) tf.set(s, (tf.get(s) || 0) + 1);
    let sc = 0;
    for (const [s, t] of qm.terms) {
      const f = tf.get(s) || 0;
      if (f) sc += t.w * idf(s) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * p.stems.length / avgLen));
      if (p.headSet.has(s)) sc += t.w * idf(s) * 0.6;
    }
    p.score = sc;
    if (sc > maxP) maxP = sc;
  }
  maxP = maxP || 1;

  const sentences = [];
  for (let pi = 0; pi < passages.length; pi++) {
    const p = passages[pi];
    const doc = docs[p.di];
    // topical prior: is this document about the thing asked about, or merely a neighbour that mentions it?
    const titleSet0 = titleSets[p.di];
    const allIn = focusArr.length > 0 && focusArr.every((f) => titleSet0.has(f));
    const topical = !focusArr.length ? 1 : doc.entity ? 1.15 : doc.kind === 'encyclopedia' ? (allIn && titleSet0.size === focusArr.length ? 1.1 : allIn ? (defLike ? 0.72 : 0.9) : (defLike ? 0.66 : 0.85)) : allIn ? 1.05 : 0.92;
    // "The Fall of the Roman Empire (film)": a page about a film, game or song of that name, when none was asked about
    const creative = !askedCreative && CREATIVE_TITLE.test(doc.title || '') ? 0.4 : 1;
    const prior = (0.75 + 0.5 * (doc.quality == null ? 0.5 : doc.quality)) * topical * creative;
    const titleSet = titleSets[p.di];
    const ctxNorm = p.score / maxP;
    let recency = 1;
    if (fresh && doc.published) { const age = (now - Date.parse(doc.published)) / 86400000; if (Number.isFinite(age)) recency = age <= 2 ? 1.25 : age <= 8 ? 1.1 : age <= 40 ? 1 : 0.8; }
    for (let si = 0; si < p.sentences.length; si++) {
      const text = p.sentences[si];
      const base = sentenceStems(p, si);
      const st = base.st;
      if (st.length < 2 && p.type === 'p') continue;
      const set = base.set;
      let any = false;
      for (const s of qm.terms.keys()) if (set.has(s) || p.headSet.has(s) || titleSet.has(s)) { any = true; break; }
      if (!any) continue;                                    // nothing of the question in the sentence, its section or its page title
      const info = sentenceInfo(p, si);
      const nameOnly = info.nameOnly;
      let num = 0, direct = 0;
      // "X causes inflammation" states an effect of X without the word "effect"
      const relHit = !!qm.relCue && focusArr.length > 0 && focusArr.every((f) => set.has(f)) && qm.relCue.test(text);
      for (const [s, t] of qm.terms) {
        let w = t.w * idf(s);
        if (set.has(s) && nameOnly && nameOnly.has(s) && t.kind !== 'proper' && !qm.properStems.has(s)) w *= 0.3;
        if (set.has(s)) { num += w; if (t.core) direct += w; }
        else if (relHit && qm.relStems.has(s)) { num += 0.75 * w; direct += 0.75 * w; }
        else if (t.core && (p.headSet.has(s) || titleSet.has(s))) num += 0.5 * w;          // implicit subject / section topic
      }
      if (num <= 0) continue;
      let prox = 1;
      if (coreStems.length >= 2) {
        const pos = [];
        let idx = 0;
        for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) { const k = stem(m[0].toLowerCase()); if (coreSet.has(k)) pos.push([idx, k]); idx++; }
        const kinds = new Set(pos.map((x) => x[1]));
        if (kinds.size >= 2) {
          let best = Infinity; const cnt = new Map(); let have = 0, l = 0;
          for (let r = 0; r < pos.length; r++) {
            cnt.set(pos[r][1], (cnt.get(pos[r][1]) || 0) + 1); if (cnt.get(pos[r][1]) === 1) have++;
            while (have === kinds.size) { best = Math.min(best, pos[r][0] - pos[l][0] + 1); const k = pos[l][1]; cnt.set(k, cnt.get(k) - 1); if (!cnt.get(k)) have--; l++; }
          }
          prox = 0.78 + 0.44 * Math.min(1, kinds.size / best);
        }
      }
      let cov = Math.min(1.2, num / coreTotal);
      const directCov = direct / coreTotal;
      const words = info.words;
      const lenPen = info.pen;
      let mult = info.mult;
      const cueHit = cue ? cue.test(text) : false;
      if (cueHit) mult += boost;
      const metaReason = qm.answerType === 'reason' && META_REASON.test(text);
      const gov = cueHit && !metaReason && !!governRe && governRe.test(text) && governRe.test(maskForeign(text));
      if (gov) mult += 0.35;
      if (metaReason) mult *= 0.5;
      let defHit = false;
      if (qm.answerType === 'mechanism' && /\b(process|mechanism|overview|how it works|function|operation|principle|stages?|steps?|cycle|reactions?|working)\b/i.test(p.heading)) mult += 0.3;
      if ((qm.answerType === 'definition' || qm.answerType === 'mechanism' || qm.part.explain || qm.part.fn) && focusArr.length) {
        const head = new Set(stemsOf(text.split(/\s+/).slice(0, 10 + focusArr.length).join(' ')));
        // a defining sentence opens with the subject; for "what does X do" it must also say what X does
        // (the sentence that opens a page may leave the verb to the sentence after it: "A CPU is the primary processor … Its circuitry executes …")
        const cueText = qm.part.fn && si === 0 && p.order === 0 ? p.text.slice(0, 420) : text.slice(0, 220);
        if (focusArr.every((f) => head.has(f)) && (qm.part.fn ? CUES.function : CUES.definition).test(cueText)) { mult += 0.55; defHit = true; }
        // what something does is stated where a page introduces it, not deep inside its details
        if (qm.part.fn) { if (p.order === 0) mult += 0.5; else if (p.order <= 2) mult += 0.35; else if (p.order <= 6) mult += 0.2; else if (p.order > 12) mult *= 0.85; }
        else if (p.order <= 2) mult += 0.18;
      }
      const dangling = info.dangling;
      const meta = !!aboutRe && aboutRe.test(text);
      if (meta) mult *= 0.5;
      if (anchorRe && anchorRe.test(text)) mult *= 0.5;           // "… survived because … after the fall of X": the event is only a point in time here
      if (qm.required.size && !relHit && ![...qm.required].some((r) => set.has(r))) mult *= 0.4;
      if (qm.required.size && info.lists && (relHit || [...qm.required].some((r) => set.has(r)))) mult += 0.2;      // names instances of what was asked for
      for (const alts of qm.requiredAll) if (![...alts].some((r) => set.has(r))) mult *= 0.35;
      if (p.type === 'list' && qm.answerType !== 'procedure' && qm.answerType !== 'list' && words < 5) mult *= 0.6;
      if (p.type === 'table') mult *= qm.answerType === 'attribute' || qm.answerType === 'quantity' || qm.answerType === 'time' || qm.answerType === 'place' || qm.answerType === 'person' ? 1.1 : 0.7;
      let predCov = 1;
      if (predTotal > 0) { let got = 0; for (const [s, t] of predTerms) got += set.has(s) ? t.w : relHit && qm.relStems.has(s) ? 0.75 * t.w : (synOf.get(s) || []).some((x) => set.has(x)) ? 0.6 * t.w : 0; predCov = got / predTotal; }
      if (predTotal > 0 && predCov > 0) {
        const c = CONCESSION.exec(text);
        if (c) {
          const main = new Set(stemsOf(c[1]));
          const rel = !!qm.relCue && qm.relCue.test(c[1]);
          let got = 0;
          for (const [st, t] of predTerms) got += main.has(st) ? t.w : rel && qm.relStems.has(st) ? 0.75 * t.w : (synOf.get(st) || []).some((y) => main.has(y)) ? 0.6 * t.w : 0;
          if (got === 0) { predCov = 0; mult *= 0.4; }                 // the clause that makes the statement says nothing of what was asked
        }
      }
      const score = cov * prox * (0.72 + 0.28 * ctxNorm) * lenPen * mult * prior * recency * (0.6 + 0.4 * Math.min(1, directCov * 1.6 + (titleSet.size && focusArr.some((f) => titleSet.has(f)) ? 0.4 : 0)));
      sentences.push({ text, di: p.di, pi, si, type: p.type, heading: p.heading, stems: set, score, cov, directCov, predCov, cueHit, defHit, dangling, order: p.order, opinion: info.opinion, hedged: info.hedged, gap: info.gap, proc: info.proc || meta || metaReason, rel: relHit, gov, intro: info.intro });
    }
  }
  sentences.sort((a, b) => b.score - a.score);
  return { passages, sentences, idf, df, N };
}

/** Pseudo-relevance feedback: salient vocabulary of the best evidence that the question itself did not contain. */
export function feedbackTerms(ranked, qm, k = 6) {
  const scores = new Map(), words = new Map();
  for (const s of ranked.sentences.slice(0, 14)) {
    for (const tok of tokenize(s.text)) {
      if (STOPWORDS.has(tok) || tok.length < 4 || /\d/.test(tok)) continue;
      const st = stem(tok);
      if (qm.terms.has(st)) continue;
      scores.set(st, (scores.get(st) || 0) + s.score);
      if (!words.has(st) || tok.length < words.get(st).length) words.set(st, tok);
    }
  }
  const out = [];
  for (const [st, sc] of scores) { const d = ranked.df.get(st) || 1; if (d >= 2 && d / ranked.N < 0.5) out.push({ stem: st, word: words.get(st), score: sc * ranked.idf(st) }); }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}

export const simSets = (a, b) => jaccard(a, b);

const DOCSET_CACHE = new WeakMap();
/** All stems of a document (title and text), computed once per block list. */
export function docStems(doc) {
  const blocks = doc.blocks;
  if (!Array.isArray(blocks)) return new Set(stemsOf(doc.title || ''));
  let set = DOCSET_CACHE.get(blocks);
  if (!set) { set = new Set(stemsOf(doc.title || '')); for (const p of basePassages(doc)) for (const st of p.stemSet) set.add(st); DOCSET_CACHE.set(blocks, set); }
  return set;
}

/** Maximal-marginal-relevance selection: relevant but not redundant, with a per-document cap. */
export function mmr(cands, k, { lambda = 0.74, maxPerDoc = 99, dupSim = 0.62, minScore = 0, filter = null } = {}) {
  const pool = cands.filter((c) => c.score >= minScore && (!filter || filter(c))).slice(0, 80);
  const chosen = [], perDoc = new Map();
  const top = pool.length ? pool[0].score : 1;
  while (chosen.length < k && pool.length) {
    let best = -1, bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if ((perDoc.get(c.di) || 0) >= maxPerDoc) continue;
      let maxSim = 0;
      for (const s of chosen) { const sim = simSets(c.stems, s.stems); if (sim > maxSim) maxSim = sim; }
      if (maxSim >= dupSim) continue;
      const val = lambda * c.score - (1 - lambda) * maxSim * top;
      if (val > bestVal) { bestVal = val; best = i; }
    }
    if (best < 0) break;
    const c = pool.splice(best, 1)[0];
    chosen.push(c);
    perDoc.set(c.di, (perDoc.get(c.di) || 0) + 1);
  }
  return chosen;
}

/** Sentences from *other* documents that state the same thing (used for corroboration and multi-source citations). */
export function corroborators(sentence, ranked, { minSim = 0.5, limit = 4 } = {}) {
  const out = [], seenDocs = new Set([sentence.di]);
  const floor = sentence.score * 0.35;
  let looked = 0;
  for (const s of ranked.sentences) {
    if (out.length >= limit || ++looked > 6000) break;
    if (s === sentence || seenDocs.has(s.di) || s.score < floor) continue;
    const sim = simSets(sentence.stems, s.stems);
    if (sim >= minSim) { out.push({ sentence: s, sim }); seenDocs.add(s.di); }
  }
  return out;
}

/**
 * Share of the question's weighted terms found in a search-result title/snippet. In running text a common word that
 * appears only inside a capitalised name ("The Stars Shine Down") counts for little; titles are exempt (headline case).
 */
export function lexicalOverlap(title, snippet, weights) {
  let total = 0;
  for (const w of weights.values()) total += w;
  if (!total) return 0;
  const tset = new Set(stemsOf(title || ''));
  let ts = 0;
  for (const [k, w] of weights) if (tset.has(k)) ts += w;
  let ss = 0;
  if (snippet) {
    const lower = new Set(), cap = new Set();
    let first = true;
    for (const m of snippet.matchAll(/[\p{L}][\p{L}\p{N}'’-]*/gu)) { (first || !/^\p{Lu}/u.test(m[0]) ? lower : cap).add(stem(m[0].toLowerCase())); first = false; }
    for (const [k, w] of weights) ss += lower.has(k) ? w : cap.has(k) ? 0.3 * w : 0;
  }
  return Math.max(ss / total, (snippet ? 0.7 : 0.85) * ts / total);
}
