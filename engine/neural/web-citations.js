// Conservative lexical attribution for free-form drafts. This is a filter, NOT a
// fact checker: matching words cannot prove a claim is entailed by a passage.
// A draft is returned only when every sentence has a plausible supplied source.
const STOP = new Set('a an and are as at be been being by did do does for from had has have in into is it its of on or that the their them they this to was were with'.split(' '));
const QUALIFIERS = new Set('no not never neither nor cannot cant without may might could possibly possible likely unlikely alleged allegedly reportedly approximately about more less only always all none some most few before after increase decreases decreased increased decrease higher lower up down'.split(' '));
const words = s => String(s).normalize('NFKC').toLowerCase().replace(/[’']/g, "'").replace(/\b([a-z]+)'s\b/g, '$1').match(/[\p{L}\p{N}]+(?:[.,][0-9]+)*/gu) || [];
const signature = a => [...new Set(a)].sort().join('|');

export function citeWebDraft(draft, evidence) {
  const text = String(draft || '').trim();
  if (!text || text.length > 1600 || /(?:https?:\/\/|\[[^\]]*\]|\n\s*[-*#]|[\r\n]{2})/i.test(text)) return null;
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(s => s.trim()).filter(Boolean) || [];
  if (!sentences.length || sentences.length > 6 || !/[.!?]$/.test(text)) return null;
  const spans = [];
  for (const sentence of sentences) {
    const ws = words(sentence), content = [...new Set(ws.filter(w => !STOP.has(w) && !QUALIFIERS.has(w)))];
    if (content.length < 2 || sentence.endsWith('?')) return null;
    let match = null;
    for (const e of evidence || []) {
      if (!Array.isArray(e.cites) || !e.cites.length) continue;
      const sourceWords = words(e.text), set = new Set(sourceWords);
      // Every non-function word and all qualifications must occur in this single
      // passage. No automatic union of sources or invented citation numbers.
      if (!content.every(w => set.has(w))) continue;
      if (signature(ws.filter(w => QUALIFIERS.has(w))) !== signature(sourceWords.filter(w => QUALIFIERS.has(w)))) continue;
      if (signature(ws.filter(w => /\d/.test(w))) !== signature(sourceWords.filter(w => /\d/.test(w)))) continue;
      match = e; break;
    }
    if (!match) return null;
    spans.push({ text: sentence, cites: [...new Set(match.cites)] });
  }
  return spans;
}
