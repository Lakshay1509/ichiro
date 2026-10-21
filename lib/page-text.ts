// Page text: the plain text on screen (dates, prices, ratings) for text, find and the AI's page view. Runs in the content script.
import {
  clickable, clippedCenter, cut, deepContains, deepElementFromPoint, describe, getElements, ICON_GLYPHS, name, parentOf, type Room, shadowRootOf,
  sideways,
} from './reader.ts';

// Where a text node starts and ends on screen: its first and last line box.
type Box = { top: number; bottom: number; left: number; right: number };
export type Piece = { text: string; first: Box; last: Box };

// Joins pieces (in DOM order) into lines. Same line: glued only if they touch, else a space (table cells, overlapping
// hidden labels). Lower: new line.
export function joinLines(pieces: Piece[]): string {
  let out = '';
  pieces.forEach((p, i) => {
    const prev = pieces[i - 1]?.last;
    if (prev) {
      const sameLine = p.first.top < prev.bottom && p.first.bottom > prev.top;
      out += !sameLine ? '\n' : Math.abs(p.first.left - prev.right) > 1 ? ' ' : '';
    }
    out += p.text.replace(ICON_GLYPHS, '').replace(/\s+/g, ' ');
  });
  return out.split('\n').map((line) => line.replace(/ +/g, ' ').trim()).filter(Boolean).join('\n');
}

// Screen-reader-only boxes: absolute, 1 px or less, clipping what's inside. Their text reports full-size rects, so
// check the box. Absolute only, so a 0-height <body> with overflow:hidden (scroll lock) doesn't hide the whole page.
// Covers Tailwind's sr-only (Source: https://tailwindcss.com/docs/display) and Amazon's hidden price copies.
function clippedAway(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width > 1 && r.height > 1) return false;
  const s = getComputedStyle(el);
  return s.position === 'absolute' && (s.overflow !== 'visible' || s.clipPath !== 'none' || s.clip !== 'auto');
}

// An icon's name, for text: its aria-label, else its <title>, spaces collapsed, cut short (it's page-written text
// nobody sees, so it can't carry a paragraph). Pure.
export const iconText = (label: string | null, title: string | null | undefined) => cut((label || title || '').replace(/\s+/g, ' ').trim(), 40);

// The name of an icon alone in its box ('' if el isn't one): Bruno's pricing table marks yes with
// <svg aria-label="Included"> and no with "–", so without it a yes cell reads blank. Decorative (aria-hidden) ones stay out.
function iconName(el: Element): string {
  const box = parentOf(el);
  if (!el.matches('svg, [role=img]') || el.closest('[aria-hidden=true]') || !(box instanceof HTMLElement) || box.innerText.trim()) return '';
  return iconText(el.getAttribute('aria-label'), el.querySelector('title')?.textContent);
}

// Every text node under root in DOM order, shadow roots included, skipping screen-reader-only boxes. icons: also
// named icons alone in their box (see iconName), in their place.
// shortcut: a component's own text comes before its slotted children, not where the <slot> puts them. Upgrade if web-component pages read out of order.
function textNodes(root: Node): Generator<Text>;
function textNodes(root: Node, icons: boolean): Generator<Text | Element>;
function* textNodes(root: Node, icons = false): Generator<Text | Element> {
  for (const child of root.childNodes) {
    if (child instanceof Text) yield child;
    else if (child instanceof Element && !clippedAway(child)) {
      if (icons && iconName(child)) {
        yield child;
        continue;
      }
      const shadow = shadowRootOf(child);
      if (shadow) yield* textNodes(shadow, icons);
      yield* textNodes(child, icons);
    }
  }
}

// One rect per line the text wraps onto (an icon: its box), in viewport coordinates. Hidden ones (display:none) have none.
function lineBoxes(range: Range, node: Text | Element): DOMRect[] {
  if (node instanceof Text) range.selectNodeContents(node);
  return [...(node instanceof Text ? range : node).getClientRects()].filter((r) => r.width > 0 && r.height > 0);
}

// A lone decimal point or comma. Amazon draws ₹424¹⁵ with its "." at opacity 0: dropping it reads ₹42415 (seen live).
const SEPARATOR = /^\s*[.,]\s*$/;

// Unlike read, opacity 0 counts as hidden: invisible text can't be read (or plant instructions). Shared by text and find.
// Except a lone separator: one character can't plant anything, and without it a price is silently wrong.
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility
// An icon (see iconName) is checked itself.
const isShown = (node: Text | Element) => node instanceof Text
  ? !!parentOf(node)?.checkVisibility({ opacityProperty: !SEPARATOR.test(node.data), visibilityProperty: true })
  : node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
const seeThrough = (node: Text | Element) => node instanceof Text && SEPARATOR.test(node.data) && !parentOf(node)?.checkVisibility({ opacityProperty: true });

// A piece from a text's line boxes. A see-through separator takes no room: Amazon lays its "." over the fraction, so
// at full width the join would read "424. 15". Pure.
export function toPiece(text: string, rects: Box[], noRoom = false): Piece {
  const first = rects[0]!;
  const dot = { top: first.top, bottom: first.bottom, left: first.left, right: first.left };
  return noRoom ? { text, first: dot, last: dot } : { text, first, last: rects.at(-1)! };
}

// A box that scrolls sideways (a wide table): where it is, and how far it can still scroll each way.
export type SideBox = { rect: Box; room: Room };

// Left to right, r is on the screen (width wide), or within reach of the sideways box it sits in (the box widened by
// its room: what scrolling it shows), that box across by the same rule. Seen live: a weather table's last columns sat
// right of the screen, so text missed them while find had them. boxes: innermost first, only asked for when r is off
// screen. Pure.
export function across(r: Box, width: number, boxes: () => SideBox[] = () => []): boolean {
  if (r.right > 0 && r.left < width) return true;
  const [box, ...outer] = boxes();
  return !!box && r.right > box.rect.left - box.room.left && r.left < box.rect.right + box.room.right && across(box.rect, width, () => outer);
}

const onScreen = (r: DOMRect, boxes?: () => SideBox[]) => r.bottom > 0 && r.top < innerHeight && across(r, innerWidth, boxes);

// F3a: anywhere down the page, but not pushed off it (left:-9999px, top:-9999px hide text from sighted readers).
// r is in viewport coordinates, so scrollY puts it back on the page.
export const onPage = (r: Box, width: number, scrollY: number, boxes?: () => SideBox[]) => r.bottom + scrollY > 0 && across(r, width, boxes);

// The boxes el sits in (itself included) that scroll sideways, innermost first. Not the page itself: text pushed right
// of it stays out (F3a). cache: per walk, since text nodes share boxes. Rects are viewport coordinates, like the text's.
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect
function sideBoxes(el: Element | null, cache: Map<Element, SideBox[]>): SideBox[] {
  if (!el || el === document.body || el === document.documentElement) return [];
  let boxes = cache.get(el);
  if (!boxes) {
    const room = sideways(el);
    boxes = [...(room ? [{ rect: el.getBoundingClientRect(), room }] : []), ...sideBoxes(parentOf(el), cache)];
    cache.set(el, boxes);
  }
  return boxes;
}

// The text command's words, written by the AI, so anything else is refused: text (the screen), text all (the whole
// page), text page N (a PDF from page N on, P2; the caller refuses it on other tabs).
export function textArgs(args: string[]): { all: boolean; page?: number } {
  const [mode, n, ...rest] = args;
  if (mode === undefined) return { all: false };
  if (mode === 'all' && n === undefined) return { all: true };
  if (mode === 'page' && n !== undefined && /^[1-9]\d{0,3}$/.test(n) && !rest.length) return { all: true, page: Number(n) };
  throw new Error('Usage: text, text all, or text page N on a PDF tab');
}

// text all can be a whole article: cut so one read can't flood the AI's next turn (~3k tokens).
export const TEXT_CAP = 12_000;
export const capText = (text: string) =>
  text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}\n… ${text.length - TEXT_CAP} more characters: use find to jump to what you need` : text;

// The visible text pieces under root, by text's rules: shown, not screen-reader-only, on screen (all: anywhere on the
// page, F3a; a box that scrolls sideways counts whole while it's on screen). Text behind a modal is still included (no
// hit test, so pointer-events:none text isn't lost). A named icon alone in its box is a piece too: its name.
export function* shownPieces(root: Node, all: boolean): Generator<Piece & { node: Text | Element }> {
  const range = document.createRange();
  const sides = new Map<Element, SideBox[]>();
  for (const node of textNodes(root, true)) {
    const text = node instanceof Text ? node.data : iconName(node);
    if (!text.trim()) continue;
    const boxes = () => sideBoxes(parentOf(node), sides);
    const shown = (r: DOMRect) => (all ? onPage(r, innerWidth, scrollY, boxes) : onScreen(r, boxes));
    const rects = lineBoxes(range, node);
    if (rects.some(shown) && isShown(node)) yield { ...toPiece(text, rects, seeThrough(node)), node };
  }
}

// The visible text in the viewport (all: the whole page), as lines. except: leave out the text inside it (F4b: a typed
// field's own text isn't the page reacting).
export const readText = (all = false, except?: Node) =>
  joinLines([...shownPieces(document.documentElement, all)].filter((p) => !except?.contains(p.node)));

// Lines in after that before doesn't have, repeats counted. Pure.
export function addedLines(before: string[], after: string[]): string[] {
  const left = new Map<string, number>();
  for (const l of before) left.set(l, (left.get(l) ?? 0) + 1);
  return after.filter((l) => {
    const k = left.get(l) ?? 0;
    if (k) left.set(l, k - 1);
    return !k;
  });
}

// F4b: how the screen's text changed after typing, for the type result's first line (the line history keeps). Page
// text, so each line is quoted and cut; at most 3 each way. Pure.
const REACTION_LINES = 3;
const quoted = (lines: string[]) => [
  ...lines.slice(0, REACTION_LINES).map((l) => JSON.stringify(cut(l, 80))),
  ...(lines.length > REACTION_LINES ? [`+${lines.length - REACTION_LINES} more`] : []),
].join(' · ');
export const NO_REACTION = "the page didn't react (no other text on screen changed): the site may not have taken it";
// field: what was typed into it and its value now. The site changing it (a money field that reformats, "200" → "$200")
// is a reaction too: seen live, every type into one said NO_REACTION. Emptied isn't: that's the value refused (a number
// field empties what isn't a number). Source: https://html.spec.whatwg.org/multipage/input.html (value sanitization)
export function reaction(before: string[], after: string[], field?: { typed: string; now: string }): string {
  const now = addedLines(before, after);
  const was = addedLines(after, before);
  const changes = [
    now.length ? `now ${quoted(now)}${was.length ? `, was ${quoted(was)}` : ''}` : was.length ? `${quoted(was)} gone` : '',
    field?.now && field.now !== field.typed ? `the site changed the field: ${quoted([field.typed])} → ${quoted([field.now])}` : '',
  ].filter(Boolean);
  return changes.length ? `page changed: ${changes.join('; ')}` : NO_REACTION;
}

// F2: what the AI reads each step, like browser-use's page view: the listed elements with the visible text around them,
// in page order, so a cinema's name sits right above its showtimes. An item is an element (its read line and name) or
// a text piece with the name of the listed element it's inside ('' if none).
export type Item = { line: string; name: string } | (Piece & { owner: string });
const MAX_TEXT = 100; // characters per text line
export const MAX_TEXT_LINES = 150; // per frame: a wall of text (a long article) is what text and find are for

// Items → lines. Pure, so Node can test it. Text lines are always quoted: page text can never pass for an element
// line ("[5] button …"), which the model and our code (page-diff, loop guard, labels) trust. Text an element line already
// says is dropped: what's inside the element (its name) and a label right next to it.
export function pageLines(items: Item[]): string[] {
  const out: string[] = [];
  let pieces: Piece[] = [];
  let above = ''; // name of the element just before the pending text
  let texts = 0;
  const flush = (below: string) => {
    for (const line of joinLines(pieces).split('\n')) {
      if (!line || line === above || line === below) continue;
      if (texts++ < MAX_TEXT_LINES) out.push(JSON.stringify(cut(line, MAX_TEXT)));
    }
    pieces = [];
  };
  for (const item of items) {
    if ('line' in item) {
      flush(item.name);
      out.push(item.line);
      above = item.name;
    } else if (!item.owner.includes(item.text.replace(ICON_GLYPHS, '').replace(/\s+/g, ' ').trim())) {
      pieces.push(item);
    }
  }
  flush('');
  if (texts > MAX_TEXT_LINES) out.push(`(${texts - MAX_TEXT_LINES} more lines of text on screen not shown: use text or find)`);
  return out;
}

// el, or a box it sits in, is pinned to the screen (sticky header, fixed popup or banner). Cached per read.
function pinned(el: Element | null, cache: Map<Element, boolean>): boolean {
  if (!el) return false;
  let pin = cache.get(el);
  if (pin === undefined) {
    pin = /^(fixed|sticky)$/.test(getComputedStyle(el).position) || pinned(parentOf(el), cache);
    cache.set(el, pin);
  }
  return pin;
}

// Text under a sticky header or behind a popup: unreadable, and in page order it would sit above the wrong section
// (seen live: a hidden "02:35 PM" above the next cinema). Covered only by something pinned: a card's invisible
// full-size link (a "stretched link") also wins the hit test, and its card's text must stay. A hit on the text's own
// ancestor counts as shown: pointer-events:none text lets the test fall through to it.
function uncovered(node: Text, rects: DOMRect[], pins: Map<Element, boolean>): boolean {
  const parent = parentOf(node);
  return !!parent && rects.some((r) => {
    const p = clippedCenter(r);
    const hit = p && deepElementFromPoint(p.x, p.y);
    return !!p && (!hit || deepContains(hit, parent) || deepContains(parent, hit) || !pinned(hit, pins));
  });
}

// The items for this frame: elements is read's number → element map, lines its element lines in the same order.
// Same text rules as readText (on screen, not hidden, not screen-reader-only) plus not covered; same walk order as the
// reader's numbers.
export function pageItems(elements: Map<number, Element>, lines: string[]): Item[] {
  const listed = new Map([...elements.values()].map((el, i) => [el, { line: lines[i]!, name: name(el) }]));
  const range = document.createRange();
  const pins = new Map<Element, boolean>();
  const items: Item[] = [];
  const walk = (root: Node, owner: string) => {
    for (const child of root.childNodes) {
      if (child instanceof Text) {
        if (!child.data.trim()) continue;
        const rects = lineBoxes(range, child);
        if (rects.some(onScreen) && isShown(child) && uncovered(child, rects, pins)) items.push({ ...toPiece(child.data, rects, seeThrough(child)), owner });
      } else if (child instanceof Element && !clippedAway(child)) {
        const own = listed.get(child);
        if (own) {
          items.push(own);
          listed.delete(child);
        }
        const shadow = shadowRootOf(child);
        if (shadow) walk(shadow, own?.name ?? owner);
        walk(child, own?.name ?? owner);
      }
    }
  };
  walk(document.documentElement, '');
  // A listed element the walk can't reach (inside a screen-reader-only box) still gets its line.
  items.push(...listed.values());
  return items;
}

// R1: which texts read exactly want (spaces collapsed, icon glyphs dropped), else the ones that do ignoring case. Pure.
const flat = (s: string) => s.replace(ICON_GLYPHS, '').replace(/\s+/g, ' ').trim();
export function sameText(texts: string[], want: string): number[] {
  const w = flat(want);
  if (!w) return [];
  const flats = texts.map(flat);
  for (const same of [(t: string) => t === w, (t: string) => t.toLowerCase() === w.toLowerCase()]) {
    const hits = flats.flatMap((t, i) => (same(t) ? [i] : []));
    if (hits.length) return hits;
  }
  return [];
}

// R1: the elements holding a shown text that reads exactly want, anywhere on the page (live, the one meant sat below the
// screen), by the page list's rules: not hidden, not screen-reader-only, and on screen not covered by something pinned
// (the click checks again once it's scrolled to). Each says if it's clickable and on screen, for chooseText.
// shortcut: one text node each, so text split across tags ("Apply <b>now</b>") doesn't match; upgrade if a run needs it.
export type Found = { clickable: boolean; onScreen: boolean };
export function textTargets(want: string): (Found & { el: Element })[] {
  const range = document.createRange();
  const pins = new Map<Element, boolean>();
  const screen = new Map<Text, boolean>();
  const shown = [...textNodes(document.documentElement)].filter((n) => {
    if (!sameText([n.data], want).length) return false; // cheap test first: most text never matches
    const rects = lineBoxes(range, n);
    screen.set(n, rects.some(onScreen));
    return isShown(n) && (screen.get(n) ? uncovered(n, rects, pins) : rects.some((r) => onPage(r, innerWidth, scrollY)));
  });
  const els = new Map(sameText(shown.map((n) => n.data), want).map((i) => [parentOf(shown[i]!)!, screen.get(shown[i]!)!]));
  return [...els].map(([el, onScreen]) => ({ el, onScreen, clickable: clickable(el) }));
}

// R1: which of several shown texts a click "text" means: the one clickable one (live: a pricing toggle below the screen
// beat a hero stat with its words), else the one on screen. Still two (or none) → throws: never guess. note: '' for a
// lone text, else how many there were and which one was clicked, for the result. Pure.
export function chooseText(found: Found[], want: string): { i: number; note: string } {
  const which = (keep: (f: Found) => boolean) => found.flatMap((f, i) => (keep(f) ? [i] : []));
  const clickables = which((f) => f.clickable);
  const [i, ...rest] = found.length === 1 ? [0] : clickables.length ? clickables : which((f) => f.onScreen);
  const q = JSON.stringify(want);
  if (i === undefined || rest.length) throw new Error(`${found.length} shown texts read ${q}: click a numbered element or a longer text`);
  const picked = clickables.length ? 'the clickable one' : 'the one on screen';
  return { i, note: found.length > 1 ? ` — ${found.length} texts read ${q}, clicked ${picked}; for another, scroll to it, read, and use its number` : '' };
}

const SHOWN_MATCHES = 5;
const CONTEXT = 40; // characters of snippet on each side of a match
const AFTER_CAP = 200; // characters after a match at most, when its sentence runs on past the context

// Where a snippet cut at `at` should end: the end of the sentence it falls in (a . ! ? before a space, so "4.5" isn't
// one), at most cap. Seen live: a cut mid-sentence hid the number the agent needed ("salary range … based on the pr…").
function sentenceEnd(text: string, at: number, cap: number): number {
  const stop = /[.!?。](?=\s|$)/g;
  // exec on a /g regex starts at lastIndex. Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/lastIndex
  stop.lastIndex = at - 1; // a cut right after a sentence's end stays there
  const found = stop.exec(text);
  return Math.min(found ? found.index + 1 : text.length, cap, text.length);
}

// Finds query in text pieces (DOM order), ignoring case and all spaces: "16 GB" matches "16GB", also across pieces
// ("16<b>GB</b>"). Returns the piece each match starts in and a readable snippet around it (context characters on each
// side, then on to the end of the sentence). Pure, so Node can test it.
export function findMatches(pieces: string[], query: string, context = CONTEXT): { piece: number; snippet: string }[] {
  // text: the pieces joined readably. key: text without spaces, lowercased; starts/ends/pieceOf map each key unit back.
  let text = '';
  let key = '';
  const starts: number[] = [];
  const ends: number[] = [];
  const pieceOf: number[] = [];
  pieces.forEach((p, i) => {
    const clean = p.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (text) text += ' ';
    for (const ch of clean) {
      // Lowercasing can lengthen a character (İ → i̇): every unit maps back to the same character.
      if (ch !== ' ') for (const unit of ch.toLowerCase()) {
        key += unit;
        starts.push(text.length);
        ends.push(text.length + ch.length);
        pieceOf.push(i);
      }
      text += ch;
    }
  });
  const needle = query.replace(/\s+/g, '').toLowerCase();
  const matches: { piece: number; snippet: string }[] = [];
  if (!needle) return matches;
  for (let k = key.indexOf(needle); k !== -1; k = key.indexOf(needle, k + needle.length)) {
    const start = starts[k]!;
    const end = ends[k + needle.length - 1]!;
    const from = Math.max(0, start - context);
    const to = sentenceEnd(text, end + context, end + Math.max(context, AFTER_CAP));
    matches.push({ piece: pieceOf[k]!, snippet: `${from ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}` });
  }
  return matches;
}

// Section names for a find that missed: ones sharing a word with the query first ("Technical Specifications" puts
// "Technical Details" on top), then the rest in page order. Blank, repeated and long ones (marketing copy) are dropped.
export function rankSections(names: string[], query: string, max = 30): string[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const unique = [...new Set(names.map((n) => n.replace(/\s+/g, ' ').trim()))].filter((n) => n && n.length <= 60);
  const shares = (n: string) => words.some((w) => n.toLowerCase().includes(w));
  return [...unique.filter(shares), ...unique.filter((n) => !shares(n))].slice(0, max);
}

// Section headings and open/close buttons (accordions, "See more", <summary>) on the whole page, as their visible text,
// so a next find can match it. Sites mark these for screen readers, so no site-specific code. Hidden ones are skipped.
// shortcut: doesn't look inside shadow roots or iframes; upgrade if a site's sections live there.
const SECTIONS = 'h1, h2, h3, h4, [role=heading], summary, [aria-expanded]';
function sectionNames(): string[] {
  return [...document.querySelectorAll(SECTIONS)].filter(shownElement).map((el) => (el instanceof HTMLElement ? el.innerText : ''));
}

// An element a person can see somewhere on the page: has size, not hidden (opacity 0 counts), not screen-reader-only.
export function shownElement(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  for (let a: Element | null = el; a; a = parentOf(a)) if (clippedAway(a)) return false;
  return true;
}

// The text find searches: shown, anywhere on the page, top frame.
function searchable(): Text[] {
  const range = document.createRange();
  const nodes: Text[] = [];
  for (const node of textNodes(document.documentElement)) {
    if (node.data.trim() && lineBoxes(range, node).length && isShown(node)) nodes.push(node);
  }
  return nodes;
}
// A listed element's name matches query, and the element holds no text match (that one was found already). Seen live:
// find "Navy" missed clickable "Navy Blue", a color swatch named only by its label. Pure.
export const nameHit = (name: string, query: string, holdsMatch: () => boolean) => findMatches([name], query).length > 0 && !holdsMatch();

// find's matches: in the page's text, then in the page list's element names; each with the element to scroll to.
function allMatches(query: string): { el: Element | null; snippet: string }[] {
  const nodes = searchable();
  const inText = findMatches(nodes.map((n) => n.data), query).map((m) => ({ el: parentOf(nodes[m.piece]!), snippet: m.snippet }));
  // Still in the page (the read may be older). Source: https://developer.mozilla.org/en-US/docs/Web/API/Node/isConnected
  const named = [...getElements()].filter(([, el]) => el.isConnected && nameHit(name(el), query, () => inText.some((m) => deepContains(el, m.el))));
  return [...inText, ...named.map(([n, el]) => ({ el, snippet: `[${n}] ${describe(el)} (element name)` }))];
}

// F3d: find's matches in what's loaded now, as snippets: what the loader reads while it scrolls a lazy page for find.
export const findSnippets = (query: string) => allMatches(query).map((m) => m.snippet);

// find (3.7d): like Ctrl+F over the whole page's visible text, not only the screen, then the page list's element names
// (a label-only swatch has no text). Scrolls match nth (from 1) to the
// middle of the screen (inner scroll boxes too), so the next read numbers the elements around it. Top frame only.
// A lazy page was already scrolled through by the caller (F3d).
export function findText(query: string, nth: number): string {
  const matches = allMatches(query);
  const rules = '(case and spaces ignored; hidden text and iframes not searched)';
  const what = `${JSON.stringify(query)} ${rules}`;
  // A miss lists the page's sections, so the next find uses their exact words instead of guessing (seen live: 5 guesses
  // on an Amazon product page). Hint first: history keeps only a result's first line.
  if (!matches.length) {
    const sections = rankSections(sectionNames(), query);
    // Pages that load as you scroll were already scrolled through (F3d), so scrolling isn't the tip any more.
    const tip = sections.length
      ? 'Use the exact words of a section listed below, or open a closed section and find again.'
      : 'It may sit in a closed section (open it, then find again) or not be on this page.';
    const list = sections.length ? `Sections on this page, closest first: ${sections.map((s) => JSON.stringify(s)).join(' · ')}` : '';
    // N1: a page of the site rather than words on this one is often one site: search away (live: 12 steps of menus).
    return [`No match for ${JSON.stringify(query)}. ${tip} A page of the site? search "site:" may reach it faster.`, list, rules].filter(Boolean).join('\n');
  }
  if (nth > matches.length) throw new Error(`Only ${matches.length} matches for ${JSON.stringify(query)}; there is no match ${nth}`);
  matches[nth - 1]!.el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const shown = matches.slice(nth - 1, nth - 1 + SHOWN_MATCHES).map((m, i) => `${nth + i}. ${m.snippet}`);
  return [`${matches.length} matches for ${what}. Scrolled to match ${nth}:`, ...shown].join('\n');
}
