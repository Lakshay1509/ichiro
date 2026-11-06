// Lazy pages (F3d): before text all, pick and find read, load what the page adds (or swaps in) only as you scroll.
// Like Crawl4AI's scan_full_page + virtual scroll: scroll a screen at a time, read at each stop, stitch the reads.
// Sources: https://docs.crawl4ai.com/advanced/lazy-loading/ · https://docs.crawl4ai.com/advanced/virtual-scroll/
import { mainScroller } from '../actions/actions.ts';
import { addedLines, boxText, readText, readTextWith, shownPieces, TEXT_CAP } from './page-text.ts';
import { allElements, getElements, deepContains, label, ranges, scrollsDown, visibleCenter } from './reader.ts';
import { waitForQuiet } from '../tabs/settle.ts';

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

// The note for each way a pass ends. n: screens scrolled; lines: what was read.
export type Notes = Record<Exclude<Stop, ''>, (n: number, lines: string[]) => string>;
const NOTES: Notes = {
  bottom: (n) => `(This page loads more as you scroll: I scrolled ${n} screens to the end, so this covers the whole page.)`,
  full: (n) => `(This page loads more as you scroll: I scrolled ${n} screens and stopped once I had enough.)`,
  cap: (n) => `(This page keeps loading more as you scroll: I stopped after ${n} screens. Use the site's search, filters or sort to narrow it.)`,
};
const HIDDEN = "(The tab isn't on screen, so what the page loads as you scroll wasn't loaded.)";

// The loader's note goes first; an empty result stays empty, so callers still say "nothing found".
export const withNote = (note: string, out: string) => (out && note ? `${note}\n${out}` : out);

// Reads with read; first loads the page if it adds or swaps in content as you scroll. full: these lines are all the
// output can show, so stop loading. stay: when full, stay there (find: the match is on screen); otherwise the scroll
// position is put back, so the page list and screenshot stay where the model was. notes: what to say once it scrolled
// through (#1: a box, not the page); no note means it wasn't scrolled through.
export async function loadWith(page: Page, read: () => string[], full: (lines: string[]) => boolean, stay = false, notes = NOTES): Promise<{ lines: string[]; note: string }> {
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
  // From the top only, not from the first read: scrolled down (an editor mid-file), that read doesn't overlap the top's,
  // and the stitch put its lines before the top's. Every line is read again on the way down.
  let lines: string[] = [];
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
  // Stopped before the end (a cap, or enough read): what was on screen may lie further down than the pass got, deep in
  // a feed. Kept, after what the pass read.
  if (stop !== 'bottom') lines = stitch(lines, first);
  return finish(lines, notes[stop](screens, lines), stay && stop === 'full');
}

// The real page, scrolled by el (the page's own scroller, or a box that scrolls on its own), its text read by text.
// shortcut: only the top page is scrolled (frames read what they have); upgrade if lazy lists in iframes show up.
function domPage(el: Element | null, text: () => string[]): Page {
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
    text,
    now: () => Date.now(),
    wait: () => waitForQuiet(STOP_MS),
  };
}

export const loadPage = (read: () => string[], full: (lines: string[]) => boolean, stay = false) =>
  loadWith(domPage(window.top === window ? mainScroller() : null, () => readText(true).split('\n')), read, full, stay);

// #1: a box's text in the page covers this little of its height (text height over scroll height), or less: most of its
// lines aren't in the page, so it may keep only the ones near the screen. A box with all its text in the page covers
// nearly all of it, and isn't scrolled at all (scrolling a chat or a feed can mark it read or load more). Pure.
export const MOSTLY_EMPTY = 0.7;
export const looksVirtual = (textTop: number, textBottom: number, scrollHeight: number) =>
  scrollHeight > 0 && (textBottom <= textTop || (textBottom - textTop) / scrollHeight < MOSTLY_EMPTY);

// The height its text spans in the page now, from the first line's top to the last line's bottom.
function textSpan(box: Element): { top: number; bottom: number } {
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of shownPieces(box, true)) {
    top = Math.min(top, p.first.top);
    bottom = Math.max(bottom, p.last.bottom);
  }
  return { top, bottom };
}

// #1: the boxes text all scrolls through itself: up to 3 that scroll up and down on their own, show on screen, are big
// (a tenth of the screen or more) and look virtual (looksVirtual), biggest first, none inside another; never the page's
// own scroller (loadPage's). Seen live (Overleaf, CodeMirror): a code editor keeps only the lines near the screen in
// the page, so text all read 21 of 240 lines. Each is still probed (loadWith): one jump to its end must show new lines.
const MAX_BOXES = 3;
function boxesToRead(): Element[] {
  const page = mainScroller();
  const area = (el: Element) => el.clientWidth * el.clientHeight;
  const virtual = (el: Element) => {
    const span = textSpan(el);
    return looksVirtual(span.top, span.bottom, el.scrollHeight);
  };
  const big = [...allElements(document.body)]
    .filter((el) => el !== page && area(el) * 10 >= innerWidth * innerHeight && scrollsDown(el) && visibleCenter(el) && virtual(el))
    .sort((a, b) => area(b) - area(a));
  const boxes: Element[] = [];
  for (const el of big) if (boxes.length < MAX_BOXES && !boxes.some((b) => deepContains(b, el) || deepContains(el, b))) boxes.push(el);
  return boxes;
}

// What a box's note calls it: its label, and the elements of the latest read inside it.
function boxName(box: Element): string {
  const named = label(box).slice(0, 40);
  const nums = [...getElements()].flatMap(([n, el]) => (deepContains(box, el) ? [n] : []));
  return ['A box', named && JSON.stringify(named), nums.length && `(holding ${ranges(nums)})`].filter(Boolean).join(' ');
}

// What text all says about a box it scrolled through: where, how far, and that it was put back.
const boxNotes = (box: Element): Notes => {
  const said = (how: string) => (n: number, lines: string[]) => `(${boxName(box)} keeps only the lines near the screen: I scrolled it ${n} screens and read ${lines.length} lines${how}. Its scroll is put back.)`;
  return { bottom: said(', all of it'), full: said(', as many as one reply holds: find reaches the rest'), cap: said(', then stopped at the cap: find reaches the rest') };
};

// text all (F3a, F3d, #1): the whole page's text. A page that loads as you scroll is scrolled through first; else each
// big box that keeps only its lines near the screen is, and its lines take its place in the page's text.
export async function wholeText(): Promise<string> {
  const full = (lines: string[]) => lines.join('\n').length >= TEXT_CAP;
  const { lines, note } = await loadPage(() => readText(true).split('\n'), full);
  if (note || window.top !== window) return withNote(note, lines.join('\n'));
  const swap = new Map<Element, string[]>();
  const notes: string[] = [];
  for (const box of boxesToRead()) {
    const read = () => boxText(box).split('\n');
    const r = await loadWith(domPage(box, read), read, full, false, boxNotes(box));
    if (!r.note) continue; // not scrolled through: its lines were all in the page
    swap.set(box, r.lines);
    notes.push(r.note);
  }
  return swap.size ? withNote(notes.join('\n'), readTextWith(swap)) : lines.join('\n');
}
