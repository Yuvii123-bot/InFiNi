// INFINI AI — brain: built-in skills that need no knowledge of the world: the clock and calendar, numbers, words, games.
// Every function here is deterministic code or a pick from a fixed list.

import { formatNumber } from '../math/calc.js';
import { DAYS, MONTHS, NUMWORDS, RUDE, SEXUAL } from './lexicon.js';
import { editDistance } from './normalize.js';
import { vocab, known } from './store.js';

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const Cap = (s) => s.split(' ').map(cap).join(' ');
export const joinList = (arr, word = 'and') => (arr.length <= 1 ? arr.join('') : arr.length === 2 ? `${arr[0]} ${word} ${arr[1]}` : `${arr.slice(0, -1).join(', ')} ${word} ${arr[arr.length - 1]}`);

// ---------------------------------------------------------------------------------------------------------------------
// time and date
export function validTz(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return '';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return ''; }
}
/** Wall-clock parts of an instant in a time zone. */
export function localParts(now, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'long' });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), wd: DAYS.indexOf(p.weekday.toLowerCase()) };
}
export const dayPart = (h) => (h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night');
const clock = (p) => `${((p.h + 11) % 12) + 1}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'][n % 10]}`;
const longDate = (p) => `${cap(DAYS[p.wd])}, ${p.d} ${cap(MONTHS[p.mo - 1])} ${p.y}`;
const dayNumber = (y, mo, d) => Math.round(Date.UTC(y, mo - 1, d) / 86400000);
const fromDayNumber = (n) => { const dt = new Date(n * 86400000); return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() }; };
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthDays = (y, mo) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];

const ZONES = `Asia/Kathmandu: nepal kathmandu pokhara lalitpur bhaktapur biratnagar birgunj butwal dharan chitwan janakpur nepalgunj
Asia/Kolkata: india delhi new delhi mumbai bombay kolkata calcutta chennai madras bangalore bengaluru hyderabad pune ahmedabad jaipur lucknow patna goa kerala punjab
Asia/Dhaka: bangladesh dhaka | Asia/Karachi: pakistan karachi lahore islamabad | Asia/Colombo: sri lanka colombo | Asia/Thimphu: bhutan thimphu | Asia/Kabul: afghanistan kabul
Asia/Shanghai: china beijing shanghai shenzhen guangzhou chengdu tibet lhasa | Asia/Hong_Kong: hong kong | Asia/Taipei: taiwan taipei | Asia/Tokyo: japan tokyo osaka kyoto | Asia/Seoul: south korea korea seoul
Asia/Singapore: singapore | Asia/Kuala_Lumpur: malaysia kuala lumpur | Asia/Bangkok: thailand bangkok | Asia/Ho_Chi_Minh: vietnam hanoi ho chi minh city | Asia/Manila: philippines manila | Asia/Jakarta: indonesia jakarta
Asia/Dubai: uae dubai abu dhabi united arab emirates | Asia/Qatar: qatar doha | Asia/Riyadh: saudi arabia riyadh jeddah mecca | Asia/Kuwait: kuwait | Asia/Tehran: iran tehran | Asia/Baghdad: iraq baghdad | Asia/Jerusalem: israel jerusalem tel aviv
Europe/Istanbul: turkey istanbul ankara | Europe/Moscow: russia moscow saint petersburg st petersburg | Europe/London: uk united kingdom england britain london manchester scotland edinburgh wales | Europe/Dublin: ireland dublin
Europe/Paris: france paris | Europe/Berlin: germany berlin munich frankfurt | Europe/Madrid: spain madrid barcelona | Europe/Rome: italy rome milan | Europe/Amsterdam: netherlands amsterdam holland | Europe/Brussels: belgium brussels
Europe/Zurich: switzerland zurich geneva | Europe/Vienna: austria vienna | Europe/Stockholm: sweden stockholm | Europe/Oslo: norway oslo | Europe/Copenhagen: denmark copenhagen | Europe/Helsinki: finland helsinki
Europe/Warsaw: poland warsaw | Europe/Athens: greece athens | Europe/Lisbon: portugal lisbon | Europe/Kyiv: ukraine kyiv kiev | Europe/Prague: czech republic prague | Europe/Budapest: hungary budapest
Africa/Cairo: egypt cairo | Africa/Lagos: nigeria lagos | Africa/Johannesburg: south africa johannesburg cape town | Africa/Nairobi: kenya nairobi | Africa/Addis_Ababa: ethiopia | Africa/Casablanca: morocco
America/New_York: usa us united states america new york nyc washington washington dc boston miami atlanta philadelphia florida | America/Chicago: chicago texas houston dallas | America/Denver: denver colorado
America/Los_Angeles: los angeles la california san francisco seattle las vegas | America/Toronto: canada toronto ottawa montreal | America/Vancouver: vancouver | America/Mexico_City: mexico mexico city
America/Sao_Paulo: brazil sao paulo rio de janeiro rio | America/Argentina/Buenos_Aires: argentina buenos aires | America/Bogota: colombia bogota | America/Lima: peru lima | America/Santiago: chile santiago
Australia/Sydney: australia sydney melbourne canberra | Australia/Perth: perth | Australia/Brisbane: brisbane | Pacific/Auckland: new zealand auckland wellington | Pacific/Honolulu: hawaii honolulu | UTC: utc gmt greenwich`;
const MULTI = new Set('usa us united states america russia canada australia brazil mexico indonesia china india'.split(' '));
let PLACE = null;
function places() {
  if (PLACE) return PLACE;
  PLACE = new Map();
  for (const part of ZONES.split(/\n|\|/)) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const tz = part.slice(0, i).trim();
    let names = part.slice(i + 1).trim();
    for (const multi of ['new delhi', 'sri lanka', 'hong kong', 'south korea', 'kuala lumpur', 'ho chi minh city', 'abu dhabi', 'united arab emirates', 'saudi arabia', 'tel aviv', 'saint petersburg', 'st petersburg', 'united kingdom', 'czech republic', 'south africa', 'cape town', 'united states', 'new york', 'washington dc', 'los angeles', 'san francisco', 'las vegas', 'mexico city', 'sao paulo', 'rio de janeiro', 'buenos aires', 'new zealand']) names = names.replace(new RegExp(`\\b${multi}\\b`, 'g'), multi.replace(/ /g, '_'));
    for (const n of names.split(/\s+/)) if (n) PLACE.set(n.replace(/_/g, ' '), tz);
  }
  return PLACE;
}

export function timeSkill(c) {
  const now = c.env.now;
  let place = (c.slots.x || '').replace(/\b(the|city|city of|now|right now|currently|today|at the moment|please|time|in)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(here|my place|my city|my country|my location|my area|my time zone|my timezone|local)$/.test(place)) place = '';
  if (place) {
    const tz = places().get(place);
    if (!tz) return { pass: {} };                                                    // a place I have no clock for: the web knows
    const p = localParts(now, tz);
    const note = MULTI.has(place) && !/^(china|india)$/.test(place) ? ` ${Cap(place)} has several time zones; this is the time in ${tz.split('/').pop().replace(/_/g, ' ')}.` : '';
    return { text: `In ${Cap(place)} it is ${clock(p)} on ${cap(DAYS[p.wd])}, ${p.d} ${cap(MONTHS[p.mo - 1])}.${note}`, origin: 'skill' };
  }
  if (!c.env.tz) { const p = localParts(now, 'UTC'); return { text: `It is ${clock(p)} UTC. I couldn't read your device's time zone, so I can't give your local time.`, origin: 'skill' }; }
  const p = localParts(now, c.env.tz);
  return { text: `It's ${clock(p)}, ${cap(DAYS[p.wd])} ${p.d} ${cap(MONTHS[p.mo - 1])}, going by your device's time zone (${tzCity(c.env.tz) ? `${tzCity(c.env.tz)} time` : c.env.tz.replace(/_/g, ' ')}).`, origin: 'skill' };
}

const EVENTS = { 'new year': [1, 1], 'new years': [1, 1], 'new years day': [1, 1], 'new year day': [1, 1], 'new year eve': [12, 31], 'new years eve': [12, 31], christmas: [12, 25], xmas: [12, 25], 'christmas day': [12, 25], 'christmas eve': [12, 24], 'valentines day': [2, 14], 'valentine day': [2, 14], valentines: [2, 14], halloween: [10, 31], 'april fools day': [4, 1], 'april fools': [4, 1], 'may day': [5, 1], 'labour day': [5, 1], 'labor day': [5, 1], 'boxing day': [12, 26], 'international womens day': [3, 8], 'womens day': [3, 8], 'earth day': [4, 22], 'world environment day': [6, 5], 'environment day': [6, 5] };
/** "25 december", "december 25 2027", "2027-01-01", "1/2/2027" (day first), "next friday", "tomorrow" → {y, mo, d} */
function parseDay(text, today) {
  let t = text.replace(/\b(the|of|on|in|next year|this year|coming|next|this)\b/g, ' ').replace(/(\d+)(st|nd|rd|th)\b/g, '$1').replace(/\s+/g, ' ').trim();
  const nextYear = /\bnext year\b/.test(text);
  if (t === 'today') return today;
  if (t === 'tomorrow') return fromDayNumber(dayNumber(today.y, today.mo, today.d) + 1);
  if (t === 'yesterday') return fromDayNumber(dayNumber(today.y, today.mo, today.d) - 1);
  let m;
  if (t in EVENTS) { const [mo, d] = EVENTS[t]; let y = today.y + (nextYear ? 1 : 0); if (!nextYear && dayNumber(y, mo, d) < dayNumber(today.y, today.mo, today.d)) y++; return { y, mo, d, event: t }; }
  const wd = DAYS.indexOf(t);
  if (wd >= 0) { const n0 = dayNumber(today.y, today.mo, today.d); let diff = (wd - today.wd + 7) % 7; if (diff === 0) diff = 7; return fromDayNumber(n0 + diff); }
  if (/^(weekend|saturday and sunday)$/.test(t)) { const n0 = dayNumber(today.y, today.mo, today.d); const diff = (6 - today.wd + 7) % 7; return fromDayNumber(n0 + diff); }
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return ok(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return ok(+m[3], +m[2], +m[1]);
  const mon = (w) => { const i = MONTHS.findIndex((x) => x === w || x.slice(0, 3) === w || (w === 'sept' && x === 'september')); return i >= 0 ? i + 1 : 0; };
  if ((m = t.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/)) && mon(m[2])) return future(m[3] ? +m[3] : 0, mon(m[2]), +m[1]);
  if ((m = t.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/)) && mon(m[1])) return future(m[3] ? +m[3] : 0, mon(m[1]), +m[2]);
  return null;
  function ok(y, mo, d) { return mo >= 1 && mo <= 12 && d >= 1 && d <= monthDays(y, mo) && y >= 1583 && y <= 9999 ? { y, mo, d } : null; }
  function future(y, mo, d) { if (y) return ok(y, mo, d); let yy = today.y + (nextYear ? 1 : 0); if (!nextYear && dayNumber(yy, mo, Math.min(d, 28)) < dayNumber(today.y, today.mo, today.d) && !/\b(was|did)\b/.test(text)) yy++; return ok(yy, mo, d); }
}
const withWd = (x) => ({ ...x, wd: fromDayNumber(dayNumber(x.y, x.mo, x.d)).wd });

export function dateSkill(c) {
  const t = c.text;
  const tz = c.env.tz || 'UTC';
  const p = localParts(c.env.now, tz);
  const n0 = dayNumber(p.y, p.mo, p.d);
  const out = (text, extra = {}) => ({ text, origin: 'skill', ...extra });
  const tzNote = c.env.tz ? '' : ' (I could not read your time zone, so this is the UTC date.)';
  let m;
  if (/\b(gate|tarikh|bar)\b/.test(t) && /\baaja\b/.test(t)) return out(`Today is ${longDate(p)} in the international (Gregorian) calendar. I can't work out the Bikram Sambat date by myself, but I can look it up.`, { chips: ["Search the web: today's Nepali date in Bikram Sambat"] });
  if ((m = t.match(/^how (?:many days|long|many weeks|many months) (?:until|till|to|before|are left until|left until|left till|are there until|are there till) (.+)$/))) {
    const target = parseDay(m[1].replace(/^my birthday$/, c.st.facts && c.st.facts.birthday ? c.st.facts.birthday : m[1]), p);
    if (!target) return /^(the )?(weekend)$/.test(m[1]) ? null : { pass: {} };
    const diff = dayNumber(target.y, target.mo, target.d) - n0;
    const name = target.event ? cap(target.event.replace(/s day$/, "'s Day").replace(/\bday\b/, 'Day').replace(/\beve\b/, 'Eve').replace(/\byear\b/, 'Year').replace(/years\b/, "Year's")) : longDate(withWd(target));
    if (diff === 0) return out(`${name} is today!`);
    if (diff < 0) return out(`${name} was ${-diff} day${diff === -1 ? '' : 's'} ago.`);
    const weeks = Math.floor(diff / 7);
    return out(`${diff} day${diff === 1 ? '' : 's'} until ${name}${target.event ? ` (${longDate(withWd(target))})` : ''}.${weeks >= 2 ? ` That is ${weeks} weeks${diff % 7 ? ` and ${diff % 7} day${diff % 7 === 1 ? '' : 's'}` : ''}.` : ''}`);
  }
  if ((m = t.match(/^(?:when is|what day is|what date is|what day of the week is) (.+?)$/)) && (m[1].replace(/ (this|next) year$/, '') in EVENTS)) { const target = parseDay(m[1], p); const diff = dayNumber(target.y, target.mo, target.d) - n0; return out(`${cap(m[1].replace(/ (this|next) year$/, ''))} is on ${longDate(withWd(target))}${diff > 0 ? `, ${diff} day${diff === 1 ? '' : 's'} from now` : diff === 0 ? ', which is today' : ''}.`); }
  if ((m = t.match(/^is (.+?) a leap year$/))) { const y = /^(this year|it|this|the year)$/.test(m[1]) ? p.y : Number(m[1]); if (!Number.isInteger(y) || y < 1 || y > 9999) return null; return out(`${isLeap(y) ? 'Yes' : 'No'}. ${y} is ${isLeap(y) ? '' : 'not '}a leap year${isLeap(y) ? ', so it has 366 days' : ''}.${isLeap(y) ? '' : ` The next one is ${[1, 2, 3, 4, 5, 6, 7, 8].map((k) => y + k).find(isLeap)}.`}`); }
  if (/leap year/.test(t)) return out(`${isLeap(p.y) ? 'Yes' : 'No'}. ${p.y} is ${isLeap(p.y) ? '' : 'not '}a leap year.${isLeap(p.y) ? ' February has 29 days this year.' : ` The next one is ${[1, 2, 3, 4].map((k) => p.y + k).find(isLeap)}.`}`);
  if ((m = t.match(/^what day (?:of the week )?(?:is|was|will be) (.+)$/)) && !/^(it|today|it today|this|tomorrow|yesterday|it tomorrow|the day after tomorrow|the day before yesterday)$/.test(m[1])) { const target = parseDay(m[1], p); if (!target) return null; const w = withWd(target); const past = dayNumber(w.y, w.mo, w.d) < n0; return out(`${w.d} ${cap(MONTHS[w.mo - 1])} ${w.y} ${past ? 'was' : w.y === p.y && w.mo === p.mo && w.d === p.d ? 'is' : 'is'} a ${cap(DAYS[w.wd])}.`); }
  if ((m = t.match(/^(?:is it|is today|today is|it is) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: today)?$/))) { const yes = DAYS[p.wd] === m[1]; return out(yes ? `Yes, today is ${cap(DAYS[p.wd])}.` : `No. Today is ${cap(DAYS[p.wd])}, not ${cap(m[1])}.`); }
  if (/weekend|weekday|holiday/.test(t) && /^is /.test(t)) { const we = p.wd === 0 || p.wd === 6; return out(/holiday/.test(t) ? `Today is ${cap(DAYS[p.wd])}. Whether it is a public holiday depends on where you are, and that I would have to look up.` : `${/weekday/.test(t) ? (we ? 'No' : 'Yes') : (we ? 'Yes' : 'No')}. Today is ${cap(DAYS[p.wd])}${we ? ', part of the weekend in most countries' : ', a weekday in most countries'}.`); }
  if (/how many days .*(until|till) the weekend|how long until the weekend/.test(t)) { const diff = (6 - p.wd + 7) % 7; return out(diff === 0 || p.wd === 0 ? 'It is the weekend right now.' : `${diff} day${diff === 1 ? '' : 's'} until Saturday.`); }
  if (/how many days (are )?left in (this|the) year/.test(t)) { const left = dayNumber(p.y, 12, 31) - n0; return out(`${left} day${left === 1 ? '' : 's'} are left in ${p.y} after today.`); }
  if (/how many days (are )?left in (this|the) month/.test(t)) { const left = monthDays(p.y, p.mo) - p.d; return out(`${left} day${left === 1 ? '' : 's'} are left in ${cap(MONTHS[p.mo - 1])} after today.`); }
  if (/how many days .*this month/.test(t)) return out(`${cap(MONTHS[p.mo - 1])} ${p.y} has ${monthDays(p.y, p.mo)} days.`);
  if (/how many days .*this year/.test(t)) return out(`${p.y} has ${isLeap(p.y) ? 366 : 365} days.`);
  if (/day after tomorrow/.test(t)) { const x = fromDayNumber(n0 + 2); return out(`The day after tomorrow is ${longDate(x)}.`); }
  if (/day before yesterday/.test(t)) { const x = fromDayNumber(n0 - 2); return out(`The day before yesterday was ${longDate(x)}.`); }
  if (/tomorrow/.test(t)) { const x = fromDayNumber(n0 + 1); return out(`Tomorrow is ${longDate(x)}.`); }
  if (/yesterday/.test(t)) { const x = fromDayNumber(n0 - 1); return out(`Yesterday was ${longDate(x)}.`); }
  if (/\bweek\b/.test(t) && !/day of the week/.test(t)) { const jan1 = dayNumber(p.y, 1, 1); const thursday = n0 - ((p.wd + 6) % 7) + 3; const y0 = fromDayNumber(thursday).y; const wk = Math.floor((thursday - dayNumber(y0, 1, 1)) / 7) + 1; return out(`This is week ${wk} of ${y0} (ISO week numbering). Day ${n0 - jan1 + 1} of the year.`); }
  if (/century/.test(t)) return out(`This is the ${ordinal(Math.floor((p.y - 1) / 100) + 1)} century.`);
  if (/^is it (morning|afternoon|evening|night|day|night time|day time|day or night)/.test(t)) { const dp = dayPart(p.h); return out(`It's ${clock(p)} where you are, so it's ${dp === 'night' ? 'night' : `the ${dp}`}.`); }
  if (/\bmonth\b/.test(t)) return out(`It's ${cap(MONTHS[p.mo - 1])} ${p.y}.`);
  if (/\byear\b/.test(t)) return out(`It's ${p.y}.`);
  if (/^(what day|which day|day$|what is the day|what is today day|do you know what day)/.test(t) && !/date/.test(t)) return out(`Today is ${cap(DAYS[p.wd])}, ${p.d} ${cap(MONTHS[p.mo - 1])} ${p.y}.${tzNote}`);
  return out(`Today is ${longDate(p)}.${tzNote}`);
}

export function daysInMonth(c) {
  const t = c.text;
  let m;
  if ((m = t.match(/(?:which|what|how many) months have (28|29|30|31) days/))) {
    const n = Number(m[1]);
    if (n === 28) return { text: 'All twelve months have at least 28 days. Only February stops there, and it gets a 29th day in leap years.', origin: 'skill' };
    if (n === 29) return { text: 'Every month except February always has at least 29 days. February has a 29th day only in leap years.', origin: 'skill' };
    if (n === 30) return { text: 'Four months have exactly 30 days: April, June, September and November. All the others except February also reach the 30th.', origin: 'skill' };
    return { text: 'Seven months have 31 days: January, March, May, July, August, October and December.', origin: 'skill' };
  }
  const mon = MONTHS.find((x) => new RegExp(`\\b(${x}|${x.slice(0, 3)}${x === 'september' ? '|sept' : ''})\\b`).test(t));
  if (!mon) return { text: 'A month has 28 to 31 days. April, June, September and November have 30; February has 28, or 29 in a leap year; the other seven have 31.', origin: 'skill' };
  const i = MONTHS.indexOf(mon) + 1;
  const y = localParts(c.env.now, c.env.tz || 'UTC').y;
  if ((m = t.match(/have (28|29|30|31) days/))) { const n = Number(m[1]); const real = monthDays(2023, i); return { text: i === 2 ? (n === 28 ? 'Yes, in a normal year. In a leap year February has 29 days.' : n === 29 ? 'Only in a leap year. In other years February has 28 days.' : 'No. February has 28 days, or 29 in a leap year.') : n === real ? `Yes. ${cap(mon)} has ${real} days.` : `No. ${cap(mon)} has ${real} days.`, origin: 'skill' }; }
  if (i === 2) return { text: `February has 28 days in a normal year and 29 in a leap year. In ${y} it has ${monthDays(y, 2)}.`, origin: 'skill' };
  return { text: `${cap(mon)} has ${monthDays(2023, i)} days.`, origin: 'skill' };
}

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10, '11th': 11, '12th': 12 };
export function orderAfter(c) {
  const t = c.text;
  const out = (text) => ({ text, origin: 'skill' });
  let m;
  if ((m = t.match(/\bthe (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|last|\d+(?:st|nd|rd|th)) (day of the week|day of a week|month of the year|month in a year|month of a year|month)\b/))) {
    const isDay = /day/.test(m[2]);
    const list = isDay ? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] : MONTHS;
    const k = m[1] === 'last' ? list.length : ORD[m[1]];
    if (!k || k > list.length) return null;
    return out(isDay ? `Counting from Monday, as the international standard does, the ${m[1]} day of the week is ${cap(list[k - 1])}. Some countries, Nepal among them, start the week on Sunday.` : `The ${m[1]} month of the year is ${cap(list[k - 1])}.`);
  }
  if ((m = t.match(/month is (?:number )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/))) { const k = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMWORDS.indexOf(m[1]); return k >= 1 && k <= 12 ? out(`Month number ${k} is ${cap(MONTHS[k - 1])}.`) : null; }
  if ((m = t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/)) && /(which|what) (number )?month/.test(t) && !/(after|before|between|following)/.test(t)) return out(`${cap(m[1])} is the ${ordinal(MONTHS.indexOf(m[1]) + 1)} month of the year.`);
  const x = (c.slots.x || '').replace(/\b(the|month of|day|in the alphabet|letter|number|a|an|comes|come)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!x) return null;
  const before = /\b(before|previous)\b/.test(t) && !/\bafter\b/.test(t);
  const seq = (list, name, wrap = true) => {
    const i = list.indexOf(x);
    if (i < 0) return null;
    const j = before ? i - 1 : i + 1;
    if (!wrap && (j < 0 || j >= list.length)) return out(`Nothing: ${cap(x)} is the ${before ? 'first' : 'last'} ${name}.`);
    return out(`${cap(list[(j + list.length) % list.length])} comes ${before ? 'before' : 'after'} ${cap(x)}.`);
  };
  if ((m = x.match(/^(.+?) and (.+)$/)) && /between/.test(t)) {
    for (const list of [DAYS, MONTHS]) { const i = list.indexOf(m[1]), j = list.indexOf(m[2]); if (i >= 0 && j >= 0 && (j - i + list.length) % list.length === 2) return out(`${cap(list[(i + 1) % list.length])} comes between ${cap(m[1])} and ${cap(m[2])}.`); }
    const a = toNumber(m[1]), b = toNumber(m[2]);
    if (a != null && b != null && Math.abs(a - b) === 2) return out(`${fmt((a + b) / 2)} comes between ${fmt(a)} and ${fmt(b)}.`);
    return null;
  }
  return seq(DAYS, 'day') || seq(MONTHS, 'month') || seq(SEASONS, 'season') || (/^[a-z]$/.test(x) ? seq('abcdefghijklmnopqrstuvwxyz'.split(''), 'letter of the alphabet', false) : null) || (() => { const n = toNumber(x); return n != null && Number.isInteger(n) ? out(`${fmt(before ? n - 1 : n + 1)} comes ${before ? 'before' : 'after'} ${fmt(n)}.`) : null; })();
}

// ---------------------------------------------------------------------------------------------------------------------
// numbers
const fmt = (x) => formatNumber(x);
const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1e3, lakh: 1e5, lac: 1e5, million: 1e6, crore: 1e7, billion: 1e9, arab: 1e9, trillion: 1e12 };
/** "12", "-3.5", "twenty five", "two hundred and five", "3 lakh" → number, or null */
export function toNumber(s) {
  const t = String(s || '').trim().replace(/^(the number|number|no) /, '').replace(/,/g, '');
  if (/^[-+]?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^(minus|negative) /.test(t)) { const v = toNumber(t.replace(/^(minus|negative) /, '')); return v == null ? null : -v; }
  const words = t.split(/[\s-]+/).filter((w) => w !== 'and' && w !== 'a');
  if (!words.length) return null;
  let total = 0, cur = 0, seen = false;
  for (const w of words) {
    if (/^\d+(\.\d+)?$/.test(w)) { cur += Number(w); seen = true; } else if (w in SMALL) { cur += SMALL[w]; seen = true; } else if (w === 'hundred') { cur = (cur || 1) * 100; seen = true; } else if (w in SCALE) { total += (cur || 1) * SCALE[w]; cur = 0; seen = true; } else if (w === 'half' && words.length === 1) return 0.5;
    else return null;
  }
  return seen ? total + cur : null;
}
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numberWords(n) {
  if (!Number.isInteger(n) || Math.abs(n) > 999999999999999) return String(n);
  if (n < 0) return 'minus ' + numberWords(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + numberWords(n % 100) : '');
  for (const [v, name] of [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) if (n >= v) return numberWords(Math.floor(n / v)) + ' ' + name + (n % v ? (n % v < 100 ? ' and ' : ' ') + numberWords(n % v) : '');
  return String(n);
}
const roman = (n) => { let out = ''; for (const [v, s] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (n >= v) { out += s; n -= v; } return out; };
const isPrime = (n) => { if (!Number.isInteger(n) || n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const factorsOf = (n) => { const out = []; for (let i = 1; i * i <= n; i++) if (n % i === 0) { out.push(i); if (i !== n / i) out.push(n / i); } return out.sort((a, b) => a - b); };

export function mathWords(c) {
  const t = c.text;
  const A = c.slots.a != null ? toNumber(c.slots.a) : null, B = c.slots.b != null ? toNumber(c.slots.b) : null;
  const out = (text) => ({ text, origin: 'skill' });
  let m;
  if (c.slots.x != null) {                                                            // average of a list
    const nums = c.slots.x.split(/\s*(?:,|and|\s)\s*/).filter(Boolean).map(toNumber);
    if (nums.length < 2 || nums.some((v) => v == null)) return null;
    return out(`The average of ${joinList(nums.map(fmt))} is ${fmt(nums.reduce((a, b) => a + b, 0) / nums.length)}.`);
  }
  if (A == null || (c.slots.b != null && B == null)) return null;
  const int = Number.isInteger(A), intB = B != null && Number.isInteger(B);
  if (/^(?:add|sum|plus)\b|\b(sum|total|addition) of\b/.test(t) && B != null) return out(`${fmt(A)} + ${fmt(B)} = ${fmt(A + B)}`);
  if (/^(?:subtract|minus|take away|take|deduct|remove)\b/.test(t) && B != null) return out(`${fmt(B)} − ${fmt(A)} = ${fmt(B - A)}`);
  if (/\bdifference (between|of)\b/.test(t) && B != null) return out(`The difference between ${fmt(A)} and ${fmt(B)} is ${fmt(Math.abs(A - B))}.`);
  if ((/^(?:multiply|times)\b|\b(product|multiplication) of\b| into /.test(t)) && B != null) return out(`${fmt(A)} × ${fmt(B)} = ${fmt(A * B)}`);
  if (/^divide\b/.test(t) && B != null) return B === 0 ? out('Dividing by zero has no answer: nothing multiplied by zero can give a number other than zero.') : out(`${fmt(A)} ÷ ${fmt(B)} = ${fmt(A / B)}`);
  if ((m = t.match(/\b(half|a half|one half|a quarter|one quarter|a fourth|one fourth|a third|one third|a tenth|one tenth) of\b/))) { const d = /half/.test(m[1]) ? 2 : /quarter|fourth/.test(m[1]) ? 4 : /third/.test(m[1]) ? 3 : 10; return out(`${cap(m[1].replace(/^one /, 'a '))} of ${fmt(A)} is ${fmt(A / d)}.`); }
  if ((m = t.match(/\b(double|twice|triple|thrice|two times|three times)\b/))) { const k = /double|twice|two/.test(m[1]) ? 2 : 3; return out(`${cap(m[1])} ${fmt(A)} is ${fmt(A * k)}.`); }
  if ((m = t.match(/\b(bigger|greater|larger|more|higher|smaller|less|lower|fewer)\b/)) && B != null) {
    const up = /bigger|greater|larger|more|higher/.test(m[1]);
    if (/^(which|what)/.test(t)) return A === B ? out(`They are equal: both are ${fmt(A)}.`) : out(`${fmt(up ? Math.max(A, B) : Math.min(A, B))} is ${m[1]} than ${fmt(up ? Math.min(A, B) : Math.max(A, B))}.`);
    const yes = up ? A > B : A < B;
    return out(A === B ? `No. They are equal.` : `${yes ? 'Yes' : 'No'}. ${fmt(A)} is ${A > B ? 'greater' : 'less'} than ${fmt(B)}.`);
  }
  if ((m = t.match(/\b(even or odd|odd or even|an even number|an odd number|even|odd|a prime number|a prime|prime|a perfect square|a square number|positive|negative|divisible by|a multiple of|a factor of)\b/)) && /^is\b/.test(t)) {
    const k = m[1];
    if (/divisible|multiple/.test(k)) { if (!int || !intB || B === 0) return null; const yes = A % B === 0; return out(yes ? `Yes. ${fmt(A)} ÷ ${fmt(B)} = ${fmt(A / B)} exactly.` : `No. ${fmt(A)} ÷ ${fmt(B)} leaves a remainder of ${fmt(((A % B) + Math.abs(B)) % Math.abs(B))}.`); }
    if (/factor/.test(k)) { if (!int || !intB || A === 0) return null; return out(B % A === 0 ? `Yes. ${fmt(A)} divides ${fmt(B)} exactly.` : `No. ${fmt(A)} does not divide ${fmt(B)} exactly.`); }
    if (/even|odd/.test(k)) { if (!int) return out(`${fmt(A)} is not a whole number, so it is neither even nor odd.`); const even = A % 2 === 0; return out(/or/.test(k) ? `${fmt(A)} is ${even ? 'even' : 'odd'}.` : `${(/even/.test(k)) === even ? 'Yes' : 'No'}. ${fmt(A)} is ${even ? 'even' : 'odd'}.`); }
    if (/prime/.test(k)) { if (!int || Math.abs(A) > 1e12) return null; const pr = isPrime(A); const f = pr || A < 2 ? null : factorsOf(A).find((x) => x > 1); return out(pr ? `Yes. ${fmt(A)} is a prime number.` : A < 2 ? `No. Prime numbers start at 2.` : `No. ${fmt(A)} = ${fmt(f)} × ${fmt(A / f)}.`); }
    if (/square/.test(k)) { const r = Math.round(Math.sqrt(A)); return out(A >= 0 && r * r === A ? `Yes. ${fmt(A)} = ${fmt(r)} × ${fmt(r)}.` : `No. ${fmt(A)} is not a perfect square.`); }
    if (/positive|negative/.test(k)) return out(A === 0 ? 'Zero is neither positive nor negative.' : `${(k === 'positive') === (A > 0) ? 'Yes' : 'No'}. ${fmt(A)} is ${A > 0 ? 'positive' : 'negative'}.`);
  }
  if (/\b(after|before)\b/.test(t) && /^(what|which)/.test(t)) { if (!int) return null; const before = /before/.test(t) && !/after/.test(t); return out(`${fmt(before ? A - 1 : A + 1)} comes ${before ? 'before' : 'after'} ${fmt(A)}.`); }
  if (/\b(factors|divisors)\b/.test(t)) { if (!int || A < 1 || A > 1e9) return null; const f = factorsOf(A); return out(`The factors of ${fmt(A)} are ${joinList(f.map(fmt))}.${f.length === 2 ? ' That makes it a prime number.' : ''}`); }
  if (/\bmultiples\b/.test(t)) { if (!int || A === 0) return null; return out(`The first ten multiples of ${fmt(A)} are ${joinList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => fmt(A * k)))}.`); }
  if (/\b(table|pahada)\b/.test(t)) { if (!int || Math.abs(A) > 1e6) return null; return { origin: 'skill', text: `The ${fmt(A)} times table:`, blocks: [{ type: 'paragraph', spans: [{ text: `The ${fmt(A)} times table:`, cites: [] }] }, { type: 'list', ordered: false, items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => ({ spans: [{ text: `${fmt(A)} × ${k} = ${fmt(A * k)}`, cites: [] }] })) }] }; }
  if (/\bfactorial\b/.test(t)) { if (!int || A < 0 || A > 20) return A > 20 ? out(`${fmt(A)}! is too large for me to write out exactly. 20! is already 2,432,902,008,176,640,000.`) : null; let f = 1; for (let i = 2; i <= A; i++) f *= i; return out(`${fmt(A)}! = ${fmt(f)}`); }
  if (/\bsquare root\b/.test(t)) return A < 0 ? out('A negative number has no real square root.') : out(`The square root of ${fmt(A)} is ${fmt(Math.sqrt(A))}.`);
  if (/\bcube root\b/.test(t)) return out(`The cube root of ${fmt(A)} is ${fmt(Math.cbrt(A))}.`);
  if (/\bsquare\b/.test(t)) return out(`${fmt(A)} squared is ${fmt(A * A)}.`);
  if (/\bcube\b/.test(t)) return out(`${fmt(A)} cubed is ${fmt(A * A * A)}.`);
  if (/\babsolute value\b/.test(t)) return out(`The absolute value of ${fmt(A)} is ${fmt(Math.abs(A))}.`);
  if ((m = t.match(/\b(roman numerals?|roman numbers?|roman|binary|hexadecimal|hex|octal|words)\b/))) {
    if (!int) return null;
    if (/roman/.test(m[1])) return A >= 1 && A <= 3999 ? out(`${fmt(A)} in Roman numerals is ${roman(A)}.`) : out('Roman numerals in their usual form only cover 1 to 3,999, and they have no zero.');
    if (m[1] === 'words') return out(`${fmt(A)} in words is “${numberWords(A)}”.`);
    if (A < 0 || A > Number.MAX_SAFE_INTEGER) return null;
    const base = m[1] === 'binary' ? 2 : m[1] === 'octal' ? 8 : 16;
    return out(`${fmt(A)} in ${m[1] === 'hex' ? 'hexadecimal' : m[1]} is ${A.toString(base).toUpperCase()}.`);
  }
  if ((m = t.match(/^(?:round|round off)\b.*?(?:nearest (ten|hundred|thousand|whole number|integer|tenth|10|100|1000))?$/)) && /^round/.test(t)) { const k = { ten: 10, 10: 10, hundred: 100, 100: 100, thousand: 1000, 1000: 1000, tenth: 0.1 }[m[1]] || 1; const r = Math.round(A / k) * k; return out(`${fmt(A)} rounded to the nearest ${m[1] && !/whole|integer/.test(m[1]) ? m[1] : 'whole number'} is ${fmt(Number(r.toFixed(2)))}.`); }
  if ((m = t.match(/\b(hcf|gcd|gcf|highest common factor|greatest common divisor|greatest common factor|lcm|lowest common multiple|least common multiple)\b/)) && B != null) { if (!int || !intB || A === 0 || B === 0) return null; const g = gcd(A, B); return /lcm|multiple/.test(m[1]) ? out(`The lowest common multiple of ${fmt(A)} and ${fmt(B)} is ${fmt(Math.abs(A * B) / g)}.`) : out(`The highest common factor of ${fmt(A)} and ${fmt(B)} is ${fmt(g)}.`); }
  return null;
}

const BIG = { hundred: [2, '100'], thousand: [3, '1,000'], 'ten thousand': [4, '10,000'], lakh: [5, '100,000 (written 1,00,000 in South Asia)'], lac: [5, '100,000 (written 1,00,000 in South Asia)'], 'hundred thousand': [5, '100,000'], million: [6, '1,000,000'], 'ten million': [7, '10,000,000'], crore: [7, '10,000,000 (written 1,00,00,000 in South Asia)'], billion: [9, '1,000,000,000'], arab: [9, '1,000,000,000'], kharab: [11, '100,000,000,000'], trillion: [12, '1,000,000,000,000'], quadrillion: [15, '1 followed by 15 zeros'], googol: [100, '1 followed by 100 zeros'] };
const GROUPS = { dozen: 12, 'half dozen': 6, 'half a dozen': 6, 'bakers dozen': 13, score: 20, gross: 144, pair: 2, couple: 2, trio: 3, quartet: 4 };
const EQUIV = { lakh: 'One lakh is a hundred thousand, or a tenth of a million.', lac: 'One lakh is a hundred thousand, or a tenth of a million.', crore: 'One crore is ten million, or a hundred lakh.', million: 'One million is ten lakh.', billion: 'One billion is a thousand million, which is a hundred crore, or one arab.', arab: 'One arab is a hundred crore, which is one billion.', kharab: 'One kharab is a hundred arab, which is a hundred billion.', trillion: 'One trillion is a thousand billion, or one lakh crore.', thousand: 'A thousand is ten hundreds.' };
export function bigNumber(c) {
  const t = c.text;
  const g = Object.keys(GROUPS).sort((a, b) => b.length - a.length).find((k) => new RegExp(`\\b${k}\\b`).test(t));
  const name = Object.keys(BIG).sort((a, b) => b.length - a.length).find((k) => new RegExp(`\\b${k}\\b`).test(t));
  if (g && !(name && /zero|digit|nought|0s/.test(t))) return { text: `${cap(/half/.test(g) ? 'half a dozen' : `a ${g.replace('bakers', "baker's")}`)} is ${GROUPS[g]}.`, origin: 'skill' };
  if (!name) return null;
  const [zeros, written] = BIG[name];
  if (/zero|nought|0s/.test(t)) return { text: `${cap(name === 'hundred' || name === 'thousand' ? `a ${name}` : `one ${name}`)} has ${zeros} zeros: ${written}.`, origin: 'skill' };
  if (/digit/.test(t)) return { text: `One ${name} has ${zeros + 1} digits: ${written}.`, origin: 'skill' };
  return { text: `One ${name} is ${written}. ${EQUIV[name] || ''}`.trim(), origin: 'skill' };
}

// ---------------------------------------------------------------------------------------------------------------------
// colours and shapes
const MIX = { 'blue+red': 'purple', 'red+yellow': 'orange', 'blue+yellow': 'green', 'red+white': 'pink', 'black+white': 'grey', 'green+red': 'brown (with paint; with light, red and green make yellow)', 'blue+green': 'turquoise, a blue-green', 'green+yellow': 'lime, a yellow-green', 'orange+red': 'a red-orange, like vermilion', 'blue+white': 'light blue', 'black+red': 'dark red, or maroon', 'orange+yellow': 'a golden yellow-orange', 'blue+purple': 'a blue-violet, like indigo', 'purple+red': 'magenta, a red-violet', 'white+yellow': 'a pale cream yellow', 'black+yellow': 'a dark olive green', 'black+blue': 'navy, a dark blue', 'green+white': 'a pale mint green', 'blue+orange': 'brown', 'purple+yellow': 'brown', 'brown+white': 'beige', 'black+green': 'a dark forest green', 'pink+white': 'a paler pink', 'blue+pink': 'a soft purple', 'blue+red+yellow': 'brown, or nearly black if the paints are strong' };
const UNMIX = { purple: 'red and blue', violet: 'red and blue', orange: 'red and yellow', green: 'blue and yellow', pink: 'red and white', grey: 'black and white', gray: 'black and white', brown: 'red and green, or all three primary colours together', turquoise: 'blue and green', maroon: 'red and a little black', beige: 'brown and white', navy: 'blue and a little black', black: 'all three primary colours in strong amounts, though real black paint is a pigment of its own', white: 'nothing: white paint cannot be mixed from other colours, though all colours of light together make white light', red: 'nothing in paint: red is a primary colour', blue: 'nothing in paint: blue is a primary colour', yellow: 'nothing in paint: yellow is a primary colour (with light, red and green make yellow)', indigo: 'blue and a little purple', magenta: 'red and purple', lime: 'yellow and green', cream: 'white and a little yellow' };
const COLOR_WORDS = 'red blue yellow green orange purple violet pink white black brown grey gray'.split(' ');
export function colorMix(c) {
  const t = c.text;
  const x = (c.slots.x || '').replace(/\bcolou?rs?\b/g, ' ').replace(/\s+/g, ' ').trim();
  const found = x.split(/\s+/).map((w) => (w === 'violet' ? 'purple' : w === 'gray' ? 'grey' : w)).filter((w) => COLOR_WORDS.includes(w));
  const extra = x.split(/\s+/).filter((w) => w && !COLOR_WORDS.includes(w) && !(w in UNMIX) && !/^(and|with|plus|to|together|mixed|mix|paint|paints|the|a|light|dark|some|in|you|i|we|do|get|make|when|if|or|is|what|both|two|of|violet|gray|n)$/.test(w));
  if (extra.length) return null;                                    // "how do i get red wine out of a couch" is not about colours
  const making = /\b(make|makes|get|mix to make|needed to make)\b/.test(t) && /^(which|what) (two )?colou?rs|^how (do|can|to)/.test(t);
  if (making) { const target = x.split(' ').find((w) => w in UNMIX); if (!target) return null; return { text: /^nothing/.test(UNMIX[target]) ? `${cap(target)} comes from ${UNMIX[target]}.` : `To make ${target}, mix ${UNMIX[target]}.`, origin: 'skill' }; }
  const uniq = [...new Set(found)].sort();
  if (uniq.length < 2) return null;
  const r = MIX[uniq.join('+')];
  if (!r) return { text: `I don't have a sure answer for mixing ${joinList(uniq)}. As a rule, mixing many paint colours together drifts towards brown or grey.`, origin: 'skill' };
  return { text: `Mixing ${joinList(uniq)} gives ${r}.`, origin: 'skill' };
}

const SHAPES = { triangle: [3, 3], square: [4, 4], rectangle: [4, 4], rhombus: [4, 4], parallelogram: [4, 4], trapezium: [4, 4], trapezoid: [4, 4], kite: [4, 4], quadrilateral: [4, 4], diamond: [4, 4], pentagon: [5, 5], hexagon: [6, 6], heptagon: [7, 7], septagon: [7, 7], octagon: [8, 8], nonagon: [9, 9], decagon: [10, 10], dodecagon: [12, 12], circle: [0, 0], oval: [0, 0], ellipse: [0, 0], semicircle: [2, 2], star: [10, 10] };
const SOLIDS = { cube: [6, 12, 8], cuboid: [6, 12, 8], box: [6, 12, 8], sphere: [0, 0, 0], ball: [0, 0, 0], cylinder: [3, 2, 0], cone: [2, 1, 1], pyramid: [5, 8, 5], 'square pyramid': [5, 8, 5], tetrahedron: [4, 6, 4], 'triangular pyramid': [4, 6, 4], prism: [5, 9, 6], 'triangular prism': [5, 9, 6], dice: [6, 12, 8], die: [6, 12, 8] };
const DEGREES = { triangle: 180, square: 360, rectangle: 360, quadrilateral: 360, circle: 360, 'right angle': 90, 'straight line': 180, 'straight angle': 180, 'full turn': 360, 'half turn': 180 };
export function shapeSides(c) {
  const t = c.text;
  const out = (text) => ({ text, origin: 'skill' });
  let m;
  if (/\bdegrees?\b|sum of (the )?angles/.test(t)) { const k = Object.keys(DEGREES).sort((a, b) => b.length - a.length).find((x) => t.includes(x)); return k ? out(/turn|angle|line/.test(k) ? `A ${k} is ${DEGREES[k]} degrees.` : k === 'circle' ? 'A full circle is 360 degrees.' : `The angles inside a ${k} add up to ${DEGREES[k]} degrees.`) : null; }
  if (/^(what are the|name some|list of|basic shapes)/.test(t) && !c.slots.x) return out('The basic flat shapes are the circle, triangle, square, rectangle, oval, pentagon, hexagon and star. The basic solid shapes are the cube, cuboid, sphere, cylinder, cone and pyramid.');
  if (/shape has (no|zero|0) (sides|corners|edges)/.test(t)) return out('A circle. It has no straight sides and no corners, just one curved edge. An oval is the same.');
  const x = (c.slots.x || '').replace(/\b(a|an|the|shape|regular)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if ((m = t.match(/shape (?:has|with) .+ (sides|corners|angles|edges|faces)|(\w+) sided shape/))) {
    const n = toNumber(x);
    if (n == null) return null;
    const names = Object.entries(SHAPES).filter(([k, v]) => v[0] === n && !/trapezoid|septagon|diamond|kite|rhombus|parallelogram|trapezium|rectangle|ellipse|oval|semicircle|star/.test(k)).map(([k]) => k);
    if (n === 4) return out('A shape with four sides is a quadrilateral. Squares, rectangles, rhombuses, parallelograms, trapeziums and kites are all quadrilaterals.');
    return names.length ? out(`A shape with ${fmt(n)} sides is called ${/^[aeiou]/.test(names[0]) ? 'an' : 'a'} ${names[0]}.`) : n === 11 ? out('A shape with 11 sides is called a hendecagon.') : n === 20 ? out('A shape with 20 sides is called an icosagon.') : n === 100 ? out('A shape with 100 sides is called a hectogon.') : null;
  }
  const what = (t.match(/\b(sides|corners|edges|angles|vertices|faces|points)\b/) || [])[1];
  if (!what || !x) return null;
  const an = (k) => `${/^[aeiou]/.test(k) ? 'An' : 'A'} ${k}`;
  if (x in SOLIDS) { const [f, e, v] = SOLIDS[x]; if (/sphere|ball/.test(x)) return out(`${an(x)} has no flat faces, no edges and no corners: just one curved surface.`); if (x === 'cylinder') return out('A cylinder has 3 faces (two flat circles and one curved surface), 2 edges and no corners.'); if (x === 'cone') return out('A cone has 2 faces (one flat circle and one curved surface), 1 edge and 1 point at the top.'); return out(`${an(x)} has ${f} faces, ${e} edges and ${v} corners${/pyramid$/.test(x) && x === 'pyramid' ? ' (taking the usual square-based pyramid)' : /^prism$/.test(x) ? ' (taking a triangular prism)' : ''}.`); }
  if (x in SHAPES) {
    const [s, k] = SHAPES[x];
    if (/circle|oval|ellipse/.test(x)) return out(`${an(x)} has no straight sides and no corners: it is one continuous curve.`);
    if (x === 'semicircle') return out('A semicircle has 2 sides, one straight and one curved, and 2 corners.');
    if (x === 'star') return out('The usual five-pointed star has 5 points and 10 sides.');
    return out(`${an(x)} has ${s} sides and ${k} corners${x === 'square' ? ', and all four sides are equal' : x === 'triangle' ? '. Its angles add up to 180 degrees' : ''}.`);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// words and letters
const VOWELS = new Set('aeiou');
const cleanWord = (s) => String(s || '').replace(/\b(the word|the name|word|please|for me|in english|correctly|properly)\b/g, ' ').replace(/\s+/g, ' ').trim();
const unsafe = (s) => s.split(/\s+/).some((w) => RUDE.has(w)) || SEXUAL.test(s);
function closeWord(w) {
  if (known(w) || w.length < 4) return null;
  const max = w.length >= 7 ? 2 : 1;
  let best = null, bd = 9, ties = 0;
  for (const v of vocab()) {
    if (Math.abs(v.length - w.length) > max || v[0] !== w[0]) continue;
    const d = editDistance(w, v, max);
    if (d > max) continue;
    if (d < bd) { best = v; bd = d; ties = 0; } else if (d === bd) ties++;
  }
  return best && ties <= 2 ? best : null;
}
export function spell(c) {
  const x = cleanWord(c.slots.x);
  if (!x || x.split(' ').length > 3 || /^(it|that|this|a word|something|my name|your name|bee|out)$/.test(x) || /^(check|checker|checking|correct|casting|caster)\b/.test(x) || /\b(my|your|the|this|these|in|for|of)\b/.test(x) || unsafe(x)) return null;
  if (/^my name$/.test(x)) return null;
  const letters = (w) => w.toUpperCase().split('').join('-');
  const words = x.split(' ');
  const fix = words.length === 1 ? closeWord(words[0]) : null;
  if (fix) return { text: `Did you mean “${fix}”? That is spelled ${letters(fix)}. As you typed it, “${words[0]}” would be ${letters(words[0])}.`, origin: 'skill' };
  return { text: words.length === 1 ? `“${x}” is spelled ${letters(x)}.` : `“${x}” is spelled ${words.map(letters).join(', then ')}.`, origin: 'skill' };
}
const NOT_REVERSIBLE = /^(psychology|osmosis|engineering|gear|mortgage|racism|discrimination|proxy|dns|image|search|lookup|charge|swing|transcription|transcriptase|polarity|bias|logistics|culture|diet|dieting|aging|ageing|lunge|crunch|fly|curl|parking|light|lights|camera|sneeze|stock|split|repo|auction|merger|takeover|osmosis|diabetes|order|phone|number|video|audio|text to speech|migration|sweep|swing|card|uno|uno card|dictionary|osmosis process|cowgirl|flash|harem|isekai|polish notation|shell)\b/;
export function reverse(c) {
  const x = cleanWord(c.slots.x);
  if (!x || x.length > 80 || unsafe(x)) return null;
  const bare = /^(reverse|mirror|flip the word) /.test(c.text) && !/^reverse (the word|the text|this|the string) /.test(c.text);
  if (bare && (x.split(' ').length > 2 || NOT_REVERSIBLE.test(x))) return null;
  if (/^(the )?alphabet$/.test(x)) return { text: 'The alphabet backwards: Z Y X W V U T S R Q P O N M L K J I H G F E D C B A.', origin: 'skill' };
  const r = [...x].reverse().join('');
  return { text: r === x ? `“${x}” backwards is still “${r}”: it is a palindrome.` : `“${x}” backwards is “${r}”.`, origin: 'skill' };
}
export function letters(c) {
  const t = c.text;
  const x = cleanWord(c.slots.x);
  if (!x || x.length > 200 || unsafe(x)) return null;
  const only = x.replace(/[^a-z]/g, '');
  const out = (text) => ({ text, origin: 'skill' });
  let m;
  if (/palindrome/.test(t)) { if (!only) return null; const pal = only === [...only].reverse().join(''); return out(pal ? `Yes. “${x}” reads the same backwards.` : `No. Backwards, “${x}” is “${[...x].reverse().join('')}”.`); }
  if ((m = t.match(/\b(first|last|second|third|middle) letter\b/))) { if (!only) return null; const i = { first: 0, second: 1, third: 2, last: only.length - 1, middle: Math.floor((only.length - 1) / 2) }[m[1]]; if (i >= only.length) return null; return out(`The ${m[1]} letter of “${x}” is ${only[i].toUpperCase()}.${m[1] === 'middle' && only.length % 2 === 0 ? ` (It has an even number of letters, so the middle is ${only[i].toUpperCase()} and ${only[i + 1].toUpperCase()}.)` : ''}`); }
  if ((m = t.match(/\b(start|begin|end) with\b/))) { if (!only) return null; return out(`“${x}” ${m[1] === 'end' ? 'ends' : 'starts'} with the letter ${(m[1] === 'end' ? only[only.length - 1] : only[0]).toUpperCase()}.`); }
  if (/\b(uppercase|capitalize|capitalise|capitals|capital letters|caps|all caps)\b/.test(t)) return out(x.toUpperCase());
  if (/\b(lowercase|small letters)\b/.test(t)) return out(x.toLowerCase());
  if (/\bwords\b/.test(t)) { const n = x.split(' ').filter(Boolean).length; return out(`That has ${n} word${n === 1 ? '' : 's'}.`); }
  if (!only) return null;
  if (x.split(' ').length > 6) return null;
  const v = [...only].filter((ch) => VOWELS.has(ch)).length;
  if (/\bvowels\b/.test(t)) return out(`“${x}” has ${v} vowel${v === 1 ? '' : 's'}${v ? `: ${[...only].filter((ch) => VOWELS.has(ch)).join(', ').toUpperCase()}` : ''}.`);
  if (/\bconsonants\b/.test(t)) return out(`“${x}” has ${only.length - v} consonant${only.length - v === 1 ? '' : 's'}.`);
  if (/\bsyllables\b/.test(t)) return { pass: {} };
  return out(`“${x}” has ${only.length} letter${only.length === 1 ? '' : 's'}${x.includes(' ') ? ', not counting spaces' : ''}.`);
}
export function echo(c) {
  const t = c.text;
  let m;
  if ((m = t.match(/^(?:say|tell) (hi|hello|hey|bye|goodbye|good morning|good night|good evening|good afternoon|thanks|thank you|sorry|happy birthday|congratulations|namaste|i love you|welcome|good luck|get well soon) to (.+)$/))) { const who = m[2].replace(/^my /, 'your '); if (who.split(' ').length > 4 || unsafe(who)) return null; return { text: `${cap(m[1])}, ${/^your /.test(who) ? who : Cap(who)}!`, origin: 'skill' }; }
  if ((m = t.match(/^(?:wish|greet) (.+)$/))) { const who = m[1].replace(/^my /, 'your '); if (who.split(' ').length > 3 || unsafe(who) || /\b(luck|well|me|i|could|would|was|were|had|list|you)\b/.test(who)) return null; return { text: `Hello, ${/^your /.test(who) ? who : Cap(who)}! Warm wishes from INFINI AI.`, origin: 'skill' }; }
  if (!/^(?:please )?(?:say|repeat|repeat after me|say after me|echo|can you say|just say) /.test(t)) return null;
  const x = (c.slots.x || '').trim();
  if (!x || x.split(' ').length > 12) return null;
  if (/^(something|anything|it|that|this|more|again|what|why|how|when|where|who|which|if|about|me|us|the|a|an|my|your|his|her|no more|nothing|less|yes or no|whether)\b/.test(x) && !/^(a|the|my|i|it) [a-z]+$/.test(x) && !/^(cheese|please)$/.test(x)) return null;
  if (unsafe(x)) return { text: "I'd rather not repeat that one. Give me something friendlier to say.", origin: 'skill' };
  return { text: `${cap(x)}${/[.!?]$/.test(x) ? '' : '.'}`, origin: 'skill' };
}
export function alphabet(c) {
  const t = c.text;
  const out = (text) => ({ text, origin: 'skill' });
  let m;
  if (/how many letters|how many alphabets/.test(t)) return out('The English alphabet has 26 letters: 5 vowels (A, E, I, O, U) and 21 consonants.');
  if (/vowel/.test(t)) return out('The vowels are A, E, I, O and U. The letter Y sometimes stands in for a vowel sound, as in “sky”.');
  if (/consonant/.test(t)) return out('The 21 consonants are B, C, D, F, G, H, J, K, L, M, N, P, Q, R, S, T, V, W, X, Y and Z: every letter that is not A, E, I, O or U.');
  if (/backwards|reverse|z to a/.test(t)) return out('Z Y X W V U T S R Q P O N M L K J I H G F E D C B A.');
  if ((m = t.match(/\b(first|last|second|third|fourth|fifth|tenth|middle) letter of the alphabet/))) { const i = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, tenth: 9, last: 25 }[m[1]]; return out(m[1] === 'middle' ? 'The alphabet has 26 letters, so there are two middle letters: M and N.' : `The ${m[1]} letter of the alphabet is ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i]}.`); }
  if (c.slots.x) {
    const x = c.slots.x.trim();
    const n = toNumber(x.replace(/(st|nd|rd|th)$/, '')) || ORD[x];
    if (/letter of the alphabet/.test(t) && n >= 1 && n <= 26) return out(`Letter number ${n} of the alphabet is ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[n - 1]}.`);
    if (/^[a-z]$/.test(x)) { const i = x.charCodeAt(0) - 97; const before = /before/.test(t); const j = before ? i - 1 : i + 1; return out(j < 0 ? 'Nothing comes before A. It is the first letter.' : j > 25 ? 'Nothing comes after Z. It is the last letter.' : `${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[j]} comes ${before ? 'before' : 'after'} ${x.toUpperCase()}.`); }
    return null;
  }
  if (/ka kha ga|a aa i ee/.test(t)) return out("That is the start of the Devanagari alphabet. I can recite the English one: A B C D E F G H I J K L M N O P Q R S T U V W X Y Z. For the Nepali varnamala I'd have to look it up.");
  return out('A B C D E F G H I J K L M N O P Q R S T U V W X Y Z. That is 26 letters.');
}
export function count(c) {
  const t = c.text;
  const down = /count down|countdown|backwards|backward|count back/.test(t);
  let a = c.slots.a != null ? toNumber(c.slots.a) : null, b = c.slots.b != null ? toNumber(c.slots.b) : null;
  const step = c.slots.s != null ? toNumber(c.slots.s) : null;
  if (c.slots.a == null && c.slots.b == null) { a = 1; b = 10; }
  if (down) { if (a == null) return null; if (b == null) b = a > 0 ? (a <= 20 ? 0 : a - 20) : a - 10; } else { if (b == null) return null; if (a == null) a = step ? step : (b >= 1 ? 1 : 0); }
  if (!Number.isInteger(a) || !Number.isInteger(b) || (step != null && (!Number.isInteger(step) || step <= 0))) return null;
  const st = step || 1, n = Math.floor(Math.abs(b - a) / st) + 1;
  if (n > 200) return { text: `That would be ${fmt(n)} numbers, which is more than fits in a chat bubble. I can count a stretch of up to 200, for example “count from ${fmt(a)} to ${fmt(a + (b > a ? 100 : -100))}”.`, origin: 'skill' };
  const seq = [];
  for (let i = 0, v = a; i < n; i++, v += b >= a ? st : -st) seq.push(fmt(v));
  return { text: seq.join(', ') + '.', origin: 'skill' };
}

// ---------------------------------------------------------------------------------------------------------------------
// chance
export function coin(c) { const heads = c.rand() < 0.5; return { text: `${heads ? 'Heads' : 'Tails'}.`, origin: 'skill', chips: ['Flip again'] }; }
export function dice(c) {
  const t = c.text;
  let n = 1, sides = 6, m;
  const num = (w) => { const v = toNumber(w === 'a' || w === 'an' ? 'one' : w); return v == null ? null : v; };
  if ((m = t.match(/\b(\d+)?d(\d+)\b/))) { n = m[1] ? Number(m[1]) : 1; sides = Number(m[2]); } else {
    if ((m = t.match(/\b(\d+|a|an|one|two|three|four|five|six) (\d+|[a-z]+) sided\b/))) { n = num(m[1]) || 1; sides = num(m[2]); } else if ((m = t.match(/\bwith (\d+|[a-z]+) sides\b/))) sides = num(m[1]); else if ((m = t.match(/\b(\d+|[a-z]+) sided\b/))) sides = num(m[1]);
    if ((m = t.match(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten|a pair of|couple of) (?:dice|die)\b/))) n = /pair|couple/.test(m[1]) ? 2 : num(m[1]) || n;
    if (c.slots.x && !/dice|die|sided|sides/.test(t) && !/^(it|again|one more|for me|the dice|a dice|a die|dice|die)$/.test(c.slots.x.trim())) return null;
  }
  if (sides == null || !Number.isInteger(sides) || !Number.isInteger(n) || sides < 2 || sides > 1000 || n < 1 || n > 10) return sides == null ? null : { text: 'I can roll up to 10 dice with 2 to 1,000 sides each. Try “roll 2d6”.', origin: 'skill' };
  const rolls = Array.from({ length: n }, () => 1 + Math.floor(c.rand() * sides));
  const label = sides === 6 ? '' : ` (${sides}-sided)`;
  return { text: n === 1 ? `You rolled ${rolls[0] === 8 || rolls[0] === 11 || rolls[0] === 18 ? 'an' : 'a'} ${rolls[0]}${label}.` : `You rolled ${joinList(rolls.map(String))}${label}. Total: ${rolls.reduce((a, b) => a + b, 0)}.`, origin: 'skill', chips: ['Roll again'] };
}
export function random(c) {
  let a = c.slots.a != null ? toNumber(c.slots.a) : null, b = c.slots.b != null ? toNumber(c.slots.b) : null;
  if (c.slots.a == null && c.slots.b == null) { a = 1; b = /lucky/.test(c.text) ? 99 : 10; } else if (c.slots.a == null) a = 1;
  if (a == null || b == null || !Number.isInteger(a) || !Number.isInteger(b)) return null;
  if (a > b) [a, b] = [b, a];
  if (b - a > 1e12) return null;
  const v = a + Math.floor(c.rand() * (b - a + 1));
  return { text: /lucky/.test(c.text) ? `Let's say ${fmt(v)}. I picked it at random, so the luck is entirely up to you.` : `${fmt(v)}. (Picked at random from ${fmt(a)} to ${fmt(b)}.)`, origin: 'skill' };
}
export function choose(c) {
  const x = (c.slots.x || '').replace(/^(between|from|among|one of|one from|one) /, '').replace(/\b(for me|please)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const opts = x.split(/\s+or\s+|\s+and\s+|\s*,\s*/).map((s) => s.trim().replace(/^(a|an|the) /, '')).filter(Boolean);
  if (opts.length < 2 || opts.length > 12 || opts.some((o) => o.split(' ').length > 5)) return null;
  const pick = opts[Math.floor(c.rand() * opts.length)];
  return { text: `${cap(pick)}. I picked at random, so treat it like a coin toss, not advice.`, origin: 'skill' };
}
const RPS = ['rock', 'paper', 'scissors'];
export function rps(c) {
  const m = c.text.match(/\b(rock|stone|paper|scissors|scissor)\b(?!.*\b(rock|stone|paper|scissors|scissor)\b)/);
  const only = /^(?:i (?:choose|pick|play|throw|go with|say) |my choice is )?(rock|stone|paper|scissors|scissor)$/.exec(c.text);
  if (!only) return { text: 'Rock, paper, scissors! Type your choice: rock, paper or scissors.', expect: 'rps', origin: 'skill', chips: ['Rock', 'Paper', 'Scissors'] };
  const you = m[1] === 'stone' ? 'rock' : m[1] === 'scissor' ? 'scissors' : m[1];
  const me = RPS[Math.floor(c.rand() * 3)];
  const win = (RPS.indexOf(you) - RPS.indexOf(me) + 3) % 3;
  const why = { 'rock>scissors': 'Rock blunts scissors', 'paper>rock': 'Paper wraps rock', 'scissors>paper': 'Scissors cut paper' };
  const result = win === 0 ? "It's a draw." : win === 1 ? `${why[`${you}>${me}`]}. You win!` : `${why[`${me}>${you}`]}. I win this one.`;
  return { text: `I chose ${me}. ${result} Again?`, expect: 'rps', origin: 'skill', chips: ['Rock', 'Paper', 'Scissors'] };
}

/** The city a time-zone name points at ("Asia/Katmandu" → "Kathmandu"); '' for zones that name no city. */
const TZ_FIX = { Katmandu: 'Kathmandu', Calcutta: 'Kolkata', Saigon: 'Ho Chi Minh City', Rangoon: 'Yangon', Kiev: 'Kyiv', Dacca: 'Dhaka', Thimbu: 'Thimphu', Macao: 'Macau' };
export function tzCity(tz) {
  if (!tz || !tz.includes('/') || /^(Etc|GMT|UTC|US|Canada|Brazil|Mexico|Chile|Antarctica|Arctic|SystemV)\//.test(tz)) return '';
  const x = tz.split('/').pop().replace(/_/g, ' ');
  return TZ_FIX[x] || x;
}
