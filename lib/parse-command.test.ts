// Checks parseCommand: words split on spaces, double-quoted text stays one word, a quoted element word is a label. Run: npm test
import { parseCommand } from './parse-command.ts';

const cases: [string, string[]][] = [
  ['type 3 "new york"', ['type', '3', 'new york']],
  ['echo "a b" c', ['echo', 'a b', 'c']],
  ['  ping   ', ['ping']],
  ['echo ""', ['echo', '']],
  ['', []],
];

for (const [line, want] of cases) {
  const got = parseCommand(line);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`parseCommand(${JSON.stringify(line)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// With a label lookup: a quoted word in the element slot is a label, even all digits; plain digits stay a number.
const labels: Record<string, number> = { '19': 7, Search: 2, Results: 9, '2': 5 };
const lookup = (label: string) => {
  const n = labels[label];
  if (n === undefined) throw new Error(`Nothing called ${JSON.stringify(label)}`);
  return n;
};
const resolved: [string, string[]][] = [
  ['click "19"', ['click', '7']], // the live bug: was element 19
  ['click 19', ['click', '19']],
  ['click "2"', ['click', '5']], // a page-number button called 2
  ['type "Search" "19"', ['type', '2', '19']], // the text typed stays text
  ['select 4 "2"', ['select', '4', '2']],
  ['scroll down "Results"', ['scroll', 'down', '9']],
  ['find "19" 2', ['find', '19', '2']], // find takes text, not an element
  ['hover "Search"', ['hover', '2']],
  ['pick like "19"', ['pick', 'like', '7']], // F3c: the example is an element
];
for (const [line, want] of resolved) {
  const got = parseCommand(line, lookup);
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`parseCommand(${JSON.stringify(line)}, lookup) = ${JSON.stringify(got)}`);
}
let missed = '';
try {
  parseCommand('click "MON"', lookup);
} catch (err) {
  missed = (err as Error).message;
}
if (missed !== 'Nothing called "MON"') throw new Error(`unknown label should throw: ${missed}`);

// WR2: restOf keeps the rest of the line as typed, quotes and all; one wrapping pair with none inside is dropped.
import { restOf } from './parse-command.ts';
for (const [line, n, want] of [
  ['paste {"type":"x","a":[1, 2]}', 1, '{"type":"x","a":[1, 2]}'],
  ['paste "hello world"', 1, 'hello world'],
  ['paste "a" and "b"', 1, '"a" and "b"'],
  ['type here "Start"', 2, 'Start'],
  ['type here  two  spaces', 2, 'two  spaces'],
  ['paste line one\nline two', 1, 'line one\nline two'],
  ['paste', 1, ''],
] as const) {
  if (restOf(line, n) !== want) throw new Error(`restOf(${JSON.stringify(line)}, ${n}) = ${JSON.stringify(restOf(line, n))}, want ${JSON.stringify(want)}`);
}
