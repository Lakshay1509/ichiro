// Checks RP1's repeat parser (Build 2, slice 2.1): the step is in the history, numbers and ranges, 1 to 30 items. Run: npm test
import { findByLabel, labelOf } from '../page/find-by-label.ts';
import { parseCommand } from '../parse-command.ts';
import { downloadsSince, failed, filesLine, forItem, item1On, itemMiss, itemTarget, MAX_RECIPE, MAX_REPEAT_ITEMS, notAlikeError, parseRepeat, recipeFrom, recordLine, repeatAsk, repeatDone, stoppedAt } from './repeat.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
// The words after "repeat", as the panel will pass them.
const args = (line: string) => parseCommand(line).slice(1);
const same = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const refused = (line: string, steps: number, why: string) => {
  try {
    parseRepeat(args(line), steps);
  } catch (err) {
    if (!(err as Error).message.includes(why)) fail(`${line}: refused for the wrong reason: ${(err as Error).message}`);
    return;
  }
  fail(`${line}: not refused`);
};

// A range, as in the design's example.
same(parseRepeat(args('repeat 5 on 15-23'), 6), { step: 5, items: [15, 16, 17, 18, 19, 20, 21, 22, 23] }, 'range');
// Single numbers, commas or spaces, mixed with ranges; the order given is kept.
same(parseRepeat(args('repeat 2 on 15, 17 20-21'), 2).items, [15, 17, 20, 21], 'mixed');
same(parseRepeat(args('repeat 1 on 9,8'), 1).items, [9, 8], 'commas, no spaces');
// A reversed range counts down; an en dash (as models copy from our docs) works like a hyphen.
same(parseRepeat(args('repeat 1 on 23-21'), 1).items, [23, 22, 21], 'reversed range');
same(parseRepeat(args('repeat 1 on 3–5'), 1).items, [3, 4, 5], 'en dash');
// A quoted list is one word to parseCommand; it reads the same.
same(parseRepeat(args('repeat 1 on "15-17, 20"'), 1).items, [15, 16, 17, 20], 'quoted');
// An item listed twice runs once.
same(parseRepeat(args('repeat 1 on 15 15-16'), 1).items, [15, 16], 'de-dupe');
// Exactly the cap passes.
same(parseRepeat(args(`repeat 1 on 1-${MAX_REPEAT_ITEMS}`), 1).items.length, MAX_REPEAT_ITEMS, 'cap');

// The step must be in the history: 1 to the steps so far.
refused('repeat 0 on 15', 3, "step 0 isn't in your history (steps 1 to 3)");
refused('repeat 4 on 15', 3, "step 4 isn't in your history (steps 1 to 3)");
refused('repeat 1 on 15', 0, 'no steps yet');
refused('repeat x on 15', 3, 'Usage: repeat <step> on <numbers>');
refused('repeat 2.5 on 15', 3, 'Usage:');
// The shape: "on", then numbers.
refused('repeat 1 15-23', 3, 'Usage:');
refused('repeat 1', 3, 'Usage:');
refused('repeat', 3, 'Usage:');
refused('repeat 1 on 15a', 3, '"15a" is not a number or a range');
refused('repeat 1 on -3', 3, '"-3" is not a number or a range');
refused('repeat 1 on 1-2-3', 3, '"1-2-3" is not a number or a range');
// 0 items and 31+ items are refused; element numbers start at 1.
refused('repeat 1 on', 3, `1 to ${MAX_REPEAT_ITEMS} items, got 0`);
refused('repeat 1 on , ,', 3, `1 to ${MAX_REPEAT_ITEMS} items, got 0`);
refused(`repeat 1 on 1-${MAX_REPEAT_ITEMS + 1}`, 3, `1 to ${MAX_REPEAT_ITEMS} items, got ${MAX_REPEAT_ITEMS + 1}`);
refused('repeat 1 on 1-20 31-41', 3, `got ${31}`);
refused('repeat 1 on 0', 3, 'element numbers start at 1');
refused('repeat 1 on 0-3', 3, 'element numbers start at 1');
// A huge range is refused from its count, without building it.
refused('repeat 1 on 1-999999999999', 3, 'got 999999999999');

// 2.2 recordLine: before a command runs, its element number becomes that element's name, when the name is its alone.
const names: Record<number, string> = { 3: 'Search', 12: 'List', 14: 'Download' };
const labelFor = (n: number) => names[n];
same(recordLine('click 14', labelFor), 'click "Download"', 'record click');
same(recordLine('type 3 "new york" enter', labelFor), 'type "Search" "new york" enter', 'record type: the rest as typed');
same(recordLine('scroll down 12', labelFor), 'scroll down "List"', 'record scroll');
same(recordLine('click 15', labelFor), 'click 15', 'no unique name: kept by number');
same(recordLine('click "Download"', labelFor), 'click "Download"', 'a label already');
same(recordLine('click "14"', labelFor), 'click "14"', 'a quoted number is a label');
for (const line of ['back', 'key Enter', 'scroll down', 'click 340,220', 'goto https://example.com/']) same(recordLine(line, labelFor), line, `record ${line}`);
// Round trip with the real lookups: the recorded line finds the same element again.
const read = ['[14] button "Download"', '[15] link "Assignment 1"', '[16] link "Next"', '[17] link "Next"'];
const recorded = recordLine('click 15', (n) => labelOf(read, n));
same(recorded, 'click "Assignment 1"', 'record from a read');
same(parseCommand(recorded, (label) => findByLabel(read, label)), ['click', '15'], 'replays on the same element');
same(recordLine('click 16', (n) => labelOf(read, n)), 'click 16', 'a shared name stays a number');

// 2.2 recipeFrom: what worked from <step> to the last step, reads left out.
const run = [
  { ran: ['click 3'] },
  {}, // an unusable reply: nothing ran
  { ran: ['click "Assignment 1"'] },
  { ran: ['click "Download"'] },
  { ran: ['back', 'pick like "Assignment 1"', 'text all', 'find "Assignment"'] },
];
same(recipeFrom(run, 3), ['click "Assignment 1"', 'click "Download"', 'back'], 'recipe');
same(recipeFrom([{ ran: ['click 15'] }], 1), ['click 15'], 'item 1 by number');
// A bridge step's read, look, tip or pause has nothing to redo (and a replayed read would change what the agent saw).
same(recipeFrom([{ ran: ['click 15', 'read'] }, { ran: ['look', 'tip "x"', 'pause "y"', 'click "Download"'] }], 1), ['click 15', 'click "Download"'], 'bridge reads left out');
const refusedRecipe = (steps: { ran?: string[] }[], step: number, why: string) => {
  try {
    recipeFrom(steps, step);
  } catch (err) {
    if (!(err as Error).message.includes(why)) fail(`recipe from step ${step}: refused for the wrong reason: ${(err as Error).message}`);
    return;
  }
  fail(`recipe from step ${step}: not refused`);
};
refusedRecipe(run, 5, 'step 5 must start with a click on item 1');
// An earlier repeat in the range: its items' downloads would count as item 1's, so it's refused.
refusedRecipe([{ ran: ['click 15'] }, { ran: ['repeat 1 on 16-20'] }], 1, 'step 2 was a repeat');
refusedRecipe([{ ran: ['click 15'] }, { ran: ['key Tab', 'repeat 1 on 16-20'] }], 1, 'step 2 was a repeat'); // a bridge batch
refusedRecipe([{}, { ran: ['text all'] }], 1, 'nothing ran from step 1 on');
refusedRecipe([{ ran: ['click 15', ...Array(MAX_RECIPE).fill('key Tab')] }], 1, `ran ${MAX_RECIPE + 1} commands; a repeat takes up to ${MAX_RECIPE}`);
refusedRecipe([{ ran: ['back', 'click 15'] }], 1, 'must start with a click on item 1');
refusedRecipe([{ ran: ['click 340,220'] }], 1, 'must start with a click on item 1');
refusedRecipe([{ ran: ['click 15', 'click 22'] }], 1, '"click 22" points at an element by number or position');
refusedRecipe([{ ran: ['click 15', 'click 40,50'] }], 1, '"click 40,50" points at an element by number or position');
same(recipeFrom([{ ran: ['click 15', ...Array(MAX_RECIPE - 1).fill('key Tab')] }], 1).length, MAX_RECIPE, 'recipe cap');

// 2.2 forItem: the first click goes to the item; the rest run as recorded.
same(forItem(['click "Assignment 1"', 'click "Download"', 'back'], '16'), ['click 16', 'click "Download"', 'back'], 'item swap');
same(forItem(['click 15', 'back'], '"Assignment 3"'), ['click "Assignment 3"', 'back'], 'item swap by name');
same(forItem(['click 15 double'], '21'), ['click 21 double'], 'item swap keeps the flags');

// 2.3 failed: the panel's rule for a command that didn't work (its output's first line).
same([failed('Error: Element [3] is gone'), failed('Refused: the user said no'), failed('\n\nError: x'), failed('ok — real click'), failed(undefined)], [true, true, true, false, false], 'failed');

// 2.3 itemMiss: item k goes like item 1 only if every command worked, no download failed and as many started.
const recipe = ['click "Assignment 1"', 'click "Download"', 'back'];
same(itemMiss(recipe, ['ok', 'ok — real click', 'ok'], ['downloaded "a6.pdf" (12 KB)'], 1, 1), '', 'went like item 1');
same(itemMiss(recipe, ['ok', 'Error: Nothing called "Download" in the last read.'], [], 1, 0), 'click "Download" failed: Error: Nothing called "Download" in the last read.', 'a command failed');
same(itemMiss(recipe, ['ok', 'ok'], [], 1, 1), "back didn't run", 'stopped part way');
same(itemMiss(recipe, ['ok', 'ok', 'ok'], ['download failed: "a6.pdf" (NETWORK_FAILED)'], 1, 1), 'download failed: "a6.pdf" (NETWORK_FAILED)', 'download failed');
same(itemMiss(recipe, ['ok', 'ok', 'ok'], ['download refused: the user said no to "a6.pdf"'], 1, 1), 'download refused: the user said no to "a6.pdf"', 'download refused');
same(itemMiss(recipe, ['ok', 'ok', 'ok'], [], 1, 0), '0 downloads started; item 1 had 1', 'no download');
same(itemMiss(recipe, ['ok', 'ok', 'ok'], [], 0, 2), '2 downloads started; item 1 had 0', 'extra downloads');

// 2.3 downloadsSince: the run's downloads count when <step> began (the first step from there that has one).
same(downloadsSince([{ downloadsAt: 0 }, {}, { downloadsAt: 2 }], 2, 5), 3, 'from the next step with a count');
same(downloadsSince([{ downloadsAt: 1 }], 1, 1), 0, 'none since');
same(downloadsSince([{}], 1, 4), 0, 'no count: none');

// 2.3 stoppedAt: the hand-back, by names (numbers change on the next read). Names are page text: quoted, one line, cut.
const items = ['Assignment 2', 'Assignment 3', 'Assignment 4', 'Assignment 5', 'Assignment 6', 'Assignment 7', 'Assignment 8', 'Assignment 9', 'Assignment 10'];
same(stoppedAt(items, 4, 'click "Download" failed: Error: Nothing called "Download"'),
  'Repeat stopped at item 5 of 9, "Assignment 6": click "Download" failed: Error: Nothing called "Download". Done: 4 ("Assignment 2" to "Assignment 5"). Left: 5 ("Assignment 6" to "Assignment 10").', 'stopped');
same(stoppedAt(['A', 'B'], 0, 'x'), 'Repeat stopped at item 1 of 2, "A": x. Done: 0. Left: 2 ("A" to "B").', 'stopped at the first');
same(stoppedAt(['A', 'B'], 1, 'x'), 'Repeat stopped at item 2 of 2, "B": x. Done: 1 ("A"). Left: 1 ("B").', 'stopped at the last');
same(stoppedAt([`two\n  lines ${'x'.repeat(60)}`], 0, 'x'), `Repeat stopped at item 1 of 1, ${JSON.stringify(`two lines ${'x'.repeat(30)}…`)}: x. Done: 0. Left: 1 (${JSON.stringify(`two lines ${'x'.repeat(30)}…`)}).`, 'names cut');

// 2.4 itemTarget: an item by its own name when it has one (its number changes once the page reloads), else by number.
same([itemTarget(14, labelFor), itemTarget(15, labelFor)], ['"Download"', '15'], 'item targets');

// 2.4 item1On: item 1 on the current page, by its recorded name; a recorded number is used as it is.
same(item1On(['click "Assignment 1"', 'back'], (label) => findByLabel(read, label)), 15, 'item 1 by name');
same(item1On(['click 15'], () => fail('looked up a number')), 15, 'item 1 by number');

// 2.4 notAlikeError: the items not built like item 1, by number and quoted name, up to 5.
same(notAlikeError([17], 15, (n) => ({ 15: 'Assignment 1', 17: 'Log out' })[n] ?? `[${n}]`),
  'repeat refused: [17] "Log out" isn\'t built like item 1, [15] "Assignment 1". Use numbers from pick like 15.', 'not alike');
same(notAlikeError([1, 2, 3, 4, 5, 6, 7], 15, () => 'x'), 'repeat refused: [1] "x", [2] "x", [3] "x", [4] "x", [5] "x" and 2 more aren\'t built like item 1, [15] "x". Use numbers from pick like 15.', 'not alike, many');

// 2.4 repeatAsk: the one ask you approve: the steps, the site, every item by quoted name, and the downloads it covers.
same(repeatAsk(5, 7, 'coursesite.edu', ['Assignment 2', 'Assignment 3'], 1),
  'Repeat steps 5 to 7 on 2 items from coursesite.edu: "Assignment 2", "Assignment 3". Up to 2 downloads (1 per item, as item 1 had), without asking again; any other download still asks.', 'ask');
same(repeatAsk(4, 4, 'example.com', ['A'], 0), 'Repeat step 4 on 1 item from example.com: "A". Item 1 had no downloads, so any download still asks.', 'ask, no downloads');

// 2.4 repeatDone: every item went like item 1, then its files (filesLine).
same(repeatDone(['Assignment 2', 'Assignment 10'], 'Files: 2 finished ("a2.txt" to "a10.txt").'), 'Repeat done: all 2 items went like item 1 ("Assignment 2" to "Assignment 10"). Files: 2 finished ("a2.txt" to "a10.txt").', 'done');
same(repeatDone(['A'], 'No downloads.'), 'Repeat done: the 1 item went like item 1 ("A"). No downloads.', 'done, one');

// filesLine (live check: "9 downloads started" let the agent confirm nothing): the files by state, each by name. A file
// told twice (started, then done) counts once, as its last state, in its first place.
same(filesLine(['downloaded "a2.txt" (1 KB)', 'download started: "a3.txt" (still going)', 'downloaded "a3.txt" (1 KB)', 'download started: "a4.txt" (still going)']),
  'Files: 2 finished ("a2.txt" to "a3.txt"); 1 still going ("a4.txt").', 'files');
same(filesLine(['download failed: "a5.txt" (NETWORK_FAILED)', 'download refused: the user said no to "a6.txt"']), 'Files: 2 failed or refused ("a5.txt" to "a6.txt").', 'files lost');
same(filesLine(['downloaded "a.txt" (1 KB) (it finished before it could be paused for the user\'s ok)']), 'Files: 1 finished ("a.txt").', 'finished early');
same([filesLine([]), filesLine(['something else'])], ['No downloads.', 'No downloads.'], 'no files');
same(stoppedAt(['A', 'B'], 1, 'x', 'Files: 1 finished ("a.txt").'), 'Repeat stopped at item 2 of 2, "B": x. Done: 1 ("A"). Left: 1 ("B"). Files: 1 finished ("a.txt").', 'stopped, with files');

console.log('repeat.test.ts: all checks passed');
