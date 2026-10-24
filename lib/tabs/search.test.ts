// Checks W1's search: the URL our code builds from the words, and the words it refuses. Run: npm test
import { SEARCH_SITE, searchUrl } from './search.ts';

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

// The words become the q parameter of one fixed URL; nothing in them can change the host, path or other parameters.
if (searchUrl('  passport reissue fee ') !== 'https://duckduckgo.com/?q=passport%20reissue%20fee') fail(`url: ${searchUrl('  passport reissue fee ')}`);
const tricky = new URL(searchUrl('fee&q=x#@evil.example/?data=1'));
if (tricky.hostname !== SEARCH_SITE || tricky.pathname !== '/' || tricky.hash || [...tricky.searchParams.keys()].join() !== 'q' || tricky.searchParams.get('q') !== 'fee&q=x#@evil.example/?data=1') fail(`encoding: ${tricky.href}`);
// Refused: empty, over 100 characters, more than one line, and any ! (a DuckDuckGo bang opens another site with the words).
for (const bad of ['', '   ', 'x'.repeat(101), 'fee\nstructure', '!g passport fee', 'passport fee !w', 'fee!']) throws(() => searchUrl(bad), `words ${JSON.stringify(bad)}`);
searchUrl('x'.repeat(100));
