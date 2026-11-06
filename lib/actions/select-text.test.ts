// Checks select text's words (selectArgs), matching (matchesIn, pickSpan), mapping back into text nodes (pieceAt) and
// its reply (selectedNote). Run: npm test
import { matchesIn, pieceAt, pickSpan, selectArgs, selectedNote } from './select-text.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const same = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const error = (f: () => unknown) => {
  try {
    f();
  } catch (err) {
    return (err as Error).message;
  }
  return '';
};

// The agent writes the words: "start" to "end" [n], anything else refused.
same(selectArgs(['\\begin{abstract}', 'to', '\\end{abstract}']), { from: '\\begin{abstract}', to: '\\end{abstract}' }, 'no n');
same(selectArgs(['a', 'to', 'b', '2']), { from: 'a', to: 'b', nth: 2 }, 'with n');
for (const bad of [[], ['a'], ['a', 'b'], ['a', 'until', 'b'], ['a', 'to'], ['', 'to', 'b'], ['a', 'to', '  '], ['a', 'to', 'b', '0'], ['a', 'to', 'b', 'x'], ['a', 'to', 'b', '2', 'more'], ['x'.repeat(101), 'to', 'b']]) {
  if (!error(() => selectArgs(bad)).startsWith('Usage: select text')) fail(`selectArgs ${JSON.stringify(bad)} should be refused`);
}

// find's rules: case and all spaces ignored, so "\begin{ twocolentry }" finds "\begin{twocolentry}"; positions are the
// text's own, spaces inside a match included.
same(matchesIn('A \\begin{twocolentry} B', '\\BEGIN{ twocolentry }'), [{ start: 2, end: 21 }], 'case and spaces');
same(matchesIn('limit 5\nlimit  5', 'limit5'), [{ start: 0, end: 7 }, { start: 8, end: 16 }], 'every match, spaces inside');
same(matchesIn('abc', ''), [], 'blank query');
same(matchesIn('İstanbul', 'i̇stanbul'), [{ start: 0, end: 8 }], 'a letter that lengthens when lowercased');

// One block in main.tex, from \begin{twocolentry} to the \end{onecolentry} after it.
const tex = [
  '\\section{Projects}',
  '\\begin{twocolentry}{2024}',
  '  \\textbf{Ichiro}',
  '\\end{twocolentry}',
  '\\begin{onecolentry}',
  '  A browser MCP.',
  '\\end{onecolentry}',
  '\\begin{twocolentry}{2023}',
  '\\end{onecolentry}',
].join('\n');
const span = pickSpan(['other box', tex], '\\begin{twocolentry}', '\\end{onecolentry}', 1);
same(span && { box: span.box, text: tex.slice(span.start, span.end).split('\n').at(-1) }, { box: 1, text: '\\end{onecolentry}' }, 'to the first end after the start');
same(span && tex.slice(span.start, span.end).startsWith('\\begin{twocolentry}{2024}'), true, 'from the start of the start words');
same(pickSpan(['x', 'y'], 'nothing', 'y'), null, 'not in any box: null, so the page text is tried');
// Two starts and no n: refused, listing them, never a guess.
const two = error(() => pickSpan(['x', tex], '\\begin{twocolentry}', '\\end{onecolentry}'));
if (!two.startsWith('2 matches for "\\\\begin{twocolentry}": add which one') || !two.includes('\n1. ') || !two.includes('\n2. ')) fail(`two starts: ${two}`);
same(pickSpan([tex], '\\begin{twocolentry}', '\\end{onecolentry}', 2) && 'ok', 'ok', 'n picks the second start');
if (!error(() => pickSpan([tex], '\\begin{twocolentry}', '\\end{onecolentry}', 3)).startsWith('Only 2 matches')) fail('n past the matches');
// The end must be after the start, in the same box.
if (!error(() => pickSpan(['\\end{x} \\begin{x}', 'other \\end{x}'], '\\begin{x}', '\\end{x}')).startsWith('No "\\\\end{x}" after "\\\\begin{x}"')) fail('end only before the start');

// Back into text nodes: a start sits in the node holding its character; an end on a boundary ends the node before.
same(pieceAt([5, 3, 4], 0), { piece: 0, offset: 0 }, 'start of the first node');
same(pieceAt([5, 3, 4], 5), { piece: 1, offset: 0 }, 'a start on a boundary: the next node');
same(pieceAt([5, 3, 4], 5, true), { piece: 0, offset: 5 }, 'an end on a boundary: the node before');
same(pieceAt([5, 0, 3], 5, true), { piece: 0, offset: 5 }, 'never an empty node');
same(pieceAt([5, 0, 3], 5), { piece: 2, offset: 0 }, 'a start skips an empty node');
same(pieceAt([5, 3], 8, true), { piece: 1, offset: 3 }, 'the very end');

// The reply quotes page text, and cuts a long one in the middle so both ends can be checked.
same(selectedNote('short'), '5 characters: "short"', 'short');
const long = `${'a'.repeat(100)}${'b'.repeat(100)}`;
same(selectedNote(long), `200 characters: "${'a'.repeat(60)}" … "${'b'.repeat(60)}"`, 'long, cut in the middle');
same(selectedNote('say "hi"\nnow'), '12 characters: "say \\"hi\\"\\nnow"', 'quoted, one line');

console.log('select-text: all checks passed');
