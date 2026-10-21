// Checks W1's search: the URL our code builds from the model's words, the words it refuses, the ask, and the results-page rule. Run: npm test
import { onlySearched, SEARCH_SITE, searchAsk, searchUrl } from './search.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const throws = (f: () => unknown, what: string) => {
  try {
    f();
  } catch {
    return;
  }
  fail(`${what} should throw`);
};

// A stand-in for chrome.publicSuffix.getDomain (as in agent-prompt.test.ts): the known suffix plus one label.
const SUFFIXES = ['com', 'in', 'gov.in'];
const getDomain = (host: string) => {
  const labels = host.split('.');
  for (let i = 1; i < labels.length; i++) if (SUFFIXES.includes(labels.slice(i).join('.'))) return labels.slice(i - 1).join('.');
  return null;
};
Object.assign(globalThis, { browser: { publicSuffix: { getDomain } } });

// The words become the q parameter of one fixed URL; nothing in them can change the host, path or other parameters.
if (searchUrl('  passport reissue fee ') !== 'https://duckduckgo.com/?q=passport%20reissue%20fee') fail(`url: ${searchUrl('  passport reissue fee ')}`);
const tricky = new URL(searchUrl('fee&q=x#@evil.example/?data=1'));
if (tricky.hostname !== SEARCH_SITE || tricky.pathname !== '/' || tricky.hash || [...tricky.searchParams.keys()].join() !== 'q' || tricky.searchParams.get('q') !== 'fee&q=x#@evil.example/?data=1') fail(`encoding: ${tricky.href}`);
// Refused: empty, over 100 characters, more than one line, and any ! (a DuckDuckGo bang opens another site with the words).
for (const bad of ['', '   ', 'x'.repeat(101), 'fee\nstructure', '!g passport fee', 'passport fee !w', 'fee!']) throws(() => searchUrl(bad), `words ${JSON.stringify(bad)}`);
searchUrl('x'.repeat(100));

// The ask shows the exact words, trimmed.
if (searchAsk(' passport reissue fee ') !== 'The agent wants to search DuckDuckGo for: "passport reissue fee". Search?') fail(`ask: ${searchAsk(' passport reissue fee ')}`);

// After an approved search the results page is readable, but it isn't one of your Sites: typing there is refused.
const sites = ['passportindia.gov.in'];
if (!onlySearched('https://duckduckgo.com/?q=fee', sites)) fail('results page should be search-only');
if (onlySearched('https://duckduckgo.com/?q=fee', [...sites, 'duckduckgo.com'])) fail('a plan site you approved is yours to type on');
if (onlySearched('https://portal1.passportindia.gov.in/fees', sites)) fail('a plan site is not search-only');
