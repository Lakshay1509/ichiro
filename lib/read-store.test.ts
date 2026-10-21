// Checks V1's kept pages: keep by URL with caps, the search the done check runs, and the text the agent gets back.
// Run: npm test
import { keep, KEPT_CHARS, lookAgainText, MAX_KEPT, searchKept, type Kept } from './read-store.ts';

const fail = (what: string): never => {
  throw new Error(what);
};

// keep: a new URL goes at the end; the same URL is replaced and moves to the end.
let store: Kept[] = [];
store = keep(store, { url: 'https://a.example/1', pages: ['one'] });
store = keep(store, { url: 'https://a.example/2', pages: ['two'] });
store = keep(store, { url: 'https://a.example/1', pages: ['one, read again'] });
if (store.map((d) => d.url).join(' ') !== 'https://a.example/2 https://a.example/1' || store[1]!.pages[0] !== 'one, read again') fail(`keep: ${JSON.stringify(store)}`);
// At most MAX_KEPT, the oldest out first.
for (let i = 0; i < MAX_KEPT + 3; i++) store = keep(store, { url: `https://b.example/${i}`, pages: ['x'] });
if (store.length !== MAX_KEPT || store[0]!.url !== 'https://b.example/3') fail(`keep cap: ${store.map((d) => d.url).join(' ')}`);
// KEPT_CHARS per document, across its pages: the page that crosses it is cut, later ones dropped.
const big = keep([], { url: 'https://c.example/rules.pdf', pages: ['a'.repeat(KEPT_CHARS - 10), 'b'.repeat(50), 'c'] })[0]!;
if (big.pages.length !== 2 || big.pages[1] !== 'b'.repeat(10)) fail(`keep chars: ${big.pages.length} pages, last ${big.pages.at(-1)?.length}`);

// search: like the IRCTC run, a deadline on page 8 of a PDF the agent read, found with its URL and page.
const pdf = { url: 'https://contents.irctc.co.in/en/rules.pdf', pages: ['Refund rules', ...Array(6).fill('Charges apply.'), 'Train Late More Than Three Hours: TDR shall be filed Before the Actual Departure of the train'] };
const page = { url: 'https://www.irctc.co.in/refund', pages: ['Cancelled trains are refunded automatically.'] };
const hits = searchKept([page, pdf], ['actual  departure', 'AUTOMATICALLY']);
if (hits.length !== 2 || !hits[0]!.startsWith('https://contents.irctc.co.in/en/rules.pdf · page 8: "') || !hits[0]!.includes('Before the Actual Departure of the train')) fail(`search pdf: ${hits[0]}`);
// A one-page document gets no page number.
if (hits[1] !== 'https://www.irctc.co.in/refund: "Cancelled trains are refunded automatically."') fail(`search page: ${hits[1]}`);
// The snippet holds about a sentence around the match (120 characters each side), on one line.
const long = searchKept([{ url: 'u', pages: [`${'x'.repeat(300)} TDR filed online before the actual departure ${'y'.repeat(300)}`] }], ['actual departure'])[0]!;
if (!long.includes('x'.repeat(60)) || long.includes('x'.repeat(200)) || long.includes('\n')) fail(`snippet size: ${long.length}`);
// The phrases share the 8 hits: a word on every page can't crowd out a rarer one, and the same hit is listed once.
const common = { url: 'https://d.example/', pages: [Array(30).fill('TDR').join(' . '.repeat(100))] };
const shared = searchKept([common, pdf], ['TDR', 'three hours']);
if (shared.length > 8 || !shared.some((h) => h.includes('Three Hours'))) fail(`search shared: ${shared.join('\n')}`);
if (searchKept([pdf], ['three hours', 'Three Hours']).length !== 1) fail('same hit listed twice');
// No phrases or no match: nothing.
if (searchKept([pdf], []).length || searchKept([pdf], ['tatkaal']).length || searchKept([], ['refund']).length) fail('search found something in nothing');

// The text for the next turn: the phrases, the hits as bullets (no numbers to mix up with items or elements), and
// what to do with them.
const told = lookAgainText(['actual departure'], ['https://x.example/a: "…before the actual departure…"']);
if (told !== 'Pages you already read this run mention "actual departure":\n- https://x.example/a: "…before the actual departure…"\nCheck these before saying you couldn\'t find it: use what they say, or goto the page\'s URL and find.') fail(`look again text:\n${told}`);
