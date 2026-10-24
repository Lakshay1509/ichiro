// Reader: turns the page into a list of things a person could click or type into. Runs in the content script.
import type { ReadReply } from '../messages';
import { checkSame, stick } from './numbers.ts';

// Real controls: always kept.
const CONTROLS = [
  'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
  '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=switch]',
  '[role=tab]', '[role=menuitem]', '[role=menuitemcheckbox]', '[role=menuitemradio]',
  '[role=option]', '[role=textbox]', '[role=searchbox]', '[role=combobox]',
  '[role=slider]', '[role=spinbutton]', '[role=treeitem]',
  '[contenteditable=""]', '[contenteditable=true]',
  // Players auto-hide their controls; click or hover the video to bring them back.
  'video',
].join(',');

// Inputs with no text of their own, often with no linked label either (TodoMVC checkboxes, Amazon's styled buttons).
const BARE_INPUTS = 'input[type=checkbox], input[type=radio], input[type=submit], input[type=button], input[type=image]';

// Icon fonts (Google's Material icons, Font Awesome) draw icons as private-use characters: invisible noise in text.
export const ICON_GLYPHS = /[\uE000-\uF8FF]/g;

// Generic clickables: kept only when not inside an element we already collected. R1 adds browser-use's signals that
// need no debugger: any <a> (script menus drop the href) and the ARIA states a toggle or choice carries.
// Source: https://github.com/browser-use/browser-use/blob/main/browser_use/dom/serializer/clickable_elements.py
const GENERIC = '[tabindex]:not([tabindex="-1"]), [onclick], [onmousedown], [onmouseup], a, [aria-expanded], [aria-pressed], [aria-selected], [aria-checked]';

// Only these can host a page's own shadow root. Skipping the rest also skips Chrome's built-in ones (inside <input>, <video>…).
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow
const SHADOW_HOSTS = new Set([
  'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'DIV', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'MAIN', 'NAV', 'P', 'SECTION', 'SPAN',
]);

// The element's shadow root, open or closed (web components hide their buttons in these).
export function shadowRootOf(el: Element): ShadowRoot | null {
  if (!el.tagName.includes('-') && !SHADOW_HOSTS.has(el.tagName)) return null;
  // Unlike el.shadowRoot, this also opens closed roots. Source: https://developer.chrome.com/docs/extensions/reference/api/dom
  return browser.dom.openOrClosedShadowRoot(el as HTMLElement) as ShadowRoot | null;
}

// Parent element, stepping out of a shadow root to its host.
export function parentOf(el: Node): Element | null {
  return el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);
}

// True if node is el or inside it, counting a shadow root's contents as inside its host.
export function deepContains(el: Element, node: Element | null): boolean {
  for (let n = node; n; n = parentOf(n)) if (n === el) return true;
  return false;
}

// elementFromPoint stops at a component's outer element: drill into its shadow root(s) to the real target.
export function deepElementFromPoint(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  while (hit) {
    const inner = shadowRootOf(hit)?.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

// Every element under root in DOM order, with each shadow root's contents right after its host.
export function* allElements(root: ParentNode): Generator<Element> {
  for (const el of root.querySelectorAll('*')) {
    yield el;
    const shadow = shadowRootOf(el);
    if (shadow) yield* allElements(shadow);
  }
}

function hasCollectedAncestor(el: Element, found: Set<Element>): boolean {
  for (let p = parentOf(el); p; p = parentOf(p)) if (found.has(p)) return true;
  return false;
}

// Everything clickable or typeable, in DOM order (the order the numbers follow), shadow roots included.
export function findInteractive(): Element[] {
  const found = new Set<Element>();
  if (!document.body) return [];
  // DOM order, so ancestors (and shadow hosts) are always checked before what's inside them.
  for (const el of allElements(document.body)) {
    if (el.matches(CONTROLS)) found.add(el);
    else if (hasCollectedAncestor(el, found)) continue;
    // cursor is inherited, so the outermost pointer element is collected and its children skip via the line above.
    else if (el.matches(GENERIC) || getComputedStyle(el).cursor === 'pointer') found.add(el);
  }
  return [...found];
}

// el can be clicked by findInteractive's rules: a control or generic clickable, itself or around it, or a pointer cursor.
export const clickable = (el: Element) => !!el.closest(`${CONTROLS},${GENERIC}`) || getComputedStyle(el).cursor === 'pointer';

// Center of the part of rect r inside the viewport, or null if none of it is (also null for zero size).
export function clippedCenter(r: DOMRect): { x: number; y: number } | null {
  const left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
  const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
  if (left >= right || top >= bottom) return null;
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

// Center of the part of el inside the viewport, or null if none of it is.
export function visibleCenter(el: Element): { x: number; y: number } | null {
  return clippedCenter(el.getBoundingClientRect());
}

// A point where a click lands on el itself, or null if it's covered (modal, cookie banner) or off screen.
// Tries the center first, then each line of a link that wraps: its overall center can fall between the lines.
export function clickPoint(el: Element): { x: number; y: number } | null {
  for (const r of [el.getBoundingClientRect(), ...el.getClientRects()]) {
    const p = clippedCenter(r);
    if (p && deepContains(el, deepElementFromPoint(p.x, p.y))) return p;
  }
  return null;
}

// True if a person could see and reach the element right now: has size, not hidden, in the viewport, not covered.
export function isVisible(el: Element): boolean {
  // Real controls at opacity 0 are kept: custom checkboxes (TodoMVC) and auto-hidden player controls (YouTube) are
  // invisible but still clickable. Generic ones (tabindex, pointer cursor) at opacity 0 are focus traps and leftovers.
  // Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility
  const opacityProperty = !el.matches(CONTROLS);
  return el.checkVisibility({ opacityProperty, visibilityProperty: true }) && clickPoint(el) !== null;
}

const INPUT_ROLES: Record<string, string> = {
  text: 'textbox', email: 'textbox', tel: 'textbox', url: 'textbox', password: 'textbox',
  search: 'searchbox', checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
  submit: 'button', button: 'button', reset: 'button', image: 'button',
};

// What the element is, like a screen reader would say it.
export function role(el: Element): string {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  // Other input types (date, file, color…) keep their type: more useful than "clickable".
  if (el instanceof HTMLInputElement) return INPUT_ROLES[el.type] ?? el.type;
  if (el.matches('a[href]')) return 'link';
  if (el.matches('button, summary')) return 'button';
  if (el.matches('select')) return 'combobox';
  if (el.matches('video')) return 'video';
  if (el.matches('textarea') || (el instanceof HTMLElement && el.isContentEditable)) return 'textbox';
  return 'clickable';
}

const clean = (s: string | null | undefined) => (s ?? '').replace(ICON_GLYPHS, '').replace(/\s+/g, ' ').trim();

// Name for an image link with no alt text: the end of its URL (".../wiki/File:Turing.jpg" → "File:Turing.jpg").
export function urlName(href: string): string {
  const url = URL.parse(href);
  if (!url?.protocol.startsWith('http')) return ''; // javascript:void(0) says nothing
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last) || url.hostname;
  } catch {
    return last; // malformed %-escape
  }
}

// Shortens s to max characters, with "…" so a cut number ("27" of "276") can't pass as the real one.
export const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// True if label has all of text's words and more: a calendar day "26" labelled "Saturday, December 26, 2026".
export function saysMore(label: string, text: string): boolean {
  const words = (s: string) => ` ${s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  return label.length > text.length && words(label).includes(words(text));
}

// What names the element from outside its own text: aria-labelledby, aria-label, a linked <label>.
export function label(el: Element): string {
  // IDs are looked up in the element's own root: inside a shadow root they don't exist in document.
  const root = el.getRootNode() as Document | ShadowRoot;
  const labelledBy = el.getAttribute('aria-labelledby')?.split(/\s+/)
    .map((id) => root.getElementById(id)?.textContent).join(' ');
  const labels = 'labels' in el ? [...((el as HTMLInputElement).labels ?? [])].map((l) => l.innerText).join(' ') : '';
  return [labelledBy, el.getAttribute('aria-label'), labels].map(clean).find(Boolean) ?? '';
}

// An unlabeled box's words: the text right beside it, up to the next control; after it first (a box sits left of its
// words), else before. Not its parent's whole text: boxes sharing a parent (a Yes / No pair, a list of cases) all got
// the same name, and the model clicked the box next to the one it meant (seen in 4 runs). Climbs a few levels for a
// box wrapped in its own span or table cell. Node types, not instanceof, so Node tests can use a fake DOM.
export function besideText(el: Element): string {
  const control = (n: Node) => n.nodeType === 1 && ((n as Element).matches(CONTROLS) || !!(n as Element).querySelector(CONTROLS));
  const words = (from: Node, way: 'nextSibling' | 'previousSibling') => {
    const parts: string[] = [];
    for (let n = from[way]; n && !control(n); n = n[way]) parts.push((n as HTMLElement).innerText ?? n.textContent ?? '');
    return clean((way === 'nextSibling' ? parts : parts.reverse()).join(' '));
  };
  for (let box: Element | null = el, up = 0; box && up < 4; box = box.parentElement, up++) {
    const text = words(box, 'nextSibling') || words(box, 'previousSibling');
    if (text) return text;
  }
  return '';
}

// What the element is called: the first non-empty source, in screen-reader order.
export function name(el: Element): string {
  const text = clean(el instanceof HTMLElement ? el.innerText : el.textContent);
  const innerLabel = clean(el.querySelector('[aria-label]')?.getAttribute('aria-label'));
  const sources = [
    label(el),
    el.getAttribute('alt'),
    el.getAttribute('title'),
    el.getAttribute('placeholder'),
    // Calendar days: the visible "26" has a label inside that says the month.
    text && saysMore(innerLabel, text) ? innerLabel : text,
    el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type) ? el.value : '',
    // A bare checkbox or button input with no label: the text beside it.
    el.matches(BARE_INPUTS) ? besideText(el) : '',
    // Icon buttons and image links: the picture's alt. After the text, so a card is named by its title, not its photo.
    el.querySelector('img[alt]:not([alt=""])')?.getAttribute('alt'),
    // Icon buttons often label the icon instead: <button><span aria-label="Clear"><svg>.
    innerLabel,
    el instanceof HTMLAnchorElement ? urlName(el.href) : '',
  ];
  return cut(sources.map(clean).find(Boolean) ?? '', 80);
}

export const NO_VALUE = ['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'file'];

// Current value of a field, if it has one.
function value(el: Element): string | undefined {
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text;
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLInputElement && !NO_VALUE.includes(el.type)) return el.value;
}

// Passwords, card fields and one-time codes. Their values are never printed.
export function isSecret(el: Element): boolean {
  const autocomplete = el.getAttribute('autocomplete')?.toLowerCase() ?? '';
  return (el instanceof HTMLInputElement && el.type === 'password') || /\b(cc-|one-time-code)/.test(autocomplete);
}

// F4b: a field with a suggestion list (ARIA combobox or autocomplete, or an HTML datalist): typing there opens a list
// to pick from, so focus stays after typing. attr: the field's getAttribute. Pure.
// Source: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
export const suggests = (attr: (name: string) => string | null) =>
  attr('role') === 'combobox' || attr('aria-expanded') === 'true' || !!attr('list') || (attr('aria-autocomplete') ?? 'none') !== 'none';

// F1b: a password, card or code field on screen right now, listed or not (one may appear after the read).
// Screenshots skip any step where one shows: a picture can't hide a value like the list does.
export const secretOnScreen = () => [...getElements().values(), ...document.querySelectorAll('input[type=password], [autocomplete]')]
  .some((el) => isSecret(el) && el.checkVisibility({ visibilityProperty: true }) && visibleCenter(el) !== null);

function state(el: Element): string[] {
  const s: string[] = [];
  const v = value(el);
  if (v) s.push(isSecret(el) ? 'value=•••' : `value=${JSON.stringify(cut(v, 40))}`);
  if ((el instanceof HTMLInputElement && el.checked) || el.getAttribute('aria-checked') === 'true') s.push('checked');
  const expanded = el.getAttribute('aria-expanded');
  if (expanded === 'true') s.push('expanded');
  if (expanded === 'false') s.push('collapsed');
  if (el.getAttribute('aria-selected') === 'true') s.push('selected');
  if (el.getAttribute('aria-pressed') === 'true') s.push('pressed');
  if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') s.push('disabled');
  return s;
}

// Words in a class or id that say what an icon button does: "icon icon-close" → "close". A fixed list of common UI
// words, so made-up class names (css-1x2y3z) say nothing and "padding" never reads as "add". No site names.
const ICON_WORDS = new Set([
  'close', 'dismiss', 'cancel', 'cross', 'times', 'back', 'next', 'prev', 'previous', 'left', 'right', 'up', 'down',
  'search', 'menu', 'hamburger', 'cart', 'filter', 'filters', 'sort', 'clear', 'remove', 'delete', 'add', 'plus',
  'minus', 'expand', 'collapse', 'share', 'play', 'pause', 'edit', 'settings', 'more', 'like', 'wishlist',
]);

export function classHint(text: string): string {
  const words = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/);
  return [...new Set(words.filter((w) => ICON_WORDS.has(w)))].slice(0, 2).join(' ');
}

// One list line: role "name" state…
export function describe(el: Element): string {
  const n = name(el);
  // No name (a bare × icon): what its class or id says, or its icon's (<use href="#icon-close">). A guess from code.
  const code = n ? '' : [el, ...el.querySelectorAll('*')].slice(0, 6)
    .map((e) => `${e.getAttribute('class') ?? ''} ${e.id} ${e.getAttribute('href') ?? ''}`).join(' ');
  const hint = code && classHint(code);
  return [role(el), JSON.stringify(n), ...(hint ? [`(class says: ${hint})`] : []), ...state(el)].join(' ');
}

// Number → element from the latest read. Numbers stick to their element (lib/page/numbers.ts), so a number from an older
// read finds the same element here, or nothing.
let elements = new Map<number, Element>();
// Where this frame was scrolled at the latest read: every listed element was on screen there.
export let readScroll = { left: 0, top: 0 };

export const getElements = () => elements;

// What an element is, for keeping its number: a box that now says something else gets a new one.
const keyOf = (el: Element) => `${role(el)} ${name(el)}`;

// The element numbered n in the latest read. Throws instead of guessing if the page changed.
export function getElement(n: number): Element {
  const el = elements.get(n);
  if (!el) throw new Error(`Element [${n}] not found — run read again`);
  if (!el.isConnected) throw new Error(`Element [${n}] is gone — run read again`);
  checkSame(n, el, keyOf(el));
  return el;
}

// y = pixels scrolled from the top, max = the most it can scroll.
export function scrollLine(y: number, max: number): string {
  if (max <= 0) return 'Scroll: 0% — page fits on screen';
  const more = [y > 0 && 'more content above', y < max && 'more content below'].filter(Boolean).join(', ');
  return `Scroll: ${Math.round((y / max) * 100)}% — ${more}`;
}

// How far a box can still scroll left and right.
export type Room = { left: number; right: number };

// Room from scrollLeft, which counts from the start edge: the left one, or in RTL the right one (0, then negative).
// max = scrollWidth - clientWidth. Pure. Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollLeft
export function sideRoom(scrollLeft: number, max: number, rtl: boolean): Room {
  const left = scrollLeft < 0 || (scrollLeft === 0 && rtl) ? max + scrollLeft : scrollLeft;
  return { left, right: max - left };
}

// Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth (and .../CSS/Reference/Properties/direction)
export const roomOf = (el: Element) => sideRoom(el.scrollLeft, el.scrollWidth - el.clientWidth, getComputedStyle(el).direction === 'rtl');

// A box that scrolls sideways on its own (a wide table): its room, else null. overflow-y: auto makes overflow-x auto too,
// so the size check decides. Source: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-x
export const sideways = (el: Element): Room | null =>
  /^(auto|scroll)$/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1 ? roomOf(el) : null;

// Like scrollLine, sideways. Pure.
export function sideLine(room: Room): string {
  const [left, right] = [Math.round(room.left), Math.round(room.right)];
  const more = [left > 0 && 'more content left', right > 0 && 'more content right'].filter(Boolean).join(', ');
  return `Scroll sideways: ${Math.round((left / (left + right)) * 100)}% — ${more}`;
}

// Heading level: from the tag (h2 → 2), else aria-level (role=heading defaults to 2).
function level(el: Element): number {
  return Number(/^H(\d)$/.exec(el.tagName)?.[1] ?? el.getAttribute('aria-level') ?? 2);
}

const MODALS = 'dialog[open], [role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]';
// Any dialog tag: many popups have role=dialog without aria-modal.
const DIALOGS = 'dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]';

const area = (el: Element) => el.getBoundingClientRect().width * el.getBoundingClientRect().height;
// A third of the screen or more.
const big = (el: Element) => area(el) * 3 >= innerWidth * innerHeight;

// Pinned to the screen, fitting on it, and big. Bigger than the screen is the page itself: sites pin the whole page
// in place while a popup is open.
function pinnedBig(el: Element): boolean {
  if (getComputedStyle(el).position !== 'fixed') return false;
  const r = el.getBoundingClientRect();
  return r.width <= innerWidth + 1 && r.height <= innerHeight + 1 && big(el);
}

// Shows something itself (a control, a picture, its own text), not just a layout box around other things.
const showsSomething = (el: Element) => el.matches(`${CONTROLS}, img, svg, canvas`)
  || [...el.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim());

// The popup, drawer or filter panel on top of the page, or null. Many panels have no dialog tag, so it's also found by
// how it sits. At each of 9 points, the outermost box over it that is a dialog tag, or a big pinned box that hides
// some of the page: page content under it there, or a page shut behind it. An app drawn in one full-screen box, or a
// sidebar beside the page, hides nothing. The box found at the most points wins; a box holding it wins over it.
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Document/elementsFromPoint
export function panelOnTop(): Element | null {
  // While a modal is open, sites shut the page behind it (inert, or hidden from screen readers): a big sibling of the
  // panel or of a box around it. Shut parts never show up under a point, so they're checked here instead.
  const shut = [...document.querySelectorAll('[inert], [aria-hidden=true]')].filter(big);
  const shutBehind = (box: Element) => shut.some((s) => !deepContains(s, box) && !!s.parentElement && deepContains(s.parentElement, box));
  const votes = new Map<Element, number>();
  for (const fx of [1, 3, 5]) {
    for (const fy of [1, 3, 5]) {
      const stack = document.elementsFromPoint((innerWidth * fx) / 6, (innerHeight * fy) / 6);
      let panel: Element | undefined;
      for (let el = stack[0] ?? null; el; el = parentOf(el)) {
        const box = el;
        const hides = () => stack.some((s) => !deepContains(box, s) && !deepContains(s, box) && showsSomething(s)) || shutBehind(box);
        if (box.matches(DIALOGS) || (pinnedBig(box) && hides())) panel = box;
      }
      if (panel) votes.set(panel, (votes.get(panel) ?? 0) + 1);
    }
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]).map(([el]) => el);
  const best = ranked[0];
  // A small modal away from the 9 points (a corner popup) still counts.
  if (!best) return [...document.querySelectorAll(MODALS)].find(isVisible) ?? null;
  return ranked.filter((el) => deepContains(el, best)).sort((a, b) => area(b) - area(a))[0]!;
}

// A panel's name: its label or its dialog's, else its first heading. A dialog's own text is no name (Google's date
// picker said "One way Reset October S M T W…" while showing December).
function panelName(panel: Element): string {
  const dialog = panel.matches(DIALOGS) ? panel : panel.querySelector(DIALOGS);
  const heading = panel.querySelector('h1, h2, h3, [role=heading]');
  return label(panel) || (dialog ? label(dialog) : '') || (heading ? name(heading) : '');
}

// Element numbers as ranges: [3, 4, 5, 9] → "[3]–[5], [9]". At most 5 ranges.
export function ranges(nums: number[]): string {
  nums = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    const start = nums[i]!;
    while (nums[i + 1] === nums[i]! + 1) i++;
    out.push(nums[i] === start ? `[${start}]` : `[${start}]–[${nums[i]}]`);
  }
  return out.slice(0, 5).join(', ') + (out.length > 5 ? ', …' : '');
}

// Scrolls on its own (not the page): a scroll box with more inside than shows, up and down or sideways.
const scrollsDown = (el: Element) => /^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1;
const scrollsAlone = (el: Element) => scrollsDown(el) || !!sideways(el);

// Up to 3 boxes that scroll on their own and hold listed elements, biggest first, so the model knows what scroll moves.
function scrollBoxes(visible: Element[], nums: number[]): string[] {
  const memo = new Map<Element, boolean>();
  const boxes = new Set<Element>();
  for (const el of visible) {
    for (let p = parentOf(el); p && p !== document.body && p !== document.documentElement; p = parentOf(p)) {
      if (!memo.has(p)) memo.set(p, scrollsAlone(p));
      if (memo.get(p)) boxes.add(p);
    }
  }
  return [...boxes]
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)
    .slice(0, 3)
    .map((box) => {
      const inBox = visible.flatMap((el, i) => (deepContains(box, el) ? [nums[i]!] : []));
      const room = sideways(box);
      const ways = [scrollsDown(box) ? scrollLine(Math.round(box.scrollTop), box.scrollHeight - box.clientHeight) : '', room ? sideLine(room) : ''];
      return `Box with ${ranges(inBox)} ${ways.filter(Boolean).map((w) => w.replace(/^Scroll/, 'scrolls')).join('; ')}`;
    });
}

// The lines above the list: where you are on the page. Top frame only. nums[i] is visible[i]'s number.
function header(visible: Element[], nums: number[]): string {
  // scrollingElement is <html> normally, <body> on old quirks-mode pages.
  const scroller = document.scrollingElement ?? document.documentElement;
  const focused = document.activeElement ? nums[visible.indexOf(document.activeElement)] : 0;
  const panel = panelOnTop();
  const inPanel = panel ? visible.flatMap((el, i) => (deepContains(panel, el) ? [nums[i]!] : [])) : [];
  const title = panel ? panelName(panel) : '';
  const headings = [...document.querySelectorAll('h1, h2, h3, [role=heading]')]
    .filter((h) => level(h) <= 3 && isVisible(h))
    .slice(0, 10)
    .map((h) => `H${level(h)} ${JSON.stringify(cut(name(h), 60))}`);
  const pageScroll = scrollLine(Math.round(scroller.scrollTop), scroller.scrollHeight - scroller.clientHeight);
  return [
    `URL: ${location.href}`,
    `Title: ${document.title}`,
    panel ? pageScroll.replace(/^Scroll:/, 'Page scroll (behind the panel):') : pageScroll,
    focused && `Focused: [${focused}]`,
    panel && `Panel on top: ${title ? JSON.stringify(title) : '(no name)'} ·${inPanel.length ? `its elements: ${ranges(inPanel)}` : 'none of its elements are listed'}`,
    ...scrollBoxes(visible, nums),
    headings.length && `Headings: ${headings.join(', ')}`,
  ].filter(Boolean).join('\n');
}

// Nested entries with the same name are one thing: YouTube's option "cats" > button "cats", Amazon's
// clickable "Dismiss" > button "Dismiss". Keeps the outer one (it has states like selected) unless it's only a
// generic clickable wrapper. An unnamed clickable wrapper is only the hit area of what's inside: Google's
// clickable "" > radio "Nonstop only".
function dropDuplicates(els: Element[]): Element[] {
  const names = new Map(els.map((el) => [el, name(el)]));
  const drop = new Set<Element>();
  for (const el of els) {
    let outer = parentOf(el);
    while (outer && !names.has(outer)) outer = parentOf(outer);
    if (!outer) continue;
    const wrapper = role(outer) === 'clickable';
    if (names.get(outer) === names.get(el) || (wrapper && !names.get(outer))) drop.add(wrapper ? outer : el);
  }
  return els.filter((el) => !drop.has(el));
}

// Reads this frame only. New numbers count on from next, the panel's last one, so none is given twice across frames,
// pages or tabs; the panel joins the frames.
export function read(next: number): Omit<ReadReply, 'page'> {
  const isTop = window === window.top;
  const all = findInteractive();
  // shortcut: tiny frames (ads, trackers) are skipped by size, but a large hidden or off-screen iframe is still read.
  // Upgrade: have the parent frame report which of its iframe elements are visible.
  const tooSmall = !isTop && (innerWidth < 50 || innerHeight < 50);
  const visible = tooSmall ? [] : dropDuplicates(all.filter(isVisible));
  const nums = stick(visible, visible.map(keyOf), next);
  elements = new Map(visible.map((el, i) => [nums[i]!, el]));
  readScroll = { left: scrollX, top: scrollY };
  return {
    header: isTop ? header(visible, nums) : '',
    lines: visible.map((el, i) => `[${nums[i]}] ${describe(el)}`),
    numbers: nums,
    total: all.length,
  };
}
