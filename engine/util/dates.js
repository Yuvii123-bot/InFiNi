// INFINI AI — date parsing and date mention detection (rule based).

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthNum = (s) => MONTHS[s.slice(0, 3).toLowerCase()];
const pad = (n) => String(n).padStart(2, '0');
const validYMD = (y, m, d) => y >= 1 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

const RE_DMY = new RegExp('^\\W*(?:[a-z]{3,9},?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MON + ',?\\s+(\\d{4})', 'i');
const RE_MDY = new RegExp('^\\W*(?:[a-z]{3,9},?\\s+)?' + MON + '\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})', 'i');
const RE_MY = new RegExp('^\\W*' + MON + ',?\\s+(\\d{4})', 'i');

/**
 * Parse a date string from metadata (ISO 8601, RFC 822, "November 11, 2026", GDELT compact, unix seconds).
 * Returns {ms, iso, precision:'time'|'day'|'month'|'year'} or null.
 */
export function parseDate(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') {
    const ms = input < 1e11 ? input * 1000 : input;
    return finish(ms, 'time');
  }
  const s = String(input).trim();
  if (!s || s.length > 80) return null;
  let m;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/))) return finish(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), 'time');
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?\s*(Z|[+-]\d{2}:?\d{2}|[+-]\d{2})?)?/i))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!validYMD(y, mo, d)) return null;
    if (m[4] === undefined) return finish(Date.UTC(y, mo - 1, d), 'day');
    let off = 0;
    if (m[7] && m[7].toUpperCase() !== 'Z') { const o = m[7].replace(':', ''); off = (o[0] === '-' ? -1 : 1) * (Number(o.slice(1, 3)) * 60 + Number(o.slice(3, 5) || 0)); }
    return finish(Date.UTC(y, mo - 1, d, +m[4], +m[5], +(m[6] || 0)) - off * 60000, 'time');
  }
  if ((m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/))) { if (validYMD(+m[1], +m[2], +m[3])) return finish(Date.UTC(+m[1], +m[2] - 1, +m[3]), 'day'); }
  if (/\d{1,2}:\d{2}/.test(s) && /[a-z]{3}/i.test(s)) {                       // RFC 822 and friends
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return finish(t, 'time');
  }
  if ((m = s.match(RE_DMY))) { if (validYMD(+m[3], monthNum(m[2]), +m[1])) return finish(Date.UTC(+m[3], monthNum(m[2]) - 1, +m[1]), 'day'); }
  if ((m = s.match(RE_MDY))) { if (validYMD(+m[3], monthNum(m[1]), +m[2])) return finish(Date.UTC(+m[3], monthNum(m[1]) - 1, +m[2]), 'day'); }
  if ((m = s.match(RE_MY))) return finish(Date.UTC(+m[2], monthNum(m[1]) - 1, 1), 'month');
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) return finish(Date.UTC(+m[1], +m[2] - 1, 1), 'month');
  if ((m = s.match(/^(\d{4})$/))) return finish(Date.UTC(+m[1], 0, 1), 'year');
  if (/^\d{10}$/.test(s)) return finish(Number(s) * 1000, 'time');
  if (/^\d{13}$/.test(s)) return finish(Number(s), 'time');
  return null;
}
function finish(ms, precision) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 1 || y > 2200) return null;
  const day = `${String(y).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const iso = precision === 'time' ? d.toISOString() : precision === 'day' ? day : precision === 'month' ? day.slice(0, 7) : day.slice(0, 4);
  return { ms, iso, precision };
}

/** A plausible publication date: not in the future (1 day of slack), not before the web existed. */
export function plausiblePubDate(d, now = Date.now()) {
  return !!d && d.ms <= now + 86400000 && d.ms >= Date.UTC(1990, 0, 1);
}

export function formatDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(-?\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return String(iso);
  const y = Number(m[1]);
  const ys = y < 0 ? `${-y} BCE` : String(y);
  if (m[3]) return `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${ys}`;
  if (m[2]) return `${MONTH_NAMES[Number(m[2]) - 1]} ${ys}`;
  return ys;
}

const G_DMY = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MON + ',?\\s+(\\d{3,4})\\b', 'gi');
const G_MDY = new RegExp('\\b' + MON + '\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{3,4})\\b', 'gi');
const G_MY = new RegExp('\\b' + MON + ',?\\s+(?:of\\s+)?(\\d{4})\\b', 'gi');
const G_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const G_ERA = /\b(\d{1,4})\s*(BCE|BC|CE|AD)\b|\b(AD)\s*(\d{1,4})\b/g;
const G_CENT = /\b(\d{1,2})(?:st|nd|rd|th)[\s-]century(\s+(?:BCE|BC))?\b/gi;
const G_YEAR = /(?<![\d.,/$€£#-])\b(1[0-9]{3}|20[0-9]{2})\b(?![\d%]|,\d{3}|\.\d|\s*(?:km|kg|m\b|miles|people|feet|ft|dollars|usd|°|years|hours|times|percent))/g;

/**
 * Find date mentions in running text. Returns [{text, index, iso, precision, year}] in order of appearance.
 * Full dates subsume the bare years inside them.
 */
export function findDates(text) {
  const out = [];
  if (!text) return out;
  const taken = [];
  const free = (i, len) => !taken.some(([a, b]) => i < b && i + len > a);
  const add = (m, iso, precision, year) => { if (free(m.index, m[0].length)) { taken.push([m.index, m.index + m[0].length]); out.push({ text: m[0], index: m.index, iso, precision, year }); } };
  let m;
  G_DMY.lastIndex = 0;
  while ((m = G_DMY.exec(text))) { const y = +m[3], mo = monthNum(m[2]), d = +m[1]; if (validYMD(y, mo, d)) add(m, `${String(y).padStart(4, '0')}-${pad(mo)}-${pad(d)}`, 'day', y); }
  G_MDY.lastIndex = 0;
  while ((m = G_MDY.exec(text))) { const y = +m[3], mo = monthNum(m[1]), d = +m[2]; if (validYMD(y, mo, d)) add(m, `${String(y).padStart(4, '0')}-${pad(mo)}-${pad(d)}`, 'day', y); }
  G_ISO.lastIndex = 0;
  while ((m = G_ISO.exec(text))) { if (validYMD(+m[1], +m[2], +m[3])) add(m, m[0], 'day', +m[1]); }
  G_MY.lastIndex = 0;
  while ((m = G_MY.exec(text))) { const y = +m[2]; if (y >= 1000 && y <= 2200) add(m, `${y}-${pad(monthNum(m[1]))}`, 'month', y); }
  G_ERA.lastIndex = 0;
  while ((m = G_ERA.exec(text))) {
    const num = +(m[1] || m[4]); const era = (m[2] || m[3]).toUpperCase();
    const y = era.startsWith('B') ? -num : num;
    add(m, String(y), 'year', y);
  }
  G_CENT.lastIndex = 0;
  while ((m = G_CENT.exec(text))) { const c = +m[1]; const y = m[2] ? -(c * 100) : (c - 1) * 100; add(m, m[0].toLowerCase(), 'century', y); }
  G_YEAR.lastIndex = 0;
  while ((m = G_YEAR.exec(text))) add(m, m[1], 'year', +m[1]);
  out.sort((a, b) => a.index - b.index);
  return out;
}
