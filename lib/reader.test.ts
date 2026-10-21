// Checks scrollLine, sideRoom and sideLine (boxes that scroll sideways), urlName (unlabeled image links), cut
// (shortened names), saysMore (calendar labels), ranges (panel and scroll box numbers) and classHint (unnamed icon
// buttons). Run: npm test
import { besideText, classHint, cut, ranges, saysMore, scrollLine, sideLine, sideRoom, suggests, urlName } from './reader.ts';

// besideText: an unlabeled checkbox or radio is named by the text right beside it, up to the next control. Seen live
// in 4 runs: boxes sharing a parent all got the parent's whole text ("… Yes No Clear") or nothing, and the model
// clicked the box next to the one it meant. A fake DOM: text nodes, and elements (control or not) with siblings.
type Fake = { nodeType: number; textContent: string; innerText?: string; parentElement: Fake | null; nextSibling: Fake | null; previousSibling: Fake | null; control?: boolean; kids?: Fake[]; matches?: () => boolean; querySelector?: () => Fake | null };
const tx = (text: string): Fake => ({ nodeType: 3, textContent: text, parentElement: null, nextSibling: null, previousSibling: null });
const el = (control: boolean, ...kids: Fake[]): Fake => {
  const e: Fake = { nodeType: 1, textContent: '', parentElement: null, nextSibling: null, previousSibling: null, control, kids };
  kids.forEach((k, i) => Object.assign(k, { parentElement: e, previousSibling: kids[i - 1] ?? null, nextSibling: kids[i + 1] ?? null }));
  const below = (n: Fake): Fake[] => (n.kids ?? []).flatMap((k) => [k, ...below(k)]);
  Object.defineProperty(e, 'innerText', { get: () => kids.map((k) => k.innerText ?? k.textContent).join('') });
  return Object.assign(e, { matches: () => control, querySelector: () => below(e).find((n) => n.control) ?? null });
};
const named = (box: Fake) => besideText(box as unknown as Element);
const [yes, no] = [el(true), el(true)];
el(false, tx('Is your present address different? '), yes, tx(' Yes '), no, tx(' No '), el(true, tx('Clear')));
const [address, spouse] = [el(true), el(true)];
el(false, el(false, el(false, address), el(false, tx('Change of Address'))), el(false, el(false, spouse), el(false, tx("Change of Spouse's Name"))));
const [minor, adult] = [el(true), el(true)];
el(false, minor, tx(' Minor'), el(false), adult, tx(' Adult'), el(false));
const todo = el(true);
el(false, todo, el(false, tx('Buy milk')), el(true));
const agree = el(true);
el(false, tx('Agree to the terms '), agree);
const alone = el(true);
el(false, el(false, alone));
for (const [box, want, what] of [[yes, 'Yes', 'a Yes / No pair'], [no, 'No', 'stops at the Clear button'], [address, 'Change of Address', 'a box in its own table cell'],
  [spouse, "Change of Spouse's Name", 'the next row'], [minor, 'Minor', 'sibling boxes'], [adult, 'Adult', 'sibling boxes'], [todo, 'Buy milk', "TodoMVC's unlinked label"],
  [agree, 'Agree to the terms', 'text before the box when none is after'], [alone, '', 'no text near']] as const) {
  if (named(box) !== want) throw new Error(`besideText, ${what}: ${JSON.stringify(named(box))}`);
}

const runs: [number[], string][] = [
  [[], ''],
  [[7], '[7]'],
  [[3, 4, 5, 9], '[3]–[5], [9]'],
  [[1, 3, 5, 7, 9, 11, 13], '[1], [3], [5], [7], [9], …'], // capped: a scattered panel can't flood the header
];
for (const [nums, want] of runs) {
  const got = ranges(nums);
  if (got !== want) throw new Error(`ranges(${nums}) = "${got}", want "${want}"`);
}

const hints: [string, string][] = [
  ['icon icon-close', 'close'], // a bare × whose only clue is its class
  ['btnClose ', 'close'], // camelCase
  ['fa fa-times  #icon-times', 'times'], // repeats once
  ['chevron-down nav-arrow-left', 'down left'],
  ['p-padding shadow-md css-1x2y3z', ''], // "padding" isn't "add"; made-up names say nothing
  ['', ''],
];
for (const [text, want] of hints) {
  const got = classHint(text);
  if (got !== want) throw new Error(`classHint(${text}) = "${got}", want "${want}"`);
}

const cuts: [string, number, string][] = [
  ['short', 80, 'short'],
  ['12345', 5, '12345'],
  ['• 713 • 276', 10, '• 713 • 2…'], // Hugging Face: a cut "27" must not pass as the like count
];
for (const [s, max, want] of cuts) {
  const got = cut(s, max);
  if (got !== want) throw new Error(`cut(${s}, ${max}) = "${got}", want "${want}"`);
}

const labels: [string, string, boolean][] = [
  ['Saturday, December 26, 2026', '26', true], // Google Flights day cell
  ['Archive', 'A', false], // a letter inside a word isn't the same text
  ['Clear', 'Clear', false], // same text says nothing more
  ['Close dialog', 'Search', false],
];
for (const [label, text, want] of labels) {
  const got = saysMore(label, text);
  if (got !== want) throw new Error(`saysMore(${label}, ${text}) = ${got}, want ${want}`);
}

const urls: [string, string][] = [
  ['https://en.wikipedia.org/wiki/File:Alan_turing_header.jpg', 'File:Alan_turing_header.jpg'],
  ['https://example.com/caf%C3%A9/', 'café'],
  ['https://example.com/', 'example.com'],
  ['https://example.com/%E0%A4', '%E0%A4'],
  ['javascript:void(0)', ''],
];
for (const [href, want] of urls) {
  const got = urlName(href);
  if (got !== want) throw new Error(`urlName(${href}) = "${got}", want "${want}"`);
}

const cases: [number, number, string][] = [
  [0, 0, 'Scroll: 0% — page fits on screen'],
  [0, 1000, 'Scroll: 0% — more content below'],
  [500, 1000, 'Scroll: 50% — more content above, more content below'],
  [1000, 1000, 'Scroll: 100% — more content above'],
];

for (const [y, max, want] of cases) {
  const got = scrollLine(y, max);
  if (got !== want) throw new Error(`scrollLine(${y}, ${max}) = "${got}", want "${want}"`);
}

// A box that scrolls sideways (a wide table): how far it can still go each way. scrollLeft counts from the start
// edge: the left one, or the right one in RTL (0, then negative); negative is right-anchored even without the flag.
for (const [scrollLeft, rtl, want, what] of [
  [0, false, { left: 0, right: 700 }, 'at the start'],
  [300, false, { left: 300, right: 400 }, 'scrolled right'],
  [0, true, { left: 700, right: 0 }, 'RTL at the start'],
  [-200, true, { left: 500, right: 200 }, 'RTL scrolled left'],
  [-200, false, { left: 500, right: 200 }, 'negative: right-anchored'],
] as const) {
  const got = JSON.stringify(sideRoom(scrollLeft, 700, rtl));
  if (got !== JSON.stringify(want)) throw new Error(`sideRoom, ${what}: ${got}`);
}
for (const [room, want] of [
  [{ left: 0, right: 700 }, 'Scroll sideways: 0% — more content right'],
  [{ left: 350.4, right: 349.6 }, 'Scroll sideways: 50% — more content left, more content right'],
  [{ left: 700, right: 0.3 }, 'Scroll sideways: 100% — more content left'],
] as const) {
  if (sideLine(room) !== want) throw new Error(`sideLine(${JSON.stringify(room)}) = "${sideLine(room)}"`);
}

// F4b: a field with a suggestion list keeps focus after typing (ARIA combobox / autocomplete, or a datalist).
const attrs = (a: Record<string, string>) => (name: string) => a[name] ?? null;
const fields: [Record<string, string>, boolean][] = [
  [{ id: 'price_filter_max', inputmode: 'numeric' }, false], // Airbnb's price: no list, so it's left
  [{ role: 'combobox' }, true],
  [{ 'aria-autocomplete': 'list' }, true],
  [{ 'aria-autocomplete': 'none' }, false],
  [{ 'aria-expanded': 'true' }, true],
  [{ 'aria-expanded': 'false' }, false],
  [{ list: 'cities' }, true],
];
for (const [a, want] of fields) {
  if (suggests(attrs(a)) !== want) throw new Error(`suggests(${JSON.stringify(a)}) should be ${want}`);
}
