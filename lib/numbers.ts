// Element numbers that never move: an element keeps its number while it stays the same thing, and no number is given
// to two elements, so a number from an older read means the same element or is refused (wrong-click guard).

// Page side, one copy per frame. Element → its number and what it was (role and name) when numbered.
const given = new WeakMap<object, { n: number; key: string }>();
// The highest number this frame gave out.
let highest = 0;

// Numbers for one read's elements, in order. New ones count on from next (the panel's last number, never below this
// frame's own). keys[i] is what els[i] is now: a box a list reuses for another row is a new element, with a new number.
export function stick(els: object[], keys: string[], next: number): number[] {
  highest = Math.max(highest, next);
  return els.map((el, i) => {
    const key = keys[i]!;
    const had = given.get(el);
    if (had?.key === key) return had.n;
    given.set(el, { n: ++highest, key });
    return highest;
  });
}

// Throws unless el is still what it was when it got number n (the page may have changed it since the read).
export function checkSame(n: number, el: object, key: string): void {
  if (given.get(el)?.key !== key) throw new Error(`Element [${n}] changed since your last read — run read again`);
}

// Panel side. Number → where it was first read ("tab 7 frame 0").
const owners = new Map<number, string>();
// Numbers read in two places. Only a read cut short (panel closed mid-read) can cause it; refused from then on.
const clashes = new Set<number>();

export function claim(nums: number[], where: string): void {
  for (const n of nums) {
    if (!owners.has(n)) owners.set(n, where);
    else if (owners.get(n) !== where) clashes.add(n);
  }
}

export const clashed = (n: number) => clashes.has(n);
