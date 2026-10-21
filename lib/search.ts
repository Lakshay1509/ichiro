// W1: the AI's search "words". Our code builds the one results URL (DuckDuckGo, browser-use's default); the model only
// sends words, and you see them before anything opens: a model-written URL is how page data leaks out.
import { onSites } from './agent-prompt.ts';

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

// Your ask before a search: the exact words that will leave, already checked by searchUrl.
export const searchAsk = (words: string) => `The agent wants to search DuckDuckGo for: "${words.trim()}". Search?`;

// A results page you allowed by a search, not a Site you added: typing there would search again without your ask.
export const onlySearched = (url: string, sites: string[]) => onSites(url, [SEARCH_SITE]) && !onSites(url, sites);
