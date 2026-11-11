// INFINI AI — linguistic lexicon (closed-class words, common verbs, irregular morphology, synonym groups).
// This is knowledge about *language*, not about the world: about 6 KB that lets the engine parse questions
// without a pretrained model. World facts are never stored here.

const set = (s) => new Set(s.trim().split(/\s+/));

export const DET = set('the a an this that these those my your his her its our their some any each every no all both either neither another such');
export const PREP = set('to of in on at by for with about against between into through during before after above below from up down out off over under near since until within without across behind beyond among per via than as like around toward towards upon onto inside outside along despite except');
export const PRON = set('i you he she it we they me him her us them myself yourself himself herself itself ourselves themselves one someone anyone everyone something anything everything');
export const POSS = set('my your his her its our their');
export const WH = set('what which who whom whose when where why how');
export const AUX = set("am is are was were be been being do does did have has had isn't aren't wasn't weren't don't doesn't didn't haven't hasn't hadn't");
export const BE = set("am is are was were be been being isn't aren't wasn't weren't");
export const DO = set("do does did don't doesn't didn't");
export const MODAL = set("can could will would shall should may might must can't cannot couldn't won't wouldn't shouldn't");
export const CONJ = set('and or but nor yet so');
export const ADV = set('very also often usually always never just still already now then here there too more most less least quite rather really simply briefly exactly currently recently today yesterday tomorrow tonight again soon ever only even almost actually autonomously automatically again together away back well far else instead anyway');
export const NEG = set("not no never n't none neither nor cannot can't don't doesn't didn't isn't aren't wasn't weren't won't wouldn't shouldn't couldn't haven't hasn't hadn't without");

// Base forms of frequent verbs (used for tagging, lemmatisation and imperative detection).
export const VERBS = set(`accept achieve act add affect agree allow answer appear apply argue arrive ask attack avoid become begin believe belong break bring
build burn buy calculate call care carry catch cause change charge check choose claim clean climb close collect come compare compete complete compute
connect consider consist contain continue control convert cook cost count cover create cross cut damage deal decide declare define deliver depend
describe design destroy determine develop die differ direct discover discuss divide do draw drink drive drop earn eat emit end enable enjoy enter
establish evolve exist expand expect experience explain express fail fall feed feel fight fill find finish fit fix float flow fly follow form found
freeze gain generate get give glow go govern grow handle happen hate have hear heat help hide hit hold hurt identify implement improve include
increase indicate influence install introduce invent invest involve join jump keep kill know last launch lay lead learn leave lend let lie lift like
limit link list listen live look lose love maintain make manage mark marry matter mean measure meet melt mention mind miss move multiply name need
notice obtain occur offer open operate orbit order organize own paint pass pay perform pick place plan plant play point prefer prepare present
prevent print produce program protect prove provide publish pull push put raise reach react read receive recognize record reduce refer reflect
release remain remember remove repeat replace report represent require rest result return reveal ride ring rise roll rotate rule run save say see
seem sell send separate serve set shake shape share shine shoot show shut sing sink sit sleep smell solve sound speak spend spin split spread stand
star start state stay steal stick stop store study succeed suffer suggest supply support suppose survive take talk taste teach tell tend test thank
think throw touch train transfer translate travel treat try turn understand use visit vote wait walk want warm wash watch wear weigh win wish wonder
work worry write summarize simplify elaborate contrast enumerate deploy configure debug compile execute host scale optimize sort parse render fetch
update upgrade delete insert query encrypt decrypt authenticate authorize secure monitor automate integrate migrate refactor iterate loop declare
rain snow erupt orbit revolve absorb reflect radiate fuse burn boil evaporate condense dissolve expand contract locate situate border flow`);

// base, past, participle
const IRR = `be was been|have had had|do did done|go went gone|make made made|build built built|write wrote written|find found found|begin began begun|
become became become|break broke broken|bring brought brought|buy bought bought|come came come|choose chose chosen|draw drew drawn|drink drank drunk|
drive drove driven|eat ate eaten|fall fell fallen|feel felt felt|fight fought fought|fly flew flown|forget forgot forgotten|get got gotten|
give gave given|grow grew grown|hear heard heard|hold held held|keep kept kept|know knew known|lead led led|leave left left|lose lost lost|
mean meant meant|meet met met|pay paid paid|run ran run|say said said|see saw seen|sell sold sold|send sent sent|shine shone shone|shoot shot shot|
sing sang sung|sit sat sat|sleep slept slept|speak spoke spoken|spend spent spent|stand stood stood|steal stole stolen|take took taken|
teach taught taught|tell told told|think thought thought|throw threw thrown|understand understood understood|win won won|wear wore worn|
rise rose risen|freeze froze frozen|hide hid hidden|lay laid laid|ring rang rung|sink sank sunk|swim swam swum|hit hit hit|put put put|set set set|
cut cut cut|let let let|read read read|cost cost cost|spread spread spread|shut shut shut|burn burnt burnt|light lit lit|hang hung hung|
catch caught caught|deal dealt dealt|feed fed fed|lend lent lent|ride rode ridden|shake shook shaken|stick stuck stuck|strike struck struck`;
export const IRREGULAR = new Map();     // inflected form -> base
export const PAST = new Map();          // base -> simple past
export const PARTICIPLE = new Map();    // base -> past participle
for (const row of IRR.replace(/\n/g, '').split('|')) {
  const [base, past, part] = row.trim().split(' ');
  if (!IRREGULAR.has(past)) IRREGULAR.set(past, base);
  if (!IRREGULAR.has(part)) IRREGULAR.set(part, base);
  PAST.set(base, past); PARTICIPLE.set(base, part);
}
for (const [f, b] of [['is', 'be'], ['are', 'be'], ['am', 'be'], ['were', 'be'], ['being', 'be'], ['has', 'have'], ['does', 'do'], ['founded', 'found'], ['born', 'born'], ['died', 'die'], ['lies', 'lie'], ['lying', 'lie'], ['dying', 'die']]) IRREGULAR.set(f, b);

/** Lightweight lemmatiser for verbs and plural nouns. */
export function lemma(word) {
  const w = word.toLowerCase();
  if (IRREGULAR.has(w)) return IRREGULAR.get(w);
  if (VERBS.has(w) || w.length < 4) return w;
  const cands = [];
  if (w.endsWith('ies')) cands.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ied')) cands.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) cands.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('s') && !w.endsWith('ss')) cands.push(w.slice(0, -1));
  if (w.endsWith('ing')) { const b = w.slice(0, -3); cands.push(b, b + 'e'); if (/(.)\1$/.test(b)) cands.push(b.slice(0, -1)); }
  if (w.endsWith('ed')) { const b = w.slice(0, -2); cands.push(b, w.slice(0, -1)); if (/(.)\1$/.test(b)) cands.push(b.slice(0, -1)); }
  for (const c of cands) if (VERBS.has(c)) return c;
  if (w.endsWith('ing') || w.endsWith('ed')) {
    const b = w.endsWith('ing') ? w.slice(0, -3) : w.slice(0, -2);
    if (/[^aeiou][aeiou][^aeiouwxy]$/.test(b) && b.length <= 4) return b + 'e';      // "tun-ed" → "tune" style guess
    if (/(at|iz|is|ys|uc|ag|ur|ov|iv|os|as)$/.test(b)) return b + 'e';
    return /(.)\1$/.test(b) && !/(ll|ss|ff)$/.test(b) ? b.slice(0, -1) : b;
  }
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function pastTense(base) {
  if (PAST.has(base)) return PAST.get(base);
  if (base.endsWith('e')) return base + 'd';
  if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + 'ied';
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(base)) return base + base.slice(-1) + 'ed';
  return base + 'ed';
}
export function gerund(base) {
  if (base === 'be') return 'being';
  if (base.endsWith('ie')) return base.slice(0, -2) + 'ying';
  if (base.endsWith('e') && !base.endsWith('ee')) return base.slice(0, -1) + 'ing';
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(base)) return base + base.slice(-1) + 'ing';
  return base + 'ing';
}

// Synonym / related-word groups for common question vocabulary. Used as low-weight expansion terms when
// ranking evidence (never to assert facts). Topic vocabulary is acquired dynamically from retrieved text instead.
export const SYNONYM_GROUPS = [
  'invent inventor invention patent devise', 'discover discovery discoverer', 'create creator creation make made develop developed',
  'build construct create make develop implement', 'shine glow light luminous luminosity radiate emit bright brightness', 'cause reason because due result lead',
  'begin start found establish originate inception origin', 'die death dead died killed', 'born birth birthplace', 'big large huge size', 'small little tiny',
  'fast quick rapid speed', 'use usage utilize employ application', 'work function operate operation mechanism', 'buy purchase', 'cost price expensive cheap',
  'help assist aid', 'show demonstrate illustrate', 'need require requirement necessary', 'kind type sort category variety', 'risk danger threat hazard vulnerability',
  'safe safety secure security', 'benefit advantage pro strength', 'drawback disadvantage con weakness limitation', 'difference differ distinction versus compare comparison',
  'important significance significant importance matter', 'effect impact influence consequence', 'happen occur take place event', 'first earliest original pioneer',
  'famous known notable renowned', 'country nation state', 'city town capital', 'people population inhabitants residents', 'money currency funds',
  'job occupation profession career work', 'learn study understand', 'teach explain educate', 'leader president head ruler', 'rule govern control',
  'war conflict battle', 'win victory won defeat', 'end finish conclude', 'grow increase rise expand', 'fall decrease decline drop reduce',
  'hot heat warm temperature', 'cold cool freeze', 'old ancient age', 'new recent latest modern', 'write author wrote written', 'movie film', 'car automobile vehicle',
  'doctor physician', 'illness disease sickness condition', 'symptom sign', 'treat treatment cure therapy remedy', 'computer computing machine', 'program software code application',
  'website site web page', 'agent agents agentic autonomous', 'ai artificial intelligence', 'step stage phase', 'method approach technique way', 'explain explanation describe',
  'energy power fuel', 'sun solar star', 'earth planet world globe', 'water liquid ocean sea', 'animal creature species', 'tall height high', 'long length distance far',
  'heavy weight mass', 'company firm business corporation', 'law legal rule regulation', 'child kid children', 'language tongue speak spoken', 'picture image photo',
  'predict forecast projection outlook expect', 'operate control navigate browse interact automate', 'autonomous autonomously independently unattended automatic', 'recommend suggest advise best', 'simple easy basic beginner', 'hard difficult complex challenging',
];
