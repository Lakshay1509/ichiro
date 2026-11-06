// Checks #6: a landmark's lines are kept together (pageLinesIn), and a nav, sidebar or header the agent got before on
// the site, with the same elements, is said in one line (shorten). Run: npm test
import { MIN_ELEMENTS, shorten, shortLine, sigOf, type Landmark } from './landmarks.ts';
import { pageLines, pageLinesIn, type Item } from './page-text.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const same = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// Items: elements and text pieces, each in landmark g (-1: none).
const box = (y: number) => ({ top: y, bottom: y + 20, left: 0, right: 100 });
const el = (n: number, name: string): Item => ({ line: `[${n}] link ${JSON.stringify(name)}`, name });
const text = (t: string, y: number): Item => ({ text: t, first: box(y), last: box(y), owner: '' });
const items = [text('Supabase', 0), el(1, 'Home'), el(2, 'Logs'), text('Org', 60), el(3, 'Settings'), text('Logs explorer', 100), el(4, 'Run')];
const groups = [-1, 0, 0, 0, 0, -1, -1];
const { lines, ranges } = pageLinesIn(items, (i) => groups[i]!);
same(lines, ['"Supabase"', '[1] link "Home"', '[2] link "Logs"', '"Org"', '[3] link "Settings"', '"Logs explorer"', '[4] link "Run"'], 'lines as pageLines');
same(lines, pageLines(items), 'same lines with or without groups');
same([...ranges], [[0, { start: 1, end: 5 }]], 'the nav from [1] to "Org" and [3]');
// A stray item of a landmark later on (an element the walk couldn't reach) is printed as no landmark's.
same([...pageLinesIn([el(1, 'a'), el(2, 'b'), el(3, 'c')], (i) => [0, -1, 0][i]!).ranges], [[0, { start: 0, end: 1 }]], 'stray item');

// shorten: lines [start, end) of a seen landmark with the same elements become one line; others stay and are shown.
const nav: Landmark = { key: 'Navigation #1', title: 'Navigation', sig: 'link Home\nlink Logs', nums: [11, 12, 13, 14, 15, 30], start: 2, end: 5 };
const side: Landmark = { key: 'Sidebar "Logs" #1', title: 'Sidebar "Logs"', sig: 'link Collections', nums: [20, 21, 22, 23, 24], start: 6, end: 8 };
const page = ['URL: https://supabase.com/dashboard/project/x/logs', 'Elements (9):', '[11] link "Home"', '[12] link "Logs"', '"Org"', '"Logs explorer"', '[20] link "Collections"', '[21] link "API"', '[40] button "Run"'].join('\n');
const first = shorten(page, [nav, side], new Map());
same(first.text, page, 'first time on the site: all of it');
same(first.shown, [[side.key, side.sig], [nav.key, nav.sig]], 'both remembered once sent');
const seen = new Map(first.shown);
const again = shorten(page, [nav, side], seen);
same(again.text.split('\n'), ['URL: https://supabase.com/dashboard/project/x/logs', 'Elements (9):', shortLine(nav), '"Logs explorer"', shortLine(side), '[40] button "Run"'], 'seen: one line each');
same(again.shown, [], 'nothing new to remember');
same(shortLine(nav), 'Navigation: 6 elements ([11]–[15], [30]), the same as you got before on this site: click one by name, or read all lists them with their numbers', 'the line');
// The sig is what the agent reads, numbers left out: a new page's numbers don't matter, a state or a text line does.
same(sigOf(['[11] link "Home"', '"Org"']), sigOf(['[41] link "Home"', '"Org"']), 'renumbered: the same');
if (sigOf(['[11] link "Home"', '"Production"']) === sigOf(['[11] link "Home"', '"Read-only: billing overdue"'])) fail('a changed text line must count');
if (sigOf(['[11] tab "Logs" selected']) === sigOf(['[11] tab "Logs"'])) fail('a changed state must count');
// The nav changed (a new link): printed in full again, and remembered as it is now.
const changed = shorten(page, [{ ...nav, sig: `${nav.sig}\nlink Billing` }, side], seen);
if (!changed.text.includes('[11] link "Home"') || changed.text.includes(shortLine(side)) === false) fail(`changed nav: ${changed.text}`);
same(changed.shown, [[nav.key, `${nav.sig}\nlink Billing`]], 'the changed nav is remembered anew');
// The one line is ours, never page text: it doesn't start with [n] or a quote, so labels and the change report skip it.
if (/^(\[\d+\]|")/.test(shortLine(side))) fail('a shortened line looks like an element or text line');
if (MIN_ELEMENTS < 2) fail('a one-element landmark would cost more than it saves');

console.log('landmarks: all checks passed');
