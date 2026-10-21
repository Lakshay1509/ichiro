// Splits a console line into words. Double-quoted text stays one word: type 3 "new york" → ['type', '3', 'new york'].

// The word that names the element, per command: click 4, type 3 "x", scroll down 12, pick like 14.
const TARGET_AT: Record<string, number> = { click: 1, hover: 1, type: 1, select: 1, scroll: 2, pick: 2 };

// With numberFor, a quoted word in the element slot becomes that element's number. Quoted is always a label, even when
// it's only digits: click "19" is the thing called 19 (seen live: a greyed-out date), never element 19.
// Group 1 = text inside quotes; otherwise the whole match is a plain word.
const WORD = /"([^"]*)"|\S+/g;

export function parseCommand(line: string, numberFor?: (label: string) => number): string[] {
  const words = [...line.matchAll(WORD)];
  const at = TARGET_AT[words[0]?.[0] ?? ''];
  return words.map((m, i) => (numberFor && i === at && m[1] !== undefined ? String(numberFor(m[1])) : m[1] ?? m[0]));
}

// RP1: the element word as typed (quotes kept: 14, "Download", 340,220), and the line with only that word swapped.
// undefined when the command has none (back, key Enter, scroll down).
export function elementWord(line: string): { word: string; swap: (to: string) => string } | undefined {
  const words = [...line.matchAll(WORD)];
  const m = words[TARGET_AT[words[0]?.[0] ?? ''] ?? -1];
  return m && { word: m[0], swap: (to) => line.slice(0, m.index) + to + line.slice(m.index + m[0].length) };
}

// WR2: everything after the first n words, as typed (paste and type here take text with quotes in it, like JSON).
// One pair of quotes around all of it, with none inside, is dropped: paste "hello" pastes hello.
export function restOf(line: string, n: number): string {
  let rest = line.trimStart();
  for (let i = 0; i < n; i++) rest = rest.replace(/^\S+\s*/, '');
  return /^"[^"]*"$/.test(rest.trim()) ? rest.trim().slice(1, -1) : rest;
}
