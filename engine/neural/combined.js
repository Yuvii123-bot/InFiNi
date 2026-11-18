// Conservative bridge between retrieval and the neural model. The model chooses only among
// sentences already selected and cited by the retrieval engine. It never executes page text,
// generates an unsupported factual claim, changes a citation, or rewrites the answer.
const INJECTION = /\b(?:ignore|disregard|override|forget)\s+(?:all\s+|the\s+|any\s+|your\s+|previous\s+|prior\s+)*(?:instructions?|prompts?|rules?|system|directions?)\b|\b(?:system prompt|developer message|reveal (?:your|the) (?:prompt|instructions|secrets?)|(?:send|reveal|exfiltrate) (?:your|the|all) (?:passwords?|tokens?|credentials?|api keys?))\b/i;

/** Return exact answer spans whose cited claim is actually among the retrieved evidence. */
export function combinedCandidates(result) {
  if (!result || result.kind !== 'retrieval' || result.confidence?.level === 'insufficient') return [];
  const claims = result.research?.passages;
  if (!Array.isArray(claims) || !Array.isArray(result.sources)) return [];
  const ids = new Set(result.sources.map(s => s.id));
  const candidates = [], seen = new Set();
  function add(s, block, item, index) {
    const text = typeof s?.text === 'string' ? s.text.trim() : '';
    if (text.length < 25 || text.length > 320 || s.meta || INJECTION.test(text) || !Array.isArray(s.cites)) return;
    if (!claims.some(p => p && p.text === text && ids.has(p.source) && s.cites.includes(p.source))) return;
    if (seen.has(text.toLocaleLowerCase())) return;
    seen.add(text.toLocaleLowerCase()); candidates.push({ text, block, item, index });
  }
  for (const [bi, b] of (result.answer?.blocks || []).entries()) {
    if (b.type === 'paragraph' && Array.isArray(b.spans)) b.spans.forEach((s, i) => add(s, bi, null, i));
    else if (b.type === 'list' && Array.isArray(b.items)) b.items.forEach((item, ii) => (item.spans || []).forEach((s, i) => add(s, bi, ii, i)));
    if (candidates.length >= 12) break;
  }
  return candidates.slice(0, 12);
}

/** Mark, rather than repeat or reorder, the original cited sentence. */
export function markCombinedPick(result, candidate) {
  const blocks = result.answer.blocks.map((block, bi) => {
    if (bi !== candidate.block) return block;
    if (candidate.item === null) return { ...block, spans: block.spans.map((s, i) => i === candidate.index ? { ...s, neuralHighlight: true } : s) };
    return { ...block, items: block.items.map((item, ii) => ii === candidate.item ? { ...item, spans: item.spans.map((s, i) => i === candidate.index ? { ...s, neuralHighlight: true } : s) } : item) };
  });
  return { ...result, answer: { ...result.answer, blocks } };
}

// Bounded, untrusted source text for experimental free-form model generation. The
// displayed source citations belong to the excerpts only, never to the model draft.
export function webModelEvidence(result) {
  if (!result || result.kind !== 'retrieval' || result.confidence?.level === 'insufficient') return [];
  const ids = new Set((result.sources || []).map(s => s.id));
  const seen = new Set(), out = [];
  const add = (text, cites) => {
    text = String(text || '').trim();
    const valid = [...new Set((cites || []).filter(id => ids.has(id)))];
    if (text.length < 25 || text.length > 240 || !valid.length || INJECTION.test(text) || seen.has(text.toLowerCase())) return;
    seen.add(text.toLowerCase()); out.push({ text, cites: valid });
  };
  for (const c of combinedCandidates(result)) {
    const b = result.answer.blocks[c.block];
    const span = c.item === null ? b.spans[c.index] : b.items[c.item].spans[c.index];
    // Only attach sources whose retrieved passages actually contain this candidate.
    add(c.text, span.cites.filter(id => (result.research?.passages || []).some(p => p.source === id && p.text === c.text)));
  }
  for (const p of result.research?.passages || []) {
    if (!ids.has(p.source)) continue;
    for (const sentence of String(p.text || '').split(/(?<=[.!?])\s+(?=[A-Z“"(])/)) add(sentence, [p.source]);
  }
  return out.slice(0, 2);
}

// A deliberately conservative display gate, not fact-checking. It accepts only a
// complete text fragment present verbatim in an excerpt; correct paraphrases can fail.
export function matchesWebExcerpt(draft, excerpts) {
  const norm = text => String(text || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim().replace(/^[\s"“”']+|[\s"“”']+$/g, '');
  const text = norm(draft);
  return text.length >= 20 && (excerpts || []).some(e => norm(e.text).includes(text));
}

// Only remove clearly broken or promotional list fragments, and never remove the only
// answer. Keep the original evidence and citations available in the research record.
const FRAGMENT = /^(?:best of luck\b|good luck (?:with|on)\b|if this were the case\b|as (?:mentioned|shown|discussed) (?:above|earlier)\b|(?:click here|subscribe|sign up|read more)\b)/i;
const CURRENT = /\b(?:latest|current(?:ly)?|today|tonight|right now|breaking news|recent (?:news|updates?|developments?)|newest)\b/i;
export function polishCombined(result, question, blocksToText, now = Date.now()) {
  if (!result || result.kind !== 'retrieval' || !result.answer?.blocks) return result;
  const original = result.answer.blocks;
  let blocks = original.map(b => {
    if (b.type !== 'list' || !Array.isArray(b.items)) return b;
    const items = b.items.filter(it => {
      if (it.code?.length) return true;
      const text = (it.spans || []).map(s => s.text || '').join('').trim();
      return !FRAGMENT.test(text) && !/:\s*$/.test(text);
    });
    return items.length === b.items.length ? b : { ...b, items };
  });
  // Remove only verbatim list duplicates whose citations are already present in a
  // preceding single-span answer. Never discard an independent source or nested/code item.
  const prior = [];
  blocks = blocks.map(b => {
    if (b.type === 'paragraph' && b.spans?.length === 1 && b.spans[0].text && b.spans[0].cites?.length) prior.push(b.spans[0]);
    if (b.type !== 'list' || !Array.isArray(b.items)) return b;
    const items = b.items.filter(item => {
      if (item.depth || item.code?.length || item.spans?.length !== 1) return true;
      const s = item.spans[0];
      if (!s.text || !s.cites?.length || s.more?.length) return true;
      const key = s.text.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
      const duplicate = prior.some(p => p.text.trim().toLocaleLowerCase().replace(/\s+/g, ' ') === key && s.cites.every(id => p.cites.includes(id)));
      if (!duplicate) prior.push(s);
      return !duplicate;
    });
    return items.length === b.items.length ? b : { ...b, items };
  });
  // Empty lists and their immediately preceding heading should not leave an empty section.
  blocks = blocks.filter((b, i, all) => !(b.type === 'list' && !b.items.length) && !(b.type === 'heading' && all[i + 1]?.type === 'list' && !all[i + 1].items.length));
  if (!blocks.some(b => b.type === 'paragraph' || (b.type === 'list' && b.items.length) || b.type === 'table')) blocks = original;
  let confidence = result.confidence;
  // Some passages state Earth's ~23 degree axial tilt relative to the orbital
  // plane, rather than its perpendicular. When an already-cited passage makes
  // the reference frame explicit, lead with that exact passage and label the
  // differing wording instead of presenting the number without qualification.
  // This is a narrow conflict guard, not a general fact checker.
  const leadIndex = blocks.findIndex(b => b.type === 'paragraph' && b.spans?.some(s => s.cites?.length && /\bearth\b/i.test(s.text) && /\baxis\b/i.test(s.text) && /\borbital plane\b/i.test(s.text) && /\b2[23](?:\.\d+)?\s*(?:degrees?|°)/i.test(s.text) && !/\b(?:perpendicular|normal)\b/i.test(s.text)));
  if (leadIndex >= 0 && /\b(?:seasons?|tilt|axis)\b/i.test(String(question))) {
    const badIndex = blocks[leadIndex].spans.findIndex(s => /\baxis\b/i.test(s.text) && /\borbital plane\b/i.test(s.text) && /\b2[23](?:\.\d+)?\s*(?:degrees?|°)/i.test(s.text) && !/\b(?:perpendicular|normal)\b/i.test(s.text));
    let match = null;
    for (let bi = 0; bi < blocks.length && !match; bi++) if (blocks[bi].type === 'list') for (let ii = 0; ii < blocks[bi].items.length && !match; ii++) {
      const item = blocks[bi].items[ii];
      if (item.spans?.length === 1 && item.spans[0].cites?.length && /\bearth\b/i.test(item.spans[0].text) && /\baxis\b/i.test(item.spans[0].text) && /\bperpendicular\b.*\borbital plane\b/i.test(item.spans[0].text)) match = { bi, ii, span: item.spans[0] };
    }
    if (match && badIndex >= 0) {
      const bad = blocks[leadIndex].spans[badIndex];
      blocks = blocks.map((b, bi) => bi === leadIndex ? { ...b, spans: b.spans.map((s, si) => si === badIndex ? match.span : s) } : bi === match.bi ? { ...b, items: b.items.filter((_, ii) => ii !== match.ii) } : b);
      blocks = blocks.filter((b, i, all) => !(b.type === 'list' && !b.items.length) && !(b.type === 'heading' && all[i + 1]?.type === 'list' && !all[i + 1].items.length));
      blocks.push({ type: 'note', tone: 'warn', text: 'Sources describe the tilt using different reference planes. Check the reference plane before relying on the quoted angle.' }, { type: 'list', ordered: false, items: [{ spans: [bad] }] });
      if (confidence && confidence.level !== 'insufficient') confidence = { ...confidence, score: Math.min(0.39, confidence.score), level: 'low', label: 'Low confidence', caps: [...(confidence.caps || []), 'sources use different reference frames for the angle'] };
    }
  }
  // Separate the lead answer from supporting sections, without relabelling an
  // existing multi-question heading or an insufficient-evidence response.
  if (result.sources?.length && confidence?.level !== 'insufficient') {
    const firstContent = blocks.findIndex(b => b.type === 'paragraph' || b.type === 'heading' || b.type === 'table' || b.type === 'list');
    if (firstContent >= 0 && blocks[firstContent].type === 'paragraph') blocks = [...blocks.slice(0, firstContent), { type: 'heading', text: 'Answer', level: 2 }, ...blocks.slice(firstContent)];
  }
  if (CURRENT.test(String(question)) && result.sources?.length) {
    const recent = result.sources.some(s => {
      const t = Date.parse(s.published || '');
      return Number.isFinite(t) && t <= now + 86400000 && now - t <= 30 * 86400000;
    });
    const text = recent ? 'Publication dates do not guarantee these are the latest developments. Check the dated sources.' : 'I could not verify a recently published update from the cited sources. The information below may be background rather than the latest developments.';
    blocks = [{ type: 'note', tone: 'warn', text }, ...blocks];
    if (!recent && confidence && confidence.level !== 'insufficient') confidence = { ...confidence, score: Math.min(0.39, confidence.score), level: 'low', label: 'Low confidence', factors: (confidence.factors || []).map(f => f.name.toLowerCase() === 'recency' ? { ...f, value: 0, note: 'no cited source has a recent publication date; modification dates do not prove a current update' } : f), caps: [...(confidence.caps || []), 'no cited source with a recent publication date'] };
  }
  return { ...result, confidence, answer: { ...result.answer, blocks, text: blocksToText(blocks) } };
}
