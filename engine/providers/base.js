// INFINI AI — provider plumbing shared by all search adapters.

export class ProviderError extends Error {
  constructor(message, code = 'provider_error') { super(message); this.name = 'ProviderError'; this.code = code; }
}
export const enc = encodeURIComponent;
export const FRESH_DAYS = { day: 1, week: 7, month: 31, year: 366 };

/** Build a paragraph block list from plain text (one block per line/paragraph). */
export function textBlocks(text, heading = '') {
  return String(text || '').split(/\n+/).map((t) => t.trim()).filter((t) => t.length > 1).map((t) => ({ type: 'p', text: t, heading }));
}
