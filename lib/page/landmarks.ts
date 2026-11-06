// Landmarks (#6): a page's nav, sidebar and header. On dashboard apps (Supabase, Vercel, AWS) they list the same ~40
// links in every read, often more than the page's own content: once the agent got one in full on a site, a later page
// list says it in one line while its elements are the same. Their numbers and labels still work.
import { pageLinesIn, type Item } from './page-text.ts';
import { deepContains, keyOf, label, panelOnTop, parentOf, ranges } from './reader.ts';

// One landmark in a read: key (which one, the same across pages of a site), title (for its line), sig (its elements,
// by role and name: unchanged means the same), nums (their numbers), and its lines [start, end) in the read's text.
export type Landmark = { key: string; title: string; sig: string; nums: number[]; start: number; end: number };

// Fewer elements than this aren't worth a line of their own.
export const MIN_ELEMENTS = 5;

// ARIA's navigation, complementary and banner landmarks. A header is the banner only outside these.
// Source: https://www.w3.org/TR/html-aam-1.0/#el-header (and #el-aside, #el-nav)
const KINDS: [string, string][] = [
  ['nav, [role=navigation]', 'Navigation'],
  ['aside, [role=complementary]', 'Sidebar'],
  ['header, [role=banner]', 'Header'],
];
const SECTIONING = 'article, aside, main, nav, section, [role=article], [role=complementary], [role=main], [role=navigation], [role=region]';

// What kind of landmark el is, or ''.
function kindOf(el: Element): string {
  const kind = KINDS.find(([selector]) => el.matches(selector))?.[1] ?? '';
  if (kind === 'Header' && !el.matches('[role=banner]') && parentOf(el)?.closest(SECTIONING)) return '';
  return kind;
}

// The outermost landmark around node (itself included), or null. cache: per read.
function outermost(node: Node, cache: Map<Element, Element | null>): Element | null {
  const start = node instanceof Element ? node : parentOf(node);
  if (!start) return null;
  if (cache.has(start)) return cache.get(start)!;
  const above = parentOf(start);
  const outer = above ? outermost(above, cache) : null;
  const found = outer ?? (kindOf(start) ? start : null);
  cache.set(start, found);
  return found;
}

// The page list's lines for this frame (pageLines), and its landmarks with at least MIN_ELEMENTS of the listed elements.
// Top page only. Not the panel on top, or one around it: a menu the agent just opened is what it came to see.
export function landmarkLines(items: Item[], elements: Map<number, Element>): { lines: string[]; landmarks: Landmark[] } {
  if (window !== window.top) return { lines: pageLinesIn(items, () => -1).lines, landmarks: [] };
  const panel = panelOnTop();
  const cache = new Map<Element, Element | null>();
  const boxes: Element[] = [];
  const groups = items.map((item) => {
    const box = item.at ? outermost(item.at, cache) : null;
    if (!box || (panel && (deepContains(panel, box) || deepContains(box, panel)))) return -1;
    const g = boxes.indexOf(box);
    return g >= 0 ? g : boxes.push(box) - 1;
  });
  const { lines, ranges: at } = pageLinesIn(items, (i) => groups[i]!);
  const taken = new Map<string, number>();
  const landmarks = boxes.flatMap((box, g) => {
    const range = at.get(g);
    const listed = [...elements].filter(([, el]) => deepContains(box, el));
    if (!range || listed.length < MIN_ELEMENTS) return [];
    const named = label(box).slice(0, 40);
    const title = `${kindOf(box)}${named ? ` ${JSON.stringify(named)}` : ''}`;
    const nth = (taken.get(title) ?? 0) + 1; // a second sidebar with no name is another one
    taken.set(title, nth);
    return [{ key: `${title} #${nth}`, title, sig: listed.map(([, el]) => keyOf(el)).join('\n'), nums: listed.map(([n]) => n), ...range }];
  });
  return { lines, landmarks };
}

// The one line a landmark is shortened to. Ours, not page text: the page's own words in it (its label) are quoted. Pure.
export const shortLine = (l: Landmark) =>
  `${l.title}: ${l.nums.length} elements (${ranges(l.nums)}), the same as you got before on this site — read all lists them`;

// A page list's text with each landmark the agent got before (seen: key → sig) shortened to one line, while its
// elements are the same. shown: the landmarks still printed in full, to remember once this is sent. Pure.
export function shorten(text: string, landmarks: Landmark[], seen: Map<string, string>): { text: string; shown: [string, string][] } {
  const lines = text.split('\n');
  const shown: [string, string][] = [];
  for (const l of [...landmarks].sort((a, b) => b.start - a.start)) {
    if (seen.get(l.key) === l.sig && l.end > l.start) lines.splice(l.start, l.end - l.start, shortLine(l));
    else shown.push([l.key, l.sig]);
  }
  return { text: lines.join('\n'), shown };
}
