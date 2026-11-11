// INFINI AI — deterministic calculator: arithmetic, percentages, unit conversion, linear/quadratic equations.
// A recursive-descent parser over a tiny grammar. No eval(), no model: every result is computed and the steps are shown.

const NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const MULT_WORDS = { hundred: 1e2, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp,
  ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, min: Math.min, max: Math.max,
};
const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 };

export function formatNumber(x) {
  if (!Number.isFinite(x)) return String(x);
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return x.toLocaleString('en-US');
  const abs = Math.abs(x);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return x.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', ' × 10^').replace('e-', ' × 10^-');
  const s = Number(x.toPrecision(12));
  return s.toLocaleString('en-US', { maximumFractionDigits: 10 });
}
function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error('factorial needs an integer from 0 to 170');
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}

// ---- tokenizer + parser -----------------------------------------------------------------------
function lex(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([a-zπ]+)|(\*\*|[-+*/^%!(),=×÷−·]))/giy;
  let pos = 0, m;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(pos))) break; return null; }
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2].toLowerCase() });
    else out.push({ t: 'op', v: { '×': '*', '÷': '/', '−': '-', '·': '*', '**': '^' }[m[3]] || m[3] });
  }
  return out;
}

/** Parse into an AST. `vars` = allowed variable names (for equations). */
function parse(tokens, vars = null) {
  let i = 0;
  const peek = () => tokens[i];
  const eat = (v) => { if (tokens[i] && tokens[i].t === 'op' && tokens[i].v === v) { i++; return true; } return false; };
  const startsPrimary = (t) => t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '('));
  function additive() {
    let left = multiplicative();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) { i++; const right = multiplicative(); left = { op: t.v, a: left, b: right }; } else return left;
    }
  }
  function multiplicative() {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) { i++; left = { op: t.v, a: left, b: unary() }; }
      else if (t && t.t === 'op' && t.v === '%' && startsPrimary(tokens[i + 1])) { i++; left = { op: 'mod', a: left, b: unary() }; }
      else if (t && t.t === 'id' && t.v === 'mod') { i++; left = { op: 'mod', a: left, b: unary() }; }
      else if (startsPrimary(t) && !(t.t === 'num')) left = { op: '*', a: left, b: unary(), implicit: true };        // 2pi, 3(4+1), 2x
      else return left;
    }
  }
  function unary() {
    if (eat('-')) return { op: 'neg', a: unary() };
    if (eat('+')) return unary();
    return power();
  }
  function power() {
    const base = postfix();
    if (eat('^')) return { op: '^', a: base, b: unary() };
    return base;
  }
  function postfix() {
    let node = primary();
    for (;;) {
      if (eat('!')) node = { op: 'fact', a: node };
      else if (peek() && peek().t === 'op' && peek().v === '%' && !startsPrimary(tokens[i + 1])) { i++; node = { op: 'pct', a: node }; }
      else return node;
    }
  }
  function primary() {
    const t = tokens[i];
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') { i++; return { num: t.v }; }
    if (t.t === 'op' && t.v === '(') { i++; const e = additive(); if (!eat(')')) throw new Error('missing )'); return e; }
    if (t.t === 'id') {
      i++;
      if (vars && vars.includes(t.v)) return { v: t.v };
      if (FUNCS[t.v]) {
        const args = [];
        if (eat('(')) { if (!eat(')')) { do args.push(additive()); while (eat(',')); if (!eat(')')) throw new Error('missing )'); } }
        else args.push(unary());
        return { fn: t.v, args };
      }
      if (t.v in CONSTS) return { num: CONSTS[t.v], name: t.v };
      throw new Error('unknown word: ' + t.v);
    }
    throw new Error('unexpected ' + t.v);
  }
  const ast = additive();
  if (i < tokens.length) throw new Error('unexpected ' + (tokens[i].v));
  return ast;
}

function evalAst(n) {
  if ('num' in n) return n.num;
  if (n.fn) { const a = n.args.map(evalAst); return FUNCS[n.fn](...a); }
  switch (n.op) {
    case 'neg': return -evalAst(n.a);
    case 'fact': return factorial(evalAst(n.a));
    case 'pct': return evalAst(n.a) / 100;
    case '+': case '-': {
      const a = evalAst(n.a);
      if (n.b.op === 'pct') { const pv = evalAst(n.b.a); return n.op === '+' ? a + a * pv / 100 : a - a * pv / 100; }   // 200 + 10% → 220
      const b = evalAst(n.b); return n.op === '+' ? a + b : a - b;
    }
    case '*': return evalAst(n.a) * evalAst(n.b);
    case '/': { const b = evalAst(n.b); if (b === 0) throw new Error('division by zero'); return evalAst(n.a) / b; }
    case 'mod': { const b = evalAst(n.b); if (b === 0) throw new Error('division by zero'); return evalAst(n.a) % b; }
    case '^': return Math.pow(evalAst(n.a), evalAst(n.b));
    default: throw new Error('cannot evaluate');
  }
}
function show(n, parentPrec = 0) {
  if ('num' in n) return n.name || formatNumber(n.num);
  if (n.v) return n.v;
  if (n.fn) return `${n.fn}(${n.args.map((a) => show(a)).join(', ')})`;
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, mod: 2, neg: 3, '^': 4, fact: 5, pct: 5 }[n.op];
  let s;
  if (n.op === 'neg') s = '−' + show(n.a, prec);
  else if (n.op === 'fact') s = show(n.a, prec) + '!';
  else if (n.op === 'pct') s = show(n.a, prec) + '%';
  else s = `${show(n.a, prec)} ${{ '*': '×', '/': '÷', '-': '−', mod: 'mod' }[n.op] || n.op} ${show(n.b, prec + (n.op === '^' ? 0 : 1))}`;
  return prec < parentPrec ? `(${s})` : s;
}

// polynomial evaluation (degree ≤ 2) for equation solving: value = [c0, c1, c2]
function polyAst(n, x) {
  const K = (c) => [c, 0, 0];
  if ('num' in n) return K(n.num);
  if (n.v) return [0, 1, 0];
  if (n.fn) { const args = n.args.map((a) => polyAst(a, x)); if (args.some((p) => p[1] || p[2])) throw new Error('nonlinear'); return K(FUNCS[n.fn](...args.map((p) => p[0]))); }
  const a = n.a ? polyAst(n.a, x) : null, b = n.b ? polyAst(n.b, x) : null;
  const isConst = (p) => !p[1] && !p[2];
  switch (n.op) {
    case 'neg': return a.map((c) => -c);
    case '+': return a.map((c, i) => c + b[i]);
    case '-': return a.map((c, i) => c - b[i]);
    case '*': { const r = [0, 0, 0, 0, 0]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i + j] += a[i] * b[j]; if (r[3] || r[4]) throw new Error('degree'); return r.slice(0, 3); }
    case '/': if (!isConst(b) || b[0] === 0) throw new Error('nonlinear'); return a.map((c) => c / b[0]);
    case '^': { if (!isConst(b)) throw new Error('nonlinear'); const e = b[0]; if (isConst(a)) return K(Math.pow(a[0], e)); if (e === 1) return a; if (e === 2) return polyAst({ op: '*', a: n.a, b: n.a }, x); throw new Error('degree'); }
    case 'fact': if (!isConst(a)) throw new Error('nonlinear'); return K(factorial(a[0]));
    case 'pct': return a.map((c) => c / 100);
    default: throw new Error('nonlinear');
  }
}

// ---- units ------------------------------------------------------------------------------------
const U = {};
function unit(dim, factor, ...names) { for (const n of names) U[n] = { dim, factor, name: names[0] }; }
unit('length', 1, 'metres', 'meters', 'meter', 'metre', 'm'); unit('length', 1000, 'kilometres', 'kilometers', 'kilometer', 'kilometre', 'km', 'kms'); unit('length', 0.01, 'centimetres', 'centimeters', 'centimeter', 'centimetre', 'cm');
unit('length', 0.001, 'millimetres', 'millimeters', 'millimeter', 'millimetre', 'mm'); unit('length', 1609.344, 'miles', 'mile', 'mi'); unit('length', 0.9144, 'yards', 'yard', 'yd', 'yds');
unit('length', 0.3048, 'feet', 'foot', 'ft'); unit('length', 0.0254, 'inches', 'inch', 'in'); unit('length', 1852, 'nautical miles', 'nautical mile', 'nmi'); unit('length', 9.4607304725808e15, 'light-years', 'light years', 'light year', 'light-year', 'ly');
unit('mass', 1, 'kilograms', 'kilogram', 'kg', 'kgs', 'kilos', 'kilo'); unit('mass', 0.001, 'grams', 'gram', 'g'); unit('mass', 1e-6, 'milligrams', 'milligram', 'mg'); unit('mass', 0.45359237, 'pounds', 'pound', 'lb', 'lbs');
unit('mass', 0.028349523125, 'ounces', 'ounce', 'oz'); unit('mass', 1000, 'tonnes', 'tonne', 'metric tons', 'metric ton', 't'); unit('mass', 6.35029318, 'stone', 'stones', 'st'); unit('mass', 907.18474, 'US tons', 'tons', 'ton');
unit('time', 1, 'seconds', 'second', 's', 'sec', 'secs'); unit('time', 60, 'minutes', 'minute', 'min', 'mins'); unit('time', 3600, 'hours', 'hour', 'h', 'hr', 'hrs'); unit('time', 86400, 'days', 'day', 'd');
unit('time', 604800, 'weeks', 'week', 'wk'); unit('time', 31557600, 'years', 'year', 'yr', 'yrs'); unit('time', 0.001, 'milliseconds', 'millisecond', 'ms'); unit('time', 2629800, 'months', 'month');
unit('data', 1, 'bytes', 'byte', 'b'); unit('data', 0.125, 'bits', 'bit'); unit('data', 1e3, 'kilobytes', 'kilobyte', 'kb'); unit('data', 1e6, 'megabytes', 'megabyte', 'mb'); unit('data', 1e9, 'gigabytes', 'gigabyte', 'gb');
unit('data', 1e12, 'terabytes', 'terabyte', 'tb'); unit('data', 1024, 'kibibytes', 'kibibyte', 'kib'); unit('data', 1048576, 'mebibytes', 'mebibyte', 'mib'); unit('data', 1073741824, 'gibibytes', 'gibibyte', 'gib');
unit('volume', 1, 'litres', 'liters', 'liter', 'litre', 'l'); unit('volume', 0.001, 'millilitres', 'milliliters', 'milliliter', 'millilitre', 'ml'); unit('volume', 3.785411784, 'US gallons', 'gallons', 'gallon', 'gal');
unit('volume', 0.946352946, 'US quarts', 'quarts', 'quart', 'qt'); unit('volume', 0.473176473, 'US pints', 'pints', 'pint', 'pt'); unit('volume', 0.2365882365, 'US cups', 'cups', 'cup'); unit('volume', 0.0295735295625, 'US fluid ounces', 'fluid ounces', 'fluid ounce', 'fl oz', 'floz');
unit('volume', 1000, 'cubic metres', 'cubic meters', 'cubic meter', 'cubic metre', 'm3'); unit('volume', 0.01478676478125, 'tablespoons', 'tablespoon', 'tbsp'); unit('volume', 0.00492892159375, 'teaspoons', 'teaspoon', 'tsp');
unit('area', 1, 'square metres', 'square meters', 'square meter', 'square metre', 'sq m', 'm2'); unit('area', 1e6, 'square kilometres', 'square kilometers', 'square kilometer', 'square kilometre', 'sq km', 'km2'); unit('area', 1e4, 'hectares', 'hectare', 'ha');
unit('area', 4046.8564224, 'acres', 'acre'); unit('area', 0.09290304, 'square feet', 'square foot', 'sq ft', 'ft2'); unit('area', 2589988.110336, 'square miles', 'square mile', 'sq mi', 'mi2');
unit('speed', 1, 'metres per second', 'meters per second', 'm/s', 'mps'); unit('speed', 1 / 3.6, 'kilometres per hour', 'kilometers per hour', 'km/h', 'kph', 'kmh', 'kmph'); unit('speed', 0.44704, 'miles per hour', 'mph'); unit('speed', 0.514444, 'knots', 'knot', 'kn');
unit('energy', 1, 'joules', 'joule', 'j'); unit('energy', 1000, 'kilojoules', 'kilojoule', 'kj'); unit('energy', 4.184, 'calories', 'calorie', 'cal'); unit('energy', 4184, 'kilocalories', 'kilocalorie', 'kcal'); unit('energy', 3.6e6, 'kilowatt-hours', 'kilowatt hours', 'kilowatt hour', 'kwh'); unit('energy', 3600, 'watt-hours', 'watt hours', 'wh');
const TEMP = { c: 'C', celsius: 'C', centigrade: 'C', '°c': 'C', f: 'F', fahrenheit: 'F', '°f': 'F', k: 'K', kelvin: 'K', kelvins: 'K' };
const TEMP_NAME = { C: '°C', F: '°F', K: 'K' };

function findUnit(s) { const k = s.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '').replace(/²/g, '2').replace(/³/g, '3').trim(); return U[k] || (k.length > 2 && U[k.replace(/s$/, '')]) || null; }

function convert(text) {
  let m = text.match(/^(?:convert\s+|change\s+)?(-?\d[\d,]*(?:\.\d+)?|an?|one)\s*(°?[a-zµ/23²³ -]+?)\s+(?:to|in|into|as|equals? how many|is how many|=)\s+(°?[a-zµ/23²³ -]+?)\??$/i);
  let swap = false;
  if (!m) { m = text.match(/^how many\s+([a-zµ/23²³ -]+?)\s+(?:are |is )?(?:there )?(?:in|per|make(?: up)?|equal)\s+(-?\d[\d,]*(?:\.\d+)?|an?|one)\s*([a-zµ/23²³ -]+?)\??$/i); swap = !!m; }
  if (!m) return null;
  const amountStr = swap ? m[2] : m[1];
  const fromStr = (swap ? m[3] : m[2]).trim(), toStr = (swap ? m[1] : m[3]).trim();
  const amount = /^(an?|one)$/i.test(amountStr) ? 1 : Number(amountStr.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  const tf = TEMP[fromStr.toLowerCase().replace(/^degrees? /, '')], tt = TEMP[toStr.toLowerCase().replace(/^degrees? /, '')];
  if (tf && tt) {
    const c = tf === 'C' ? amount : tf === 'F' ? (amount - 32) * 5 / 9 : amount - 273.15;
    const v = tt === 'C' ? c : tt === 'F' ? c * 9 / 5 + 32 : c + 273.15;
    const formula = { CF: '(°C × 9/5) + 32', FC: '(°F − 32) × 5/9', CK: '°C + 273.15', KC: 'K − 273.15', FK: '(°F − 32) × 5/9 + 273.15', KF: '(K − 273.15) × 9/5 + 32' }[tf + tt] || 'same unit';
    return { kind: 'conversion', expr: `${formatNumber(amount)} ${TEMP_NAME[tf]} in ${TEMP_NAME[tt]}`, value: v, formatted: `${formatNumber(Number(v.toFixed(4)))} ${TEMP_NAME[tt]}`, steps: [`Formula: ${formula}`, `${formatNumber(amount)} ${TEMP_NAME[tf]} = ${formatNumber(Number(v.toFixed(4)))} ${TEMP_NAME[tt]}`] };
  }
  const from = findUnit(fromStr), to = findUnit(toStr);
  if (!from || !to || from.dim !== to.dim) return null;
  const v = amount * from.factor / to.factor;
  const rate = from.factor / to.factor;
  return { kind: 'conversion', expr: `${formatNumber(amount)} ${from.name} in ${to.name}`, value: v, formatted: `${formatNumber(Number(v.toPrecision(10)))} ${to.name}`, steps: [`1 ${from.name.replace(/s$/, '')} = ${formatNumber(Number(rate.toPrecision(10)))} ${to.name}`, `${formatNumber(amount)} × ${formatNumber(Number(rate.toPrecision(10)))} = ${formatNumber(Number(v.toPrecision(10)))} ${to.name}`] };
}

// ---- natural-language front end ---------------------------------------------------------------
function wordsToMath(s) {
  s = ' ' + s.toLowerCase() + ' ';
  s = s.replace(/(\d),(?=\d{3}\b)/g, '$1');
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(hundred|thousand|million|billion|trillion)\b/g, (_, n, w) => String(Number(n) * MULT_WORDS[w]));
  s = s.replace(/\b(\d+(?:\.\d+)?)k\b/g, (_, n) => String(Number(n) * 1000));
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a, b) => String(NUM_WORDS[a] + NUM_WORDS[b]));
  s = s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b(?=\s*(?:plus|minus|times|multiplied|divided|over|percent|squared|cubed|to the|factorial|[-+*/^%!)]|$))|(?<=(?:plus|minus|times|by|of|over|root of|[-+*/^(])\s*)\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, (w) => String(NUM_WORDS[w]));
  s = s.replace(/\bthe (?:square|2nd) root of\b|\bsquare root of\b|\bsquare root\b|√/g, ' sqrt ').replace(/\bcube root of\b|∛/g, ' cbrt ');
  s = s.replace(/\b(?:multiplied by|times)\b/g, ' * ').replace(/\bdivided by\b/g, ' / ').replace(/\bplus\b/g, ' + ').replace(/\bminus\b/g, ' - ');
  s = s.replace(/\b(?:to the power of|raised to(?: the power of)?|to the)\s+(\d+)(?:st|nd|rd|th)?(?: power)?\b/g, ' ^ $1 ').replace(/\bto the power of\b|\braised to\b/g, ' ^ ');
  s = s.replace(/\bsquared\b/g, ' ^2 ').replace(/\bcubed\b/g, ' ^3 ').replace(/\bmodulo\b/g, ' mod ').replace(/\bfactorial of\s+(\d+)/g, ' $1! ').replace(/\b(\d+)\s+factorial\b/g, ' $1! ');
  s = s.replace(/\bpercent(?:age)?\b|\bper cent\b/g, '%').replace(/(\d)\s*x\s*(?=\d)/g, '$1 * ');
  return s.trim();
}
const SCAFFOLD = /^(?:please\s+)?(?:(?:can|could) you\s+)?(?:what(?: is| are|'s)?|how much(?: is| are)?|calculate|compute|evaluate|work out|find|solve|simplify|tell me|give me|what does|whats)?\s*(?:the\s+)?(?:value|result|answer|sum|product)?\s*(?:of|for|to)?\s*:?\s*/i;

function percentForms(s) {
  let m;
  const N = '(-?\\d+(?:\\.\\d+)?)';
  if ((m = s.match(new RegExp(`^${N}\\s*%\\s*of\\s*${N}$`)))) return { expr: `${m[1]}% of ${m[2]}`, value: m[1] / 100 * m[2], steps: [`${m[1]}% of ${m[2]} = (${m[1]} ÷ 100) × ${m[2]}`] };
  if ((m = s.match(new RegExp(`^(?:what )?%\\s*(?:of|is)\\s*${N}\\s*(?:is|of|out of)\\s*${N}$`)))) { const [part, whole] = /is\s*-?\d/.test(s.replace(/^.*?%\s*/, '').slice(0, 4)) ? [m[1], m[2]] : [m[2], m[1]]; if (Number(whole) === 0) return null; return { expr: `${part} as a percentage of ${whole}`, value: part / whole * 100, unit: '%', steps: [`(${part} ÷ ${whole}) × 100`] }; }
  if ((m = s.match(new RegExp(`^${N}\\s*(?:is|as|are)\\s*(?:what|a)\\s*%\\s*of\\s*${N}$`)))) { if (Number(m[2]) === 0) return null; return { expr: `${m[1]} as a percentage of ${m[2]}`, value: m[1] / m[2] * 100, unit: '%', steps: [`(${m[1]} ÷ ${m[2]}) × 100`] }; }
  if ((m = s.match(new RegExp(`^%\\s*(change|increase|decrease|difference)\\s*(?:from|between)\\s*${N}\\s*(?:to|and)\\s*${N}$`)))) { if (Number(m[2]) === 0) return null; return { expr: `percentage change from ${m[2]} to ${m[3]}`, value: (m[3] - m[2]) / Math.abs(m[2]) * 100, unit: '%', steps: [`((${m[3]} − ${m[2]}) ÷ ${m[2]}) × 100`] }; }
  return null;
}

/** Try to interpret `text` as a calculation. Returns null when it is not one. */
export function calc(text) {
  let raw = String(text || '').trim().replace(/[?!.\s]+$/, '').replace(/[’‘]/g, "'");
  if (!raw || raw.length > 200 || !/\d|\b(pi|sqrt|one|two|three|four|five|six|seven|eight|nine|ten)\b|^how many\b/i.test(raw)) return null;
  try {
    const conv = convert(raw.replace(/^(?:what(?: is|'s)|how much is)\s+/i, ''));
    if (conv) return conv;
    let s = wordsToMath(raw.replace(/^solve\s+(?:for\s+[a-z]\s*[:,]?\s*)?/i, 'solve ').replace(SCAFFOLD, ''));
    s = s.replace(/^(?:of|is|equals?)\s+/, '').replace(/\s*(?:=|equals?|is equal to)\s*$/, '').trim();
    if (!s) return null;
    const pf = percentForms(s.replace(/\s+/g, ' '));
    if (pf) return { kind: 'percent', expr: pf.expr, value: pf.value, formatted: formatNumber(Number(pf.value.toPrecision(12))) + (pf.unit || ''), steps: [...pf.steps, `= ${formatNumber(Number(pf.value.toPrecision(12)))}${pf.unit || ''}`] };
    s = s.replace(/(\d(?:\.\d+)?)\s*%\s*of\s*/g, '($1/100) * ');
    if (s.includes('=')) return equation(s);
    const tokens = lex(s);
    if (!tokens || !tokens.length) return null;
    const hasOp = tokens.some((t) => t.t === 'op' && t.v !== '(' && t.v !== ')' && t.v !== ',') || tokens.some((t) => t.t === 'id' && (FUNCS[t.v] || t.v === 'mod'));
    if (!hasOp) return null;
    if (tokens.some((t) => t.t === 'id' && !FUNCS[t.v] && !(t.v in CONSTS) && t.v !== 'mod')) return null;
    if (tokens.length === 2 && tokens[0].t === 'op' && tokens[0].v === '-') return null;            // "-5" is not a question
    if (/^\d{1,4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,4}$/.test(s)) return null;                         // dates: 2026-11-11
    const ast = parse(tokens);
    let value = evalAst(ast);
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    if (Number.isFinite(value)) value = Number(value.toPrecision(14));          // hide binary floating-point noise (0.1 + 0.2)
    const shown = show(ast);
    return { kind: 'arithmetic', expr: shown, value, formatted: formatNumber(value), steps: [`${shown} = ${formatNumber(value)}`] };
  } catch (e) {
    if (/division by zero|factorial/.test(e.message)) return { kind: 'error', expr: raw, value: NaN, formatted: '', error: e.message, steps: [] };
    return null;
  }
}

function equation(s) {
  const sides = s.split('=');
  if (sides.length !== 2) return null;
  const vars = [...new Set((s.match(/[a-z]+/g) || []).filter((w) => !FUNCS[w] && !(w in CONSTS) && w !== 'mod' && w !== 'solve'))];
  const clean = (t) => t.replace(/\bsolve\b/g, '').trim();
  if (vars.length !== 1 || vars[0].length !== 1) return null;
  const x = vars[0];
  const L = lex(clean(sides[0])), R = lex(clean(sides[1]));
  if (!L || !R || !L.length || !R.length) return null;
  const la = parse(L, [x]), ra = parse(R, [x]);
  const lp = polyAst(la, x), rp = polyAst(ra, x);
  const [c, b, a] = lp.map((v, i) => v - rp[i]);
  const eq = `${show(la)} = ${show(ra)}`;
  const f = (v) => formatNumber(Number(v.toPrecision(12)));
  if (a === 0) {
    if (b === 0) return { kind: 'equation', expr: eq, value: NaN, formatted: c === 0 ? 'true for every value of ' + x : 'no solution', steps: [`Simplifies to ${f(c)} = 0`] };
    const v = -c / b;
    return { kind: 'equation', expr: eq, value: v, formatted: `${x} = ${f(v)}`, steps: [`Move everything to one side: ${f(b)}${x} ${c < 0 ? '−' : '+'} ${f(Math.abs(c))} = 0`, `${x} = ${f(-c)} ÷ ${f(b)}`, `${x} = ${f(v)}`] };
  }
  const D = b * b - 4 * a * c;
  const std = `${f(a)}${x}² ${b < 0 ? '−' : '+'} ${f(Math.abs(b))}${x} ${c < 0 ? '−' : '+'} ${f(Math.abs(c))} = 0`;
  if (D < 0) { const re = -b / (2 * a), im = Math.sqrt(-D) / (2 * a); return { kind: 'equation', expr: eq, value: NaN, formatted: `${x} = ${f(re)} ± ${f(Math.abs(im))}i (no real solution)`, steps: [`Standard form: ${std}`, `Discriminant b² − 4ac = ${f(D)} < 0`] }; }
  const r1 = (-b + Math.sqrt(D)) / (2 * a), r2 = (-b - Math.sqrt(D)) / (2 * a);
  return { kind: 'equation', expr: eq, value: r1, formatted: D === 0 ? `${x} = ${f(r1)}` : `${x} = ${f(Math.min(r1, r2))} or ${x} = ${f(Math.max(r1, r2))}`, steps: [`Standard form: ${std}`, `Discriminant b² − 4ac = ${f(D)}`, `${x} = (−b ± √${f(D)}) ÷ 2a`] };
}
