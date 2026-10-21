// findByLabel: turns a label like "Search" into its element number, using the lines the last read printed.

// One read line: [12] button "Proceed to checkout" disabled → number 12, name "Proceed to checkout".
const LINE = /^\[(\d+)\] \S+ ("(?:[^"\\]|\\.)*")/;

const elementsOf = (lines: string[]) => lines.flatMap((line) => {
  const m = LINE.exec(line);
  return m ? [{ n: Number(m[1]), name: JSON.parse(m[2]!) as string, line }] : [];
});

// Exact name first, then ignoring case. 0 or 2+ matches throw: never guess.
export function findByLabel(lines: string[], label: string): number {
  const elements = elementsOf(lines);
  const lower = label.toLowerCase();
  for (const same of [(name: string) => name === label, (name: string) => name.toLowerCase() === lower]) {
    const matches = elements.filter((e) => same(e.name));
    if (matches.length === 1) return matches[0]!.n;
    if (matches.length > 1) {
      throw new Error(`${matches.length} elements are called ${JSON.stringify(label)}. Use a number:\n${matches.map((e) => e.line).join('\n')}`);
    }
  }
  // Hint seen needed live: the AI tried to click a greyed-out date that showed only as a quoted text line.
  throw new Error(`Nothing called ${JSON.stringify(label)} in the last read. Quoted lines are page text and can't be clicked: an option shown only as text is usually unavailable (greyed out). Use a number, or run read`);
}

// RP1's recorder, the other way round: element n's name, only when that name finds n again and fits in one quoted
// command word (no quote or line break). undefined otherwise, and the command stays by number.
export function labelOf(lines: string[], n: number): string | undefined {
  const name = nameOf(lines, n);
  if (!name || /["\r\n]/.test(name)) return undefined;
  try {
    return findByLabel(lines, name) === n ? name : undefined;
  } catch {
    return undefined; // others share the name
  }
}

// Element n's name in the read, shared or not (for showing it); undefined if it isn't there.
export const nameOf = (lines: string[], n: number) => elementsOf(lines).find((e) => e.n === n)?.name;
