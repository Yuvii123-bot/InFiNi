#!/usr/bin/env node
// INFINI AI — builds the brain's data files from the editable sources in tools/brain/.
//   node tools/brain/build.mjs            (all stages)
//   node tools/brain/build.mjs dialogue   (only the conversation database)
// Sources: tools/brain/intents/*.txt, fun.txt, commonsense/*.txt (written for this project) + tools/brain/sources/* (open data, see NOTICE).
// The large ConceptNet extract is read from $BRAIN_RAW (default /var/tmp/brain); without it the common-sense stage keeps the existing file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../../engine/brain/normalize.js';
import { parseTemplate, hasSlot, expand, mapLiterals, stringify, countExpansions } from '../../engine/brain/pattern.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'engine/brain/data');
const SRC = path.join(HERE, 'sources');
const RAW = process.env.BRAIN_RAW || '/var/tmp/brain';
const stages = process.argv.slice(2);
const want = (s) => !stages.length || stages.includes(s);
const read = (p) => fs.readFileSync(p, 'utf8');
const log = (...a) => console.log(...a);
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------------
// vocabulary: frequent English words (subtitle frequency list) + every word used in a pattern
function loadFrequency() {
  const rank = new Map();
  const lines = read(path.join(SRC, 'en_50k.txt')).split('\n');
  for (const line of lines) {
    const [w] = line.split(' ');
    if (!w || !/^[a-z]+$/.test(w) || rank.has(w)) continue;
    rank.set(w, rank.size + 1);
  }
  return rank;
}

// ---------------------------------------------------------------------------------------------------------------------
// intents
function parseIntentFiles() {
  const dir = path.join(HERE, 'intents');
  const intents = [];
  let cur = null;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
    const lines = read(path.join(dir, file)).split('\n');
    lines.forEach((raw, ln) => {
      const line = raw.trimEnd();
      if (!line.trim() || (line.startsWith('#') && !line.startsWith('##'))) return;
      const where = `${file}:${ln + 1}`;
      if (line.startsWith('## ')) {
        const [id, ...kv] = line.slice(3).trim().split(/\s+/);
        if (intents.some((x) => x.id === id)) throw new Error(`${where}: duplicate intent ${id}`);
        cur = { id, g: '', h: '', patterns: [], imports: [], replies: [], chips: [], where };
        for (const p of kv) { const [k, v] = p.split('='); if (k === 'g') cur.g = v; else if (k === 'h') cur.h = v; else throw new Error(`${where}: unknown key ${k}`); }
        intents.push(cur);
      } else if (!cur) throw new Error(`${where}: content before the first intent`);
      else if (line.startsWith('> ')) cur.patterns.push({ src: line.slice(2).trim(), where });
      else if (line.startsWith('! ')) {
        const m = line.slice(2).trim().match(/^(ms|clinc)\s+(.*)$/);
        if (!m) throw new Error(`${where}: bad import`);
        let rest = m[2], inc = null, exc = null;
        rest = rest.replace(/\s-\/(.+?)\/\s*$/, (_, r) => { exc = new RegExp(r); return ''; });
        rest = rest.replace(/\s\/(.+?)\/\s*$/, (_, r) => { inc = new RegExp(r); return ''; });
        rest = rest.replace(/\s-\/(.+?)\/\s*$/, (_, r) => { exc = new RegExp(r); return ''; });
        cur.imports.push({ kind: m[1], names: rest.trim().split(/\s+/), inc, exc, where });
      } else if (line.startsWith('<')) {
        const m = line.match(/^<(?:\[([^\]]*)\])?\s*(.*)$/);
        let text = m[2].trim(), expect = '';
        text = text.replace(/\{\?([a-z0-9_]+)\}\s*$/, (_, e) => { expect = e; return ''; }).trim();
        if (!text) throw new Error(`${where}: empty reply`);
        cur.replies.push({ c: m[1] ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [], t: text, e: expect });
      } else if (line.startsWith('* ')) cur.chips.push(...line.slice(2).split('|').map((x) => x.trim()).filter(Boolean));
      else throw new Error(`${where}: cannot parse "${line.slice(0, 60)}"`);
    });
  }
  return intents;
}

function parseMs() {
  const txt = read(path.join(SRC, 'ms_professional.qna')).replace(/\r/g, '');
  const out = [];
  for (const b of txt.split(/\n(?=#+ \? )/)) {
    const m = b.match(/^#+ \? (.*)/);
    if (!m) continue;
    const qs = [m[1].trim()];
    for (const l of b.split('\n')) if (l.startsWith('- ') && !l.startsWith('- editorial')) qs.push(l.slice(2).trim());
    out.push(qs);
  }
  return out;
}

function buildDialogue(freq) {
  const intents = parseIntentFiles();
  // 1. vocabulary
  const vocab = new Set();
  let n = 0;
  for (const [w] of freq) { if (n++ >= 30000) break; if (w.length > 1 || w === 'a' || w === 'i') vocab.add(w); }
  const trees = new Map();
  for (const it of intents) for (const p of it.patterns) {
    let tree;
    try { tree = parseTemplate(p.src.toLowerCase()); } catch (e) { throw new Error(`${p.where}: ${e.message}`); }
    trees.set(p, tree);
    (function walk(t) { for (const node of t) { if (typeof node === 'string') { for (const w of node.split(/[^a-z0-9]+/)) if (w) vocab.add(w); } else if (node.alt) node.alt.forEach(walk); } })(tree);
  }
  const known = (w) => vocab.has(w);
  const norm = (s) => normalize(s, known).text;

  // 2. patterns: normalise literals, expand, check
  const owner = new Map();          // phrase -> intent id (hand-written)
  const report = { unreachable: [], collisions: [] };
  let nExpanded = 0, nBig = 0;
  const outIntents = [];
  for (const it of intents) {
    const exact = [], slots = [];
    const parts = [];
    for (const p of it.patterns) { const tr = trees.get(p); if (tr.length === 1 && tr[0].alt && !tr[0].opt) for (const alt of tr[0].alt) parts.push([p, alt]); else parts.push([p, tr]); }
    for (const [p, tr0] of parts) {
      const tree = mapLiterals(tr0, (phrase) => norm(phrase));
      const text = stringify(tree);
      if (!text) continue;
      if (hasSlot(tree) || countExpansions(tree) > 2500) { slots.push(text); if (!hasSlot(tree)) nBig++; continue; }
      exact.push(text);
      let phrases;
      try { phrases = expand(tree, 60000); } catch (e) { throw new Error(`${p.where}: ${e.message}`); }
      for (const ph of new Set(phrases)) {
        if (!ph) continue;
        const again = norm(ph);
        if (again !== ph) { if (report.unreachable.length < 400) report.unreachable.push(`${it.id}: "${ph}" → "${again}"`); if (!again) continue; }
        const key = again;
        const prev = owner.get(key);
        if (prev && prev !== it.id) report.collisions.push(`"${key}": ${prev} (kept) vs ${it.id}`);
        else if (!prev) { owner.set(key, it.id); nExpanded++; }
      }
    }
    outIntents.push({ id: it.id, g: it.g, h: it.h, t: exact, s: slots, r: it.replies.map((r) => [r.c, r.t, r.e]), c: it.chips });
  }

  // 3. imported phrasings
  const ms = parseMs();
  const clinc = JSON.parse(read(path.join(SRC, 'clinc150.json')));
  const imported = {};
  const importOwner = new Map();
  let nImported = 0, dropped = 0;
  const usedMs = new Set(), usedClinc = new Set();
  for (const it of intents) {
    const lines = [];
    for (const imp of it.imports) {
      for (const name of imp.names) {
        let utts;
        if (imp.kind === 'ms') { utts = ms[Number(name)]; usedMs.add(Number(name)); } else { utts = clinc.intents[name]; usedClinc.add(name); }
        if (!utts) throw new Error(`${imp.where}: unknown ${imp.kind} source "${name}"`);
        for (const u of utts) {
          const t = norm(u);
          if (!t || t.length > 120) { dropped++; continue; }
          if (imp.inc && !imp.inc.test(t)) continue;
          if (imp.exc && imp.exc.test(t)) continue;
          const o = owner.get(t);
          if (o) { if (o !== it.id) dropped++; continue; }                       // a hand-written pattern already covers it
          const io = importOwner.get(t);
          if (io) { if (io !== it.id) dropped++; continue; }
          importOwner.set(t, it.id);
          lines.push(t);
          for (const w of t.split(' ')) if (/^[a-z]+$/.test(w)) vocab.add(w);
          nImported++;
        }
      }
    }
    if (lines.length) imported[it.id] = lines.join('\n');
  }

  // 4. fun material
  const fun = {};
  let sec = null;
  for (const raw of read(path.join(HERE, 'fun.txt')).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) { sec = line.slice(3).trim().split(/\s+/)[0]; fun[sec] = []; continue; }
    if (line.startsWith('#') || !sec) continue;
    fun[sec].push(line.split('|').map((x) => x.trim()));
  }
  for (const r of fun.riddles) r[2] = [r[1], ...(r[2] || '').split(',')].map((x) => norm(x).replace(/^(a|an|the|your|my) /, '')).filter(Boolean);

  const nReplies = outIntents.reduce((s, it) => s + it.r.length, 0) + Object.values(fun).reduce((s, v) => s + v.length, 0);
  const meta = { built: new Date().toISOString().slice(0, 10), intents: outIntents.length, patterns: nExpanded + nImported, handWritten: nExpanded, imported: nImported, slotPatterns: outIntents.reduce((s, it) => s + it.s.length, 0), replies: nReplies };
  fs.writeFileSync(path.join(OUT, 'dialogue.json'), JSON.stringify({ meta, intents: outIntents, imported, fun }));
  fs.writeFileSync(path.join(OUT, 'build-report.txt'), [`built ${meta.built}`, JSON.stringify(meta), '', `phrases that normalise to something else (${report.unreachable.length} shown):`, ...report.unreachable, '', `collisions (${report.collisions.length}):`, ...report.collisions].join('\n'));
  log('dialogue:', JSON.stringify(meta), `| wide patterns kept as rules ${nBig}`, `| dropped imports ${dropped} | unreachable ${report.unreachable.length} | collisions ${report.collisions.length}`);
  log('  MS scenarios not used:', ms.map((_, i) => i).filter((i) => !usedMs.has(i)).join(',') || 'none');
  return { vocab, norm, meta };
}

// ---------------------------------------------------------------------------------------------------------------------
// common sense
const DET = new Set('a an the some any its their his her my your our this that these those'.split(' '));
const KEYS = ['isa', 'isnot', 'can', 'cannot', 'is', 'has', 'hasnot', 'used', 'made', 'at', 'eats', 'sound', 'young', 'color', 'group', 'needs', 'gives', 'male', 'female'];

function parseCore() {
  const things = {}, alias = {};
  const lines = read(path.join(HERE, 'commonsense/core.txt')).split('\n');
  lines.forEach((raw, ln) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [head, ...fields] = line.split('|').map((x) => x.trim());
    const names = head.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const t = {};
    for (const f of fields) {
      const i = f.indexOf(':');
      if (i < 0) throw new Error(`core.txt:${ln + 1}: field without key: ${f}`);
      const key = f.slice(0, i).trim();
      if (!KEYS.includes(key)) throw new Error(`core.txt:${ln + 1}: unknown key "${key}"`);
      t[key] = key === 'color' ? [f.slice(i + 1).trim()] : f.slice(i + 1).split(',').map((x) => x.trim()).filter(Boolean);
    }
    if (things[names[0]]) throw new Error(`core.txt:${ln + 1}: duplicate thing ${names[0]}`);
    things[names[0]] = t;
    for (const a of names.slice(1)) { if (alias[a] || things[a]) throw new Error(`core.txt:${ln + 1}: duplicate alias ${a}`); alias[a] = names[0]; }
  });
  for (const [n, t] of Object.entries(things)) for (const c of t.isa || []) { const base = alias[c] || c; if (!things[base] && !['pet', 'farm animal', 'wild animal', 'big cat', 'ape', 'rodent', 'marsupial', 'sea animal', 'grain', 'drink', 'musical instrument', 'sport', 'game', 'natural satellite'].includes(c)) log(`  note: class "${c}" of "${n}" has no entry of its own`); }
  return { things, alias };
}

function parseWords() {
  const out = { opp: {}, syn: {}, size: {}, weight: {}, speed: {}, temp: {} };
  let sec = null;
  for (const raw of read(path.join(HERE, 'commonsense/words.txt')).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) { sec = line.slice(3).trim().split(/\s+/)[0]; continue; }
    if (line.startsWith('#') || !sec) continue;
    if (sec === 'synonyms') { const [a, b] = line.split('=').map((x) => x.trim()); out.syn[a] = b.split(',').map((x) => x.trim()).filter(Boolean); continue; }
    if (sec === 'opposites') {
      const [a, b] = line.split('=').map((x) => x.trim());
      const list = b.split(',').map((x) => x.trim()).filter(Boolean);
      out.opp[a] = [...new Set([...(out.opp[a] || []), ...list])];
      for (const x of list) if (!out.opp[x]) out.opp[x] = [a];
    } else {
      const key = sec === 'temperature' ? 'temp' : sec;
      for (const item of line.split('|')) { const m = item.trim().match(/^(.*\S)\s+(-?[\d.]+(?:e-?\d+)?)$/); if (!m) throw new Error(`words.txt: bad magnitude "${item}"`); out[key][m[1].toLowerCase()] = Number(m[2]); }
    }
  }
  return out;
}

const CRUDE = /^(sex|sexy|sexual|sexually|penis|vagina|breasts?|boobs?|naked|nude|porn|pornography|fuck\w*|shit\w*|piss\w*|pee|peeing|poop\w*|crap|ass|asses|butt|butts|bitch\w*|whore\w*|slut\w*|rape\w*|orgasm\w*|masturbat\w*|erection|horny|condom|prostitut\w*|cocaine|heroin|marijuana|weed|drugs?|drunk|stoned|gay|lesbian|homosexual\w*|nigger\w*|negro\w*|retard\w*|fag\w*|jew|jews|jewish|muslim\w*|islam\w*|christian\w*|catholic\w*|hindu\w*|buddhist\w*|atheist\w*|god|gods|jesus|allah|satan|devil|hell|heaven|republican\w*|democrat\w*|liberal\w*|conservative\w*|communis\w*|nazi\w*|hitler|bush|clinton|american\w*|mexican\w*|chinese|japanese|indian\w*|arab\w*|african\w*|european\w*|black|blacks|whites|terroris\w*|abortion\w*|genital\w*|testicle\w*|anus|anal|semen|sperm|urine|urinate|feces|faeces|fart\w*|vomit\w*|puke|turd|dick|cock|pussy|tits?|bra|panties|underwear|stripper\w*|kinky|fetish|incest|pedophil\w*|molest\w*|suicide|murder\w*|torture\w*)$/;
const SUBJ_STOP = new Set('it this that these those you he she they we i me him her them us one ones someone somebody anyone anybody everyone everybody nobody something anything everything nothing thing things stuff lot lots kind kinds type types sort way ways time times people person persons man men woman women girl girls boy boys guy guys wife husband mother father mom dad kid kids child children human humans who what which where when why how there here many most some any all each every other others another such same few several both either neither'.split(' '));
const ABSTRACT = new Set(`entity physical_entity abstraction abstract_entity object physical_object whole unit thing causal_agent cause causal_agency psychological_feature matter instrumentality instrumentation artifact artefact attribute relation measure quantity amount group grouping cognition knowledge content communication state event act action process natural_object part portion component happening occurrence phenomenon property quality condition status change social_group fundamental_quantity magnitude definite_quantity indefinite_quantity commodity goods creation life_form biological_group taxonomic_group vascular_plant woody_plant placental eutherian ungulate hoofed_mammal even_toed_ungulate odd_toed_ungulate domestic_animal domesticated_animal work piece way point activity human_activity deed feat signal symbol message subject_matter substance_abuse concept idea thought category kind sort type form variety division section unit_of_measurement trait characteristic feature aspect facet side item element_of abstract expanse area region location space position place line shape_form figure representation covering protective_covering device equipment implement container vessel conveyance transport structure construction system arrangement collection aggregation accumulation assemblage set class family order genus species kingdom phylum native head_of leader worker unfortunate unfortunate_person adult organism being living_thing animate_thing chordate vertebrate craniate`.split(/\s+/));
const KEEP_ANYWAY = new Set('device equipment container vessel structure shape organism being living_thing vertebrate tool vehicle machine'.split(' '));
const KEYCLASS = new Set('color colour sport game language shape number emotion feeling disease illness music dance country city planet month day season metal element gas liquid fruit vegetable flower tree bird fish insect mammal reptile animal plant food drink tool weapon vehicle instrument furniture clothing building'.split(' '));
const CONCRETE = new Set(['animal', 'plant', 'food', 'artifact', 'body', 'substance', 'object']);

// WordNet 3.1 (Princeton), read from its own database files so that every hypernym chain stays within one word sense.
function loadWordNet(freq) {
  const dir = path.join(RAW, 'wn/dict');
  if (!fs.existsSync(path.join(dir, 'data.noun'))) return null;
  const rank = (w) => freq.get(w) || 1e9;
  const parseData = (pos) => {
    const syn = new Map();
    for (const line of read(path.join(dir, `data.${pos}`)).split('\n')) {
      if (!line || line.startsWith('  ')) continue;
      const f = line.split(' | ')[0].split(' ');
      const wcnt = parseInt(f[3], 16);
      const words = [];
      let i = 4;
      for (let k = 0; k < wcnt; k++, i += 2) words.push(f[i].replace(/\(.*\)$/, '').toLowerCase());
      const pcnt = Number(f[i++]);
      const ptrs = [];
      for (let k = 0; k < pcnt; k++, i += 4) ptrs.push({ sym: f[i], off: f[i + 1], pos: f[i + 2], st: f[i + 3] });
      syn.set(f[0], { lex: Number(f[1]), type: f[2], words, ptrs });
    }
    return syn;
  };
  const parseIndex = (pos) => {
    const idx = new Map();
    for (const line of read(path.join(dir, `index.${pos}`)).split('\n')) {
      if (!line || line.startsWith('  ')) continue;
      const f = line.trim().split(/\s+/);
      const pcnt = Number(f[3]);
      idx.set(f[0], { tagged: Number(f[5 + pcnt]), offsets: f.slice(6 + pcnt) });
    }
    return idx;
  };
  const data = { n: parseData('noun'), v: parseData('verb'), a: parseData('adj'), r: parseData('adv') };
  const index = { n: parseIndex('noun'), v: parseIndex('verb'), a: parseIndex('adj'), r: parseIndex('adv') };
  const CONCRETE_LEX = new Set([5, 6, 8, 13, 17, 20, 27]);          // animal, artifact, body, food, object, plant, substance
  const common = (w, max) => { const t = w.split('_'); return t.every((x) => /^[a-z]+$/.test(x) && !CRUDE.test(x)) && (t.length === 1 ? rank(w) <= max : t.length === 2 && t.every((x) => rank(x) <= Math.min(max, 15000))); };
  const isa = {}, has = {}, syn = {}, opp = {};
  // --- noun taxonomy
  for (const [lemma, ix] of index.n) {
    if (!common(lemma, 30000) || SUBJ_STOP.has(lemma)) continue;
    const senses = ix.offsets.map((o) => data.n.get(o)).filter(Boolean);
    if (!senses.length || senses[0].ptrs.some((p) => p.sym === '@i')) continue;                       // a named individual: world knowledge, left to the web
    const cand = senses.slice(0, 4).filter((sy) => !sy.ptrs.some((p) => p.sym === '@i'));
    const LIVING = new Set([5, 13, 20]);                                                             // animal, food, plant
    const living = cand.some((sy) => LIVING.has(sy.lex));
    const usable = cand.filter((sy) => !(living && sy.lex === 18));                                 // "whale: a very large person" loses to the animal
    if (!usable.length) continue;
    const chosen = usable.filter((sy, i) => i === 0 || (senses.indexOf(sy) < ix.tagged && (CONCRETE_LEX.has(sy.lex) || [4, 7, 10, 12, 25, 28].includes(sy.lex)))).slice(0, 3);
    const firstConcrete = CONCRETE_LEX.has(chosen[0].lex);
    const list = [];
    for (const sy of chosen) {
      let frontier = [sy];
      const seen = new Set();
      for (let d = 0; d < 16 && frontier.length; d++) {
        const next = [];
        for (const x of frontier) for (const p of x.ptrs) {
          if (p.sym !== '@' || seen.has(p.off)) continue;
          seen.add(p.off);
          const par = data.n.get(p.off);
          if (!par) continue;
          next.push(par);
          let taken = 0;
          for (const w of par.words) {
            if (taken >= 3) break;
            if ((ABSTRACT.has(w) && !KEEP_ANYWAY.has(w)) || !common(w, 50000)) continue;
            const t = w.replace(/_/g, ' ');
            if (t !== lemma.replace(/_/g, ' ') && !list.includes(t)) list.push(t);
            taken++;
          }
        }
        frontier = next;
      }
    }
    if (list.length) isa[lemma.replace(/_/g, ' ')] = list.slice(0, 18).join('|');
    // parts (first sense only, concrete things)
    if (firstConcrete) {
      const parts = [];
      for (const p of chosen[0].ptrs) if (p.sym === '%p') { const part = data.n.get(p.off); if (part && common(part.words[0], 20000)) parts.push(part.words[0].replace(/_/g, ' ')); }
      if (parts.length) has[lemma.replace(/_/g, ' ')] = parts.slice(0, 12).join('|');
    }
  }
  // --- synonyms and antonyms (all parts of speech, most frequent senses first)
  const addTo = (m, a, b) => { if (a === b) return; (m[a] = m[a] || []); if (!m[a].includes(b)) m[a].push(b); };
  for (const pos of ['a', 'n', 'v', 'r']) {
    for (const [lemma, ix] of index[pos]) {
      if (lemma.includes('_') || !common(lemma, 25000)) continue;
      const senses = ix.offsets.slice(0, 3).map((o) => data[pos].get(o)).filter(Boolean);
      senses.forEach((sy, si) => {
        for (const w of sy.words) if (!w.includes('_') && common(w, 25000)) addTo(syn, lemma, w);
        const me = sy.words.indexOf(lemma) + 1;
        for (const p of sy.ptrs) {
          if (p.sym !== '!') continue;
          const src = parseInt(p.st.slice(0, 2), 16), tgt = parseInt(p.st.slice(2), 16);
          if (src !== me) continue;
          const o = data[p.pos === 's' ? 'a' : p.pos].get(p.off);
          const w = o && o.words[tgt - 1];
          if (w && !w.includes('_') && common(w, 30000)) addTo(opp, lemma, w);
        }
        // satellite adjectives borrow the antonym of their head ("freezing" → cold → hot)
        if (pos === 'a' && sy.type === 's' && si === 0 && !(opp[lemma] || []).length) {
          const head = sy.ptrs.find((p) => p.sym === '&');
          const h = head && data.a.get(head.off);
          const anti = h && h.ptrs.find((p) => p.sym === '!');
          const o = anti && data.a.get(anti.off);
          const w = o && o.words[parseInt(anti.st.slice(2), 16) - 1];
          if (w && !w.includes('_') && common(w, 20000)) addTo(opp, lemma, w);
        }
      });
    }
  }
  const header = read(path.join(dir, 'data.noun')).split('\n').filter((l) => l.startsWith('  ')).map((l) => l.replace(/^\s+\d+\s?/, '').trimEnd()).join('\n');
  const nouns = new Set(index.n.keys());
  return { nouns, isa, has, syn: Object.fromEntries(Object.entries(syn).map(([k, v]) => [k, v.slice(0, 6).join('|')])), opp: Object.fromEntries(Object.entries(opp).map(([k, v]) => [k, v.slice(0, 3).join('|')])), license: header };
}

const NOISE_OBJ = /^(pet|pets|rude|people|person|something|anything|someone|it|them|thing|things)$|\b(stab\w*|kill\w*|murder\w*|hurt\w*|tortur\w*|suicide|making love|make love|have sex|die|dying|dead|death)\b/;
async function loadOmcs(freq) {
  const cnFile = path.join(RAW, 'cn_en.tsv');
  if (!fs.existsSync(cnFile)) return null;
  const rank = (w) => freq.get(w) || 1e9;
  const { createInterface } = await import('node:readline');
  const { singular } = await import('../../engine/brain/normalize.js');
  const rl = createInterface({ input: fs.createReadStream(cnFile, 'utf8'), crlfDelay: Infinity });
  const rel = { can: new Map(), cannot: new Map(), is: new Map(), isnot: new Map(), has: new Map(), used: new Map(), at: new Map(), made: new Map(), isa: new Map(), likes: new Map() };
  const clean = (node) => node.split('/')[0].replace(/_/g, ' ').toLowerCase();
  const add = (m, s, o, w) => { let mm = m.get(s); if (!mm) m.set(s, (mm = new Map())); mm.set(o, (mm.get(o) || 0) + w); };
  const subjOk = (s) => { const t = s.split(' '); return t.length <= 2 && !SUBJ_STOP.has(s) && !(t.length === 1 && SUBJ_STOP.has(t[0])) && t.every((w) => /^[a-z]+$/.test(w) && rank(w) <= (t.length === 1 ? 25000 : 12000) && !CRUDE.test(w)); };
  const objOk = (o, maxTok) => { const t = o.split(' '); return t.length <= maxTok && !NOISE_OBJ.test(o) && t.every((w) => /^[a-z0-9]+$/.test(w) && (rank(w) <= 30000 || /^\d+$/.test(w)) && !CRUDE.test(w)) && !/\b(i|me|my|mine|you|your|we|our|us)\b/.test(o); };
  const known = (w) => freq.has(w);
  const subjCanon = (s) => { const t = s.split(' '); t[t.length - 1] = singular(t[t.length - 1], known); return t.join(' '); };
  let n = 0;
  for await (const line of rl) {
    const p = line.split('\t');
    if (p.length < 5 || p[4] !== 'conceptnet/4/en') continue;
    n++;
    const [r, s0, e0, w0] = p;
    const w = Number(w0) || 1;
    const s = subjCanon(clean(s0)), o = clean(e0);
    if (s === o || !subjOk(s)) continue;
    switch (r) {
      case 'CapableOf': if (objOk(o, 4)) add(rel.can, s, o.replace(/^(to|can) /, ''), w); break;
      case 'NotCapableOf': if (objOk(o, 4)) add(rel.cannot, s, o.replace(/^(to|can) /, ''), w); break;
      case 'HasProperty': if (objOk(o, 4)) add(rel.is, s, o, w); break;
      case 'NotHasProperty': if (objOk(o, 4)) add(rel.isnot, s, o, w); break;
      case 'HasA': if (objOk(o, 4)) add(rel.has, s, o, w); break;
      case 'PartOf': { const whole = subjCanon(o); if (subjOk(whole) && objOk(clean(s0), 3)) add(rel.has, whole, clean(s0), w); break; }
      case 'UsedFor': if (objOk(o, 4)) add(rel.used, s, o, w); break;
      case 'AtLocation': if (objOk(o, 3)) add(rel.at, s, o, w); break;
      case 'MadeOf': if (objOk(o, 3)) add(rel.made, s, o, w); break;
      case 'IsA': if (objOk(o, 3)) add(rel.isa, s, o, w); break;
      case 'Desires': if (objOk(o, 3)) add(rel.likes, s, o, w); break;
      default: break;
    }
  }
  // A statement entered once (weight 1) counts only when several independent wordings agree on its first word(s).
  const PREP = new Set('to in on at during when and or for with than as if but because like of by from into while that which'.split(' '));
  const head = (o) => { const t = o.split(' '); const i = t.findIndex((x, k) => k > 0 && PREP.has(x)); return (i > 0 ? t.slice(0, i) : t).join(' '); };
  const strongOnly = (m, { promote = false, top = 12, minW = 2 } = {}) => {
    const out = {};
    for (const [s, mm] of m) {
      const strong = [...mm].filter(([, w]) => w >= minW).sort((a, b) => b[1] - a[1]).map(([o]) => o);
      if (promote) {
        const heads = new Map();
        for (const [o, w] of mm) { if (w >= minW) continue; const h = head(o); heads.set(h, (heads.get(h) || 0) + 1); }
        for (const [h, c] of heads) if (c >= 2 && !strong.includes(h) && h.split(' ').length <= 2) strong.push(h);
      }
      if (strong.length) out[s] = strong.slice(0, top).join('|');
    }
    return out;
  };
  return {
    lines: n,
    can: strongOnly(rel.can, { promote: true, top: 14 }), cannot: strongOnly(rel.cannot, { top: 8 }), is: strongOnly(rel.is, { promote: true }), isnot: strongOnly(rel.isnot, { top: 6 }),
    has: strongOnly(rel.has, { promote: true }), used: strongOnly(rel.used, { top: 8 }), at: strongOnly(rel.at, { top: 8 }), made: strongOnly(rel.made, { promote: true, top: 5 }),
    isa: strongOnly(rel.isa, { top: 6, minW: 3 }), likes: strongOnly(rel.likes, { top: 6 }),
  };
}

async function buildCommonsense(freq) {
  const core = parseCore();
  const words = parseWords();
  const wn = loadWordNet(freq);
  const omcs = await loadOmcs(freq);
  let tail, wnLicense = '';
  if (!wn || !omcs) {
    log(`  raw sources missing under ${RAW} (WordNet: ${!!wn}, ConceptNet: ${!!omcs}): keeping the existing long-tail data`);
    const prev = JSON.parse(read(path.join(OUT, 'commonsense.json')));
    tail = prev.tail;
  } else {
    const isa = { ...wn.isa };
    for (const [s, v] of Object.entries(omcs.isa)) { const extra = v.split('|').filter((o) => o.split(' ').length <= 2 && wn.nouns.has(o.replace(/ /g, '_')) && o !== s); if (extra.length) isa[s] = [...new Set([...(isa[s] ? isa[s].split('|') : []), ...extra])].join('|'); }
    const has = { ...omcs.has };
    for (const [s, v] of Object.entries(wn.has)) has[s] = [...new Set([...(has[s] ? has[s].split('|') : []), ...v.split('|')])].filter((o) => o !== s).slice(0, 14).join('|');
    const opp = {};
    for (const [k, v] of Object.entries(wn.opp)) if (!words.opp[k]) opp[k] = v;
    const syn = {};
    for (const [k, v] of Object.entries(wn.syn)) if (!words.syn[k]) syn[k] = v;
    tail = { isa, can: omcs.can, cannot: omcs.cannot, is: omcs.is, isnot: omcs.isnot, has, used: omcs.used, at: omcs.at, made: omcs.made, likes: omcs.likes, opp, syn };
    wnLicense = wn.license;
    fs.writeFileSync(path.join(OUT, 'LICENSE-WordNet.txt'), wnLicense + '\n');
  }
  const count = (o) => Object.values(o).reduce((s, v) => s + v.split('|').filter(Boolean).length, 0);
  const coreFacts = Object.values(core.things).reduce((s, t) => s + Object.values(t).reduce((a, v) => a + v.length, 0), 0);
  const magFacts = ['size', 'weight', 'speed', 'temp'].reduce((s, k) => s + Object.keys(words[k]).length, 0) + Object.values(words.opp).reduce((s, v) => s + v.length, 0) + Object.values(words.syn).reduce((s, v) => s + v.length, 0);
  const tailBy = Object.fromEntries(Object.entries(tail).map(([k, o]) => [k, count(o)]));
  const tailFacts = Object.values(tailBy).reduce((a, b) => a + b, 0);
  const meta = { built: new Date().toISOString().slice(0, 10), things: Object.keys(core.things).length, coreFacts: coreFacts + magFacts, tailFacts, facts: coreFacts + magFacts + tailFacts, tailBy };
  fs.writeFileSync(path.join(OUT, 'commonsense.json'), JSON.stringify({ meta, core, words, tail }));
  log('commonsense:', JSON.stringify(meta));
  return meta;
}

// ---------------------------------------------------------------------------------------------------------------------
// spelling guard: real but uncommon words and names that the spelling repair (engine/brain/spell.js) would otherwise
// turn into a common word ("cation" → "caution"). Collected from WordNet, the rarer part of the frequency list and a
// hand-written list; only the words that actually collide are kept.
async function buildSpellGuard(freq, vocabSet) {
  const { slipTarget } = await import('../../engine/brain/spell.js');           // reads the vocab.txt written just above
  const real = new Set();
  for (const [w] of freq) if (!vocabSet.has(w)) real.add(w);
  const wn = path.join(RAW, 'wn/dict');
  const file = path.join(OUT, 'spell-guard.txt');
  if (fs.existsSync(path.join(wn, 'index.noun'))) {
    for (const f of ['index.noun', 'index.verb', 'index.adj', 'index.adv']) for (const line of read(path.join(wn, f)).split('\n')) {
      if (line.startsWith(' ')) continue;                                         // licence header
      const w = line.split(' ')[0];
      if (/^[a-z]+$/.test(w) && !vocabSet.has(w)) real.add(w);
    }
  }
  const kept = [];                                                               // without WordNet: what an earlier build found
  if (!fs.existsSync(path.join(wn, 'index.noun')) && fs.existsSync(file)) {
    log(`  WordNet not found under ${RAW}: keeping the words already in spell-guard.txt`);
    for (const w of read(file).split('\n')) if (w) kept.push(w);
  }
  for (const line of read(path.join(HERE, 'spell-names.txt')).split('\n')) if (!line.startsWith('#')) for (const w of line.split(/\s+/)) if (/^[a-z]+$/.test(w)) real.add(w);
  // regular inflections of real words are real words too ("preformed", "collies"), whether or not a word list has them
  const forms = (w) => {
    const f = [w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', w + 'er', w + 'est', w + 'ly'];
    if (w.endsWith('e')) f.push(w.slice(0, -1) + 'ing', w + 'r', w + 'st');
    if (w.endsWith('y')) f.push(w.slice(0, -1) + 'ies', w.slice(0, -1) + 'ied', w.slice(0, -1) + 'ier', w.slice(0, -1) + 'ily');
    if (/[^aeiou][aeiou][^aeiouwxy]$/.test(w)) { const d = w + w[w.length - 1]; f.push(d + 'ed', d + 'ing', d + 'er'); }
    return f;
  };
  for (const w of [...real, ...vocabSet]) if (w.length >= 4) for (const f of forms(w)) real.add(f);
  for (const w of kept) real.add(w);
  const out = [...real].filter((w) => !vocabSet.has(w) && slipTarget(w)).sort();
  fs.writeFileSync(file, out.join('\n'));
  log('spell guard:', out.length, 'words of', real.size, 'candidates');
}

// ---------------------------------------------------------------------------------------------------------------------
const freq = loadFrequency();
let dlg = null;
if (want('dialogue') || want('vocab')) dlg = buildDialogue(freq);
if (dlg) {
  // In order of frequency (a word's line is its rank; the spelling repair only produces common words);
  // words that occur only in patterns follow the frequency list.
  const words = [...dlg.vocab].filter((w) => /^[a-z]+$/.test(w));
  fs.writeFileSync(path.join(OUT, 'vocab.txt'), words.join('\n'));
  log('vocab:', words.length, 'words');
  await buildSpellGuard(freq, new Set(words));
}
if (want('commonsense')) await buildCommonsense(freq);
// one small file with the numbers the assistant quotes about itself
{
  const d = JSON.parse(read(path.join(OUT, 'dialogue.json'))).meta;
  const c = fs.existsSync(path.join(OUT, 'commonsense.json')) ? JSON.parse(read(path.join(OUT, 'commonsense.json'))).meta : { facts: 0, things: 0, coreFacts: 0, tailFacts: 0 };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ built: d.built, intents: d.intents, patterns: d.patterns, handWritten: d.handWritten, imported: d.imported, replies: d.replies, facts: c.facts, things: c.things, coreFacts: c.coreFacts, tailFacts: c.tailFacts }));
}
for (const f of fs.readdirSync(OUT)) log('  ', f, fs.statSync(path.join(OUT, f)).size);
