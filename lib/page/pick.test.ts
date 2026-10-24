// Checks pick (F3b, F3c): lines grouped by record box, numbers kept, text quoted and cut, capped; attribute similarity;
// record boxes; the AI's arguments checked. Run: npm test
import { builtLike, MAX_MATCHES, pickArgs, pickLines, pickOut, recordsOf, similarity, type Match } from './pick.ts';

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
const same = (got: unknown, want: unknown, label: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label}:\n${JSON.stringify(got)}\n--- want ---\n${JSON.stringify(want)}`);
};

// Showtimes sit under their cinema's box; a box line only when the box changes; numbered ones can be clicked.
const shows: Match[] = [
  { record: 0, label: 'PVR: Vegas Dwarka', n: 12, text: '09:50 AM 4DX' },
  { record: 0, label: 'PVR: Vegas Dwarka', n: 13, text: '04:40 PM 4DX' },
  { record: 1, label: 'Cinepolis: City Centre Dwarka', n: 0, text: '10:00 AM' },
  { record: 2, label: '', n: 0, text: '11:30 PM' },
];
same(pickLines('built like [12]', shows), [
  '4 matches built like [12] (whole page; [n] = in the page list, can be clicked):',
  'In "PVR: Vegas Dwarka":',
  '  [12] "09:50 AM 4DX"',
  '  [13] "04:40 PM 4DX"',
  'In "Cinepolis: City Centre Dwarka":',
  '  "10:00 AM"',
  'In the next box (no text of its own):',
  '  "11:30 PM"',
].join('\n'), 'grouped by box');
// A plain list (record -1): no box lines, no indent.
same(pickLines('for "h3"', [{ record: -1, label: '', n: 0, text: 'Post one' }, { record: -1, label: '', n: 4, text: 'Post two' }]), [
  '2 matches for "h3" (whole page; [n] = in the page list, can be clicked):',
  '"Post one"',
  '[4] "Post two"',
].join('\n'), 'flat list');

// Page text stays quoted, so it can't pass for an element line or a box line; spaces collapse; a long line stays whole
// (live: a GitHub license file came out cut at 100 characters a line).
same(pickLines('for "p"', [{ record: 0, label: 'In "x":', n: 0, text: '[5] button "Pay"\n  now' }, { record: -1, label: '', n: 0, text: 'x'.repeat(150) }]), [
  '2 matches for "p" (whole page; [n] = in the page list, can be clicked):',
  'In "In \\"x\\":":',
  '  "[5] button \\"Pay\\" now"',
  JSON.stringify('x'.repeat(150)),
].join('\n'), 'quoted, long line whole');
// One match past 6,000 characters is cut there, with the note outside the quotes so it isn't page text.
same(pickLines('for "article"', [{ record: -1, label: '', n: 0, text: 'z'.repeat(6500) }]).split('\n')[1],
  `${JSON.stringify('z'.repeat(6000))} (cut: 500 more characters)`, 'one long match cut, with a note');
// The first match always shows, even when quoting makes it bigger than the size cap (6,000 quotes → 12,000 escaped).
const big = pickLines('for "pre"', [{ record: -1, label: '', n: 0, text: '"'.repeat(6000) }, { record: -1, label: '', n: 0, text: 'next' }]).split('\n');
if (big.length !== 3 || !big[1]!.startsWith('"\\"') || big[2] !== '… 1 more not shown: use a narrower selector or example') fail(`first match always shown: ${big.length} lines`);

// Capped at MAX_MATCHES lines, then a note; matches past the cap that weren't read count too.
const many = Array.from({ length: MAX_MATCHES + 5 }, (_, i) => ({ record: -1, label: '', n: 0, text: `row ${i}` }));
const capped = pickLines('for "tr"', many, 20).split('\n');
if (capped.length !== MAX_MATCHES + 2 || capped.at(-1) !== '… 25 more not shown: use a narrower selector or example') fail(`cap: ${capped.at(-1)}`);
if (!capped[0]!.startsWith('125 matches')) fail(`cap count: ${capped[0]}`);
// Also capped by size (~8,000 characters), whichever comes first.
const long = pickLines('for "li"', Array.from({ length: MAX_MATCHES }, () => ({ record: -1, label: '', n: 0, text: 'y'.repeat(99) })));
if (long.length > 8200 || !long.endsWith('more not shown: use a narrower selector or example')) fail(`size cap: ${long.length} chars`);
// Nothing: '' (the panel says "No match" once for all frames); one: "1 match".
same(pickLines('for "h3"', []), '', 'no matches');
if (!pickLines('for "h3"', [{ record: -1, label: '', n: 0, text: 'x' }]).startsWith('1 match for')) fail('one match');
// F3d: lines stitched from several scroll stops count only match lines, not box lines.
same(pickOut('built like [3]', ['In "A":', '  "09:50"', 'In "B":', '  "09:50"']).split('\n'),
  ['2 matches built like [3] (whole page; [n] = in the page list, can be clicked):', 'In "A":', '  "09:50"', 'In "B":', '  "09:50"'], 'stitched lines');

// F3c: attributes alike (Scrapling's 20% rule), as shared tokens over all tokens. A state class (fast filling) or an
// item id still leaves the same component alike; another component isn't; none on either side counts as alike.
const pill = ['.showtime', '.pill', '.green', 'data-id=1', 'role=button'];
if (similarity(pill, ['.showtime', '.pill', '.yellow', 'data-id=2', 'role=button']) < 0.2) fail('state class should stay alike');
if (similarity(pill, ['.date-tab', '.active']) >= 0.2) fail('another component should not be alike');
same(similarity([], []), 1, 'no attributes on either side');
same(similarity(pill, pill), 1, 'same attributes');

// builtLike (F3c's rule, shared with RP1's item check): same tag path and page-list word, attributes 20% alike.
const item1 = { path: 'HTML>BODY>UL>LI>A', tokens: ['.assignment', 'data-id=1'], kind: 'link' };
same(builtLike(item1, { ...item1, tokens: ['.assignment', 'data-id=7'] }), true, 'another item of the same list');
same(builtLike(item1, { ...item1, path: 'HTML>BODY>NAV>A' }), false, 'a link elsewhere on the page');
same(builtLike(item1, { ...item1, kind: 'button' }), false, 'another page-list word');
same(builtLike(item1, { ...item1, tokens: ['.logout'] }), false, 'attributes not alike');

// F3c: record boxes (MDR's data records). The box holding every match is the shared start of their chains; each
// match's record is the next box down. Every record holding one match → a plain list (null).
const cinemas = [['body', 'list', 'pvr', 'a'], ['body', 'list', 'pvr', 'b'], ['body', 'list', 'cine', 'c']];
same(recordsOf(cinemas), ['pvr', 'pvr', 'cine'], 'cinema cards');
same(recordsOf([['body', 'feed', 'p1'], ['body', 'feed', 'p2'], ['body', 'feed', 'p3']]), [null, null, null], 'plain list');
same(recordsOf([['body', 'x']]), [null], 'one match');
same(recordsOf([['body', 'box'], ['body', 'box', 'inner']]), [null, null], 'a match inside a match');
same(recordsOf([]), [], 'no matches');

// The AI's arguments: like <n|label>, or exactly one CSS selector (one line, up to 200 characters).
same(pickArgs(['like', '14']), { like: '14' }, 'like');
same(pickArgs(['table tr']), { css: 'table tr' }, 'css');
for (const bad of [[], [''], ['   '], ['a\nb'], ['x'.repeat(201)], ['table', 'tr'], ['like'], ['like', ''], ['like', '1', '2']]) {
  throws(() => pickArgs(bad), `pick ${JSON.stringify(bad)}`);
}
