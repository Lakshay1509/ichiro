// Lazy pages (F3d): before text all, pick and find read, load what the page adds (or swaps in) only as you scroll.
// Like Crawl4AI's scan_full_page + virtual scroll: scroll a screen at a time, read at each stop, stitch the reads.
// Sources: https://docs.crawl4ai.com/advanced/lazy-loading/ · https://docs.crawl4ai.com/advanced/virtual-scroll/
import { mainScroller } from './actions.ts';
import { addedLines, readText } from './page-text.ts';
import { waitForQuiet } from './settle.ts';

// Caps, so an endless feed can't hang a step. The time cap also covers slow pages (each stop waits up to STOP_MS).
export const MAX_SCREENS = 20;
const MAX_MS = 15_000;
const STOP_MS = 1500; // per stop; waitForQuiet returns after 500 ms without changes
const STEP = 0.8; // of a screen, so stops overlap and the stitch can line them up
// New text lines after one jump to the bottom that mean "this page loads as you scroll". A ticking clock or a
// carousel changes fewer, so a normal page isn't scrolled through on every read.
export const MIN_NEW = 3;
// The stitch compares every line of one read with every line of the other; past this it keeps the longer read.
const MAX_CELLS = 4_000_000;

// What the loader needs from the page. The real one is domPage; tests pass fakes.
export type Scroller = { y: () => number; max: () => number; screen: () => number; to: (y: number) => void };
export type Page = { scroller: Scroller | null; hidden: boolean; text: () => string[]; now: () => number; wait: () => Promise<unknown> };
export type Stop = '' | 'full' | 'bottom' | 'cap';

// How many lines in after before doesn't have, repeats counted. Pure.
export const newLines = (before: string[], after: string[]) => addedLines(before, after).length;

// Two reads of one page → one, in page order: lines both have appear once, real repeats stay ("09:50 AM" under two
// cinemas). Shortest common supersequence via the longest common subsequence; the shared start and end are cut off
// first, so a page that only grew costs almost nothing. Ties put a's lines first. Pure.
export function stitch(a: string[], b: string[]): string[] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const x = a.slice(s, a.length - e);
  const y = b.slice(s, b.length - e);
  // shortcut: two huge reads that differ throughout keep the longer one; upgrade if long lazy pages lose lines live.
  if (x.length * y.length > MAX_CELLS) return a.length >= b.length ? a : b;
  const w = y.length + 1;
  const lcs = new Uint32Array((x.length + 1) * w); // lcs[i * w + j]: common length of x[i..] and y[j..]
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const mid: string[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      mid.push(x[i++]!);
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) mid.push(x[i++]!);
    else mid.push(y[j++]!);
  }
  return [...a.slice(0, s), ...mid, ...x.slice(i), ...y.slice(j), ...a.slice(a.length - e)];
}

// Why the pass stops: the output can't show more (full), the end stopped growing (bottom), or a cap. Pure.
export const stopReason = (s: { full: boolean; atBottom: boolean; screens: number; ms: number }): Stop =>
  s.full ? 'full' : s.atBottom ? 'bottom' : s.screens >= MAX_SCREENS || s.ms >= MAX_MS ? 'cap' : '';

const NOTES: Record<Exclude<Stop, ''>, (n: number) => string> = {
  bottom: (n) => `(This page loads more as you scroll: I scrolled ${n} screens to the end, so this covers the whole page.)`,
  full: (n) => `(This page loads more as you scroll: I scrolled ${n} screens and stopped once I had enough.)`,
  cap: (n) => `(This page keeps loading more as you scroll: I stopped after ${n} screens. Use the site's search, filters or sort to narrow it.)`,
};
const HIDDEN = "(The tab isn't on screen, so what the page loads as you scroll wasn't loaded.)";

// The loader's note goes first; an empty result stays empty, so callers still say "nothing found".
export const withNote = (note: string, out: string) => (out && note ? `${note}\n${out}` : out);

// Reads with read; first loads the page if it adds or swaps in content as you scroll. full: these lines are all the
// output can show, so stop loading. stay: when full, stay there (find: the match is on screen); otherwise the scroll
// position is put back, so the page list and screenshot stay where the model was.
export async function loadWith(page: Page, read: () => string[], full: (lines: string[]) => boolean, stay = false): Promise<{ lines: string[]; note: string }> {
  const first = read();
  const s = page.scroller;
  if (full(first) || !s || s.max() <= 0) return { lines: first, note: '' };
  if (page.hidden) return { lines: first, note: HIDDEN }; // background tabs don't render, so nothing would load
  const start = s.y();
  // Back where it was, settled (seen live: the next page list came mid-redraw and missed the element the model then
  // clicked), then one more read: a page that only added holds everything now, without text that changed while
  // loading ("Loading more" → "End of list"). Only a page that swapped rows out needs the stitch.
  const finish = async (lines: string[], note: string, here = false) => {
    if (!here) s.to(start);
    await page.wait();
    const last = read();
    return { lines: newLines(last, lines) < MIN_NEW ? last : lines, note };
  };
  // Probe: one jump to the bottom. A normal page shows no new text there, and is read as it is.
  const before = page.text();
  s.to(s.max());
  await page.wait();
  if (newLines(before, page.text()) < MIN_NEW) return finish(first, '');
  // Lazy page: top to bottom, a screen at a time, reading and stitching at every stop.
  const t0 = page.now();
  let lines = first;
  let screens = 0;
  let stop: Stop = '';
  for (let y = 0; !stop; y = s.y() + s.screen() * STEP) {
    s.to(y);
    await page.wait();
    lines = stitch(lines, read());
    screens++;
    let atBottom = s.y() >= s.max() - 1;
    // shortcut: a page that loads more after a quiet wait (no spinner, slow network) can look finished; the second
    // wait at the bottom catches most. Upgrade to the panel's network-aware settle if a live run stops short.
    if (atBottom && !full(lines)) {
      await page.wait();
      lines = stitch(lines, read());
      atBottom = s.y() >= s.max() - 1;
    }
    stop = stopReason({ full: full(lines), atBottom, screens, ms: page.now() - t0 });
  }
  return finish(lines, NOTES[stop](screens), stay && stop === 'full');
}

// The real page. shortcut: only the top page is scrolled (frames read what they have); upgrade if lazy lists in iframes show up.
function domPage(): Page {
  const el = window.top === window ? mainScroller() : null;
  return {
    scroller: el && {
      y: () => el.scrollTop,
      max: () => el.scrollHeight - el.clientHeight,
      screen: () => el.clientHeight,
      // instant: a site's CSS smooth scrolling would otherwise animate each stop.
      // Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTo
      to: (y) => el.scrollTo({ top: y, behavior: 'instant' }),
    },
    // Source: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
    hidden: document.visibilityState === 'hidden',
    text: () => readText(true).split('\n'),
    now: () => Date.now(),
    wait: () => waitForQuiet(STOP_MS),
  };
}

export const loadPage = (read: () => string[], full: (lines: string[]) => boolean, stay = false) => loadWith(domPage(), read, full, stay);
