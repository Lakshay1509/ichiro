// RP1 (Build 2): the AI's repeat command, "redo step <step>'s commands on each of these items": its words (2.1) and
// its recipe (2.2) and the check that each item went like item 1 (2.3). Built-like is checked on the page (notAlike in
// lib/pick.ts).
import { oneLine, summarize } from './agent-prompt.ts';
import { elementWord, parseCommand } from './parse-command.ts';

// Cap from repeat-tasks.md (RP1 security): one repeat covers at most this many items.
export const MAX_REPEAT_ITEMS = 30;
const USAGE = `Usage: repeat <step> on <numbers>: redo the commands from that step of your history on each element, 1 to ${MAX_REPEAT_ITEMS} of them, e.g. repeat 5 on 15-23 or repeat 5 on 15, 17, 20-23`;

// args: the words after "repeat". stepCount: the run's steps so far; <step> must be one of them.
export function parseRepeat(args: string[], stepCount: number): { step: number; items: number[] } {
  const [stepWord = '', on, ...rest] = args;
  if (on !== 'on' || !/^\d+$/.test(stepWord)) throw new Error(USAGE);
  const step = Number(stepWord);
  if (step < 1 || step > stepCount) throw new Error(`repeat refused: step ${step} isn't in your history (${stepCount ? `steps 1 to ${stepCount}` : 'no steps yet'}).`);
  const ranges = rest.join(' ').split(/[\s,]+/).filter(Boolean).map((part) => {
    const m = /^(\d+)(?:[-–](\d+))?$/.exec(part);
    if (!m) throw new Error(`repeat refused: ${JSON.stringify(part.slice(0, 20))} is not a number or a range like 15-23. ${USAGE}`);
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (!a || !b) throw new Error('repeat refused: element numbers start at 1.');
    return [a, b] as const;
  });
  // Counted before building the list, so 1-999999999 is refused without making it.
  const count = ranges.reduce((sum, [a, b]) => sum + Math.abs(b - a) + 1, 0);
  if (!count || count > MAX_REPEAT_ITEMS) throw new Error(`repeat refused: it takes 1 to ${MAX_REPEAT_ITEMS} items, got ${count}. ${USAGE}`);
  // A reversed range counts down; an item listed twice runs once.
  const items = ranges.flatMap(([a, b]) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => a + i * Math.sign(b - a)));
  return { step, items: [...new Set(items)] };
}

// 2.2 Recorder. While a step runs, each command that worked is kept by label (recordLine) on its Step as ran. A
// repeat's recipe is what worked from <step> to the last step; per item, its first click goes to that item (forItem).
// Cap from repeat-tasks.md (RP1 security), the same as F9's commands per step.
export const MAX_RECIPE = 8;
// Nothing to redo, so a recipe leaves them out: reads (the pick that found the items, a text all; the bridge's read
// and look), a tip (saved once is enough) and a pause for the user.
const READ_ONLY = ['text', 'find', 'pick', 'read', 'look', 'tip', 'pause'];

// Called before the command runs, while its number is still this read's: click 14 → click "Download" when that name
// is element 14's alone (labelFor). Numbers change on every page load; names mostly don't. Otherwise kept as it is.
export function recordLine(line: string, labelFor: (n: number) => string | undefined): string {
  const target = elementWord(line);
  const label = target && /^\d+$/.test(target.word) ? labelFor(Number(target.word)) : undefined;
  return label === undefined ? line : target!.swap(`"${label}"`);
}

// steps: the run's, each with what ran (recordLine's lines). step: parseRepeat's. The first command must click item 1;
// every later one must find its element by name, since the next item's page numbers its elements anew.
export function recipeFrom(steps: { ran?: string[] }[], step: number): string[] {
  // An earlier repeat in the range: its items' downloads would count as item 1's (more let through unasked).
  const again = steps.slice(step - 1).findIndex((s) => s.ran?.some((line) => parseCommand(line)[0] === 'repeat'));
  if (again >= 0) throw new Error(`repeat refused: step ${step + again} was a repeat, and a recipe can't hold one. Send the step where this item 1 started.`);
  const lines = steps.slice(step - 1).flatMap((s) => s.ran ?? []).filter((line) => !READ_ONLY.includes(parseCommand(line)[0] ?? ''));
  if (!lines.length) throw new Error(`repeat refused: nothing ran from step ${step} on.`);
  if (lines.length > MAX_RECIPE) throw new Error(`repeat refused: steps ${step} to ${steps.length} ran ${lines.length} commands; a repeat takes up to ${MAX_RECIPE}. Send the step where item 1 started.`);
  const first = elementWord(lines[0]!);
  if (parseCommand(lines[0]!)[0] !== 'click' || !first || !/^(\d+|".*")$/.test(first.word)) {
    throw new Error(`repeat refused: step ${step} must start with a click on item 1; it starts with ${JSON.stringify(lines[0]!.slice(0, 100))}.`);
  }
  const byNumber = lines.slice(1).find((line) => elementWord(line)?.word.startsWith('"') === false);
  if (byNumber) throw new Error(`repeat refused: ${JSON.stringify(byNumber.slice(0, 100))} points at an element by number or position, not a name of its own, so it can't be found on the next item's page. Do the items one by one.`);
  return lines;
}

// An item's commands: the first click goes to the item (itemTarget: its quoted name or its number); the rest run as
// recorded.
export const forItem = (recipe: string[], target: string) => [elementWord(recipe[0]!)!.swap(target), ...recipe.slice(1)];

// 2.3 Item check. A command's output that says it didn't work: its first line starts with Error or Refused (the
// panel skips the rest of a step on it too).
export const failed = (output: string | void) => /^(Error|Refused)\b/.test(summarize(output));

// Why item k didn't go like item 1, '' if it did: every recipe command worked, no download failed or was refused, and
// as many downloads started as item 1's. outputs: its commands' outputs so far, in recipe order. news: its download
// lines (RunDownloads.report). want: item 1's downloads (downloadsSince); got: item k's.
export function itemMiss(recipe: string[], outputs: (string | void)[], news: string[], want: number, got: number): string {
  const i = outputs.findIndex(failed);
  if (i >= 0) return `${recipe[i]} failed: ${summarize(outputs[i])}`;
  if (outputs.length < recipe.length) return `${recipe[outputs.length]} didn't run`;
  const lost = news.find((line) => /^download (failed|refused)\b/.test(line));
  if (lost) return lost;
  if (got !== want) return `${got} download${got === 1 ? '' : 's'} started; item 1 had ${want}`;
  return '';
}

// Item 1's downloads: the run's count now (RunDownloads.created) minus its count when <step> began. Steps with no
// count (an unusable reply) are skipped; none at all means none.
export function downloadsSince(steps: { downloadsAt?: number }[], step: number, now: number): number {
  return now - (steps.slice(step - 1).find((s) => s.downloadsAt !== undefined)?.downloadsAt ?? now);
}

// The hand-back at the first miss. By name: element numbers change on the next read. Names are page text, so quoted,
// one line and cut; only the first and last of each list, so it fits the step's result.
export function stoppedAt(names: string[], at: number, why: string, files = ''): string {
  const done = names.slice(0, at);
  const left = names.slice(at);
  return `Repeat stopped at item ${at + 1} of ${names.length}, ${q(names[at] ?? '')}: ${oneLine(why, 200)}. Done: ${done.length}${span(done)}. Left: ${left.length}${span(left)}.${files && ` ${files}`}`;
}

// The files a repeat brought, from its items' download lines (RunDownloads.report), so the agent can confirm them:
// finished, still going (its "downloaded" line comes later, as for any download), failed or refused. A file told twice
// (started, then done) counts once, as its last state, in its first place.
export function filesLine(news: string[]): string {
  const files = new Map<string, string>();
  for (const line of news) {
    const name = /"([^"]*)"/.exec(line)?.[1];
    const state = line.startsWith('downloaded ') ? 'finished' : line.startsWith('download started') ? 'still going' : /^download (failed|refused)\b/.test(line) ? 'failed or refused' : '';
    if (name !== undefined && state) files.set(name, state);
  }
  const lists = ['finished', 'still going', 'failed or refused'].map((state) => [state, [...files].filter(([, s]) => s === state).map(([n]) => n)] as const);
  const said = lists.filter(([, list]) => list.length).map(([state, list]) => `${list.length} ${state}${span(list)}`);
  return said.length ? `Files: ${said.join('; ')}.` : 'No downloads.';
}

// An item's name is page text: quoted, one line, cut. A list shows its first and last.
const q = (name: string) => JSON.stringify(oneLine(name, 40));
const span = (list: string[]) => (list.length ? ` (${q(list[0]!)}${list.length > 1 ? ` to ${q(list.at(-1)!)}` : ''})` : '');

// 2.4 Approve once, then run. How the repeat aims at an item: by its own name when it has one, since its number
// changes once the page reloads (after a trip and back); else by its number.
export function itemTarget(n: number, labelFor: (n: number) => string | undefined): string {
  const label = labelFor(n);
  return label === undefined ? String(n) : `"${label}"`;
}

// Item 1's number on the current page: found by its recorded name; a recorded number is used as it is.
export function item1On(recipe: string[], numberFor: (label: string) => number): number {
  const word = elementWord(recipe[0]!)!.word;
  return word.startsWith('"') ? numberFor(word.slice(1, -1)) : Number(word);
}

// The items notAlike found, by number and quoted name (up to 5).
export function notAlikeError(odd: number[], item1: number, name: (n: number) => string): string {
  const shown = odd.slice(0, 5).map((n) => `[${n}] ${q(name(n))}`).join(', ');
  const more = odd.length > 5 ? ` and ${odd.length - 5} more` : '';
  return `repeat refused: ${shown}${more} ${odd.length === 1 ? "isn't" : "aren't"} built like item 1, [${item1}] ${q(name(item1))}. Use numbers from pick like ${item1}.`;
}

// The one ask you approve: the steps, the site, every item by quoted name, and the downloads it lets through without
// asking (perItem: item 1's, for each item). Any other download still asks.
export function repeatAsk(step: number, last: number, site: string, names: string[], perItem: number): string {
  const steps = step === last ? `step ${step}` : `steps ${step} to ${last}`;
  const files = perItem
    ? `Up to ${perItem * names.length} downloads (${perItem} per item, as item 1 had), without asking again; any other download still asks.`
    : 'Item 1 had no downloads, so any download still asks.';
  return `Repeat ${steps} on ${names.length} item${names.length === 1 ? '' : 's'} from ${site}: ${names.map(q).join(', ')}. ${files}`;
}

// The step's result when every item went like item 1. files: filesLine's.
export const repeatDone = (names: string[], files: string) =>
  `Repeat done: ${names.length === 1 ? 'the 1 item' : `all ${names.length} items`} went like item 1${span(names)}. ${files}`;
