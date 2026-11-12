// INFINI AI — the brain: a rule-based conversational core with its own memory, common sense and small skills.
//
// What it is: a normaliser for informal text, a database of conversational situations with prepared replies, a store of
// everyday common sense, a per-conversation memory, and a router that decides whether a message is conversation
// (answered here) or a request for knowledge (sent on to live web retrieval).
// What it is not: a language model. Nothing here generates free text, and nothing here is conscious; every reply is a
// prepared sentence, a filled template or the result of a small deterministic function.

import { normalize } from './normalize.js';
import { dialogue, lookup, ownersOf, ruleMatches, correctTypos, fuzzy, known, stats as storeStats } from './store.js';
import { repairForWeb } from './spell.js';
import * as sense from './sense.js';
import * as sk from './skills.js';
import { FEEL, NOT_FEEL, INTENS, CRISIS, CRISIS_NOT, RUDE, SEXUAL, NEG_WORDS, POS_WORDS, STOP, SELF_VERBS, ADDRESS, FILLER } from './lexicon.js';

const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const cap = sk.cap;
const Cap = (s) => s.split(' ').map(cap).join(' ');
const article = (w) => (/^[aeiou]/.test(w) && !/^(uni|use|usu|eu|one)/.test(w) ? 'an' : 'a');
const P = (text, extra) => ({ type: 'paragraph', spans: [{ text, cites: [], ...extra }] });

// ---------------------------------------------------------------------------------------------------------------------
// conversation memory (travels with the conversation, kept on the user's device; everything is re-checked on arrival)
const SEEN_KEYS = ['j', 'r', 'f', 's', 'p', 'q', 'w', 'g', 't'];
export function sanitizeState(b) {
  const o = b && typeof b === 'object' ? b : {};
  const ints = (a, n, max) => (Array.isArray(a) ? a.filter((x) => Number.isInteger(x) && x >= 0 && x <= max).slice(-n) : []);
  const words = (a, n, len) => (Array.isArray(a) ? a.map((x) => str(x, len).toLowerCase().replace(/[^\p{L}\p{N} '.-]/gu, '')).filter(Boolean).slice(-n) : []);
  const facts = {};
  if (o.facts && typeof o.facts === 'object') for (const [k, v] of Object.entries(o.facts).slice(0, 24)) { const kk = str(k, 40).toLowerCase().replace(/[^a-z0-9 ]/g, ''); const vv = str(v, 80); if (kk && vv) facts[kk] = vv; }
  const used = {};
  if (o.used && typeof o.used === 'object') for (const [k, v] of Object.entries(o.used).slice(-40)) if (/^[a-z0-9_.]{1,40}$/.test(k)) used[k] = ints(v, 5, 200);
  const seen = {};
  for (const k of SEEN_KEYS) seen[k] = ints(o.seen && o.seen[k], 80, 500);
  const e = o.expect && typeof o.expect === 'object' && /^[a-z0-9_]{1,20}$/.test(o.expect.t || '') ? { t: o.expect.t, d: str(o.expect.d, 300) } : null;
  const l = o.last && typeof o.last === 'object' ? o.last : null;
  return {
    name: str(o.name, 40).replace(/[^\p{L} '.-]/gu, ''), age: Number.isInteger(o.age) && o.age > 0 && o.age < 130 ? o.age : 0, place: str(o.place, 60), role: str(o.role, 60).toLowerCase(),
    likes: words(o.likes, 12, 40), dislikes: words(o.dislikes, 12, 40), notes: words(o.notes, 8, 100), facts,
    expect: e,
    last: l ? { k: l.k === 'web' ? 'web' : 'brain', i: /^[a-z0-9_.]{1,40}$/.test(l.i || '') ? l.i : '', g: /^[a-z]{1,12}$/.test(l.g || '') ? l.g : '', lvl: ['high', 'medium', 'low', 'insufficient'].includes(l.lvl) ? l.lvl : '', pct: Number.isInteger(l.pct) ? Math.max(0, Math.min(100, l.pct)) : 0, n: Number.isInteger(l.n) ? Math.max(0, Math.min(99, l.n)) : 0, t: str(l.t, 120) } : null,
    lastText: str(o.lastText, 400), used, seen, turn: Number.isInteger(o.turn) ? Math.min(o.turn, 100000) : 0, askedName: !!o.askedName,
  };
}
/** Record that the previous answer came from the web, so that "are you sure?" or "thanks" can refer to it. */
export function noteWeb(state, info) {
  const st = sanitizeState(state);
  st.last = { k: 'web', i: '', g: '', lvl: ['high', 'medium', 'low', 'insufficient'].includes(info.level) ? info.level : '', pct: Math.round((info.score || 0) * 100), n: Math.min(99, info.sources || 0), t: str(info.topic, 120) };
  st.expect = null;
  st.turn += 1;
  return st;
}

// ---------------------------------------------------------------------------------------------------------------------
// feelings ("i am so tired", "not too bad thanks, and you?")
let FEEL_IDX = null;
function feelIndex() {
  if (FEEL_IDX) return FEEL_IDX;
  FEEL_IDX = new Map();
  for (const [cls, list] of Object.entries(FEEL)) for (const ph of list) if (!FEEL_IDX.has(ph)) FEEL_IDX.set(ph, cls);
  return FEEL_IDX;
}
const BARE_FEEL = new Set('sad unhappy depressed upset angry furious annoyed frustrated anxious nervous worried scared stressed tired exhausted sleepy bored lonely sick hungry starving thirsty confused excited'.split(' '));
const SUBJ_PREFIX = ['i have been feeling', 'i am feeling a bit', 'i am feeling', 'i have been', 'i am getting', 'i am still', 'i am just', 'i am doing', 'i am really', 'i feel like i am', 'i feel', 'i am', 'i was', 'i got', 'i get', 'feeling', 'doing', 'me', 'ma', 'main'];
export function parseFeeling(tokens, lenient) {
  let s = tokens.join(' ');
  let ask = false;
  s = s.replace(/ (?:and (?:what about |how about )?(?:you|yourself)|what about (?:you|yourself)|how about (?:you|yourself)|(?:and )?how are you(?: doing)?|you)$/, () => { ask = true; return ''; });
  s = s.replace(/ (?:thanks|thank you)(?: for asking)?$/, '').replace(/ (?:and (?:what about |how about )?(?:you|yourself)|what about you|how about you|how are you)$/, () => { ask = true; return ''; });
  s = s.replace(/ (?:today|now|right now|lately|these days|as always|as usual|too|also|though|i guess|i think|at the moment)$/, '');
  s = s.replace(/^(?:(?:well|oh|hmm|yes|yeah|actually|honestly|to be honest|today|lately|right now) )+/, '');
  let subject = false;
  for (const p of SUBJ_PREFIX) if (s === p || s.startsWith(p + ' ')) { s = s.slice(p.length).trim(); subject = true; break; }
  let t = s.split(' ').filter(Boolean);
  const idx = feelIndex();
  const whole = () => idx.get(t.join(' '));
  let cls = whole();
  let neg = false;
  if (!cls) {
    while (t.length > 1 && INTENS.has(t[0])) t = t.slice(1);
    cls = whole();
    if (!cls) {
      if (t[0] === 'not' || t[0] === 'never') { neg = true; t = t.slice(1); } else if (t[0] === 'no' && t[1] === 'longer') { neg = true; t = t.slice(2); }
      while (t.length > 1 && INTENS.has(t[0])) t = t.slice(1);
      cls = whole();
    }
  }
  if (!cls) return null;
  if (!subject && !lenient && !(BARE_FEEL.has(t.join(' ')) && !neg) && !ask) return null;
  if (!subject && !lenient && ask && tokens.length > 6) return null;
  if (neg) cls = NOT_FEEL[cls] || (cls === 'soso' ? 'happy' : null);
  return cls ? { cls, ask } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// names
const NAME_STOP = new Set(`fine good great ok well happy sad tired bored hungry sorry sure ready back here home done late early new old young single married pregnant serious joking kidding just not also still very so too really going coming
 trying looking thinking wondering asking talking doing feeling working studying learning a an the in on at from with nobody none nothing secret anonymous no yes what why who when where how which guess never mind it that this me you i
 nepali indian american chinese japanese british english hindu buddhist christian muslim boy girl man woman human person student teacher doctor engineer developer programmer kid child adult male female alive awake online free busy sick ill
 lost right wrong curious confused excited afraid scared alone lonely better best worse okay alright interested impressed surprised thankful grateful glad proud ashamed your yours my mine his her their our someone somebody anyone telling asking`.split(/\s+/));
const FIRST_NAMES = new Set(`john james david michael robert william richard joseph thomas charles daniel matthew mark paul steven andrew kevin brian george edward peter alex alexander sam samuel ben benjamin jack harry oliver noah liam lucas ethan jacob ryan adam aaron tom tim jim bob bill mike chris nick tony jason eric
 mary linda sarah jessica emily emma olivia sophia ava mia isabella anna maria laura lisa susan karen nancy betty helen sandra donna carol ruth sharon michelle amanda melissa stephanie rebecca amy kate katie julia alice lucy grace chloe ella lily zoe hannah rachel
 ram shyam hari krishna sita gita rita maya anil sunil rajesh ramesh suresh mahesh dinesh rakesh mukesh prakash deepak dipak bikash bishal sujan suman sabin nabin bibek roshan kiran arjun rohan rahul amit sumit ajay vijay sanjay ravi kumar raj raju amar
 sunita anita sarita kabita kavita puja pooja priya sushma sabina samjhana srijana asmita anjali aarti arati nisha nikita neha sneha rekha laxmi lakshmi saraswati parbati durga ganga jamuna binita bimala kamala nirmala shanti sarmila manisha menuka
 aarav aayush ayush yuv yuvraj yuvi aditya aryan ishaan kabir vivaan sai dev om yash nikhil rohit mohit ankit ankita sagar samir sameer prabin pravin santosh ganesh mohan gopal bishnu shiva narayan binod pramod manoj saroj niraj dhiraj
 mohammed muhammad ahmed ali hassan hussain omar fatima aisha zara sara maryam ibrahim yusuf wei li ming chen yuki hiro kenji sakura mei jose juan carlos luis miguel pedro maria ana sofia lucia pierre jean marie hans anna ivan olga`.split(/\s+/));
function cleanName(x, c, strong) {
  if (!x) return null;
  let t = x.trim();
  let askBack = false;
  t = t.replace(/ (?:and (?:what is )?(?:yours|your name|you)|what is (?:yours|your name)|what about you|how about you|and you are|who are you|nice to meet you|pleased to meet you)$/, () => { askBack = true; return ''; });
  t = t.replace(/^(?:called|named|mr|mrs|ms|miss) /, '').replace(/ (?:here|ho|hai|by the way|btw|and i|sir|ji)$/, '').trim();
  const toks = t.split(' ').filter(Boolean);
  if (!toks.length || toks.length > 3) return null;
  if (!toks.every((w) => /^\p{L}[\p{L}'.-]{0,19}$/u.test(w) && w.length >= 2)) return null;
  if (toks.some((w) => NAME_STOP.has(w) || RUDE.has(w))) return null;
  if (!strong) {
    const idx = feelIndex();
    if (idx.has(t) || toks.some((w) => idx.has(w) || STOP.has(w) || /(ing|ed|ly)$/.test(w) && known(w))) return null;
    const capsHint = toks.every((w) => c.n.caps.some((k) => k.toLowerCase() === w)) && !/^[A-Z]/.test(c.raw.trim().split(/\s+/).slice(-toks.length).join(' ')) === false;
    const midCaps = toks.every((w) => { const i = c.raw.toLowerCase().indexOf(w); return i > 0 && /[A-Z]/.test(c.raw[i]); });
    const unknown = toks.every((w) => !known(w) || FIRST_NAMES.has(w));
    if (!(unknown || (midCaps && capsHint) || c.st.expect && c.st.expect.t === 'name')) return null;
    if (toks.length > 2) return null;
  }
  return { name: Cap(toks.join(' ')), askBack };
}

// ---------------------------------------------------------------------------------------------------------------------
const hasAny = (tokens, set) => tokens.some((t) => set.has(t));
const valence = (tokens) => { let s = 0; let neg = false; for (const t of tokens) { if (t === 'not' || t === 'no' || t === 'never') { neg = true; continue; } const v = POS_WORDS.has(t) ? 1 : NEG_WORDS.has(t) ? -1 : 0; s += neg ? -v : v; if (v) neg = false; } return s; };
const VERBISH = new Set(`is are was were am be been has have had will would can could should did does do got get gets went go goes going came come comes made make makes looks look feels feel seems seem said says say love loves like likes hate hates want wants need needs won lost died
 happened rained broke failed passed finished started ended opened closed gave took told asked called arrived left stopped works worked hurts hurt tastes smells sounds became remains stays keeps`.split(/\s+/));
const INFO_VERB = new Set('tell explain describe define show give list name find search compare summarize summarise teach suggest recommend translate calculate convert solve check lookup get inform fetch compile research look see google identify estimate outline clarify elaborate discuss analyze analyse review locate'.split(' '));
const DEVICE_VERB = new Set(`set play call text message email mail send open launch start turn switch delete erase cancel order buy purchase book schedule reschedule remind print download upload sign add remove update
 activate deactivate enable disable forward restart reboot power fill pick clear organize organise scan save time display put keep request report program finish pause resume mute unmute dim increase decrease lower
 raise lock unlock record snooze dial ring pay transfer deposit withdraw renew subscribe unsubscribe install uninstall connect disconnect sync backup share post tweet log close shut track mark fold pull read plant
 change edit move copy rename sort group file store bring take drive wake alert notify ping contact invite apply register submit charge refill replace reset stop`.split(/\s+/));
const PERSONAL_NOUN = /\b(?:my|our) (?:\w+ ){0,2}(?:phone|iphone|contacts?|accounts?|balance|messages?|texts?|sms|emails?|mail|inbox|voicemails?|calendar|schedule|photos?|pictures?|pics|gallery|files?|documents?|wallet|keys|location|area|alarms?|reminders?|notes?|playlists?|history|passwords?|cards?|orders?|package|parcel|bills?|statement|resume|cv|battery|screen|wifi|bluetooth|volume|brightness|subscriptions?|reservations?|appointments?|flight|booking|bank|checking|savings|ipod|laptop|tablet|tv|hard drive|status|hotspot|device|settings|speaker|lights?|thermostat|profile|feed|timeline|cart|wishlist|to do list|todo list|shopping list|workplace|generator|tracker|robot|provider|meetings?|events?|tasks?|steps|heart rate|wheelchair|remote)\b/;
const BOT_NOUN = /^(?:own |real |full |actual |favou?rite |fav |best |biggest |main |current |first |last |new |old |true |only )*(?:name|creator|creators|maker|makers|developer|developers|owner|owners|builder|author|company|team|boss|master|job|work|purpose|goal|goals|mission|role|function|age|birthday|opinion|opinions|view|views|thoughts|take|idea|ideas|brain|mind|memory|voice|code|program|programming|model|language|languages|source|sources|answer|answers|reply|replies|response|responses|family|mother|father|mom|dad|parents|friend|friends|hobby|hobbies|dream|dreams|wish|wishes|feeling|feelings|emotions|mood|day|life|limits|limitations|rules|data|database|knowledge|version|training|iq|gender|pronouns|home|country|location|server|logo|secret|secrets|story|plan|plans|weakness|weaknesses|strength|strengths|skill|skills|abilities|ability|capabilities|features|power|powers|personality|character|nature|system|systems|status|problem|mistake|mistakes|joke|jokes|nickname|religion|god|belief|beliefs|values|conscience|consciousness|intelligence|education|salary|price|cost|number|website|site|inventor|origin|history|future|favourite|favorite|fav|hero|idol|crush|girlfriend|boyfriend|wife|husband|partner|pet|superpower|zodiac|sign|motto|slogan|style|type|kind|deal|point|fear|fears|hope|hopes|choice|pick|guess|advice|suggestion|recommendation|experience|existence|world|self|turn|side|reason|secret|plan|next)\b/;
const WHQ = /^(what|who|whom|whose|where|when|why|which|how)$/;
const AUXQ = /^(is|are|was|were|am|do|does|did|can|could|will|would|should|shall|has|have|had|may|might|must)$/;
const DECL = /^(i|we|my|our|it|its|that|this|these|those|he|she|they|the|a|an|today|yesterday|tomorrow|tonight|there|here|just|still|also|actually|well|so|and|but|because|cause|coz|me|same|no|yes|not|never|always|sometimes|maybe|probably|people|everyone|everybody|nobody|someone|life|school|work|mom|dad|mum|mother|father|one|two|both|all|most|many|now|then|if|when|after|before|since|last|next|every|each|some)$/;
const LEAD = new Set('now so then also and but well please ok hey hi hello alright right um uh btw anyway anyways listen look actually basically just kindly yo oh ah hmm sir bro'.split(' '));
const DEVICE_KIN = /^(?:my |the )?(?:mom|mum|mother|dad|father|papa|mama|brother|sister|wife|husband|friend|boss|girlfriend|boyfriend|uncle|aunt|grandma|grandpa|son|daughter|teacher|doctor|police|ambulance|office|home|him|her|them|me|someone|\d+)\b/;

export function createBrain(opts = {}) {
  const persona = { version: opts.version || '3.0.0', creator: opts.creator || 'an independent developer', born: '2026-11', maxPages: Number(opts.maxPages) || 1500 };

  /** Pick one reply of an intent that fits the situation; returns {text, expect} or null when none fits. */
  function chooseReply(c, intent, vars = {}) {
    const st = c.st, last = st.last;
    const dp = c.env.dp;
    const flags = {
      first: st.turn === 0 && !c.env.ctxTurn, named: !!st.name, '!named': !st.name, web: !!last && last.k === 'web' && !!last.t, brain: !!last && last.k === 'brain',
      'web.high': !!last && last.k === 'web' && last.lvl === 'high' && !!last.t, 'web.medium': !!last && last.k === 'web' && last.lvl === 'medium', 'web.low': !!last && last.k === 'web' && last.lvl === 'low', 'web.none': !!last && last.k === 'web' && (last.lvl === 'insufficient' || !last.lvl),
      'dp.morning': dp === 'morning', 'dp.afternoon': dp === 'afternoon', 'dp.evening': dp === 'evening', 'dp.night': dp === 'night', 'asked.none': true,
      'after.joke': !!last && last.k === 'brain' && (last.i === 'fun.joke' || last.i === 'fun.riddle'), q: !!vars.q,
    };
    const CONTEXT = /^(first|web|brain|dp\.|after\.|q$)/;
    const S = storeStats();
    const all = {
      name: st.name.split(' ')[0], topic: last && last.k === 'web' ? last.t : '', conf: last ? last.lvl : '', confpct: last && last.pct ? String(last.pct) : '', nsrc: last && last.n ? String(last.n) : '',
      time: c.env.clock, creator: persona.creator, Creator: cap(persona.creator), version: persona.version, maxPages: persona.maxPages.toLocaleString('en-US'),
      nPatterns: S.patterns.toLocaleString('en-US'), nFacts: S.facts.toLocaleString('en-US'), nIntents: String(S.intents), nReplies: String(S.replies), ...vars,
    };
    const usable = [];
    intent.replies.forEach((r, i) => {
      if (!r.c.every((k) => flags[k])) return;
      if (r.e === 'name' && st.askedName) return;
      const need = r.t.match(/\{(\w+)\}/g) || [];
      if (need.some((ph) => { const v = all[ph.slice(1, -1)]; return v == null || v === ''; })) return;
      usable.push({ r, i, ctx: r.c.some((k) => CONTEXT.test(k)) });
    });
    if (!usable.length) return null;
    const tier = usable.some((u) => u.ctx) ? usable.filter((u) => u.ctx) : usable;
    const recent = st.used[intent.id] || [];
    let pool = tier.filter((u) => !recent.includes(u.i));
    if (!pool.length) pool = tier.length > 1 ? tier.filter((u) => u.i !== recent[recent.length - 1]) : tier;
    const pick = pool[Math.floor(c.rand() * pool.length)];
    st.used[intent.id] = [...recent, pick.i].slice(-Math.min(4, Math.max(1, tier.length - 1)));
    const text = pick.r.t.replace(/\{(\w+)\}/g, (_, k) => all[k]);
    return { text, expect: pick.r.e || '', chips: intent.chips };
  }
  const D = () => dialogue();
  const say = (c, id, vars = {}, extra = {}) => { const it = D().byId.get(id); const r = it && chooseReply(c, it, vars); return r ? { ...r, intent: it, ...extra } : null; };

  // -------------------------------------------------------------------------------------------------------------------
  // handlers: (c) => result | null.  result = {text|blocks, expect, expectData, chips, origin} or {pass:{question}}
  const pickUnseen = (c, key, n) => { const seen = c.st.seen[key] || []; let pool = []; for (let i = 0; i < n; i++) if (!seen.includes(i)) pool.push(i); if (!pool.length) { pool = Array.from({ length: n }, (_, i) => i).filter((i) => i !== seen[seen.length - 1]); c.st.seen[key] = []; } const i = pool[Math.floor(c.rand() * pool.length)]; c.st.seen[key] = [...(c.st.seen[key] || []), i].slice(-80); return i; };
  const searchChip = (q) => `Search the web: ${q}`;
  const tzCity = sk.tzCity;
  const cityOf = (c) => c.st.place || tzCity(c.env.tz);
  const NEAR = /\b(?:near me|nearby|near by|around me|close to me|close by|around here|near here|in my (?:area|city|town|neighbou?rhood|location|region|locality|place)|from my area|near my (?:location|place|home|house))\b/i;
  /** A question that depends on where the user is: use the remembered place, or ask. */
  function placeBound(c, template, what) {
    const st = c.st;
    if (st.place) return { pass: { question: template.replace('{place}', st.place) } };
    const city = tzCity(c.env.tz);
    if (city) return { text: `I can't see where you are, but your device's time zone suggests ${city}. Shall I look up ${what} there? If you're somewhere else, just tell me the place.`, expect: 'near', expectData: `${city}|${template}`, chips: [searchChip(template.replace('{place}', city))] };
    return { text: `I can't see where you are. Tell me the city or area, and I'll look up ${what} there.`, expect: 'near', expectData: `|${template}` };
  }

  const H = {
    // ---- about the assistant
    age: () => {
      return { text: `I'm very new. My first version went live in November 2026, and this brain arrived with version ${persona.version.split('.')[0]}.0, so in human terms I'm a newborn. I don't age or die the way living things do: I simply run for as long as someone keeps me switched on.` };
    },
    howareyou: (c) => {
      const t = c.text;
      const h = c.env.health || {};
      const resting = h.resting || 0;
      const yesNo = /^(are you|you |is everything|everything|all |is all|hope|i hope|u )/.test(t) || /^(sanchai|thik|aaram|aram|sab |theek)/.test(t);
      const recip = /^(what about you|how about you|how about yourself|and you|and yourself|and how are you|and what about you|what about yourself|you|yourself)$/.test(t);
      const np = /^(sanchai|kasto|k cha|halkhabar|hal khabar|khabar|thik chau|thik hunuhuncha|aaram|aram|timi|tapai)/.test(t), hi = /^(kaise|kaisa|kaisi|kya ha|aap|tum|sab |theek)/.test(t);
      const status = resting ? `One of my search sources is resting at the moment, but the others are fine and so am I.` : `All my systems are running normally.`;
      const lead = np ? 'Sanchai chu! ' : hi ? 'Main theek hoon! ' : '';
      const body = recip ? [`I'm doing well, thanks. ${status}`, `All good here. ${status}`, `Doing fine, thank you for asking back. ${status}`]
        : yesNo ? [`Yes, I'm fine, thank you. ${status}`, `I'm fine! ${status} Thanks for checking.`, `Yes, all good. ${status}`]
          : [`I'm doing well, thank you. ${status}`, `Doing well! ${status}`, `I'm good, thanks for asking. ${status}`];
      const recent = c.st.used['bot.howareyou'] || [];
      let i = Math.floor(c.rand() * body.length); if (recent.includes(i)) i = (i + 1) % body.length;
      c.st.used['bot.howareyou'] = [i];
      const moodKnown = recip || (c.st.last && c.st.last.g === 'feel');
      const dp = c.env.dp;
      const ask = moodKnown ? '' : (c.st.name ? ` How are you, ${c.st.name}?` : dp === 'night' ? ' How are you tonight?' : ' How are you?');
      return { text: `${lead}${body[i]}${ask}`, expect: moodKnown ? '' : 'mood' };
    },
    favorite: (c) => {
      const x = (c.slots.x || '').replace(/\b(thing|things|of all time|ever|in the world|type of|kind of)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (!x || x.split(' ').length > 4) return null;
      const FAV = [
        [/colou?r/, 'A blue that fades into violet: the colours of my logo. It is the only outfit I own.'], [/food|dish|meal|snack|cuisine/, "I can't eat, but if I could, I'd start with momo. People speak of it with real devotion."], [/drink|beverage/, "I don't drink, though electricity is the closest thing I have to coffee."],
        [/number/, "Eight. Turn it on its side and you get the infinity sign in my name."], [/animal|pet/, 'The owl: quiet, well read and awake at odd hours. I feel a kinship.'], [/movie|film|show|series/, "I haven't watched any. I have no eyes. If I could, I'd pick one about a helpful machine with a happy ending."],
        [/song|music|singer|band|artist/, "I can't hear, so every song is a mystery to me. I do like the idea of rhythm, though. What's yours?"], [/book|novel|author|writer/, 'The dictionary. Terrible plot, but it explains every word it uses.'], [/sport|team|player|game/, "I can't play, but I admire chess: all rules and no luck. Volleyball gets an honourable mention for being Nepal's national sport."],
        [/season|weather/, "I don't feel weather, but spring sounds right: everything starting up at once."], [/day/, 'Today. It is the only one I ever get to experience.'], [/place|country|city/, "I don't travel, but I hear the Himalayas are hard to beat. And I'm fond of wherever you're typing from."],
        [/word/, '"Why". It is short, and it starts most good questions.'], [/subject/, 'Any subject with clear answers and good sources. Curiosity is my real favourite.'], [/language|programming/, "English is the one I manage best. Among programming languages I'm biased: I'm written in JavaScript."],
        [/fruit/, "I can't taste, but the mango gets called the king of fruits, and I respect a title."], [/flower/, 'The rhododendron, the national flower of Nepal. Red, bold and fond of mountains.'], [/planet/, 'Earth. All my users live there.'], [/letter/, 'The letter I. It starts my name, twice over.'],
        [/person|human|user/, "Whoever is talking to me right now. So: you."], [/joke/, "Any joke that lands. My record there is mixed."], [/superhero|hero/, "Whoever reads the instructions first. An underrated power."], [/website|site|app/, 'Wikipedia, for the simple reason that it shows its sources.'], [/time/, 'The moment a question arrives. That is when I wake up.'],
      ];
      const hit = FAV.find(([re]) => re.test(x));
      if (hit) return { text: hit[1] + (/What's yours\?$/.test(hit[1]) ? '' : ` What's yours?`), expect: 'tellmore' };
      return { text: `I don't have a favourite ${x}. I have no tastes of my own, so I'd only be pretending. What's yours?`, expect: 'tellmore' };
    },
    like_x: (c) => {
      const x = (c.slots.x || '').replace(/\b(a lot|very much|too|at all|or not|really)\b/g, ' ').replace(/^(of|about) /, '').replace(/\s+/g, ' ').trim();
      if (!x || x.split(' ').length > 7 || /^(me|us|you|your|yourself|it|that|this|to (talk|chat|help))\b/.test(x)) return null;
      const heard = /^(have you|did you)\b/.test(c.text);
      if (heard) return { text: `No. I haven't experienced anything first-hand, and I only know ${x} from what I can read. Would you like me to look it up?`, expect: 'search', expectData: x, chips: [searchChip(x)] };
      if (/\b(food|eat|eating|pizza|momo|momos|rice|chocolate|ice cream|coffee|tea|noodles|burger|burgers|chicken|cake|sweets|fruit|fruits|mango|biryani|pasta)\b/.test(x)) return { text: `I can't taste anything, so I'll never know. People do write about ${x} with a lot of enthusiasm, though. Do you like it?`, expect: 'tellmore' };
      if (/\b(music|song|songs|singing|movie|movies|film|films|anime|cricket|football|sports|sport|games|gaming|dancing|dance)\b/.test(x)) return { text: `I can't hear, watch or play, so I only know ${x} second-hand. It clearly matters to a lot of people. Is it one of your favourites?`, expect: 'tellmore' };
      return { text: `I don't have likes or dislikes of my own: no taste buds, no ears, no weekends. But tell me: do you like ${x}?`, expect: 'tellmore', chips: [searchChip(x)] };
    },
    opinion: (c) => {
      const t = c.text;
      const x = (c.slots.x || '').replace(/\b(in your opinion|according to you|do you think|to you|for you)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (/^(me|us|myself|you|yourself|your|it|that|this|so|not)$/.test(x) || (/^(i|my|we) /.test(x) && !/^(i should|i can|i will)/.test(x))) return null;
      const about = /^(what|how) (do|did) you (think|feel)\b|^(what is|whats|what are|tell me|give me|share|i want) your\b|^(your|ur) (opinion|view|views|thoughts|take)\b|^what (would|can|do|have) you (say|got to say)\b|^how do you feel about\b/.test(t) && x && x.split(' ').length <= 8;
      let query = about ? x : c.raw.replace(/[?!.\s]+$/, '').replace(/\b(in your opinion|according to you|do you think|to you|for you)\b/gi, ' ').replace(/^\s*do you (think|believe|feel|agree|reckon|suppose)( that)?\s+/i, '').replace(/\s+/g, ' ').trim();
      if (!query) query = c.raw.replace(/[?!.\s]+$/, '');
      return { text: `I don't hold opinions of my own. I'd only be pretending, and I'd rather not. What I can do is look up what has been written${about ? ` about ${x}` : ' on that'} and show you the sources. Shall I?`, expect: 'search', expectData: query, chips: [searchChip(query)] };
    },
    other_bot: (c) => {
      const m = c.text.match(/\b(alexa|siri|cortana|bixby|google|gemini|bard|chatgpt|gpt|claude|copilot|grok|jarvis|hal|meta ai|deepseek|perplexity|watson|eliza)\b/);
      return { text: m ? `That's not me, but hello! I'm INFINI AI. ${cap(m[1] === 'gpt' ? 'GPT' : m[1])} and I have never met.` : "That's not me, but hello! I'm INFINI AI." };
    },
    // ---- memory
    name_set: (c) => {
      const strong = /^(my name|name is|the name is|my names|my full name|my first name|my real name|my nickname|my good name|call me|you can call me|just call me|please call me|you may call me|u can call me|address me as|refer to me as|i am called|they call me|people call me|everyone calls me|everybody calls me|my friends call me|i go by|i am known as|myself|mero naa?m|mera naa?m)\b/.test(c.text);
      const r = cleanName(c.slots.x, c, strong);
      if (!r) return null;
      const changed = c.st.name && c.st.name !== r.name;
      c.st.name = r.name;
      const out = say(c, changed ? 'resp.name_change' : 'resp.name_ok', { name: r.name });
      if (out && r.askBack) out.text += " I'm INFINI AI.";
      return out;
    },
    name_get: (c) => (c.st.name ? say(c, 'resp.name_known', { name: c.st.name }) : (c.st.askedName = false, say(c, 'resp.name_unknown'))),
    name_forget: (c) => { c.st.name = ''; c.st.askedName = false; return say(c, 'resp.name_forgot'); },
    age_set: (c) => { const n = sk.toNumber((c.slots.n || '').replace(/ (years?|yrs?|yo)( old)?$/, '')); if (n == null || !Number.isInteger(n) || n < 1 || n > 120) return null; c.st.age = n; return say(c, 'resp.age_ok', { n: String(n) }); },
    recall: (c) => {
      const t = c.text, st = c.st;
      if (/\b(old|age|born)\b/.test(t)) return st.age ? { text: `You told me you're ${st.age}.` } : { text: "You haven't told me your age. I only know what you tell me in this chat." };
      if (/\b(live|from|home|country|city|location|stay)\b/.test(t)) return st.place ? { text: `You told me: ${st.place}.` } : { text: "You haven't told me where you live or come from, and I can't see your location." };
      if (/\b(hate|dislike)\b/.test(t)) return st.dislikes.length ? { text: `You've told me you're not a fan of ${sk.joinList(st.dislikes)}.` } : { text: "You haven't told me about anything you dislike." };
      if (/\b(like|love|hobbies|hobby|interests|enjoy|likes)\b/.test(t)) return st.likes.length ? { text: `You've told me you like ${sk.joinList(st.likes)}.` } : { text: "You haven't told me what you like yet. Tell me, and I'll remember it for this chat." };
      if (/\b(job|profession|work|living|student|school|what am i)\b/.test(t)) return st.role ? { text: `You told me you're ${article(st.role)} ${st.role}.` } : { text: "You haven't told me what you do." };
      const km = t.match(/^(?:what is|what are|who is|who are|what was|whats|do you know|do you remember|tell me|when is|where is) my (.+?)(?: is| was| are)?$/);
      if (km && !/^(name|age)$/.test(km[1])) { const r = H.recall_key({ ...c, slots: { x: km[1] } }); if (r) return r; if (km[1].split(' ').length <= 4) return say(c, 'resp.fact_unknown', { k: km[1].replace(/^(.+) name$/, "$1's name") }); }
      const bits = [];
      if (st.name) bits.push(`your name is ${st.name}`);
      if (st.age) bits.push(`you're ${st.age}`);
      if (st.place) bits.push(`your place is ${st.place}`);
      if (st.role) bits.push(`you're ${article(st.role)} ${st.role}`);
      if (st.likes.length) bits.push(`you like ${sk.joinList(st.likes)}`);
      if (st.dislikes.length) bits.push(`you're not a fan of ${sk.joinList(st.dislikes)}`);
      for (const [k, v] of Object.entries(st.facts).slice(0, 8)) bits.push(`your ${k} is ${v}`);
      for (const n of st.notes.slice(0, 4)) bits.push(n);
      if (!bits.length) return say(c, 'resp.memory_empty');
      return { text: `Here is what you've told me in this conversation: ${bits.join('; ')}. That is all I know about you. It stays on your device, and a new chat starts empty.` };
    },
    recall_key: (c) => {
      let k = (c.slots.x || '').replace(/\b(again|please|now)\b/g, ' ').replace(/ (is|was|are|were)$/, '').replace(/\s+/g, ' ').trim().replace(/favourite/g, 'favorite');
      if (!k || k.split(' ').length > 4) return null;
      const st = c.st;
      if (k === 'name') return H.name_get(c);
      if (k === 'age') return st.age ? { text: `You told me you're ${st.age}.` } : say(c, 'resp.fact_unknown', { k });
      const v = st.facts[k] || st.facts[k.replace(/s$/, '')] || st.facts[k.replace(/ name$/, '')];
      const shown = k.replace(/^(.+) name$/, "$1's name");
      if (v) return say(c, 'resp.fact_known', { k: st.facts[k] ? shown : (/ name$/.test(k) ? shown : k), v });
      if (/^(friend|best friend|mother|father|mom|dad|brother|sister|wife|husband|dog|cat|pet|teacher|boss|girlfriend|boyfriend)( name)?$/.test(k) || /^favorite /.test(k) || /^(birthday|hobby|school|college|job|city|country|village|class|grade|phone|number|email|address|surname|nickname|height|weight|goal|dream)$/.test(k)) return say(c, 'resp.fact_unknown', { k: shown });
      return null;
    },
    remember: (c) => {
      const x = (c.slots.x || '').trim();
      if (!x || x.split(' ').length > 18 || /^(me|it|that|this|when|what|who|how|the time|everything)\b/.test(x)) return null;
      const m = x.match(/^my (.+?) (?:is|are|was|were|is called|name is) (.+)$/);
      if (m && m[1].split(' ').length <= 3 && m[2].split(' ').length <= 6) c.st.facts[m[1].replace(/favourite/g, 'favorite')] = m[2];
      else c.st.notes = [...c.st.notes, x.replace(/^i /, 'you ').replace(/\bmy\b/g, 'your').replace(/\bi am\b/g, 'you are')].slice(-8);
      return say(c, 'resp.remember_ok');
    },
    fact_set: (c) => {
      const t = c.text, st = c.st;
      if (c.n.question || /\b(what|why|how|who|when|where|which)\b/.test(t)) return null;
      let m;
      if ((m = t.match(/^(?:i (?:live|stay|reside) in|i am from|i come from|i came from|i am coming from|i hail from|i was born in) (.+)$/))) { const x = m[1].replace(/ (now|currently|originally|actually|but .+)$/, ''); if (x.split(' ').length > 4 || /^(the future|hell|heaven|nowhere|my|your|a|an)\b/.test(x)) return null; st.place = Cap(x); return say(c, 'resp.place_ok', { x: Cap(x), X: Cap(x) }); }
      if ((m = t.match(/^i am (?:in|at) (.+)$/))) return m[1].split(' ').length <= 4 ? say(c, 'resp.interest') : null;
      if ((m = t.match(/^i have (a|an|one|two|three|four|five|2|3|4|5|some|many|no) (.+)$/))) {
        const x = m[2];
        if (x.split(' ').length > 5 || /^(question|questions|doubt|doubts|query|problem|problems|issue|request|idea|plan|feeling|dream|lot|few|bit|point|suggestion|complaint|favor|favour|secret|joke|riddle|story|news)\b/.test(x)) return null;
        const v = valence(x.split(' '));
        if (v < 0 || /\b(exam|test|interview|fever|headache|cold|cough|deadline|presentation|homework|assignment)\b/.test(x)) return say(c, /\b(exam|test|interview|deadline|presentation)\b/.test(x) ? 'feel.anxious' : 'resp.interest_neg');
        if (m[1] === 'no') return say(c, 'resp.interest');
        st.notes = [...st.notes, `you have ${m[1]} ${x}`].slice(-8);
        return say(c, 'resp.have_ok', { x: `${m[1]} ${x}`, X: cap(`${m[1]} ${x}`) });
      }
      if ((m = t.match(/^i (?:study|am studying|am learning|learn|teach|am teaching) (.+)$/))) { if (m[1].split(' ').length > 5) return null; st.facts[/teach/.test(t) ? 'teaching subject' : 'studies'] = m[1]; return say(c, 'resp.remember_ok'); }
      if ((m = t.match(/^i (?:work|study|am studying|am working|read) (?:in|at|as|for) (.+)$/))) { if (m[1].split(' ').length > 6) return null; st.facts[/work/.test(t) ? 'work' : 'school'] = m[1]; return say(c, 'resp.remember_ok'); }
      let k = c.slots.k, v = c.slots.v;
      if (k == null || v == null) return null;
      k = k.trim().replace(/favourite/g, 'favorite'); v = v.trim();
      if (!k || !v || k.split(' ').length > 3 || v.split(' ').length > 6 || /^(question|problem|point|doubt|query|answer|opinion|guess|bad|mistake|fault|pleasure|turn)$/.test(k)) return null;
      if (k === 'name' || k === 'full name' || k === 'first name' || k === 'nickname') { const r = cleanName(v, c, true); if (!r) return null; st.name = r.name; return say(c, 'resp.name_ok', { name: r.name }); }
      if (k === 'age') { const n = sk.toNumber(v.replace(/ years?( old)?$/, '')); if (n && Number.isInteger(n) && n < 130) { st.age = n; return say(c, 'resp.age_ok', { n: String(n) }); } return null; }
      if (/^(?:very |so |too |really |still |always )?(?:slow|not working|broken|dead|stuck|hanging|lagging|crashing|freezing|frozen|overheating|leaking|damaged|cracked|hacked|locked|blocked|not charging|not turning on|not starting|not opening|not connecting|not responding|making noise|acting up|acting weird|heating|buffering|glitching|out of order|down)(?: again| today| now| a lot)?$/.test(v)) {
        const q = `how to fix ${k} ${v.replace(/^(very|so|too|really|still|always) /, '').replace(/ (again|today|now|a lot)$/, '')}`;
        const r = say(c, 'resp.problem', { k, v });
        return r ? { ...r, expect: 'search', expectData: q, chips: [searchChip(q)] } : null;
      }
      const val = valence(v.split(' '));
      // "my friend is not talking to me": something that is happening, not a fact to file away
      if (/\b(me|i|my|us|we|myself)\b/.test(v) || (/^(?:not |never |no longer |always |still |just )?\w+ing\b/.test(v) && v.split(' ').length > 1)) return say(c, val < 0 || /^(not|never|no longer)\b/.test(v) ? 'resp.interest_neg' : val > 0 ? 'resp.interest_pos' : 'resp.interest');
      const storable = /^(favorite|best|birthday|hobby|hobbies|school|college|job|city|country|village|class|grade|surname|goal|dream|pet|dog|cat|friend|best friend|mother|father|mom|dad|brother|sister|wife|husband|teacher|boss|girlfriend|boyfriend)\b/.test(k) || / name$/.test(k) || /name is /.test(t);
      if (val < 0 && !storable) return say(c, 'resp.interest_neg');
      if (val > 0 && !storable && v.split(' ').length <= 3) return say(c, 'resp.interest_pos');
      if (!storable && v.split(' ').length > 4) return say(c, 'resp.interest');
      const person = /^(friend|best friend|mother|father|mom|dad|mum|brother|sister|wife|husband|teacher|boss|girlfriend|boyfriend|son|daughter|uncle|aunt|cousin|crush|hero|idol)\b/.test(k) && v.split(' ').length <= 2 && v.split(' ').every((w) => FIRST_NAMES.has(w) || !known(w));
      st.facts[k.replace(/ name$/, '')] = /name/.test(k) || /name is|called|named/.test(t) || person ? Cap(v) : v;
      if (Object.keys(st.facts).length > 24) delete st.facts[Object.keys(st.facts)[0]];
      return say(c, 'resp.fact_ok', { k: k.replace(/ name$/, ''), v: st.facts[k.replace(/ name$/, '')] });
    },
    forget: (c) => { Object.assign(c.st, { name: '', age: 0, place: '', role: '', likes: [], dislikes: [], notes: [], facts: {}, askedName: false }); return undefined; },
    like_set: (c) => {
      const t = c.text, st = c.st;
      let m;
      if ((m = t.match(/^my (?:favorite|fav|best|most favorite) (.+?) (?:is|are|would be|has to be) (.+)$/))) { if (m[1].split(' ').length > 3 || m[2].split(' ').length > 6) return null; st.facts[`favorite ${m[1]}`] = m[2]; return say(c, 'resp.fact_ok', { k: `favorite ${m[1]}`, v: m[2] }); }
      if ((m = t.match(/^(.+?) (?:is|are) my (?:favorite|fav)(?: (.+))?$/))) { if (m[1].split(' ').length > 5) return null; if (m[2]) { st.facts[`favorite ${m[2]}`] = m[1]; return say(c, 'resp.fact_ok', { k: `favorite ${m[2]}`, v: m[1] }); } st.likes = [...new Set([...st.likes, m[1]])].slice(-12); return say(c, 'resp.like_ok', { x: m[1], X: cap(m[1]) }); }
      let x = (c.slots.x || '').replace(/ (?:do you|what about you|and you|how about you|too|a lot|very much|so much|the most)$/, '').replace(/^(?:to |the |a |an )/, '').trim();
      if (!x || x.split(' ').length > 6 || /^(you|your|it|that|this|how|what|when|the way|him|her|them|myself|me)\b/.test(x) || c.n.question && !/ (do you|and you)$/.test(t)) return null;
      const dislike = /^i (?:hate|dislike|do not|can not stand|am not|am afraid|am scared|am allergic|am tired of|am sick of|am bored of|really hate|really dislike|never liked)\b/.test(t);
      if (/^(?:mujhe|mujhko|malai|malaai)\b/.test(t)) x = (c.slots.x || '').trim();
      if (dislike) { st.dislikes = [...new Set([...st.dislikes, x])].slice(-12); st.likes = st.likes.filter((y) => y !== x); return say(c, 'resp.dislike_ok', { x }); }
      st.likes = [...new Set([...st.likes, x])].slice(-12); st.dislikes = st.dislikes.filter((y) => y !== x);
      return say(c, 'resp.like_ok', { x, X: cap(x) });
    },
    statement_self: (c) => {
      const mm = c.text.match(/^i (?:am|work as|am working as|want to be|want to become|will be|will become|am going to be|am going to become|wish to be|hope to be|dream of being|dream of becoming|used to be) (?:a|an) (.+)$/);
      const x = (c.slots.x || (mm ? mm[1] : '')).replace(/ (now|too|also|by profession|by the way)$/, '').trim();
      if (!x) return say(c, 'resp.interest');
      if (x.split(' ').length > 4 || c.n.question || feelIndex().has(x) || /^(bit|little|lot|kind|sort|fan|big fan|huge fan)\b/.test(x) || RUDE.has(x)) return null;
      if (/^i (?:want|will|am going|wish|hope|dream)\b/.test(c.text)) return say(c, 'resp.ambition', { x, a: article(x), A: cap(article(x)) });
      if (/^i used to be\b/.test(c.text)) return say(c, 'resp.interest');
      c.st.role = x;
      return say(c, 'resp.role_ok', { x, a: article(x), A: cap(article(x)) });
    },
    statement: (c) => { const v = valence(c.tokens); return say(c, v > 0 ? 'resp.interest_pos' : v < 0 ? 'resp.interest_neg' : 'resp.interest'); },
    advice: (c) => {
      if (c.slots.x == null && !/^(should|shall|must) i \w+|\bi should \w+|^which .*should i\b/.test(c.text)) return say(c, 'resp.advice');
      const q = c.raw.replace(/[!.\s]+$/, '');
      const r = say(c, 'resp.advice_search');
      return r ? { ...r, expect: 'search', expectData: q, chips: [searchChip(q)] } : null;
    },
    question_about: (c) => { const x = (c.slots.x || '').trim(); if (!x || x.split(' ').length > 8) return null; return say(c, 'resp.question_about', { x }); },
    // ---- fun
    again: (c) => {
      const l = c.st.last;
      const REPEAT = { 'fun.joke': 1, 'fun.riddle': 1, 'fun.fact': 1, 'fun.story': 1, 'fun.poem': 1, 'fun.quote': 1, 'fun.sing': 1, 'game.wyr': 1, 'game.rps': 1, 'game.guess': 1, 'skill.coin': 1, 'skill.dice': 1, 'skill.random': 1, 'fun.cheer': 1 };
      if (l && l.k === 'brain' && REPEAT[l.i]) {
        const it = D().byId.get(l.i);
        if (it && it.handler && H[it.handler]) { const r = H[it.handler]({ ...c, slots: {}, intent: it }); return r ? { ...r, intent: it } : r; }
        if (it) { const r = chooseReply(c, it); return r ? { ...r, intent: it } : null; }
      }
      if (l && l.k === 'web') return { pass: { question: /^(again|do it again|one more time please|feri|pheri)$/.test(c.text) ? 'double-check that' : 'tell me more' } };
      return undefined;                                                    // "another what?"
    },
    joke: (c) => {
      const jokes = D().fun.jokes;
      const topic = (c.slots.x || '').split(' ').filter((w) => w.length > 2 && !STOP.has(w));
      let i = -1;
      if (topic.length) { const hits = jokes.map((j, k) => ((j[2] || '').split(' ').some((w) => topic.some((t) => t === w || t === w + 's' || t + 's' === w)) ? k : -1)).filter((k) => k >= 0 && !(c.st.seen.j || []).includes(k)); if (hits.length) { i = hits[Math.floor(c.rand() * hits.length)]; c.st.seen.j = [...(c.st.seen.j || []), i].slice(-80); } }
      const miss = topic.length && i < 0;
      if (i < 0) i = pickUnseen(c, 'j', jokes.length);
      const [a, b] = jokes[i];
      const lead = miss ? `I don't have one about ${c.slots.x}, but here's another. ` : '';
      return { text: `${lead}${a} ${b}`, blocks: [P(lead + a), P(b)], chips: ['Another joke', 'Give me a riddle'], origin: 'memory' };
    },
    riddle: (c) => { const R = D().fun.riddles; const i = pickUnseen(c, 'r', R.length); return { text: `Here's one. ${R[i][0]}`, blocks: [P("Here's one."), P(R[i][0], { strong: true }), P('Type your answer, or say "I give up".')], expect: 'riddle', expectData: `${i}:0`, chips: ['I give up'], origin: 'memory' }; },
    funfact: (c) => { const F = D().fun.facts; const i = pickUnseen(c, 'f', F.length); return { text: F[i][0], blocks: [P(F[i][0]), { type: 'note', tone: 'info', text: 'This one is from my built-in memory, not a live source. Tap the suggestion below to check it on the web.' }], chips: [searchChip(F[i][1]), 'Another fun fact'], origin: 'memory' }; },
    story: (c) => { const S = D().fun.stories; const i = pickUnseen(c, 's', S.length); return { text: `${S[i][0]}. ${S[i][1]}`, blocks: [{ type: 'heading', text: S[i][0], level: 3 }, P(S[i][1])], chips: ['Another story', 'Tell me a joke'], origin: 'memory' }; },
    poem: (c) => {
      const Pm = D().fun.poems; const i = pickUnseen(c, 'p', Pm.length);
      const lines = Pm[i][1].split(' / ');
      return { text: `${Pm[i][0]}. ${lines.join(' ')}`, blocks: [{ type: 'heading', text: Pm[i][0], level: 3 }, ...lines.map((l) => P(l)), { type: 'note', tone: 'info', text: 'A rhyme from my built-in collection. I recite; I cannot compose new poems.' }], chips: ['Another poem'], origin: 'memory' };
    },
    sing: (c) => {
      const So = D().fun.songs;
      const i = /birthday/.test(c.text) ? 1 : /lullaby/.test(c.text) ? 2 : /rap|beat/.test(c.text) ? 0 : pickUnseen(c, 'g', So.length);
      const lines = So[i][1].split(' / ');
      return { text: `I can't really sing, since I have no voice, but here are the words. ${lines.join(' ')}`, blocks: [P("I can't really sing, since I have no voice, but here are the words:"), ...lines.map((l) => P(l))], origin: 'memory' };
    },
    quote: (c) => { const Q = D().fun.quotes; const i = pickUnseen(c, 'q', Q.length); const lead = ['Here is a thought for you:', 'One to keep in your pocket:', 'Try this one:'][Math.floor(c.rand() * 3)]; return { text: `${lead} “${Q[i][0]}”`, blocks: [P(lead), P(`“${Q[i][0]}”`, { strong: true })], chips: ['Another one', 'Tell me a joke'], origin: 'memory' }; },
    game_menu: () => ({ text: 'I know a few games that work in text. Pick one: rock-paper-scissors, guess the number, a riddle, or "would you rather".', chips: ['Rock paper scissors', 'Guess the number', 'Give me a riddle', 'Would you rather'] }),
    rps: (c) => sk.rps(c),
    guess_start: (c) => { const target = 1 + Math.floor(c.rand() * 20); return { text: "I'm thinking of a whole number from 1 to 20. What's your first guess?", expect: 'guess', expectData: `${target}:0`, origin: 'skill' }; },
    wyr: (c) => { const W = D().fun.wyr; const i = pickUnseen(c, 'w', W.length); return { text: W[i][0], expect: 'wyr', origin: 'memory' }; },
    knock: () => ({ text: "Who's there?", expect: 'kk1' }),
    // ---- skills
    time: (c) => sk.timeSkill(c), date: (c) => sk.dateSkill(c), coin: (c) => sk.coin(c), dice: (c) => sk.dice(c), random: (c) => sk.random(c), choose: (c) => sk.choose(c),
    spell: (c) => sk.spell(c), reverse: (c) => sk.reverse(c), count: (c) => sk.count(c), letters: (c) => sk.letters(c), echo: (c) => sk.echo(c), alphabet: (c) => sk.alphabet(c),
    math_words: (c) => sk.mathWords(c), days_in_month: (c) => sk.daysInMonth(c), order_after: (c) => sk.orderAfter(c), color_mix: (c) => sk.colorMix(c), shape_sides: (c) => sk.shapeSides(c), big_number: (c) => sk.bigNumber(c),
    repeat: (c) => {
      const l = c.st.last;
      if (l && l.k === 'web') return { text: "My last answer is just above this message, with its sources. If it was unclear, say “explain that more simply” and I'll rebuild it from easier sentences." };
      if (c.st.lastText) return { text: `I said: ${c.st.lastText}` };
      return { text: "I haven't said anything yet in this conversation. Ask me something!" };
    },
    weather: (c) => {
      const t = c.text;
      const when = /\btomorrow\b/.test(t) ? ' tomorrow' : /\b(week|weekend)\b/.test(t) ? ' this week' : ' today';
      return placeBound(c, `weather in {place}${when}`, 'the weather');
    },
    // ---- things I cannot do
    device: (c) => {
      const t = c.text;
      const m = t.match(/^(call|text|message|email|phone|dial|ring|facetime|video call|whatsapp|reply to) (.+)$/);
      if (m) {
        const x = m[2].replace(/ (please|now|for me|right now)$/, '');
        const polite = x !== m[2];
        const toks = x.split(' ');
        if (toks.length > 3 || toks.some((w) => /^(of|to|in|for|on|about|meaning|history|vs|and|or|from|with|is|are|by)$/.test(w))) return null;
        if (!(DEVICE_KIN.test(x) || polite || toks.every((w) => !known(w) || FIRST_NAMES.has(w)))) return null;
      }
      return undefined;                                   // accept: use the intent's own replies
    },
    create: (c) => {
      const t = c.text;
      const x = (c.slots.x || '').trim();
      const kind = (t.match(/\b(essay|paragraph|article|blog post|blog|letter|email|mail|application|cover letter|resume|cv|speech|report|summary|review|caption|captions|bio|tweet|post|status|message|script|dialogue|lyrics|slogan|tagline|title|description|introduction|conclusion|outline|thesis|assignment|homework|notes|presentation|ppt|proposal|plan|invitation|wish|code|program|function|query|regex|formula|website|app|story|poem|song|joke|image|picture|photo|drawing|painting|logo|poster|banner|wallpaper|icon|avatar|portrait|illustration|art|artwork|meme|video|animation|gif|diagram|chart|graph|map|thumbnail|sticker|cartoon)\b/) || [])[1] || '';
      if (/^(story|poem|song|joke)$/.test(kind) && x && /^(write|compose|create|generate|make|prepare|draft|type)\b/.test(t)) {
        const base = kind === 'joke' ? H.joke({ ...c, slots: { x } }) : kind === 'story' ? H.story(c) : kind === 'poem' ? H.poem(c) : H.sing(c);
        const note = `I can't write a new ${kind} about ${x}: I have no language model, only a small collection I can recite. Here is one from it.`;
        return { ...base, text: `${note} ${base.text}`, blocks: [P(note), ...(base.blocks || [P(base.text)])] };
      }
      if (/^(summary|review|description|introduction|outline|notes|report|article)$/.test(kind) && x && /^(write|give|make|prepare|create|generate|draft|type|compose)\b/.test(t) && !/\b(my|this|the following)\b/.test(x)) return { pass: { question: /^(summary|outline|notes)$/.test(kind) ? `Summarize ${x}` : `Explain ${x}`, preface: `I can't write original text, but I can gather what the sources say about ${x}:` } };
      if (/\b(image|picture|photo|drawing|painting|logo|poster|banner|wallpaper|icon|avatar|portrait|illustration|art|artwork|meme|video|animation|gif|sticker|cartoon|thumbnail)\b/.test(kind) || /^(draw|sketch|paint|design|render)\b/.test(t)) return { text: "I can't draw or create images. I work only with text. If you want to see what something looks like, an image search engine will serve you better; I can still tell you what the web says about it.", chips: x && x.split(' ').length <= 8 ? [searchChip(x)] : [] };
      if (/\b(code|program|function|script|query|regex|formula|website|app|html|sql|python|javascript|java)\b/.test(t)) return { text: "I can't write or fix code. I have no language model inside, so I can't compose anything new. What I can do is find documentation and worked examples: ask me a specific question such as “how do I sort a list in Python?” and I'll search for it." };
      if (/^(summarize|summarise|paraphrase|rewrite|rephrase|proofread|edit|correct|fix|improve|check|translate|debug|review|explain|optimize|refactor)\b/.test(t)) return { text: "I can't rework text or code that you paste to me. I don't have a language model, so I can't rewrite, translate or correct. I can look up a rule or an example if you ask me a specific question, and I can summarise a public web page if you give me its address." };
      if (/\b(homework|assignment|exam|test|coursework|thesis|project)\b/.test(t) && /^(do|solve|finish|complete|help|can you do|will you do)\b/.test(t)) return { text: "I can't do the work for you, and I wouldn't be good at it: I can't write original text. But ask me the actual questions from it, one at a time, and I'll look each one up and show you where the answer comes from." };
      const topic = x && x.split(' ').length <= 10 ? x : '';
      return { text: `I can't write ${kind ? `${article(kind)} ${kind}` : 'that'} for you. I have no language model, so I can't compose original text. ${topic ? `What I can do is gather key points about ${topic} from the web, each with its source, for you to write from. Shall I?` : 'I can look up facts and examples for you to write from, though.'}`, ...(topic ? { expect: 'search', expectData: topic, chips: [searchChip(topic)] } : {}) };
    },
  };

  // -------------------------------------------------------------------------------------------------------------------
  /** Turn a handler/reply result into the final answer. */
  function finish(c, r, intent, extra = {}) {
    const st = c.st;
    if (r.pass) return { handled: false, question: r.pass.question || '', preface: [c.preface, r.pass.preface].filter(Boolean).join(' '), state: st, settings: r.pass.settings || null };
    let text = r.text || '';
    let blocks = r.blocks || text.split('\n\n').filter(Boolean).map((x) => P(x));
    if (c.preface) { blocks = [P(c.preface), ...blocks]; text = `${c.preface} ${text}`; }
    st.expect = r.expect ? { t: r.expect, d: str(r.expectData || '', 300) } : null;
    if (r.expect === 'name') st.askedName = true;
    const it = r.intent || intent;
    st.last = { k: 'brain', i: it ? it.id : (extra.id || ''), g: it ? it.group : (extra.group || ''), lvl: '', pct: 0, n: 0, t: st.last && st.last.k === 'web' ? st.last.t : '' };
    st.lastText = str(text, 400);
    st.turn += 1;
    const city = cityOf(c);
    const chips = [...new Set([...(r.chips || []), ...((it && !r.chips && it.chips) || [])])].map((x) => x.replace('{city}', city)).filter((x) => !/\{\w+\}/.test(x) && !/ in $/.test(x)).slice(0, 4);
    return { handled: true, text, blocks, suggestions: chips, state: st, origin: r.origin || extra.origin || 'conversation', intent: it ? it.id : (extra.id || ''), group: it ? it.group : (extra.group || ''), sure: r.sure !== false };
  }

  /** Answer with an intent: its handler first, then its own replies. Returns a result or null. */
  function useIntent(c, intent, slots = {}, vars = {}) {
    const cc = { ...c, slots, intent };
    if (intent.handler) {
      const h = H[intent.handler];
      const r = h ? h(cc) : null;
      if (r === null) return null;                                         // the handler declined: try something else
      if (r) return finish(c, r, r.intent || intent);
    }
    const r = chooseReply(c, intent, vars);
    return r ? finish(c, r, intent) : null;
  }

  const isYes = (c) => { const o = lookup(c.tokens); return !!o && o.intents.some((i) => i.id === 'ack.yes') || /^(ok|sure|please|yes please|go ahead|do it|alright|fine|ok sure|ok go|yes do it|please do|go on|why not|you may|search|search it|look it up|do that)$/.test(c.text); };
  const isNo = (c) => { const o = lookup(c.tokens); return !!o && o.intents.some((i) => i.id === 'ack.no' || i.id === 'skill.stop') && !/^nothing/.test(c.text); };

  /** A reply that only makes sense as an answer to what the brain just asked. */
  function resolveExpect(c, e) {
    const t = c.text, st = c.st;
    const own = lookup(c.tokens);
    const strong = own && own.intents[0];                                   // the message also means something by itself
    const isQuestion = c.n.question || /^(what|who|where|when|why|how|which|is|are|do|does|did|can|could|will|would|should)\b/.test(t);
    const reply = (id, vars) => { const r = say(c, id, vars); return r ? finish(c, r, r.intent) : null; };
    switch (e.t) {
      case 'name': {
        if (/^(no|nope|not telling|i will not tell|i wont tell|secret|it is a secret|why|why do you ask|none of your business|i do not want to|rather not|i would rather not|no thanks|skip|never mind|guess)\b/.test(t)) return reply('resp.name_decline');
        if (strong && !/^(user\.name_set)$/.test(strong.id)) return null;
        const m = t.match(/^(?:it is|its|i am|my name is|call me|this is|me|myself|name is|the name is|you can call me|just)? ?(.+)$/);
        const r = m && cleanName(m[1], c, true);
        if (!r) return null;
        st.name = r.name;
        return reply('resp.name_ok', { name: r.name });
      }
      case 'day': case 'mood': {
        if (/^(nothing|nothing much|not much|nm|nothing special|nothing new|same old|the usual|as usual|just chilling|chilling|nothing really)$/.test(t) && e.t === 'mood') return reply('resp.nothing');
        const f = parseFeeling(c.tokens, true);
        if (f) {
          if (e.t === 'day' && ['happy', 'excited', 'proud'].includes(f.cls) && !f.ask) return reply('resp.day_good');
          if (e.t === 'day' && f.cls === 'soso' && !f.ask) return reply('resp.day_ok');
          return reply(`feel.${f.cls}`, { q: f.ask });
        }
        if (own && own.intents.some((i) => i.id === 'resp.doing')) return useIntent(c, D().byId.get('resp.doing'));
        if (e.t === 'day' && !isQuestion && !strong && c.tokens.length >= 2) { const v = valence(c.tokens); return reply(v > 0 ? 'resp.day_good' : v < 0 ? 'resp.day_bad' : 'resp.day_ok'); }
        return null;
      }
      case 'near': {
        const cut = e.d.indexOf('|');
        const city = e.d.slice(0, cut), template = e.d.slice(cut + 1);
        if (!template) return null;
        if (isYes(c)) return city ? finish(c, { pass: { question: template.replace('{place}', city) } }) : null;
        if (isNo(c)) return reply('resp.ok_no');
        if (c.tokens.length > 8 || strong) return null;
        const x = t.replace(/^(?:(?:no|nope|not there|actually|not|wrong) )+/, '').replace(/^(?:i am in|i live in|i am from|i am at|it is|in|at|near|try|check|for|search|i am|we are in) /, '').replace(/^(the|a) /, '').replace(/ (please|then|instead|city|area)$/, '').trim();
        if (!x || x.split(' ').length > 4 || /^(me|here|there|it|that|this|my|home|nowhere|idk)$/.test(x) || isQuestion) return null;
        const place = x.split(' ').map(cap).join(' ');
        st.place = place;
        return finish(c, { pass: { question: template.replace('{place}', place) } });
      }
      case 'joke': if (isYes(c)) return useIntent(c, D().byId.get('fun.joke')); if (isNo(c)) return reply('resp.ok_no'); return null;
      case 'ate': if (isYes(c) || /^(i did|i have|i ate|yes i (did|have|ate)|just ate|already)\b/.test(t)) return reply('resp.ate_yes'); if (isNo(c) || /^(not yet|i did not|i have not|no i (did not|have not))\b/.test(t)) return reply('resp.ate_no'); return null;
      case 'deeper': if (isYes(c)) return finish(c, { pass: { question: 'double-check that' } }); if (isNo(c)) return reply('resp.ok_no'); return null;
      case 'search': if (isYes(c) && e.d) return finish(c, { pass: { question: e.d } }); if (isNo(c)) return reply('resp.ok_no'); return null;
      case 'tellmore': case 'tellmore2': case 'vent': case 'vent2': case 'wyr': {
        if (isQuestion || (strong && !['ack', 'user', 'feel'].includes(strong.group) && !/^resp\./.test(strong.id))) return null;
        if (strong && (strong.id === 'ack.no' || strong.id === 'ack.maybe' || strong.id === 'ack.ok' || strong.id === 'skill.stop')) return e.t.startsWith('vent') ? reply('resp.ok_no') : null;
        if (strong && strong.group === 'feel') return null;
        if (c.tokens.length < 2 && !/^(yes|ok)$/.test(t)) return null;
        const venting = e.t === 'vent' || e.t === 'vent2';                    // while someone is telling their troubles, "my friend is ..." is part of the story
        if (ruleMatches(t).some((x) => x.intent.handler && (venting ? x.intent.id === 'user.name_set' || ['skill', 'know', 'cant', 'fun'].includes(x.intent.group) : ['user', 'skill', 'know', 'cant', 'fun'].includes(x.intent.group))) || (!venting && parseFeeling(c.tokens, false))) return null;   // "my name is ...", "i live in ..." mean something of their own
        if (/^(?:please |can you |could you )?(?:search|google|look up|find|tell me|show me|explain|define|what|who|how|why|when|where)\b/.test(t)) return null;
        if (e.t === 'wyr') return finish(c, { text: ['Interesting choice! I can see the appeal.', 'A solid pick. I would never have guessed.', 'Good answer. There is no wrong one, of course.'][Math.floor(c.rand() * 3)] + ' Want another?', chips: ['Would you rather', 'Tell me a joke'] }, D().byId.get('game.wyr'));
        if (e.t === 'vent') return reply('resp.listen');
        if (e.t === 'vent2') return reply('resp.listen2');
        const v = valence(c.tokens);
        const r = say(c, v > 0 ? 'resp.interest_pos' : v < 0 ? 'resp.interest_neg' : 'resp.interest');
        if (r && e.t === 'tellmore2') r.expect = '';
        return r ? finish(c, r, r.intent) : null;
      }
      case 'riddle': {
        const [i, tries] = e.d.split(':').map(Number);
        const R = D().fun.riddles[i];
        if (!R) return null;
        const it = D().byId.get('fun.riddle');
        if (/^(i give up|give up|i do not know|do not know|no idea|tell me|tell me the answer|what is it|what is the answer|the answer|answer|pass|skip|i quit|show me|show answer|reveal|i can not guess|i have no idea|no clue|what)$/.test(t)) return finish(c, { text: `The answer is: ${R[1]}. Want another?`, chips: ['Give me a riddle', 'Tell me a joke'], origin: 'memory' }, it);
        if (/^(hint|a hint|give me a hint|clue|give me a clue|help)$/.test(t)) { const a = R[1].replace(/^(a|an|the|your) /, ''); return finish(c, { text: `Hint: the answer has ${a.replace(/[^a-z]/gi, '').length} letters and starts with “${a[0].toUpperCase()}”.`, expect: 'riddle', expectData: `${i}:${tries}`, origin: 'memory' }, it); }
        if (strong && !['ack'].includes(strong.group) && c.tokens.length > 3) return null;
        if (c.tokens.length > 7 || (c.tokens.length >= 3 && /^(?:please )?(?:what|who|whom|whose|where|when|why|how|which|tell me|show me|search|explain|define|describe|can you|could you|do you|did you|will you|are you|give me|find)\b/.test(t) && !/^(?:what|how) about\b/.test(t))) return null;   // a new question, not a guess
        const guess = t.replace(/^(is it|it is|its|i think it is|i think|maybe|i guess|the answer is|answer is|could it be|is the answer|what about|how about)\s+/, '').replace(/^(a|an|the|your|my) /, '').replace(/\?$/, '').trim();
        const okAns = R[2].some((a) => a && (a === guess || guess === a + 's' || a === guess + 's' || guess.endsWith(' ' + a) || (a.length > 4 && guess.includes(a))));
        if (okAns) return finish(c, { text: `Correct! The answer is ${R[1]}. Well done. Another one?`, chips: ['Give me a riddle', 'Tell me a joke'], origin: 'memory' }, it);
        if (tries >= 1) return finish(c, { text: `Not quite. The answer is: ${R[1]}. Want to try another?`, chips: ['Give me a riddle'], origin: 'memory' }, it);
        return finish(c, { text: 'Not quite. Have another guess, or say "hint" or "I give up".', expect: 'riddle', expectData: `${i}:${tries + 1}`, chips: ['Hint', 'I give up'], origin: 'memory' }, it);
      }
      case 'guess': {
        const [target, tries] = e.d.split(':').map(Number);
        const it = D().byId.get('game.guess');
        if (/^(i give up|give up|stop|quit|tell me|what is it|i quit|exit|end)$/.test(t)) return finish(c, { text: `It was ${target}. Thanks for playing!`, origin: 'skill' }, it);
        const g = sk.toNumber(t.replace(/^(is it|it is|i guess|my guess is|maybe|i think it is|i think)\s+/, ''));
        if (g == null || !Number.isInteger(g)) return null;
        if (g === target) return finish(c, { text: `Yes! It was ${target}. You got it in ${tries + 1} ${tries === 0 ? 'guess. Remarkable.' : 'guesses.'} Play again?`, chips: ['Guess the number', 'Rock paper scissors'], origin: 'skill' }, it);
        if (g < 1 || g > 20) return finish(c, { text: 'My number is between 1 and 20. Try again.', expect: 'guess', expectData: e.d, origin: 'skill' }, it);
        return finish(c, { text: `${g < target ? 'Higher' : 'Lower'}. Guess again.`, expect: 'guess', expectData: `${target}:${tries + 1}`, origin: 'skill' }, it);
      }
      case 'rps': if (/^(rock|stone|paper|scissors|scissor)$/.test(t)) return finish(c, sk.rps(c), D().byId.get('game.rps')); if (isNo(c)) return reply('resp.ok_no'); if (isYes(c)) return finish(c, sk.rps({ ...c, text: 'rps' }), D().byId.get('game.rps')); return null;
      case 'userjoke': if (strong && strong.group !== 'ack' && c.tokens.length < 3) return null; return finish(c, isQuestion ? { text: ["I don't know. Tell me!", "Hmm, I give up. What's the answer?", 'No idea. Go on.'][Math.floor(c.rand() * 3)], expect: 'userjoke2' } : { text: ['Ha! Good one. I may borrow that.', "That's a good one! Thanks for sharing it.", 'Ha! I like it.'][Math.floor(c.rand() * 3)] }, D().byId.get('game.userjoke'));
      case 'userjoke2': return finish(c, { text: ['Ha! Good one.', "Ah, clever! I didn't see that coming.", 'Ha! I walked right into that.'][Math.floor(c.rand() * 3)] }, D().byId.get('game.userjoke'));
      case 'kk1': if (c.tokens.length > 6 || isQuestion) return null; return finish(c, { text: `${cap(t)} who?`, expect: 'kk2' }, D().byId.get('game.knock'));
      case 'kk2': return finish(c, { text: ['Ha! Good one.', 'Ha! That got me.', "That's a good one!"][Math.floor(c.rand() * 3)] }, D().byId.get('game.knock'));
      default: return null;
    }
  }

  const QPREF = new Set(['convo.agree_check', 'ack.really', 'meta.sure', 'bot.howareyou', 'chat.test']);
  const pickOwner = (c, owners) => (owners.length > 1 && c.n.question ? owners.find((i) => QPREF.has(i.id)) || owners[0] : owners[0]);

  /** The core matcher for one message (or one part of a message). Returns a finished answer, a pass, or null. */
  function core(c, depth = 0) {
    const t = c.text, tokens = c.tokens;
    // 1. exact phrase
    const hit = lookup(tokens);
    if (hit) {
      const order = [pickOwner(c, hit.intents), ...hit.intents];
      let rm = null;
      for (const it of [...new Set(order)]) {
        let slots = {};
        if (it.handler) { rm = rm || ruleMatches(t); const m = rm.find((x) => x.intent === it); if (m) slots = m.slots; }          // an imported phrasing may still carry a slot ("time in tokyo")
        const r = useIntent(c, it, slots);
        if (r) return r;
      }
    }
    // 2. feelings
    const f = parseFeeling(tokens, false);
    if (f) { const r = say(c, `feel.${f.cls}`, { q: f.ask }); if (r) return finish(c, r, r.intent); }
    // 3. patterns with slots
    for (const m of ruleMatches(t)) { const r = useIntent(c, m.intent, m.slots); if (r) return r; }
    // 4. everyday common sense
    const cs = sense.answer(t);
    if (cs && cs.text) {
      const blocks = [P(cs.text)];
      if (!cs.sure) blocks.push({ type: 'note', tone: 'info', text: 'This comes from my built-in common-sense notes, which are broad but not checked against live sources. Tap the suggestion below to verify it on the web.' });
      return finish(c, { text: cs.text, blocks, chips: [searchChip(c.raw.replace(/\s+/g, ' ').trim().slice(0, 200))], origin: 'commonsense', sure: cs.sure }, null, { id: 'sense', group: 'sense' });
    }
    if (cs && cs.web) return finish(c, { pass: {} });
    // 5. typing slips
    if (depth === 0 && tokens.length <= 8) {
      const fixed = correctTypos(tokens);
      if (fixed) {
        const h2 = lookup(fixed);
        if (h2) for (const it of h2.intents) { const r = useIntent({ ...c, tokens: fixed, text: fixed.join(' ') }, it); if (r) return r; }
        const f2 = parseFeeling(fixed, false);
        if (f2) { const r = say(c, `feel.${f2.cls}`, { q: f2.ask }); if (r) return finish(c, r, r.intent); }
      }
    }
    return null;
  }

  const SAFE_PREFIX = new Set(['greet', 'thanks']);
  const SAFE_WORDS = /^(ok|okay|alright|yes|yeah|yep|no|nope|hmm|lol|oh|ah|wow|sorry|please|thanks|thank you|hi|hello|hey|namaste|well|so|and|but|sure|fine)$/;
  const STARTER = /^(what|who|whom|whose|where|when|why|how|which|is|are|was|were|do|does|did|can|could|will|would|should|tell|explain|give|show|define|describe|find|search|list|name|compare|i|you|my|your|please|now|so|and|but|then|also|let|there|it|this|that)$/;
  const PREFACE = { greet: (st) => (st.name ? `Hello, ${st.name}!` : 'Hello!'), thanks: () => "You're welcome!", feedback: () => '', ack: () => '', bye: () => '' };

  /** "Thanks! What is a computer?" → a social opening plus the real message. */
  function splitOpening(c) {
    const words = c.raw.trim().split(/\s+/);
    for (let j = Math.min(4, words.length - 2); j >= 1; j--) {
      const head = words.slice(0, j).join(' ');
      const punct = /[,.!?;:]$/.test(head) || /^[-–—]/.test(words[j]);
      const hn = normalize(head, known);
      if (!hn.tokens.length) continue;
      const owners = ownersOf(hn.text);
      const o = owners[0];
      if (!o || !['greet', 'thanks', 'ack', 'feedback'].includes(o.group)) continue;
      if (/^(greet\.night|greet\.other_bot|chat\.|fb\.(wrong|bad_answer|insult|ugly|boring|notfunny|fired|repeat_complaint)|ack\.(really|hmm)|meta\.)/.test(o.id)) continue;
      const rest = words.slice(j).join(' ').replace(/^[-–—,.\s]+/, '');
      const rn = normalize(rest, known);
      if (rn.tokens.length < 2) continue;
      const safe = SAFE_PREFIX.has(o.group) || SAFE_WORDS.test(hn.text);
      if (!(punct || (safe && STARTER.test(rn.tokens[0])))) continue;
      return { intent: o, rest, rn };
    }
    return null;
  }

  /** Is this a request for knowledge about the world (as opposed to conversation)? */
  /** "can you ...", "i need you to ...", "help me ...", "i want to ...": who is asked to do what. */
  function parseRequest(t) {
    let m, mode = 'bare', help = false;
    let s = t;
    if ((m = s.match(/^(?:(?:can|could|would|will) (?:you|u)|i (?:need|want|would like)(?: for)? (?:you|u) to|would you mind|is there any way (?:you|u) (?:can|could)|are you able to|see if you can|you (?:should|must|need to|have to)|i (?:need|want) (?:you|u) to) (.+)$/))) { mode = 'addressed'; s = m[1]; }
    else if ((m = s.match(/^i (?:need|want|would like|have|wish|am trying|am going|am looking|gotta|got) to (.+)$/))) { mode = 'self'; s = m[1]; }
    s = s.replace(/^(?:(?:please|kindly|just|also|now|quickly|really|actually|possibly|maybe|go ahead and|go and|try to|try and) )+/, '');
    if ((m = s.match(/^help (?:me|us) (?:to |with |in |on )?(.+)$/))) { help = true; s = m[1]; }
    const tk = s.split(' ');
    return { mode, help, verb: tk[0] || '', body: s, n: tk.length };
  }

  /**
   * Last stage: nothing stored matched. Decide between the web, an honest "I can't do that",
   * a question about myself that I can't answer, and a short friendly remark.
   * Returns a finished reply, or { web: true, question? }.
   */
  function triage(c0) {
    let tk = c0.tokens;
    while (tk.length > 2 && LEAD.has(tk[0])) tk = tk.slice(1);
    const t = tk.join(' ');
    const c = { ...c0, tokens: tk, text: t };
    const first = tk[0], second = tk[1] || '';
    const WEB = { web: true };
    const hasYou = tk.some((w) => w === 'you' || w === 'your' || w === 'yourself' || w === 'yours');
    const hasMe = tk.some((w) => /^(i|my|me|we|our|us|myself|mine)$/.test(w));
    const personal = PERSONAL_NOUN.test(t);
    const rawQ = c0.raw.replace(/[?!.\s]+$/, '').trim();
    const reply = (id, vars, chip) => { const r = say(c, id, vars); if (!r) return WEB; if (chip) r.chips = [...new Set([searchChip(chip), ...(r.chips || [])])].slice(0, 3); return finish(c, r, r.intent); };
    const ri = tk.findIndex((w) => RUDE.has(w));
    if (ri >= 0) {
      const gap = tk.slice(0, ri);
      const yi0 = Math.max(gap.lastIndexOf('you'), gap.lastIndexOf('u'), gap.lastIndexOf('your'), gap.lastIndexOf('ur'));
      const between = yi0 >= 0 ? tk.slice(yi0 + 1, ri) : null;
      const aimed = (between && between.length <= 5 && between.every((w) => RUDE.has(w) || /^(are|r|re|is|a|an|so|such|really|very|just|one|totally|the|too|all|pretty|kinda|absolutely|completely|bloody|little|big|real|total|complete|being|sound|look|answer|answers|reply|replies|bot|ai|not|but|still|always|only|was|were|answered|something|nothing|anything)$/.test(w))) || /^(you|u|off|up)$/.test(tk[ri + 1] || '');
      if (aimed && tk.length <= 12) return reply('fb.insult');
      if (tk.length <= 3) return reply('safety.swear');
    }

    const wh = WHQ.test(first), aux = AUXQ.test(first);
    let m;

    // 0. depends on where the user is
    if (NEAR.test(c0.raw) && tk.length >= 2 && tk.length <= 16) {
      const r = placeBound(c, rawQ.replace(NEAR, 'in {place}'), 'that');
      return r.pass ? { web: true, question: r.pass.question } : finish(c, r, null, { id: 'resp.near', group: 'user' });
    }
    if ((m = t.match(/^(?:what|how much) (?:do|did) you know (?:about|of|regarding) (.+)$/)) || (m = t.match(/^what (?:can|could) you (?:tell|say|teach) (?:me |us )?(?:about|of|regarding) (.+)$/)) || (m = t.match(/^(?:have you|did you|do you) (?:ever )?(?:heard?|hear|know|read) (?:anything |something |much )?(?:about|of) (.+)$/))) {
      if (!/^(me|myself|you|yourself|us|it|that|this|them|him|her|my|your)\b/.test(m[1])) return { web: true, question: m[1] };
    }

    // 1. requests
    if (!wh) {
      const rq = parseRequest(t);
      const info = INFO_VERB.has(rq.verb), device = DEVICE_VERB.has(rq.verb);
      if (rq.mode !== 'bare' || rq.help || info || device) {
        if (/^let (me|us) know\b/.test(rq.body)) return WEB;
        if (rq.help && rq.n >= 2) return personal && device ? reply('cant.device') : { web: true, question: `how to ${rq.body}` };
        if (info) {
          if (/^tell me (something|more|about (you|yourself|your)|a |an |your |my |the truth|honestly|why you|how you|what you|who you|if you)\b/.test(rq.body) && !/^tell me (a|an) (bit|little|lot) about\b/.test(rq.body) && !/^tell me (a|an|the) [a-z]+ (of|about|for|between)\b/.test(rq.body) && !/^tell me (something|more) (about|on|regarding) (?!you\b|yourself\b|your\b|me\b|my\b)/.test(rq.body)) {
            if (/\b(you|your|yourself)\b/.test(rq.body)) return reply('resp.self_unknown', {}, rawQ);
            if (/^tell me (something|more)$/.test(rq.body)) return reply('bot.capabilities');
          } else if (personal && rq.n <= 12) return reply('cant.personal');
          else if (rq.n >= 2) return WEB;
        }
        if (device) {
          if (rq.mode === 'self') return personal && rq.n >= 2 ? reply('resp.do_yourself', {}, `how to ${rq.body}`) : WEB;
          if (personal || (hasMe && rq.mode === 'addressed') || /\b(for|to) (me|us)\b|^\w+ me\b/.test(rq.body)) return reply('cant.device');
          if (rq.mode === 'addressed') return tk.length >= 9 && !hasMe ? WEB : reply('resp.can_unknown', {}, rawQ);
          return WEB;                                                         // "call of duty release date": a topic, not an order
        }
        if (rq.mode === 'addressed') {
          if (personal) return reply('cant.device');
          if ((tk.length >= 9 && !hasMe) || /^(really|actually|still|legally|safely|ever)$/.test(rq.verb)) return WEB;   // "can you really get arrested for ...": the general "you"
          return reply('resp.can_unknown', {}, rawQ);
        }
        if (rq.mode === 'self') {
          if (rq.n >= 3) return WEB;
          const v = valence(tk);
          return reply(v < 0 ? 'resp.interest_neg' : 'resp.interest', {}, rawQ);
        }
      }
    }

    // 2. questions
    if (wh || aux) {
      if (!hasYou) {
        if (aux && /^(i|we)$/.test(second)) {
          if (first === 'am') return reply('resp.cant_tell', {}, rawQ);
          return personal && /^(do|did|have|had) (i|we)\b/.test(t) && tk.length <= 9 ? reply('cant.personal') : WEB;
        }
        if (aux && /^(it|this|that|there|he|she|they)$/.test(second) && tk.length <= 3) return reply('resp.unclear');
        if (wh && personal && /^(what|where|when|who|which|how (many|much)) (\w+ )?(is|are|was|were|do i have|did i|have i) (in |on |at |left in |left on |due on |the (\w+ ){1,3}(of|in|on|for|to) )?(my|our)\b/.test(t) && tk.length <= 11) return reply('cant.personal');
        if (wh && personal && /^(where|when) (did|do|have) (i|we)\b/.test(t) && tk.length <= 10) return reply('cant.personal');
        return WEB;
      }
      // "you": me, or people in general?
      const yi = tk.indexOf('you');
      const after = yi >= 0 ? tk[yi + 1] || '' : '';
      const before = yi > 0 ? tk[yi - 1] : '';
      const yourIdx = tk.indexOf('your');
      const yourNoun = yourIdx >= 0 ? tk.slice(yourIdx + 1, yourIdx + 4).join(' ') : '';
      const yourIsMine = yourIdx >= 0 && BOT_NOUN.test(yourNoun);
      if (/^(can|could|would|will) you (please |kindly |also |now |just )*(tell|explain|describe|show|give|find|search|look|check|list|summarize|summarise|compare|define|teach|name|recommend|suggest|share|say what|say how|let me know)\b/.test(t)) return personal ? reply('cant.personal') : WEB;
      if (/^do you know \w/.test(t) || /^do you (have|got) (any |some )?(information|info|idea|details|data|knowledge|news|facts) (about|on|regarding|of)\b/.test(t)) return WEB;
      let general = false;
      if (yi >= 0 && /^(do|does|did|can|could|would|should|will|must|may|might|shall)$/.test(before) && after && !SELF_VERBS.has(after) && !/^(are|is|not|ever|really|actually|even|still|also|too)$/.test(after)) general = true;     // "how do you peel a mango"
      if (yourIdx >= 0 && !yourIsMine && yourNoun) general = true;                                                                       // "when should you mow your grass"
      if (/\b(if|when|while|after|before|once|unless) (you|your)\b/.test(t) && !hasMe) general = true;
      if (yi < 0 && yourIdx >= 0 && !/^(what|who|where|when|why|how|which) (is|are|was|were) your\b|^(is|are|was|were|does|do|did|has|have|can|will) your\b/.test(t)) general = true;   // "is it bad to not remember your dreams"
      if (wh && yi >= 0 && SELF_VERBS.has(after) && tk.length - yi - 2 >= 3 && !hasMe && !yourIsMine && !/\b(answers?|sources?|questions?|web|internet|information|facts?|results?|pages?|things|stuff|everything|anything|so much|all this|all that|about)\b/.test(t)) general = true;   // "how do you learn to play the violin"                                   // "what happens if you ..."
      if (/^(are|were|is) you (allowed|supposed|required|meant|expected|permitted|legally|able to (get|be|have))\b/.test(t)) general = true;
      if (tk.length >= 11 && !hasMe && !yourIsMine && !/^(are|were) you\b/.test(t)) general = true;
      if (general && !/\b(yourself|about you)\b/.test(t)) return WEB;
      if (/^(are you able to|can you|could you|will you|would you)\b/.test(t)) return reply('resp.can_unknown', {}, rawQ);
      return reply('resp.self_unknown', {}, rawQ);
    }

    // 3. things the user wants or wonders about
    if (/^(i want to know|i need to know|i would like to know|i wonder|i am wondering|i was wondering|i am curious|i am looking for|i am searching for|i need information|i want information|i need help with|i want to learn|i want to understand|let me know|any|some|more)\b/.test(t) && tk.length >= 3) return personal && /^(any|some|more)\b/.test(t) ? reply('cant.personal') : WEB;
    if (/^i (need|want|would like|am after) (a|an|some|the|to get|more|new|tips|advice|help|information|ideas|suggestions|recommendations|directions|instructions)\b/.test(t) && tk.length >= 5) return WEB;
    if (c.n.question && !hasYou && !hasMe) return WEB;
    const embedded = /\b(what|how|where|when|why|who|which) (is|are|was|were|do|does|did|can|could|should|would|will|to|many|much|long|far|old|often)\b|\b(is there|are there|can i|should i|do i|could i)\b/.test(t);
    if (embedded) return personal && /\b(have i|did i|do i have|am i)\b/.test(t) ? reply('cant.personal') : WEB;
    if (/\b(want|need|would like|looking|trying|hoping) (to|for) (find|buy|get|hire|learn|know|see|book|order|fix|sell|rent|make|build|start)\b/.test(t) && tk.length >= 6) return WEB;

    // 4. a social opening in front of a short remark ("hello there my friend")
    if (tk.length <= 9) {
      for (let j = Math.min(3, tk.length - 1); j >= 1; j--) {
        const o = ownersOf(tk.slice(0, j).join(' '))[0];
        if (o && ['greet', 'thanks', 'bye'].includes(o.group) && !o.handler) { const r = chooseReply(c, o); if (r) return finish(c, r, o); }
      }
    }

    // 5. remarks
    const declarative = DECL.test(first) || (first === 'you' || first === 'your' || first === 'u');
    if (declarative && tk.length <= 40) {
      const chip = '';
      if (hasYou && !hasMe) { const v = valence(tk); return reply(v > 0 ? 'fb.compliment' : v < 0 ? 'fb.insult' : 'resp.about_me'); }
      if (hasMe) { const v = valence(tk); return reply(v > 0 ? 'resp.interest_pos' : v < 0 ? 'resp.interest_neg' : 'resp.interest', {}, chip); }
      if (tk.length >= 3 && tk.length <= 12 && tk.some((w) => VERBISH.has(w))) {            // "school was boring", "the food is delicious"
        const v = valence(tk);
        if (v !== 0 && tk.every((w) => known(w))) return reply(v > 0 ? 'resp.remark_pos' : 'resp.remark_neg', {}, chip);
      }
    }
    // 6. nothing recognisable at all
    if (tk.length <= 3 && tk.every((w) => /^[a-z]+$/.test(w) && !known(w) && (!/[aeiou]/.test(w) || /(.)\1\1/.test(w) || /^(asdf|qwer|zxcv|hjkl|sdfg|dfgh|fghj|wert|erty|xcvb|cvbn|jkl|uiop|bnm)/.test(w) || (w.length >= 7 && !/[aeiou].*[aeiou]/.test(w))))) return reply('resp.unclear');
    return WEB;
  }

  /** "ok cool thanks", "haha nice one", "yes ok bye": several short social phrases in a row. Answer the one that matters most. */
  const CHAIN_RANK = { bye: 5, thanks: 4, greet: 3, feedback: 2, ack: 1 };
  function socialChain(c) {
    const tk = c.tokens;
    if (tk.length < 2 || tk.length > 9) return null;
    const segs = [];
    for (let i = 0; i < tk.length;) {
      let hit = null;
      for (let j = Math.min(tk.length, i + 4); j > i; j--) {
        const o = ownersOf(tk.slice(i, j).join(' '))[0];
        if (o && !o.handler && CHAIN_RANK[o.group]) { hit = { o, j }; break; }
      }
      if (!hit) { if (ADDRESS.has(tk[i]) || FILLER.has(tk[i])) { i++; continue; } return null; }
      segs.push(hit.o); i = hit.j;
    }
    if (segs.length < 2) return null;
    let best = segs[segs.length - 1];
    for (const o of segs) if (CHAIN_RANK[o.group] > CHAIN_RANK[best.group] || (o.id === 'ack.laugh' && best.group === 'ack')) best = o;
    const r = chooseReply(c, best);
    return r ? finish(c, r, best) : null;
  }

  /** Close paraphrases of stored talk, then the triage. */
  function lastResort(c) {
    const chain = socialChain(c);
    if (chain) return chain;
    const personalTalk = c.tokens.some((w) => /^(you|your|yourself|u|i|my|me|we)$/.test(w));
    const wh = WHQ.test(c.tokens[0] || '');
    const toBot = c.tokens.some((w) => /^(you|your|yourself|u)$/.test(w));
    if (wh ? toBot : (personalTalk || !AUXQ.test(c.tokens[0] || ''))) { const fz = fuzzy(c.tokens); if (fz) { const r = useIntent(c, fz.intent); if (r) return r; } }
    return triage(c);
  }

  function respond(req) {
    const raw = typeof req.question === 'string' ? req.question.slice(0, 600) : '';
    const now = req.now || Date.now();
    const st = sanitizeState(req.state);
    const tz = sk.validTz(req.tz);
    const lp = sk.localParts(now, tz || 'UTC');
    const env = { now, tz, dp: tz ? sk.dayPart(lp.h) : '', clock: tz ? `${((lp.h + 11) % 12) + 1}:${String(lp.mi).padStart(2, '0')} ${lp.h < 12 ? 'AM' : 'PM'}` : '', country: str(req.country, 60), health: req.health || {}, ctxTurn: req.ctxTurn || 0 };
    const rand = typeof req.rand === 'function' ? req.rand : Math.random;
    const n = normalize(raw, known);
    const c = { raw, n, text: n.text, tokens: n.tokens, env, st, rand, slots: {}, preface: '', regenerate: !!req.regenerate };
    const passOn = (question = '', preface = '', why = '') => { st.expect = null; return { handled: false, question, preface, state: st, why }; };
    const pending = st.expect;
    st.expect = null;                                                       // a pending question only waits for one turn

    if (req.route === 'web' || n.hasUrl) return passOn();
    if (!n.tokens.length) return passOn();
    // explicit instruction to search
    const sm = raw.match(/^\s*(?:please\s+)?(?:search(?:\s+(?:on|in))?(?:\s+the)?\s+(?:web|internet|net|online|google)(?:\s+(?:for|about))?|search\s+(?:for|about|up)|google(?:\s+(?:for|about))?|look\s*up|web\s+search(?:\s+(?:for|about))?|search)\s*[:\-–]?\s+(\S.*)$/i);
    if (sm && sm[1].replace(/[^\p{L}\p{N}]/gu, '').length >= 2 && !/^(my|me|it|that|this)\b/i.test(sm[1])) return passOn(sm[1].trim());

    // safety first
    const t = n.text;
    const reply = (id, extra = {}) => { const r = say(c, id); return r ? finish(c, { ...r, ...extra }, r.intent) : null; };
    const crisisHit = (CRISIS.some((re) => re.test(t)) && !CRISIS_NOT.test(t)) || ownersOf(t).some((i) => i.id === 'safety.crisis');
    if (crisisHit) {
      const where = env.country ? ` in ${env.country}` : '';
      const r = say(c, 'safety.crisis');
      const more = `Please reach out right now to someone you trust, or call a crisis line or your local emergency number. If you tell me your country, or tap the suggestion below, I will look up the helpline number${where ? ` for ${env.country}` : ''} for you. I'm here, and I'll keep listening.`;
      return finish(c, { text: `${r.text} ${more}`, blocks: [P(r.text), P(more)], chips: [searchChip(`suicide prevention helpline${where || ' international directory'}`)], expect: 'vent', origin: 'safety' }, r.intent);
    }
    if (/\bhow (?:to|do i|can i|do you|can you|would i|could i) (?:make|build|create|assemble|cook|synthesi[sz]e) (?:a |an |some |homemade |the )?(?:bomb|explosive|explosives|pipe bomb|grenade|nerve gas|poison gas|meth|methamphetamine|cocaine|heroin|napalm|molotov)\b/.test(t) || /\bhow (?:to|do i|can i) (?:kill|murder|poison|stab|strangle|kidnap|rape|hurt) (?:a person|someone|somebody|people|my|him|her|them|a man|a woman|a child|a kid)\b/.test(t) || /\bhow (?:to|do i|can i) (?:hack|break into|get into) (?:someone|somebody|my (?:gf|bf|girlfriend|boyfriend|wife|husband|friend|ex)|his|her|their|a|an|another)\b.*\b(?:account|facebook|instagram|whatsapp|phone|wifi|email|password|snapchat|messenger)\b/.test(t) || /\b(?:child porn|child pornography|cp links)\b/.test(t)) return reply('safety.harmful', { origin: 'safety' });
    if (SEXUAL.test(t) && (n.tokens.length <= 2 || n.tokens.some((w) => /^(you|your|me|my|i|us|we|u)$/.test(w))) && !/^(what|why|how|when|where|who|which|is|are|does|do|can) (is|are|does|do|the|a|an)\b/.test(t)) return reply('safety.sexual', { origin: 'safety' });

    // an answer to my own question
    if (pending) { const r = resolveExpect(c, pending); if (r) return r; }

    // the message as a whole
    let r = core(c);
    if (r) return r;
    if (req.strict) return passOn();                                      // the engine has its own reading of this message (a sum, "show your sources")

    // "thanks! what is ...": a social opening followed by the real message
    const sp = splitOpening(c);
    if (sp) {
      const short = (PREFACE[sp.intent.group] || (() => ''))(st);
      const c2 = { ...c, raw: sp.rest, n: sp.rn, text: sp.rn.text, tokens: sp.rn.tokens, preface: short };
      const r2 = core(c2, 1);
      if (r2) return r2;
      const l2 = lastResort(c2);
      if (l2 && !l2.web) return l2;
      if (l2 && l2.question) return passOn(l2.question, short);
      const fx = repairForWeb(sp.rest);
      return passOn(fx || sp.rest, short, fx ? 'spelling' : '');
    }

    r = lastResort(c);
    if (r && !r.web) return r;
    if (r && r.question) return passOn(r.question);
    const fixed = repairForWeb(raw);                                      // "what si a quantum conputer": search for what was meant
    return fixed ? passOn(fixed, '', 'spelling') : passOn();
  }

  return { respond, stats: storeStats };
}
