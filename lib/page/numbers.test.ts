// Tests for numbers.ts: a number from an older read means the same element or is refused, never a different one.
import { checkSame, claim, clashed, stick } from './numbers.ts';

// Seen live on erail.in: a click scrolled the page, the next read renumbered, and an old [34] hit another train's cell.
// Here: a b c on screen, a scroll, then b c d. Numbering by position would give a's number to b.
const [a, b, c, d] = [{}, {}, {}, {}];
const first = stick([a, b, c], ['link "A"', 'link "B"', 'link "C"'], 0);
const after = stick([b, c, d], ['link "B"', 'link "C"', 'link "D"'], Math.max(0, ...first));
// What actions resolve numbers against: the latest read, number → element.
const latest = new Map(after.map((n, i) => [n, [b, c, d][i]]));
if (latest.has(first[0]!)) throw new Error(`a's old number [${first[0]}] now means another element`);
if (latest.get(first[1]!) !== b || latest.get(first[2]!) !== c) throw new Error('b or c changed number after the scroll');
if (new Set([...first, ...after]).size !== 4) throw new Error(`a number was given twice: ${first} then ${after}`);

// A list reusing b's box for another row: b is a new element now, so its old number is refused.
const reused = stick([b], ['link "Z"'], Math.max(...after));
if (reused[0] === first[1]) throw new Error('a reused box kept its old number');
let refused = '';
try {
  checkSame(first[1]!, b, 'link "Y"');
} catch (err) {
  refused = (err as Error).message;
}
if (!refused.includes('changed since your last read')) throw new Error(`a changed element was not refused: ${refused}`);

// The panel's number lagging behind (a read cut short) still never gives this frame's numbers out again.
const lagging = stick([{}], ['button "New"'], 0);
if ([...first, ...after, ...reused].includes(lagging[0]!)) throw new Error(`[${lagging[0]}] was given twice in one frame`);

// One number read in two frames (a read cut short elsewhere) can't say which element it means: refused for good.
claim([1, 2], 'tab 7 frame 0');
claim([2, 3], 'tab 7 frame 0');
if (clashed(2)) throw new Error('the same frame reading [2] again was flagged');
claim([3], 'tab 7 frame 12');
if (!clashed(3)) throw new Error('[3] read in two frames was not flagged');
claim([3], 'tab 7 frame 0');
if (!clashed(3)) throw new Error('a clashed number was cleared');

console.log('numbers ok');
