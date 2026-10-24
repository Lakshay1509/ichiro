// Checks the MCP change report (pageReport). Run: npm test
import { pageReport } from './page-diff.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
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

// No earlier page, or a hidden one (no URL line): the whole list.
const hidden = "(Page hidden: x.com is off the bridge's Sites.)";
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
