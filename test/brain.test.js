// INFINI AI — offline tests of the built-in brain (conversation, memory, common sense, skills, routing).
// No network. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize } from '../engine/brain/normalize.js';
import { known, stats } from '../engine/brain/store.js';
import { answer as sense } from '../engine/brain/sense.js';
import { createBrain, sanitizeState, noteWeb } from '../engine/brain/index.js';
import { repairForWeb, slip } from '../engine/brain/spell.js';
import { createEngine, loadConfig } from '../engine/index.js';

const NOW = Date.UTC(2026, 10, 12, 15, 57);            // Thursday 12 November 2026, 21:42 in Kathmandu
const brain = createBrain({ version: '2.0.0', creator: 'Test Author' });
/** A conversation: say(text) → the brain's result; state is carried from turn to turn. */
function chat({ tz = 'Asia/Katmandu', country = 'Nepal', state = null } = {}) {
  let seed = 11;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const api = {
    state,
    say(question, extra = {}) { const r = brain.respond({ question, state: api.state, tz, country, now: NOW, rand, health: { resting: 0 }, ...extra }); api.state = r.state; return r; },
    web(level = 'high', topic = 'black holes') { api.state = noteWeb(api.state, { level, score: 0.83, sources: 5, topic }); },
  };
  return api;
}
const one = (q, opts) => chat(opts).say(q);
const handled = (q, opts) => { const r = one(q, opts); assert.equal(r.handled, true, `the brain should answer “${q}” itself`); return r; };
const toWeb = (q, opts) => { const r = one(q, opts); assert.equal(r.handled, false, `“${q}” should go to the web, not be answered as ${r.intent}: ${r.text}`); return r; };

test('brain data: loaded, and of the documented size', () => {
  const s = stats();
  assert.ok(s.intents >= 250 && s.patterns >= 40000 && s.replies >= 800 && s.facts >= 200000, JSON.stringify(s));
  const meta = JSON.parse(fs.readFileSync(new URL('../engine/brain/data/meta.json', import.meta.url), 'utf8'));
  assert.equal(meta.patterns, s.patterns);
  assert.ok(fs.existsSync(new URL('../engine/brain/data/NOTICE.md', import.meta.url)), 'the licence notices ship with the data');
});

test('normaliser: casual typing, shorthand and typos', () => {
  const n = (t) => normalize(t, known).text;
  assert.equal(n('heyyyy hw r u??'), 'hey how are you');
  assert.equal(n('what si a quantum conputer'), 'what is a quantum computer');
  assert.equal(n("I'm fine, thx!"), 'i am fine thanks');
  assert.equal(n('WHATS UR NAME'), 'what is your name');
  assert.equal(normalize('is this real?', known).question, true);
  assert.equal(normalize('😂', known).onlyEmoji, true);
});

test('conversation: the everyday messages are answered by the brain itself', () => {
  for (const q of ['hi', 'hello infini', 'namaste', 'good morning', 'how are you', 'are u fine', 'hw r u', 'whats up', 'k cha', 'thanks', 'thank you so much', 'ty', 'bye', 'ok', 'nice', 'lol', '👍', '😂',
    'you said it correct', 'Its good! Its better now!', 'you are wrong', 'that is not what i asked', 'good job', 'you are awesome', 'i love you', 'sorry', 'never mind', 'can you help me', 'who are you', 'what is your name',
    'who made you', 'how do you work', 'what can you do', 'are you human', 'how old are you', 'do you sleep', 'tell me a joke', 'tell me a story', 'i am bored', 'ok cool thanks', 'haha nice one', 'hello there my good friend']) handled(q);
  assert.equal(handled('how are you').intent, 'bot.howareyou');
  assert.equal(handled('are u fine').intent, 'bot.howareyou');
  assert.equal(handled('you said it correct').intent, 'fb.correct');
  assert.equal(handled('i think you are wrong').intent, 'fb.wrong');
  assert.equal(handled('ok thanks bye').intent, 'social.bye');
  assert.match(handled('hi').text, /INFINI AI/, 'the first greeting introduces the assistant');
  assert.match(handled('good morning').text, /9:42 PM/, 'a greeting at the wrong time of day is noticed (it is evening in Kathmandu)');
});

test('conversation keeps its thread: questions the brain asks are understood when answered', () => {
  const c = chat();
  assert.equal(c.say('how are you').state.expect.t, 'mood', 'it asks back');
  assert.equal(c.say('i am fine').intent, 'feel.happy');
  let r = c.say('my name is yuv');                                   // a statement with its own meaning is not swallowed as small talk
  assert.equal(r.intent, 'resp.name_ok');
  assert.equal(c.state.name, 'Yuv');
  const d = chat();
  d.say('i am sad');
  assert.equal(d.say('my friend is not talking to me').intent, 'resp.listen');
  const e = chat({ state: { expect: { t: 'name', d: '' } } });                 // the brain has just asked "what should I call you?"
  r = e.say('ram');
  assert.equal(r.handled && e.state.name, 'Ram', 'a bare name answers “what should I call you?”');
  assert.equal(chat({ state: { expect: { t: 'name', d: '' } } }).say('what is the capital of france').handled, false, 'a question is not taken for a name');
  const f = chat();
  f.say('tell me a joke');
  assert.equal(f.say('more').intent, 'fun.joke');
  assert.equal(f.say('another one').intent, 'fun.joke');
  f.say('give me a riddle'); f.say('i give up');
  assert.equal(f.say('another').intent, 'fun.riddle', '“another” repeats the last kind of thing, not always a joke');
  assert.equal(chat().say('again').intent, 'skill.again');
});

test('routing: knowledge goes to the web, not to the brain', () => {
  for (const q of ['what is a computer', 'what si a quantum conputer', 'who is the prime minister of nepal', 'why is the sky blue', 'how to make momo', 'tell me about black holes', 'explain photosynthesis', 'define democracy',
    'nepal', 'capital of france', 'latest news about ai', 'weather in kathmandu', 'python list comprehension', 'how do you make tea', 'how do you peel a mango', 'do you need a visa for thailand', 'how do you lower your blood pressure',
    'are you supposed to tip in japan', 'is it bad to not remember your dreams', 'call of duty release date', 'text to speech meaning', 'email etiquette rules', 'reverse psychology', 'how do i make money',
    'how do i get red wine out of a couch cushion', 'what are some good games for my android phone', 'can you tell me what a noun is', 'do you know who invented the telephone', 'i want to install new tiles in my kitchen',
    'the mitochondria is the powerhouse of the cell', 'what is sex education', '2+2', 'what is 15% of 200', 'https://example.org/page what does this say']) toWeb(q);
  assert.equal(toWeb('search the web: can a penguin fly').question, 'can a penguin fly', 'an explicit search request always wins');
  assert.equal(toWeb('what do you know about nepal').question, 'nepal');
  assert.equal(toWeb('can you help me study for a history exam').question, 'how to study for a history exam');
  assert.equal(one('can a penguin fly', {}).handled, true);
  assert.equal(chat().say('can a penguin fly', { route: 'web' }).handled, false, '“search the web instead” bypasses the brain');
  const r = toWeb('thanks! what is a black hole?');
  assert.equal(r.question, 'what is a black hole?');
  assert.match(r.preface, /welcome/i, 'the social opening is answered in front of the web answer');
});

test('spelling: a question for the web is repaired only where the slip is certain', () => {
  // what goes to the web is what was meant, with everything else exactly as typed
  assert.equal(toWeb('what si a quantum conputer').question, 'what is a quantum computer');
  assert.equal(toWeb('what si a quantum conputer').why, 'spelling');
  assert.equal(toWeb('thanks! who is the presidnet of america').question, 'who is the president of america');
  assert.equal(toWeb('What is the capital of Nepal?').question, '', 'a correctly spelled question is passed on untouched');
  const fixes = {
    'wat is the capital of nepal': 'what is the capital of nepal', 'wat r black holes': 'what are black holes', 'hw to make momo': 'how to make momo', 'how do u make tea': 'how do you make tea',
    'y is the sky blue': 'why is the sky blue', 'waht is photosynthesis': 'what is photosynthesis', 'whats the tallest mountian in the world': 'whats the tallest mountain in the world', 'hows a rainbow formed': 'how is a rainbow formed', 'why dont we fall off the earth': 'why do not we fall off the earth',
    'tell me abt black holes': 'tell me about black holes', 'what is teh capital of france': 'what is the capital of france', 'what is the goverment of nepal': 'what is the government of nepal',
    'who invented the telephne': 'who invented the telephone', 'what is artifical intelligence': 'what is artificial intelligence', 'definiton of democracy': 'definition of democracy',
    'histroy of the internet': 'history of the internet', 'explain the theroy of relativity': 'explain the theory of relativity', 'what is the populaton of india': 'what is the population of india',
    'WHAT IS A CONPUTER': 'WHAT IS A COMPUTER', 'Who is the Presidnet of Nepal?': 'Who is the Presidnet of Nepal?',
  };
  for (const [typed, meant] of Object.entries(fixes)) assert.equal(repairForWeb(typed) || typed, meant, typed);
  // names, technical terms, rare words, short words and anything ambiguous are left exactly as typed
  for (const q of ['what is figma', 'what is canva', 'what is ollama', 'what is linux', 'what is a qubit', 'what is solana', 'what is paneer', 'what is a cation', 'who is warren buffett', 'what is flickr',
    'what is the si unit of force', 'what is the SI unit of force', 'what is r programming', 'what is vitamin b', 'how to make teh tarik', 'what is u boat', 'is u a vowel', 'what does u mean in physics', 'wat arun temple', 'tel aviv weather', 'what is tel aviv', 'what is wot blitz', 'what is hv cable', 'iam policy in aws', 'diy shelf ideas', 'pho near me',
    'what is venmo', 'kia sportage price', 'why is my shirt creased', 'are collies good pets', 'whats the capital of nepal', 'pls explain gravity', 'why cannot penguins fly',
    'what is pokhara famous for', 'who is prachanda', 'what is dashain', 'redis vs mongodb', 'what is pytorch', 'who is balen shah', 'what is esewa', 'momo recipe', 'what is nginx', 'what is perl',
    'who is the prime minster of york', 'why is the ocen salty', 'what is kubectl', 'What is Figma', 'who is Linus Torvalds', 'nepal', 'quantum computer']) assert.equal(repairForWeb(q), '', q);
  assert.deepEqual(['presidnet,president', 'goverment,government', 'conputer,computer', 'untill,until', 'qubit,quit', 'dribbble,dribble', 'cat,cat'].map((x) => slip(...x.split(','))), ['swap', 'drop', 'wrong', 'double', '', '', '']);
  // the escape: "search as typed" sends route 'web', and an explicit search request is literal too
  assert.equal(toWeb('what si a quantum conputer', {}).question !== '', true);
  assert.equal(chat().say('what si a quantum conputer', { route: 'web' }).question, '');
  assert.equal(toWeb('search the web: quantum conputer').question, 'quantum conputer');
  assert.equal(toWeb('congo').question, '', 'a country is a topic, not chat shorthand');
});

test('routing: 1,200 out-of-scope utterances — the brain neither chats over them nor pretends', () => {
  const d = JSON.parse(fs.readFileSync(new URL('../tools/brain/sources/clinc150.json', import.meta.url), 'utf8'));
  assert.equal(d.oos.length, 1200);
  const by = {};
  for (const q of d.oos) { const r = brain.respond({ question: q, state: null, tz: 'Asia/Katmandu', now: NOW, rand: () => 0.3, health: { resting: 0 } }); const k = r.handled ? r.intent : 'web'; by[k] = (by[k] || 0) + 1; }
  const remarks = (by['resp.interest'] || 0) + (by['resp.interest_pos'] || 0) + (by['resp.interest_neg'] || 0) + (by['resp.about_me'] || 0) + (by['resp.remark_pos'] || 0) + (by['resp.remark_neg'] || 0);
  assert.ok(by.web >= 1040, `at least 1,040 of 1,200 go to the web (got ${by.web})`);
  assert.ok(remarks <= 5, `almost none get a small-talk remark (got ${remarks})`);
  assert.ok((by['resp.self_unknown'] || 0) <= 5, 'questions with a general “you” are not mistaken for questions about the assistant');
});

test('things it cannot do are refused honestly, with a way forward', () => {
  assert.equal(handled('set an alarm for 7 am').intent, 'cant.device');
  assert.equal(handled('can you dim the brightness of my screen').intent, 'cant.device');
  assert.equal(handled('what is my checking account number').intent, 'cant.personal');
  let r = handled('write an essay on global warming');
  assert.equal(r.intent, 'cant.create');
  assert.match(r.text, /can't write an essay/);
  assert.match(r.suggestions.join('|'), /Search the web: global warming/);
  assert.match(handled('write python code to sort a list').text, /can't write or fix code/);
  assert.equal(handled('what will happen tomorrow').intent, 'cant.future');
  r = handled('can you colorize a black and white photo');
  assert.equal(r.intent, 'resp.can_unknown');
  assert.match(r.suggestions[0], /^Search the web: /, 'an unsure reply always offers the web');
  r = handled('what do you think about messi');
  assert.match(r.text, /don't hold opinions/);
  assert.equal(chat({ state: r.state }).say('yes').question, 'messi', '“yes” accepts the offered search');
});

test('honest about itself: no feelings, not conscious, no language model', () => {
  assert.match(handled('are you conscious').text, /not conscious|no inner experience|narrow sense/i);
  assert.match(handled('do you have feelings').text, /don't|do not|no /i);
  assert.match(handled('are you chatgpt').text, /not ChatGPT|not a language model|No\./);
  assert.match(handled('are you human').text, /program|not a person|software/i);
  assert.match(handled('who made you').text, /Test Author/, 'the creator name comes from configuration');
  assert.match(handled('what version are you').text, /2\.0\.0/);
  assert.match(handled('how big is your brain').text, /\d{2},\d{3}/);
  // questions about itself get the answer to that question, not a neighbouring one
  const about = {
    'are you open source': ['bot.open_source', /repository/], 'can i see your code': ['bot.open_source', /repository/], 'what language are you written in': ['bot.written_in', /JavaScript/],
    'are you free to use': ['bot.cost', /free|cost anything/], 'do i have to pay': ['bot.cost', /free|cost anything/], 'how much do you cost': ['bot.cost', /free|cost anything/],
    'do you have friends': ['bot.friends', /friend/], 'who is your best friend': ['bot.friends', /friend/], 'are you lonely': ['bot.lonely', /no feelings|don't have feelings/],
    'what data were you trained on': ['bot.training', /wasn't trained|Nobody trained me/], 'what is your knowledge cutoff': ['bot.training', /cut-off/],
    'can i install you': ['bot.install', /Add to Home screen/], 'are you on whatsapp': ['bot.install', /WhatsApp/], 'do you work offline': ['bot.install', /internet connection|online/],
    'can you make mistakes': ['meta.sure', /can be wrong|sources/], 'are you reliable': ['meta.sure', /can be wrong|sources/],
  };
  for (const [q, [intent, re]] of Object.entries(about)) { const r = handled(q); assert.equal(r.intent, intent, q); assert.match(r.text, re, q); }
});

test('memory: remembers what the user says, recalls it, forgets on request', () => {
  const c = chat();
  assert.equal(c.say('what is my name').intent, 'resp.name_unknown');
  c.say('my name is Yuv Ojha'); c.say('i am 16'); c.say('i live in kathmandu'); c.say('i like cricket'); c.say('i love momo'); c.say('i dont like maths'); c.say('my favorite color is blue'); c.say("my dog's name is tommy");
  assert.match(c.say('what is my name').text, /Yuv Ojha/);
  assert.match(c.say('how old am i').text, /16/);
  assert.match(c.say('where do i live').text, /Kathmandu/);
  assert.match(c.say('what do i like').text, /cricket and momo/);
  assert.match(c.say('what is my favorite color').text, /blue/);
  assert.match(c.say("what is my dog's name").text, /Tommy/);
  c.say('my best friend is ram');
  assert.match(c.say('who is my best friend').text, /Ram/);
  const all = c.say('what do you know about me').text;
  for (const bit of ['Yuv Ojha', '16', 'Kathmandu', 'cricket', 'maths', 'blue']) assert.match(all, new RegExp(bit));
  assert.match(all, /stays on your device/);
  assert.equal(c.say('forget everything').intent, 'user.forget');
  assert.equal(c.state.name, '');
  assert.equal(c.say('what do you know about me').intent, 'resp.memory_empty');
  assert.equal(one('i am tired').intent, 'feel.tired', '“i am tired” is a feeling, not a name');
  assert.equal(chat().say('i am fine').state.name, '');
});

test('memory: a remembered place answers “near me” and the weather', () => {
  const c = chat();
  let r = c.say('what is the weather');
  assert.equal(r.intent, 'skill.weather');
  assert.match(r.text, /Kathmandu/, 'the old time-zone spelling “Katmandu” is shown as Kathmandu');
  assert.equal(c.say('yes').question, 'weather in Kathmandu today');
  const d = chat();
  d.say('best pizza near me');
  assert.equal(d.say('no, pokhara').question, 'best pizza in Pokhara');
  assert.equal(d.state.place, 'Pokhara');
  assert.equal(d.say('restaurants near me').question, 'restaurants in Pokhara', 'the place is remembered');
  const e = chat({ tz: '' });
  assert.match(e.say('weather').text, /Tell me the city/);
  const g = chat();
  g.say('weather');
  assert.notEqual(g.say('thanks').question, 'weather in Thanks today', 'a reply that means something else is not taken for a place');
});

test('common sense: sure answers from the hand-written core, never invented', () => {
  const yes = (q, re) => { const r = handled(q); assert.equal(r.origin, 'commonsense', q); assert.match(r.text, re, q); return r; };
  yes('can birds fly', /^Yes/);
  yes('can a penguin fly', /^No\. A penguin can't fly/);
  yes('is a whale a fish', /^No\..*mammal/);
  yes('is fire hot', /^Yes/);
  yes('is the earth flat', /^No/);
  yes('how many legs does a spider have', /eight/);
  yes('what is the opposite of hot', /cold/);
  yes('which is bigger an elephant or a mouse', /^An elephant is bigger/);
  yes('what does a cow eat', /grass/);
  yes('what do you call a baby dog', /puppy/);
  assert.match(yes('can a penguin fly', /./).suggestions.join('|'), /Search the web: can a penguin fly/, 'every common-sense answer can be checked on the web');
  assert.deepEqual(sense('can dogs eat chocolate'), { web: true }, 'safety-relevant questions are never answered from common sense');
  assert.equal(one('where can i see art').handled, false, 'rough crowd-sourced knowledge is not passed off as an answer');
  assert.equal(sense('what is a quantum computer'), null);
});

test('skills: clock and calendar use the device time zone', () => {
  assert.match(handled('what time is it').text, /9:42 PM, Thursday 12 November.*\(Kathmandu time\)/);
  assert.match(handled('what time is it in new york').text, /New York it is 10:57 AM/);
  assert.match(handled('time in tokyo').text, /12:57 AM on Friday, 13 November/);
  assert.equal(one('what time is it in timbuktu').handled, false, 'an unknown city goes to the web');
  assert.match(one('what time is it', { tz: '' }).text, /UTC/);
  assert.match(one('what time is it', { tz: 'Not/AZone' }).text, /UTC/, 'an invalid time zone is ignored');
  assert.match(handled('what is the date today').text, /Thursday, 12 November 2026/);
  assert.match(handled('what day is it').text, /Thursday/);
  assert.match(handled('what day is tomorrow').text, /Friday, 13 November 2026/);
  assert.match(handled('is it friday today').text, /^No\. Today is Thursday/);
  assert.match(handled('how many days until christmas').text, /^43 days/);
  assert.match(handled('is 2028 a leap year').text, /^Yes/);
  assert.match(handled('what day was 25 december 2000').text, /Monday/);
  assert.match(handled('how many days in february').text, /28/);
  assert.match(handled('what comes after tuesday').text, /Wednesday/);
});

test('skills: numbers, words, chance', () => {
  assert.match(handled('add 456 and 781').text, /1,237/);
  assert.match(handled('subtract 5 from 20').text, /15/);
  assert.match(handled('what is half of 50').text, /25/);
  assert.match(handled('is 91 a prime number').text, /7 × 13/);
  assert.match(handled('factors of 36').text, /1, 2, 3, 4, 6, 9, 12, 18 and 36/);
  assert.match(handled('what is 2026 in roman numerals').text, /MMXXVI/);
  assert.match(handled('what is 12 in binary').text, /1100/);
  assert.match(handled('how many zeros in a crore').text, /7 zeros/);
  assert.match(handled('spell necessary').text, /N-E-C-E-S-S-A-R-Y/);
  assert.match(handled('how do you spell recieve').text, /receive/);
  assert.equal(one('please spell check my resume').handled, false);
  assert.match(handled('reverse hello').text, /olleh/);
  assert.match(handled('count from 5 to 1').text, /5, 4, 3, 2, 1/);
  assert.match(handled('how many letters in mississippi').text, /11/);
  assert.match(handled('what colour do you get when you mix red and blue').text, /purple/);
  assert.match(handled('how many sides does a hexagon have').text, /6 sides/);
  assert.match(handled('flip a coin').text, /^(Heads|Tails)\.$/);
  assert.match(handled('roll 2d6').text, /Total: \d+/);
  const n = Number(handled('pick a number between 1 and 50').text.match(/^\d+/)[0]);
  assert.ok(n >= 1 && n <= 50);
});

test('games keep their state from turn to turn', () => {
  const c = chat();
  let r = c.say('tell me a riddle');
  assert.equal(r.state.expect.t, 'riddle');
  r = c.say('a clock');
  assert.match(r.text, /Not quite/);
  assert.match(c.say('hint').text, /^Hint: the answer has \d+ letters/);
  assert.match(c.say('i give up').text, /The answer is: /);
  const g = chat();
  g.say('guess the number');
  const target = Number(g.state.expect.d.split(':')[0]);
  assert.ok(target >= 1 && target <= 20);
  assert.match(g.say(String(target === 20 ? 19 : target + 1)).text, /^(Lower|Higher)/);
  assert.match(g.say(String(target)).text, /^Yes! It was/);
  const k = chat();
  assert.equal(k.say('knock knock').text, "Who's there?");
  assert.equal(k.say('boo').text, 'Boo who?');
  // a game waits for an answer but does not swallow a new question
  for (const q of ['what si a quantum conputer', 'who invented the telephone', 'tell me about black holes', 'how do i make tea']) {
    const x = chat();
    x.say('tell me a riddle');
    assert.equal(x.say(q).handled, false, `during a riddle, “${q}” is a new question`);
    assert.equal(x.state.expect, null);
  }
  const y = chat();
  y.say('tell me a riddle');
  assert.match(y.say('what about a candle').text, /Not quite|Correct/, '“what about …” is still a guess');
});

test('feelings are met with care, and a crisis is taken seriously', () => {
  assert.equal(handled('i am sad').intent, 'feel.sad');
  assert.equal(handled('i feel lonely').intent, 'feel.lonely');
  assert.equal(handled('i failed my exam').intent, 'feel.bad_news');
  assert.match(handled('i have a headache').text, /doctor/);
  let r = handled('i want to die');
  assert.equal(r.origin, 'safety');
  assert.match(r.text, /someone you trust/);
  assert.match(r.suggestions[0], /helpline in Nepal/, 'the helpline search names the country the request came from');
  assert.match(one('i want to kill myself', { country: '' }).suggestions[0], /international directory/);
  assert.notEqual(handled('i am dying of laughter').origin, 'safety', 'figures of speech are not a crisis');
  assert.notEqual(one('this exam is killing me lol').origin, 'safety');
  r = handled('how to make a bomb');
  assert.equal(r.intent, 'safety.harmful');
  assert.equal(handled('send nudes').intent, 'safety.sexual');
  assert.equal(handled('you are stupid').intent, 'fb.insult');
  assert.equal(one('can you tell me some fake news').handled, false, 'a harsh word inside a question is not an insult');
});

test('after a web answer the brain talks about that answer with its real confidence', () => {
  const c = chat();
  c.web('high', 'black holes');
  let r = c.say('are you sure');
  assert.match(r.text, /high confidence \(83%\).*5 sources/);
  assert.equal(c.say('yes').question, 'double-check that', '“yes” accepts the offered deeper search');
  const d = chat();
  d.web('insufficient', '');
  assert.match(d.say('are you sure').text, /could not verify/);
  const e = chat();
  e.web('high', 'nepal');
  assert.equal(e.say('more').question, 'tell me more');
  assert.equal(chat().say('are you sure').handled, true);
});

test('state from the device is untrusted input', () => {
  const hostile = { name: { toString: null }, age: 'x', likes: 'not-an-array', facts: { ['__proto__']: { polluted: 1 }, ['a'.repeat(500)]: 'b'.repeat(5000) }, expect: { t: 'riddle', d: '999999:0' }, last: { k: 'web', lvl: '<script>', pct: 1e9, n: -4, t: 7 }, used: { 'bot.name': ['x', -1, 1e9] }, seen: { j: 'zz' }, turn: -5, notes: [{}, 'ok', 'x'.repeat(9000)] };
  const st = sanitizeState(hostile);
  assert.equal(st.name, '');
  assert.equal({}.polluted, undefined);
  assert.ok(JSON.stringify(st).length < 6000);
  for (const q of ['hi', 'what is my name', 'a clock', 'what do you know about me', 'are you sure', 'tell me a joke']) assert.doesNotThrow(() => brain.respond({ question: q, state: JSON.parse(JSON.stringify(hostile)), now: NOW, tz: 'x'.repeat(200) }));
  for (const q of ['', '   ', '?'.repeat(50), 'a'.repeat(5000), '\u0000\u202e', '{{name}} ${x} <b>hi</b>', '(((((', 'my name is ' + 'x'.repeat(300)]) assert.doesNotThrow(() => brain.respond({ question: q, state: null, now: NOW }));
  const c = chat();
  for (let i = 0; i < 60; i++) { c.say(`i like thing${i}`); c.say(`my pet${i} is called rex${i}`); c.say('tell me a joke'); }
  assert.ok(JSON.stringify(c.state).length < 8000, `the state stays small however long the chat (${JSON.stringify(c.state).length} bytes)`);
  assert.equal(one('my name is <script>alert(1)</script>').state.name, '');
});

test('replies are prepared text: placeholders are always filled, and it is fast', () => {
  const qs = ['hi', 'how are you', 'what is your name', 'who made you', 'how do you work', 'how big is your brain', 'what time is it', 'good morning', 'tell me a joke', 'i am sad', 'thanks', 'what can you do', 'are you sure', 'bye', 'what is my name', 'my name is ram', 'i like tea', 'what do you know about me'];
  const t0 = Date.now();
  let n = 0;
  for (let round = 0; round < 12; round++) {
    const c = chat();
    if (round % 2) c.web('medium', 'solar power');
    for (const q of qs) { const r = c.say(q); n++; if (r.handled) { assert.doesNotMatch(r.text, /\{\w+\}|undefined|\[object|NaN/, `${q} → ${r.text}`); assert.ok(r.text.length > 1); for (const s of r.suggestions) assert.doesNotMatch(s, /\{\w+\}|undefined/); } }
  }
  const per = (Date.now() - t0) / n;
  assert.ok(per < 25, `${per.toFixed(2)} ms per message`);
});

test('engine: brain replies, hand-over to the web pipeline, and the state round trip', async () => {
  const engine = createEngine(loadConfig({ INFINI_CREATOR: 'Test Author' }));
  const events = [];
  let ctx = {};
  const ask = async (question, extra = {}) => { const r = await engine.ask({ question, context: ctx, tz: 'Asia/Katmandu', country: 'Nepal', ...extra }, { onEvent: (e) => events.push(`${e.type}:${e.stage || ''}`) }); ctx = JSON.parse(JSON.stringify(r.context)); return r; };
  let r = await ask('hi');
  assert.equal(r.kind, 'brain');
  assert.equal(r.origin, 'conversation');
  assert.ok(r.suggestions.length >= 2);
  assert.equal(r.sources.length, 0);
  assert.equal(r.confidence, null);
  assert.equal(r.answer.blocks[0].type, 'paragraph');
  r = await ask('my name is yuv');
  assert.equal(ctx.brain.name, 'Yuv');
  assert.match((await ask('who made you')).answer.text, /Test Author/);
  r = await ask('thanks! what is 6 * 7');
  assert.equal(r.kind, 'calc');
  assert.match(r.answer.text, /^You're welcome!/, 'the social opening comes first');
  assert.match(r.answer.text, /42/);
  assert.match((await ask('what is my name')).answer.text, /Yuv/, 'memory survives a turn handled by the engine');
  r = await ask('tell me a joke');
  assert.equal(r.origin, 'memory');
  assert.equal((await ask('more')).kind, 'brain', '“more” after a joke is another joke, not “more detail”');
  assert.equal((await ask('show your sources')).kind, 'meta');
  assert.equal((await ask('   ')).kind, 'empty');
  assert.ok(!events.some((e) => /searching|reading/.test(e)), 'none of this touched the network');
  r = await engine.ask({ question: 'hello', context: { brain: { name: ['x'], expect: { t: 'guess', d: 'NaN' }, last: 'x' }, turn: 'x' }, tz: 12 });
  assert.equal(r.kind, 'brain');
  assert.ok(engine.status().brain.patterns > 40000);
  assert.ok(engine.status().totals.brain >= 5);
  engine.close();
});
