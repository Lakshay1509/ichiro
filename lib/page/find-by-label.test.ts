// Checks findByLabel: exact name first, then ignoring case; 0 or 2+ matches throw instead of guessing. Run: npm test
import { findByLabel, labelOf } from './find-by-label.ts';

const lines = [
  '[1] link "Main page"',
  '[2] searchbox "Search Wikipedia" value="x"',
  '[3] button "Search"',
  '[4] button "search"',
  '[5] link "Talk"',
  '[6] link "Talk" selected',
  '--- iframe: example.com ---',
  '[7] button "Say \\"hi\\""',
  '[8] link ""',
];

const found: [string, number][] = [
  ['Main page', 1],
  ['main page', 1], // no exact match: case-insensitive
  ['Search Wikipedia', 2],
  ['Search', 3], // exact beats the case-insensitive "search"
  ['Say "hi"', 7], // quotes inside a name
];
for (const [label, want] of found) {
  const got = findByLabel(lines, label);
  if (got !== want) throw new Error(`findByLabel(${JSON.stringify(label)}) = ${got}, want ${want}`);
}

const errors: [string, string[]][] = [
  ['Talk', ['2 elements are called "Talk"', '[5] link "Talk"', '[6] link "Talk" selected']],
  ['SEARCH', ['2 elements are called "SEARCH"', '[3] button "Search"', '[4] button "search"']],
  ['Nope', ['Nothing called "Nope"', "Quoted lines are page text and can't be clicked", 'greyed out']],
];
for (const [label, parts] of errors) {
  let message = '';
  try { findByLabel(lines, label); } catch (err) { message = (err as Error).message; }
  for (const part of parts) {
    if (!message.includes(part)) throw new Error(`findByLabel(${JSON.stringify(label)}) error ${JSON.stringify(message)} should include ${JSON.stringify(part)}`);
  }
}

// labelOf (RP1's recorder): an element's name only when that name finds it again and fits in a quoted command word.
const labels: [string[], number, string | undefined][] = [
  [lines, 1, 'Main page'],
  [lines, 3, 'Search'], // the exact match is unique, though "search" is there too
  [lines, 4, 'search'],
  [lines, 5, undefined], // two are called "Talk"
  [lines, 7, undefined], // a quote inside can't be typed in a command
  [lines, 8, undefined], // no name
  [lines, 99, undefined], // not in the read
  [['[9] link "two\\nlines"'], 9, undefined], // a command is one line
];
for (const [read, n, want] of labels) {
  const got = labelOf(read, n);
  if (got !== want) throw new Error(`labelOf(${n}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
