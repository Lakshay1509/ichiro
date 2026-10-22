// Actions: do things to elements from the latest read, like a person would. Runs in the content script.
// Known limit: these events have isTrusted = false. A few sites ignore them; harness Phase 7 adds real input.
import {
  clickable, clickPoint, deepContains, deepElementFromPoint, findInteractive, getElement, getElements, isSecret, name, NO_VALUE, panelOnTop,
  parentOf, readScroll, role, roomOf, scrollLine, shadowRootOf, sideLine, sideways, suggests, visibleCenter,
} from './reader.ts';
import { HandOver, StopLine } from './messages.ts';
import { chooseText, NO_REACTION, reaction, readText, textTargets } from './page-text.ts';
import { waitForQuiet } from './settle.ts';
import { checkPersonal } from './personal.ts';
import { checkStopLine, clickTargets, enterTargets, stopWord } from './stop-lines.ts';
import { keyRefusal, keyStop, parseKey } from './keys.ts';
import { sameLayout, toViewport, type Point } from './real-input.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Scrolls el into view and finds what's under its center. Throws if something covers it. what names it in errors.
// Returns the event init for a mouse at that point; events fire at `hit`, the innermost element there.
async function aimAt(el: Element, what: string) {
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  // Still off screen: it sits in a bar the page hides as you scroll (a header that slides away), which scrolling to it
  // can't reach. Seen live: click after find scrolled away. So back where the latest read saw it on screen, and a
  // moment for the page to show it again. Source: https://developer.mozilla.org/en-US/docs/Web/API/Window/scrollTo
  // shortcut: only the window's scroll is put back, not an inner box's; upgrade if a live miss is in an app that scrolls a box.
  if (!visibleCenter(el)) {
    scrollTo({ ...readScroll, behavior: 'instant' });
    await waitForQuiet(1500);
  }

  // A wrapped link's center can miss it; clickPoint tries each line. Fall back to the center to name what covers it.
  const point = clickPoint(el) ?? visibleCenter(el);
  if (!point) throw new Error(`${what} is not on screen`);
  // Deep: lands on the real button inside a web component, not the component's outer element.
  const hit = deepElementFromPoint(point.x, point.y);
  if (!hit || !deepContains(el, hit)) {
    // Name the whole banner/dialog if there is one, not just the bit of text on top.
    const cover = hit?.closest('dialog, [role=dialog], [role=alertdialog]') ?? hit;
    throw new Error(`${what} is covered by ${cover ? `${role(cover)} ${JSON.stringify(name(cover))}` : 'something'}`);
  }
  const mouse = { bubbles: true, composed: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0 };
  const pointer = { ...mouse, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  return { el, hit, mouse, pointer };
}

// Opens menus that appear on hover via JavaScript. Menus made only with CSS :hover won't open (fake events can't trigger it).
export async function hover(n: number): Promise<string> {
  const { hit, mouse, pointer } = await aimAt(getElement(n), `Element [${n}]`);
  hit.dispatchEvent(new PointerEvent('pointerover', pointer));
  hit.dispatchEvent(new PointerEvent('pointerenter', pointer));
  hit.dispatchEvent(new MouseEvent('mouseover', mouse));
  hit.dispatchEvent(new MouseEvent('mouseenter', mouse));
  hit.dispatchEvent(new PointerEvent('pointermove', pointer));
  hit.dispatchEvent(new MouseEvent('mousemove', mouse));
  return 'ok';
}

export const click = (n: number, allow = false) => clickAt(getElement(n), `Element [${n}]`, allow);

// R1: click "text" that names no element: the shown page text reading exactly that (several: chooseText's pick, which
// note says). Inside a listed element it's that element's click (its own name and stop-lines). Else the text itself:
// its click bubbles to the page's own handler, which may sit on any box around it, so their names count for
// stop-lines too (attributes only: a big box's text would hold every stop word on the page).
function textTarget(want: string, allow: boolean): { el: Element; what: string; note: string } {
  const found = textTargets(want);
  const { i, note } = chooseText(found, want);
  const el = found[i]!.el;
  const owner = [...getElements()].filter(([, e]) => deepContains(e, el)).at(-1);
  if (owner) return { el: owner[1], what: `Element [${owner[0]}]`, note };
  if (!allow) checkBoxes(el, `click text ${JSON.stringify(want)}`);
  // Said in the note, so the real click (aim) and the script click (clickText) both report it.
  const kind = clickable(el) ? ' — clicked page text (not in the element list)'
    : ' — but it is plain text: nothing there looks clickable (no link, button or pointer cursor), so the click likely did nothing';
  return { el, what: `Text ${JSON.stringify(want)}`, note: `${kind}${note}` };
}

// A click on el bubbles to the page's own handler, which may sit on any box around it: their names count for stop-lines
// (attributes only: a big box's text would hold every stop word on the page).
function checkBoxes(el: Element, what: string) {
  for (let box = parentOf(el); box; box = parentOf(box)) {
    const word = ['aria-label', 'title'].map((a) => stopWord(box!.getAttribute(a) ?? '')).find(Boolean);
    if (word) throw new StopLine(`Stop-line: ${what} (word "${word}" on the box around it). Needs your ok.`);
  }
}

export async function clickText(want: string, allow = false): Promise<string> {
  const t = textTarget(want, allow);
  return `${await clickAt(t.el, t.what, allow)}${t.note}`;
}

// Where a click on el lands, after every check a click needs: on screen, not covered, stop-lines (unless allowed).
// Shared by our script click and I1's real one.
async function prepareClick(el: Element, what: string, allow: boolean) {
  const aimed = await aimAt(el, what);
  if (!allow) checkStopLine(JSON.stringify(name(el)), clickTargets(el, aimed.hit));
  return aimed;
}

// I1: a real click lands on whatever is at the point when it arrives. If the page put something else there after our
// checks (a popup, a list that shifted), its events are stopped at the window before the page sees them, and the
// panel reports it. Playwright checks the same ("element intercepts pointer events"). The browser's own follow-up
// click from a label to its control passes.
let guard: { blocked: string; pressed: boolean; check: (e: Event) => void; off: () => void } | null = null;
const GUARDED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
// Listeners on one target run in the order they were added; stopping one only stops those after it. A guard added at
// click time came after the page's own window listeners (Google Slides has one): the page took a "stopped" press. So
// it's added once, before any page script runs (the content script starts at document_start), as Playwright adds its
// own once at start. first: false if this script came late (a tab open before the extension loaded): then a stop can't
// promise the page saw nothing. Sources: https://developer.mozilla.org/en-US/docs/Web/API/Event/stopImmediatePropagation
// and run_at in https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
let first = false;
export function watchMouse() {
  first = document.readyState === 'loading';
  for (const type of GUARDED) addEventListener(type, (e) => guard?.check(e), true);
}

// The guard's rule for one real mouse event: true stops it, and g.blocked says why. Like Playwright, the press decides
// (it checks the first event only): until ours lands on what we checked, anything elsewhere is stopped. After it, the
// page often moves things under the mouse in answer (a slide's selection handles, the shape a drag carries), so the
// rest of the gesture goes on, but anything new it lands on gets the stop-lines (a dialog the first click of a
// double-click opened). One stopped event stops the rest. at: what the event landed on; stopLine: why acting there
// needs your ok ('' if it doesn't). Source: setupHitTargetInterceptor in
// https://github.com/microsoft/playwright/blob/main/packages/injected/src/injectedScript.ts
export function guardStops(g: { blocked: string; pressed: boolean }, press: boolean, aimed: boolean, at: () => string, stopLine: () => string): boolean {
  if (g.blocked) return true;
  if (aimed) {
    if (press) g.pressed = true;
    return false;
  }
  if (!g.pressed) {
    g.blocked = `${at()} was at that spot when the mouse got there (the page moved)`;
    return true;
  }
  const why = stopLine();
  if (why) g.blocked = `${at()} came up under the mouse after the press (${why})`;
  return !!why;
}

// After our press: why a press or release on hit needs your ok, '' if it doesn't. Said, not thrown: this runs inside
// the page's event. A check that fails stops the event too.
function spotStop(hit: Element): string {
  try {
    checkSpot(hit, 'the mouse');
    return '';
  } catch (err) {
    return err instanceof StopLine ? 'needs your ok' : "couldn't be checked";
  }
}

export function guardClick(allow: boolean, ...els: Element[]) {
  endGuard();
  const controls = els.map((el) => el.closest('label')?.control ?? null);
  const check = (e: Event) => {
    // The page's own script events aren't our mouse (its code can act without them anyway), and must not count as our press.
    if (!e.isTrusted) return;
    const t = e.composedPath()[0];
    const el = t instanceof Element ? t : null;
    const aimed = !!el && (els.some((x) => deepContains(x, el)) || controls.includes(el as HTMLElement));
    const press = e.type === 'pointerdown' || e.type === 'mousedown';
    const stopLine = () => (!el ? "couldn't be checked" : allow ? '' : spotStop(el));
    if (!guardStops(g, press, aimed, () => (el ? describe(el) : 'something else'), stopLine)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const g = { blocked: '', pressed: false, check, off: () => clearTimeout(timer) };
  guard = g;
  const timer = setTimeout(() => guard === g && endGuard(), 5000); // never left on if the panel's real click doesn't come
}

// After the panel's real click: the guard comes off, and says what it stopped ('' = nothing). Says the page saw nothing
// only when that's sure (watchMouse's first): a click that went through is never reported as stopped.
export function endGuard(): string {
  const g = guard;
  g?.off();
  guard = null;
  if (!g?.blocked) return '';
  if (!first) return `Maybe done: ${g.blocked}. This tab was open before the extension loaded, so the page may have taken the click before it could be stopped (reload the tab to fix)`;
  return `Stopped: ${g.blocked}: ${g.pressed ? 'the rest was held back' : 'nothing reached the page'}`;
}

// I1: everything a click needs except the click itself: the checked point, in the top page's viewport (what the
// protocol wants), with the guard on. A hover needs only the point. In a frame: null, and the panel clicks there with
// script events (frame offsets aren't mapped to the top page).
export async function aim(target: { n?: number; text?: string }, allow = false, hover = false): Promise<{ x: number; y: number; note: string } | null> {
  if (window !== window.top) return null;
  const t = target.text !== undefined ? textTarget(target.text, allow) : { el: getElement(target.n!), what: `Element [${target.n}]`, note: '' };
  const { mouse } = await (hover ? aimAt(t.el, t.what) : prepareClick(t.el, t.what, allow));
  if (!hover) guardClick(allow, t.el);
  return { x: mouse.clientX, y: mouse.clientY, note: t.note };
}

// WR1: a click or drag at points from a screenshot shot.width × shot.height pixels (what the model sees), as points in
// this viewport (what the protocol wants). Checked where the button goes down and comes up (a drag's middle only moves
// the mouse): something there, not in a frame, stop-lines unless allowed. Then the guard, as for a click.
// shortcut: points work on the top page only (a frame's content isn't checked from here); upgrade by mapping the point into the frame.
export async function aimPoints(points: Point[], shot: { width: number; height: number }, allow = false): Promise<{ points: Point[]; note: string }> {
  // The panel attached just before: Chrome's debugging bar may be still coming in. Give the page up to 1 s to be laid
  // out as in the picture.
  const view = () => ({ width: innerWidth, height: innerHeight });
  for (let waited = 0; !sameLayout(shot, view()) && waited < 1000; waited += 50) await sleep(50);
  // What the page drew for the mouse that just arrived (a hover look) is in by the next frame. 100 ms if frames are paused.
  await new Promise((resolve) => (requestAnimationFrame(resolve), setTimeout(resolve, 100)));
  const css = toViewport(points, shot, view());
  const ends = points.length > 1 ? [0, points.length - 1] : [0];
  const hits = ends.map((n, i) => {
    const hit = deepElementFromPoint(css[n]!.x, css[n]!.y);
    const at = `${points[n]!.x},${points[n]!.y}`;
    if (!hit) throw new Error(`Nothing on the page at ${at}`);
    if (hit.matches('iframe, frame, embed, object')) throw new Error(`${at} is inside a frame (${role(hit)} ${JSON.stringify(name(hit))}): points work on the top page only. Use click <n> on an element in it`);
    if (!allow) checkSpot(hit, `${i ? 'release' : 'press'} at ${at}`);
    return hit;
  });
  guardClick(allow, ...hits);
  const on = (hit: Element) => `${role(hit)} ${JSON.stringify(name(hit).slice(0, 40))}`;
  return { points: css, note: ` on ${on(hits[0]!)}${hits[1] ? `, released on ${on(hits[1])}` : ''}` };
}

// The stop-lines for a press or release on hit: inside a listed thing (a button, a link), checked like clicking it.
// Else the spot and the boxes around it.
function checkSpot(hit: Element, what: string) {
  const owner = findInteractive().filter((e) => deepContains(e, hit)).at(-1);
  if (owner) checkStopLine(`${what} on ${JSON.stringify(name(owner))}`, clickTargets(owner, hit));
  else {
    checkStopLine(what, [hit]);
    checkBoxes(hit, what);
  }
}

// What has focus in doc: inside a web component, down through its shadow roots to the real field, or a letter or a
// paste would slip past the field's checks.
function deepActive(doc: Document): Element {
  let focused = doc.activeElement ?? doc.body;
  for (let inner = shadowRootOf(focused)?.activeElement; inner; inner = shadowRootOf(focused)?.activeElement) focused = inner;
  return focused;
}
const isFrame = (el: Element) => el.matches('iframe, frame, embed, object');
const describe = (el: Element) => (el === document.body ? 'the page' : `${role(el)} ${JSON.stringify(name(el))}`);
const isField = (el: Element) => el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
  || (el instanceof HTMLInputElement && !NO_VALUE.includes(el.type)) || (el instanceof HTMLElement && el.isContentEditable);

// WR2: true if focus ends in this frame: what has focus here isn't a frame, and each frame above has its focus on the
// one holding this. Under another site's frame frameElement is null, so that never counts: our checks can't see there.
export function focusHere(): boolean {
  if (isFrame(deepActive(document))) return false;
  for (let w: Window = window; w !== w.top; w = w.parent) {
    const host = w.frameElement;
    if (!host || deepActive(host.ownerDocument) !== host) return false;
  }
  return true;
}

// WR1: the checks a real key needs before the panel sends it, on what has focus. Returns where it lands. The panel
// sends it to the frame focus is in; a frame here means another site's frame. null: a plain Escape that goes to the
// panel on top (pressKey's rule), which only a script event can reach: a real key goes where focus is.
export function aimKey(input: string, allow = false): string | null {
  const k = parseKey(input);
  const focused = deepActive(document);
  const where = describe(focused);
  const focus = isFrame(focused) ? 'frame' : isField(focused) ? 'field' : 'other';
  const refused = keyRefusal(k, focus);
  if (refused) throw new Error(`Not sent: ${refused}`);
  if (!allow) {
    const stop = keyStop(k);
    if (stop) throw new StopLine(`Stop-line: ${k.name} on ${where} (${stop}). Needs your ok.`);
    // Enter submits a form; Space presses a focused button or ticks a box.
    if (k.key === 'Enter') checkStopLine(`${k.name} on ${where}`, enterTargets(focused));
    if (k.key === ' ') checkStopLine(`${k.name} on ${where}`, [focused]);
  }
  if (k.name === 'Escape' && keyTarget('Escape', focused, isField(focused) ? null : panelOnTop()) !== focused) return null;
  return where;
}

// WR2: the checks before the panel types or pastes text where focus is (in the frame focus is in). A secret field is
// yours; a field asking for personal data asks first (given: the text is in your goal). Typing needs a field; a paste
// may go to the page itself (drawing apps take it there). Returns where it lands.
export function aimText(paste: boolean, allow = false, given = false): string {
  const focused = deepActive(document);
  const where = describe(focused);
  if (isFrame(focused)) throw new Error(`Not sent: focus is inside another site's frame (${where}), which can't be checked`);
  if (isSecret(focused)) throw new HandOver(`Sign-in or card details needed: ${where} is a password, card or one-time-code field: type it yourself on the page.`);
  const field = isField(focused);
  if (!field && !paste) throw new Error(`Nothing to type into: focus is on ${where}. Click (or double-click) where the text goes first`);
  if (field && !allow && !given) checkPersonal(focused, paste ? 'paste into' : 'type into');
  return where;
}

// WR2: pastes text where focus is, as a paste event carrying it. No clipboard: yours stays as it is, and nothing you
// copied can reach the page. Apps that read pastes (a drawing app's JSON, rich editors) take it from the event; a plain
// field that doesn't gets it at the cursor, like a real paste.
// shortcut: an app that ignores script paste events won't take it; upgrade to the real clipboard + ctrl+v if one shows up.
export function pasteText(text: string, allow = false, given = false): string {
  const where = aimText(true, allow, given);
  const focused = deepActive(document);
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  // Source: https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/ClipboardEvent (clipboardData init)
  const taken = !focused.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true, composed: true }));
  const chars = `${text.length} characters`;
  if (taken) return `ok — ${where} took the paste (${chars})`;
  if (isField(focused) && document.execCommand('insertText', false, text)) return `ok — pasted ${chars} into ${where} as text`;
  return `ok — sent a paste of ${chars} to ${where}; it didn't say it took it: check the screen`;
}

// The form button a click on hit activates (submit or reset), or null: the nearest thing with its own click action
// decides, so a link or label inside a form isn't taken for its submit button.
function formButton(hit: Element): HTMLButtonElement | HTMLInputElement | null {
  const b = hit.closest('button, input[type=submit], input[type=image], input[type=reset], a[href], label, summary');
  return (b instanceof HTMLButtonElement || b instanceof HTMLInputElement) && b.form && ['submit', 'image', 'reset'].includes(b.type) ? b : null;
}

async function clickAt(el: Element, what: string, allow: boolean): Promise<string> {
  const { hit, mouse, pointer } = await prepareClick(el, what, allow);
  const before = location.href;
  hit.dispatchEvent(new PointerEvent('pointerover', pointer));
  hit.dispatchEvent(new PointerEvent('pointerenter', pointer));
  hit.dispatchEvent(new MouseEvent('mouseover', mouse));
  hit.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
  const mousedownAllowed = hit.dispatchEvent(new MouseEvent('mousedown', { ...mouse, buttons: 1 }));
  // Like a real browser: no focus change if the page cancelled mousedown (autocomplete lists do, to keep the input focused).
  if (mousedownAllowed && (el instanceof HTMLElement || el instanceof SVGElement)) el.focus({ preventScroll: true });
  hit.dispatchEvent(new PointerEvent('pointerup', pointer));
  hit.dispatchEvent(new MouseEvent('mouseup', mouse));
  // A form button's own action (submit, reset) runs, for a real click, after the page's pending work (microtasks).
  // Sent from our script it would run at once, before that work: live, a fee calculator disabled its button there,
  // so a real click didn't submit, but ours submitted the form and reloaded the page, losing the fee. So we hold it,
  // let that work run, then do it ourselves only if the page didn't cancel the click and the button can still act.
  // Our listener is the window's last, so it sees whether the page cancelled; if the page stops the click before
  // window, the browser's own action runs as before and we don't add a second one.
  const button = formButton(hit);
  let held = false;
  let cancelled = false;
  const hold = (e: Event) => {
    held = true;
    cancelled = e.defaultPrevented;
    e.preventDefault();
  };
  if (button) addEventListener('click', hold);
  hit.dispatchEvent(new MouseEvent('click', mouse));
  if (button) {
    removeEventListener('click', hold);
    await sleep(0);
    if (held && !cancelled && button.isConnected && !button.matches(':disabled') && button.form?.isConnected) {
      if (button.type === 'reset') button.form.reset();
      else button.form.requestSubmit(button);
    }
  }

  const notes = ['ok'];
  if (location.href !== before) notes.push('page changed URL');
  if (hit.closest('a[target=_blank]')) notes.push('opened new tab');
  return notes.join(' — ');
}

// Fires a fake key event. Returns false if the page cancelled it, i.e. handled the key itself.
function key(el: Element, type: 'keydown' | 'keypress' | 'keyup', init: KeyboardEventInit): boolean {
  return el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }));
}

// Moves focus to `to` (null: just leave the field). Focus and blur events only fire while the page has focus, and during
// a run you're usually in the side panel, so it doesn't: sites that save a field on leaving it (seen live: Airbnb's
// price) never heard it. Then we send the events ourselves, like browser-use does.
function moveFocus(to: HTMLElement | null) {
  const from = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  if (to) to.focus({ preventScroll: true });
  else from?.blur();
  if (document.hasFocus()) return; // the browser fired them itself
  // focusin and focusout bubble (React listens to them); focus and blur don't.
  const event = (type: string, related: Element | null) => new FocusEvent(type, { bubbles: type === 'focusin' || type === 'focusout', composed: true, relatedTarget: related });
  if (from && from !== to) ['blur', 'focusout'].forEach((type) => from.dispatchEvent(event(type, to)));
  if (to && to !== from && document.activeElement === to) ['focus', 'focusin'].forEach((type) => to.dispatchEvent(event(type, from)));
}

// React and Vue ignore a plain el.value = …; the native setter plus an input event is what they notice.
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// A fake Enter never submits a form by itself. If the page doesn't react within 300 ms, submit the form for it.
async function pressEnter(el: Element, form: HTMLFormElement | null): Promise<string> {
  let reacted = false;
  const onReact = () => { reacted = true; };
  form?.addEventListener('submit', onReact);
  addEventListener('beforeunload', onReact); // a navigation started
  const before = location.href;
  const enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
  if (!key(el, 'keydown', enter)) reacted = true; // the page handled Enter itself
  key(el, 'keypress', { ...enter, charCode: 13 });
  key(el, 'keyup', enter);
  let note = 'pressed Enter';
  if (form) {
    await sleep(300);
    // Source: https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/requestSubmit (validates, like a submit button)
    if (!reacted && location.href === before && form.isConnected) {
      form.requestSubmit();
      note += ', then submitted the form';
    }
  }
  form?.removeEventListener('submit', onReact);
  removeEventListener('beforeunload', onReact);
  return note;
}

export async function typeText(n: number, text: string, enter: boolean, slow: boolean, allow = false, given = false): Promise<string> {
  const el = getElement(n);
  // 4.2: secrets are yours to type, so this is refused even with Allow once; a run pauses and hands over.
  if (isSecret(el)) {
    const what = el.getAttribute('autocomplete')?.toLowerCase().includes('cc-') ? 'Card details needed' : 'Sign-in needed';
    throw new HandOver(`${what}: [${n}] ${JSON.stringify(name(el))} is a password, card or one-time-code field: type it yourself on the page.`);
  }
  const field = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NO_VALUE.includes(el.type)) ? el : null;
  if (!field && !(el instanceof HTMLElement && el.isContentEditable)) {
    throw new Error(`Element [${n}] is ${role(el)} ${JSON.stringify(name(el))}, not a text field`);
  }
  // Checked before typing, so a refused command leaves the page as it was. Clearing a field shares nothing, and
  // neither does text you gave in the goal. Secrets (above) and the Enter stop-line (below) still apply to it.
  if (text && !allow && !given) checkPersonal(el, `type into [${n}]`);
  if (enter && !allow) checkStopLine(`Enter in ${JSON.stringify(name(el))}`, enterTargets(el));
  // F4b: the screen's text before typing, without the field's own text, to say afterwards how the page reacted.
  const screen = () => readText(false, el).split('\n');
  const before = enter ? [] : screen();
  moveFocus(el as HTMLElement);

  // Clear what's there. In an editor, selecting everything makes the first insert replace it.
  if (field) setValue(field, '');
  else {
    getSelection()?.selectAllChildren(el);
    if (!text) document.execCommand('delete');
  }

  // Slow mode: letter by letter with key events, for autocompletes that only react to typing.
  for (const chunk of slow ? [...text] : [text]) {
    // If the page cancels the key it typed (or blocked) the letter itself: don't add it again.
    const handledByPage = slow && !(key(el, 'keydown', { key: chunk }) && key(el, 'keypress', { key: chunk, charCode: chunk.charCodeAt(0) }));
    if (!handledByPage) {
      if (field) setValue(field, field.value + chunk);
      // Deprecated, but still what rich editors notice. Source: https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
      else document.execCommand('insertText', false, chunk);
    }
    if (slow) {
      key(el, 'keyup', { key: chunk });
      await sleep(30);
    }
  }
  field?.dispatchEvent(new Event('change', { bubbles: true }));

  // Report what the field really contains: shows if the site rejected or reformatted the text.
  const value = () => (field ? field.value : (el as HTMLElement).innerText);
  const fieldNow = () => `field now: ${isSecret(el) ? '•••' : JSON.stringify(value().slice(0, 40))}`;
  const notes = ['ok', fieldNow()];
  if (enter) notes.push(await pressEnter(el, field ? field.form : el.closest('form')));
  else {
    // What was typed, to tell if the site changed it (a formatter, as we typed or on leaving). Not the value after our
    // events: their handlers run inside dispatchEvent, so a formatter has already run. Fields only: an editor's innerText
    // shifts on its own. Source: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/dispatchEvent
    const typed = field && !isSecret(el) ? text : undefined;
    // F4b: leave the field like a person moving on, so sites that save on leaving do (seen live: Airbnb's price only
    // saved on blur). A field with a suggestion list keeps focus, so the list stays open for the next click.
    if (!suggests((a) => el.getAttribute(a))) moveFocus(null);
    // The page's reaction goes first: the field's own text proves nothing, since we put it there; the site changing it
    // does. Then the value now, which the site may have reformatted on leaving.
    const fieldChange = () => (typed === undefined ? undefined : { typed, now: value() });
    notes.splice(1, 1, await reactionTo(before, screen, fieldChange), fieldNow());
  }
  return notes.join(' — ');
}

// F4b: what changed on screen (and in the typed field) after typing. A site that asks its server first (a result
// count) can sit quiet for a moment, so "no reaction" gets one more wait before it's said.
async function reactionTo(before: string[], screen: () => string[], field: () => { typed: string; now: string } | undefined): Promise<string> {
  await waitForQuiet(1500);
  const first = reaction(before, screen(), field());
  if (first !== NO_REACTION) return first;
  await waitForQuiet(1500);
  return reaction(before, screen(), field());
}

// Native <select> only. Custom dropdowns are divs: click them, read, click the option.
export function selectOption(n: number, option: string, allow = false, given = false): string {
  const el = getElement(n);
  if (!(el instanceof HTMLSelectElement)) {
    throw new Error(`Element [${n}] is ${role(el)} ${JSON.stringify(name(el))}, not a <select>. For custom dropdowns: click it, read, then click the option`);
  }
  if (!allow && !given) checkPersonal(el, `select in [${n}]`); // a birth month or a country is personal too (4.3)
  const want = option.trim().toLowerCase();
  const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === want || o.value === option);
  if (!opt) {
    const all = [...el.options].map((o) => JSON.stringify(o.text.trim()));
    const more = all.length > 30 ? ` (+${all.length - 30} more)` : '';
    throw new Error(`No option ${JSON.stringify(option)} in [${n}]. Options: ${all.slice(0, 30).join(', ')}${more}`);
  }
  if (opt.disabled) throw new Error(`Option ${JSON.stringify(opt.text.trim())} in [${n}] is disabled`);
  el.selectedIndex = opt.index;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return `ok — selected ${JSON.stringify(opt.text.trim())}`;
}

type Way = 'up' | 'down' | 'left' | 'right';
const EDGE: Record<Way, string> = { up: 'top', down: 'bottom', left: 'left edge', right: 'right edge' };

// True if el is a scroll box with room left to scroll in that direction.
function canScroll(el: Element, dir: Way): boolean {
  if (dir === 'left' || dir === 'right') return (sideways(el)?.[dir] ?? 0) >= 1;
  const { overflowY } = getComputedStyle(el);
  if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
  return dir === 'down' ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
}

// overflow:hidden on <html> (or on <body> when <html> leaves it visible) stops people scrolling the window that way.
// Sites do this behind modals, and sideways to keep a page from moving. Scripts could still move it, so check first.
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle
function windowLocked(axis: 'overflowX' | 'overflowY' = 'overflowY'): boolean {
  const html = getComputedStyle(document.documentElement)[axis];
  const viewport = html === 'visible' && document.body ? getComputedStyle(document.body)[axis] : html;
  return viewport === 'hidden' || viewport === 'clip';
}

// The biggest visible box among els that passes ok.
const biggestBox = (els: Element[], ok: (el: Element) => boolean) => els
  .filter((el) => ok(el) && visibleCenter(el))
  .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];

// F3d: what a read scrolls to load a lazy page, by scroll's choice: the panel on top's biggest scroll box, else the
// page (unless locked), else the biggest visible scroll box (apps like Gmail). null when nothing scrolls.
export function mainScroller(): Element | null {
  const scrolls = (el: Element) => canScroll(el, 'down') || canScroll(el, 'up');
  const panel = panelOnTop();
  const page = document.scrollingElement ?? document.documentElement;
  return (panel && biggestBox([panel, ...panel.querySelectorAll('*')], scrolls))
    || (!windowLocked() && page.scrollHeight > page.clientHeight + 1 ? page : biggestBox([...document.querySelectorAll('body *')], scrolls))
    || null;
}

// Scrolls the page by 80% of the screen. With n: scrolls the box around element n instead.
// A panel on top (popup, drawer, filters) is what you see, so its box scrolls first, like a mouse wheel over it.
// Left and right move a box that scrolls sideways (a wide table), or a wide page. The reply always says what moved:
// the model can't see it.
export function scroll(dir: Way, n?: number): string {
  const side = dir === 'left' || dir === 'right';
  const sign = dir === 'down' || dir === 'right' ? 1 : -1;
  // 80% of a box (or the window) that way, and where it stands after. behavior 'instant' jumps at once, so scrollX/Y
  // read right after are the new spot. Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollBy
  // (and .../Window/scrollBy, .../Window/scrollX)
  const step = (width: number, height: number) => (side ? { left: sign * width * 0.8 } : { top: sign * height * 0.8 });
  const where = (el: Element) => (side ? sideLine(roomOf(el)) : scrollLine(Math.round(el.scrollTop), el.scrollHeight - el.clientHeight));
  const biggest = (els: Element[]) => biggestBox(els, (el) => canScroll(el, dir));
  const panel = panelOnTop();
  let box: Element | null | undefined;
  let note = '';
  if (n !== undefined) {
    // Element n is usually a link or button inside the list: walk up to the box that scrolls.
    for (box = getElement(n); box && !canScroll(box, dir); box = box.parentElement);
    if (!box) throw new Error(`Nothing around [${n}] can scroll ${dir}`);
  } else {
    box = panel && biggest([panel, ...panel.querySelectorAll('*')]);
    // Never stuck on a panel: if nothing in it scrolls, the page does, and the reply says so.
    if (panel && !box) note = `nothing in the panel on top scrolls ${dir}, so `;
    if (!box && !windowLocked(side ? 'overflowX' : 'overflowY')) {
      const at = () => (side ? scrollX : scrollY);
      const before = at();
      scrollBy({ ...step(innerWidth, innerHeight), behavior: 'instant' });
      if (at() !== before) return `ok — ${note}scrolled the page: ${where(document.scrollingElement ?? document.documentElement)}`;
    }
    // The window is locked or didn't move: apps like Gmail (and open modals) scroll an inner box. Use the biggest visible one.
    box ??= biggest([...document.querySelectorAll('body *')]);
    if (!box) throw new Error(`Can't scroll ${dir}: ${note}already at the ${EDGE[dir]}`);
  }
  box.scrollBy({ ...step(box.clientWidth, box.clientHeight), behavior: 'instant' });
  const what = panel && deepContains(panel, box) ? 'a box inside the panel on top, not the page' : 'an inner box, not the page';
  return `ok — ${note}scrolled ${what}: ${where(box)}`;
}

const KEY_CODES: Record<string, number> = {
  Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
};

// Escape closes what's on top, so it goes to the panel unless focus is already inside it: sites listen on the panel,
// and a page update often leaves focus on the page body (seen live: Amazon's Filters panel ignored Escape there).
export const keyTarget = (keyName: string, focused: Element, panel: Element | null): Element =>
  keyName === 'Escape' && panel && !deepContains(panel, focused) ? panel : focused;

// Fake keydown/keyup on the focused element. Works when the site listens for the key itself;
// browser defaults (Tab moving focus) won't happen because the event isn't trusted.
export function pressKey(input: string, allow = false): string {
  const keyName = Object.keys(KEY_CODES).find((k) => k.toLowerCase() === input.toLowerCase());
  if (!keyName) throw new Error(`Unsupported key ${JSON.stringify(input)}. Use one of: ${Object.keys(KEY_CODES).join(', ')}`);
  // Escape in a text field stays there: it ends the editing (seen live: Excalidraw's text box beside its style panel).
  const focused = deepActive(document);
  const target = keyTarget(keyName, focused, keyName === 'Escape' && !isField(focused) ? panelOnTop() : null);
  const where = target === document.body ? 'the page' : `${role(target)} ${JSON.stringify(name(target))}`;
  if (keyName === 'Enter' && !allow) checkStopLine(`Enter on ${where}`, enterTargets(target));
  const init = { key: keyName, code: keyName, keyCode: KEY_CODES[keyName], which: KEY_CODES[keyName] };
  key(target, 'keydown', init);
  key(target, 'keyup', init);
  return `ok — pressed ${keyName} on ${where}`;
}
