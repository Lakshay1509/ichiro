// Checks the lazy-page loader (F3d): the stitch, the "is it lazy" probe count, the stop rules and the whole loop on fake
// pages (normal, adds as you scroll, virtual list, endless feed, hidden tab). Run: npm test
import { loadWith, MAX_SCREENS, MIN_NEW, newLines, stitch, stopReason, withNote, type Page } from './load-page.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const same = (got: unknown, want: unknown, label: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label}:\n${JSON.stringify(got)}\n--- want ---\n${JSON.stringify(want)}`);
};

// Stitch: a page that only grew → the bigger read; swapped windows → joined at their overlap; real repeats stay.
same(stitch(['H', 'a', 'b', 'F'], ['H', 'a', 'b', 'c', 'd', 'F']), ['H', 'a', 'b', 'c', 'd', 'F'], 'grew');
same(stitch(['H', 'r1', 'r2', 'r3', 'F'], ['H', 'r3', 'r4', 'r5', 'F']), ['H', 'r1', 'r2', 'r3', 'r4', 'r5', 'F'], 'swapped');
same(stitch(['In "A":', '09:50', 'In "B":', '09:50'], ['In "B":', '09:50', '10:00', 'In "C":', '09:50']),
  ['In "A":', '09:50', 'In "B":', '09:50', '10:00', 'In "C":', '09:50'], 'repeats kept');
same(stitch(['a', 'b'], ['c', 'd']), ['a', 'b', 'c', 'd'], 'no overlap → appended');
same(stitch(['a', 'b'], ['a', 'b']), ['a', 'b'], 'same');
same(stitch([], ['a']), ['a'], 'empty a');
same(stitch(['a'], []), ['a'], 'empty b');

// Probe count: new lines, repeats counted; a clock that ticks is one line, under MIN_NEW.
if (newLines(['a', 'b', '12:01'], ['a', 'b', '12:02']) >= MIN_NEW) fail('a ticking clock looked lazy');
if (newLines(['x'], ['x', 'x', 'y']) !== 2) fail('newLines repeats');

// Stop rules: full first, then the bottom, then the caps.
same(stopReason({ full: true, atBottom: true, screens: 99, ms: 0 }), 'full', 'full wins');
same(stopReason({ full: false, atBottom: true, screens: 99, ms: 0 }), 'bottom', 'bottom');
same(stopReason({ full: false, atBottom: false, screens: MAX_SCREENS, ms: 0 }), 'cap', 'screen cap');
same(stopReason({ full: false, atBottom: false, screens: 1, ms: 15_000 }), 'cap', 'time cap');
same(stopReason({ full: false, atBottom: false, screens: 1, ms: 0 }), '', 'go on');

// The note goes first, and never on its own: an empty result stays empty.
same(withNote('(n)', 'out'), '(n)\nout', 'note first');
same(withNote('', 'out'), 'out', 'no note');
same(withNote('(n)', ''), '', 'nothing found');

// A fake page: Header, rows, Footer; one row per unit of scroll, `view` rows on screen.
// batches: rows added (batch at a time) each time a wait ends at the bottom; virtual: only rows near the screen exist.
// spinner: a "Loading" line under the rows while batches are left, then "End" (stale text must not stay).
function fake(o: { rows: number; view?: number; batch?: number; batches?: number; virtual?: boolean; hidden?: boolean; spinner?: boolean }) {
  const view = o.view ?? 10;
  let loaded = o.rows;
  let left = o.batches ?? 0;
  let y = 0;
  let t = 0;
  const log: string[] = []; // scrolls and waits, in order
  const max = () => Math.max(0, loaded + 2 - view);
  const rows = () => Array.from({ length: loaded }, (_, i) => `row ${i + 1}`);
  const spin = () => (o.spinner ? [left > 0 ? 'Loading' : 'End'] : []);
  const text = () => ['Header', ...(o.virtual ? rows().slice(Math.max(0, y - 2), y + view + 2) : rows()), ...spin(), 'Footer'];
  const page: Page = {
    scroller: max() > 0 ? { y: () => y, max, screen: () => view, to: (v) => void log.push(`to ${(y = Math.max(0, Math.min(v, max())))}`) } : null,
    hidden: !!o.hidden,
    text,
    now: () => t,
    wait: async () => {
      log.push('wait');
      t += 500;
      if (y >= max() - 1 && left > 0) {
        loaded += o.batch ?? 10;
        left--;
      }
    },
  };
  return { page, text, log, at: () => y, go: (v: number) => void (y = v), all: () => ['Header', ...rows(), ...spin(), 'Footer'] };
}
const textFull = (lines: string[]) => lines.join('\n').length >= 12_000;

// Normal page: nothing new at the bottom → read as is, no note, back where it was.
{
  const f = fake({ rows: 50 });
  f.go(7);
  const r = await loadWith(f.page, f.text, textFull);
  same(r, { lines: f.all(), note: '' }, 'normal page');
  if (f.at() !== 7) fail(`normal page: not scrolled back (${f.at()})`);
  // Seen live (BookMyShow): the next page list came while the page was still redrawing after the scroll back, and an
  // element the model clicked wasn't in it. So it waits for quiet after scrolling back.
  same(f.log.slice(-2), ['to 7', 'wait'], 'normal page: waits after scrolling back');
}
// Adds as you scroll: 3 more batches → every row in order, "to the end", back where it was.
{
  const f = fake({ rows: 10, batches: 3 });
  f.go(1);
  const r = await loadWith(f.page, f.text, textFull);
  same(r.lines, f.all(), 'adds: every row');
  if (r.lines.length !== 42 || !r.note.includes('to the end') || f.at() !== 1) fail(`adds: ${r.note} at ${f.at()}`);
}
// Seen live: a "Loading" line that later turned into "End" stayed in the middle. A page that only adds is read once
// more at the end instead, so text that changed while loading is gone.
{
  const f = fake({ rows: 10, batches: 3, spinner: true });
  const r = await loadWith(f.page, f.text, textFull);
  same(r.lines, f.all(), 'spinner: last read');
  if (r.lines.includes('Loading')) fail('stale Loading line kept');
}
// Virtual list: 200 rows, only ~24 exist at a time → all 200 stitched in order.
{
  const f = fake({ rows: 200, view: 20, virtual: true });
  const r = await loadWith(f.page, f.text, textFull);
  same(r.lines, f.all(), 'virtual: every row');
  if (!r.note.includes('to the end')) fail(`virtual note: ${r.note}`);
}
// Endless feed (the infinite-scroll edge case): stops at the cap, says so, scrolls back.
{
  const f = fake({ rows: 10, batches: Infinity });
  f.go(2);
  const r = await loadWith(f.page, f.text, textFull);
  if (!r.note.includes('keeps loading') || !r.note.includes('search, filters or sort') || f.at() !== 2) fail(`endless: ${r.note} at ${f.at()}`);
  same(f.log.slice(-2), ['to 2', 'wait'], 'endless: waits after scrolling back');
}
// Full output: stops early. Without stay it scrolls back; with stay (find) it stays where it got full.
{
  const f = fake({ rows: 10, batches: 5 });
  f.go(1);
  const r = await loadWith(f.page, f.text, (l) => l.length >= 15);
  if (!r.note.includes('had enough') || f.at() !== 1) fail(`full: ${r.note} at ${f.at()}`);
  const g = fake({ rows: 10, batches: 5 });
  g.go(1);
  await loadWith(g.page, g.text, (l) => l.length >= 15, true);
  if (g.at() === 1) fail('stay: scrolled back anyway');
}
// Already full, not scrollable or hidden: no scrolling; hidden says why.
{
  const f = fake({ rows: 10, batches: 3 });
  same(await loadWith(f.page, f.text, () => true), { lines: f.text(), note: '' }, 'already full');
  const small = fake({ rows: 5 });
  same((await loadWith(small.page, small.text, textFull)).note, '', 'not scrollable');
  const h = fake({ rows: 10, batches: 3, hidden: true });
  const r = await loadWith(h.page, h.text, textFull);
  if (!r.note.includes("isn't on screen") || h.at() !== 0 || r.lines.length !== 12) fail(`hidden: ${r.note}`);
}
