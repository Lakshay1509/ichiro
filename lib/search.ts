// W1: /search "words". Our code builds the one results URL (DuckDuckGo, browser-use's default) from the words only.

export const SEARCH_SITE = 'duckduckgo.com';
const MAX_WORDS = 100;

// The words → the results URL. One line, 1 to 100 characters, no ! at all: a DuckDuckGo bang (!g, !w) sends the
// words on to another site. Source: https://github.com/browser-use/browser-use/blob/main/browser_use/tools/service.py
export function searchUrl(words: string): string {
  const w = words.trim();
  if (!w || w.length > MAX_WORDS || /[\r\n]/.test(w)) throw new Error(`search needs 1 to ${MAX_WORDS} characters on one line, e.g. search "passport reissue fee"`);
  if (w.includes('!')) throw new Error('search refused: no ! in the words (DuckDuckGo would send them on to another site)');
  return `https://${SEARCH_SITE}/?q=${encodeURIComponent(w)}`;
}
