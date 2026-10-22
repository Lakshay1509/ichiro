// Checks what-changed notes and * marks between two page reads (3.7b), and the MCP change report (pageReport). Run: npm test
import { pageChange, pageReport, stepKey } from './page-diff.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const page = (url: string, scroll: string, ...els: string[]) =>
  [`URL: ${url}`, 'Title: Shop', `Scroll: ${scroll}`, `Elements (${els.length}):`, ...els.map((e, i) => `[${i + 1}] ${e}`)].join('\n');
const check = (before: string, after: string, note: string, marked: string[] = []) => {
  const c = pageChange(before, after);
  if (c.note !== note) fail(`note: want ${JSON.stringify(note)}, got ${JSON.stringify(c.note)}`);
  const got = c.page.split('\n').filter((l) => l.startsWith('*'));
  if (JSON.stringify(got) !== JSON.stringify(marked)) fail(`marks: want ${JSON.stringify(marked)}, got ${JSON.stringify(got)}`);
};

const a = page('https://shop.in/s', '0%', 'button "Sort by" collapsed', 'link "Laptop A"');
check(a, a, 'nothing changed');

// A menu opened: its options are new and marked with their new numbers; the button's state changed too.
check(a, page('https://shop.in/s', '0%', 'button "Sort by" expanded', 'option "Price: Low to High"', 'link "Laptop A"'), '2 new, 1 gone',
  ['*[1] button "Sort by" expanded', '*[2] option "Price: Low to High"']);

// Numbers shift but the elements are the same → nothing changed.
const shifted = page('https://shop.in/s', '0%', 'button "Sort by" collapsed', 'link "Laptop A"').replace('[1]', '[7]').replace('[2]', '[8]');
check(a, shifted, 'nothing changed');

// Same elements, page moved: not "nothing changed".
check(a, page('https://shop.in/s', '14%', 'button "Sort by" collapsed', 'link "Laptop A"'), 'no new elements');

// Repeated buttons are counted: two → three is one new.
const two = page('https://shop.in/s', '0%', 'button "Add to cart"', 'button "Add to cart"');
check(two, page('https://shop.in/s', '0%', 'button "Add to cart"', 'button "Add to cart"', 'button "Add to cart"'), '1 new', ['*[3] button "Add to cart"']);
check(two, page('https://shop.in/s', '0%', 'button "Add to cart"'), '1 gone');

// A new URL is a new page: one note, no marks.
check(a, page('https://shop.in/s?rh=16gb', '0%', 'link "Laptop B"'), 'URL changed');

// Iframe separator lines are kept, never marked.
check(a, `${a}\n--- iframe: ads.example ---\n[3] link "Ad"`, '1 new', ['*[3] link "Ad"']);

// Hidden pages (off the run's Sites) have no URL line: same or changed only.
const hidden = "(Page hidden: x.com is not one of the run's Sites. Only goto, back and done work here.)";
check(hidden, hidden, 'nothing changed');
check(hidden, a, 'page changed');
check(a, hidden, 'page changed');

// stepKey: a field you took over matches across reads (its number shifts), but not another field or another page.
const pw = (n: number) => `Sign-in needed: [${n}] "Password" is a password, card or one-time-code field: type it yourself on the page.`;
const reg = 'https://demoqa.com/register';
if (stepKey(reg, pw(15)) !== stepKey(reg, pw(8))) fail('stepKey: same field, new number should match');
if (stepKey(reg, pw(15)) === stepKey(reg, pw(15).replace('"Password"', '"Confirm password"'))) fail('stepKey: other field should differ');
if (stepKey(reg, pw(15)) === stepKey('https://demoqa.com/login', pw(15))) fail('stepKey: other page should differ');

// pageReport (MCP): only what changed since the agent's last page list, with element numbers; the whole list otherwise.
const slides = (url: string, ...lines: string[]) =>
  [`URL: ${url}`, 'Title: Deck - Google Slides', 'Scroll: 0%', `Elements (${lines.filter((l) => l.startsWith('[')).length}):`, ...lines].join('\n');
const deck = 'https://docs.google.com/presentation/d/abc/edit';
const s1 = slides(`${deck}#slide=id.p1`, '[3] button "Bold"', '[4] textbox "Title" value ""', '"Click to add text"', '[5] link "Help"');
const report = (before: string | null, after: string, want: string[]) => {
  const got = pageReport(before, after);
  if (got !== want.join('\n')) fail(`pageReport: want\n${want.join('\n')}\ngot\n${got}`);
};
const HEAD = 'Page changes since your last page list (read gives the whole list):';

// No earlier page, or a hidden one: the whole list.
report(null, s1, [s1]);
report(hidden, s1, [s1]);
report(s1, hidden, [hidden]);
report(s1, s1, ['Page: nothing changed since your last page list.']);

// A new element shows with its number, a changed state as its new line; unchanged lines are left out.
report(s1, slides(`${deck}#slide=id.p1`, '[3] button "Bold" pressed', '[4] textbox "Title" value ""', '"Click to add text"', '[5] link "Help"', '[9] option "Arial"'),
  [HEAD, '[3] button "Bold" pressed', '[9] option "Arial"']);

// A #hash (or ?query) change is the same page: a change report, URL line included.
report(s1, slides(`${deck}?slide=2#slide=id.p2`, '[3] button "Bold"', '[4] textbox "Title" value "Hi"', '[5] link "Help"'),
  [HEAD, `URL: ${deck}?slide=2#slide=id.p2`, '[4] textbox "Title" value "Hi"', 'Gone: 1 text line']);

// Gone elements: a count and their numbers. A header line with no new value is shown as gone by its name only: its old
// value would read as still there (live, Kroger: "Gone: [332]–[334]" and "Panel on top … its elements: [332]–[334]").
// One with a new value isn't gone.
const panel = slides(`${deck}#slide=id.p1`, '[3] button "Bold"', '[4] textbox "Title" value ""', '"Click to add text"', '[5] link "Help"', '[6] button "Close"', '[7] button "OK"', '[8] button "Cancel"')
  .replace('Scroll: 0%', 'Scroll: 0%\nFocused: [7]\nPanel on top: "Share" ·its elements: [6]–[8]');
report(panel, s1.replace('Scroll: 0%', 'Scroll: 10%'),
  [HEAD, 'Scroll: 10%', 'Gone: 3 elements [6]–[8]; Focused; Panel on top']);

// A new page (another path): the whole list, even with the same elements.
const other = s1.replace(deck, 'https://docs.google.com/presentation/d/xyz/edit');
report(s1, other, [other]);

// Changed nearly all over: the report would be longer than the page, so the whole list instead.
const tiny = 'URL: https://a.in/x\nElements (1):\n[1] link "A"';
const swapped = 'URL: https://a.in/x\nElements (1):\n[2] link "B"';
report(tiny, swapped, [swapped]);
