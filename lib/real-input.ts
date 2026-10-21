// I1: real mouse input through chrome.debugger, the way Playwright (page.mouse) and browser-use click. Pages get
// trusted events in the browser's own order (focus and blur, :hover, a form button's action after the page's own
// work), which script events can't give. Runs in the side panel.
// Guards: only the Input domain (no Runtime, so nothing the model writes ever runs as code), only the tab a command
// targets, and only while a command or run is going: runAndPrint calls detachAll after each. Chrome shows its
// "debugging this browser" bar while attached, so you always see it.
// WR1 adds clicks and drags at screenshot points, modifiers, and real keys (lib/keys.ts) through the same guards.
// Sources: https://developer.chrome.com/docs/extensions/reference/api/debugger and Input.dispatchMouseEvent in
// https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json
import { MODIFIERS, type KeyEvent } from './keys.ts';

const PROTOCOL = '1.3';
const MAX_PX = 100_000;
// WR1: a drag's points; a freehand line needs a few dozen, more is a runaway.
export const MAX_POINTS = 50;

export type Point = { x: number; y: number };
type MouseEvent = { type: 'mouseMoved' | 'mousePressed' | 'mouseReleased'; x: number; y: number; button: 'none' | 'left'; buttons: number; clickCount: number; modifiers?: number };

// The point our content script hands over: CSS pixels in the top page's viewport, as the protocol wants. Anything
// else is refused, so a broken page geometry never turns into a click somewhere odd.
export function checkPoint(p: unknown): Point {
  const { x, y } = (p ?? {}) as { x?: unknown; y?: unknown };
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PX;
  if (!ok(x) || !ok(y)) throw new Error(`Not a point on the page: ${JSON.stringify(p)?.slice(0, 80)}`);
  return { x, y };
}

// A hover is the move; a click is the browser's own sequence after it: press, release (twice for a double-click, the
// second counting 2). modifiers: the protocol's bits (shift+click adds to a selection).
const withModifiers = (events: MouseEvent[], modifiers: number) => (modifiers ? events.map((e) => ({ ...e, modifiers })) : events);
export const moveTo = ({ x, y }: Point): MouseEvent[] => [{ type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0 }];
const press = ({ x, y }: Point, clickCount = 1): MouseEvent => ({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount });
const release = ({ x, y }: Point, clickCount = 1): MouseEvent => ({ type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount });
export const clickAtPoint = (p: Point, clicks: 1 | 2 = 1, modifiers = 0): MouseEvent[] => withModifiers([
  ...moveTo(p),
  press(p),
  release(p),
  ...(clicks === 2 ? [press(p, 2), release(p, 2)] : []),
], modifiers);

// WR1: press at the first point, move to each next one in steps with the button held (apps draw from the moves in
// between), release at the last. At most 10 steps a stretch, so a long drag stays quick.
export function dragAlong(points: Point[], modifiers = 0): MouseEvent[] {
  const [first, ...rest] = points;
  if (!first || !rest.length) throw new Error('A drag needs at least 2 points');
  const events = [...moveTo(first), press(first)];
  let from = first;
  for (const to of rest) {
    const steps = Math.min(10, Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 20)));
    for (let i = 1; i <= steps; i++) {
      const at = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      events.push({ type: 'mouseMoved', ...at, button: 'left', buttons: 1, clickCount: 0 });
    }
    from = to;
  }
  events.push(release(from));
  return withModifiers(events, modifiers);
}

// WR1: "640,360" → that point in the last screenshot's pixels; null if the word isn't a point.
export function parsePoint(word: string): Point | null {
  const m = /^(\d{1,5}(?:\.\d+)?),(\d{1,5}(?:\.\d+)?)$/.exec(word);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

// WR1: the page is laid out as in the screenshot: same height at the picture's scale (width-based: the picture may be
// shrunk, or taken on a HiDPI screen). Chrome's debugging bar or a resized window changes it, and content anchored to
// the bottom or centred moves.
type Size = { width: number; height: number };
export const sameLayout = (shot: Size, view: Size) => Math.abs((view.height * shot.width) / view.width - shot.height) <= 2;

// WR1: points in a screenshot's pixels as points in the page's viewport (CSS pixels), if the layout is the same.
export function toViewport(points: Point[], shot: Size, view: Size): Point[] {
  if (!sameLayout(shot, view)) throw new Error("The page isn't the size it was in the last screenshot (window resized, or Chrome's debugging bar came or went): take a new one");
  const scale = view.width / shot.width;
  return points.map(({ x, y }) => {
    if (x >= shot.width || y >= shot.height) throw new Error(`${x},${y} is outside the screenshot (${shot.width}×${shot.height})`);
    return { x: x * scale, y: y * scale };
  });
}

// WR1: the words after a click's or drag's points: double (clicks only), and keys to hold (shift, ctrl, alt, meta).
export function mouseFlags(words: string[], canDouble: boolean, usage: string): { clicks: 1 | 2; modifiers: number } {
  let clicks: 1 | 2 = 1;
  let modifiers = 0;
  for (const w of words) {
    const m = w.toLowerCase();
    if (Object.hasOwn(MODIFIERS, m)) modifiers |= MODIFIERS[m as keyof typeof MODIFIERS];
    else if (w === 'double' && canDouble) clicks = 2;
    else throw new Error(`Usage: ${usage}`);
  }
  return { clicks, modifiers };
}

// A script click (element in a frame, or no debugger) can't double-click or hold keys: refused, never silently dropped.
export function checkScriptClick(clicks: 1 | 2, modifiers: number): void {
  if (clicks === 2 || modifiers) {
    throw new Error("double and shift/ctrl/alt/meta need the real mouse, and there's none for this element (it's in a frame, or the debugging bar was cancelled). Click without them");
  }
}

const attached = new Set<number>();
let listening = false;
let cancelled = false; // you pressed Cancel on Chrome's bar: script events for the rest of this panel session

// Attaches to the tab if needed: 'fresh' if just now (Chrome's bar may be about to appear and shrink the page). false
// if real input isn't possible here (you cancelled the bar, or Chrome won't let us attach, e.g. a browser page).
export async function attach(tabId: number): Promise<'fresh' | 'already' | false> {
  if (!listening) {
    listening = true;
    // A closed tab, DevTools taking over, or your Cancel on the bar ends the session.
    browser.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId !== undefined) attached.delete(source.tabId);
      if (reason === 'canceled_by_user') cancelled = true;
    });
  }
  if (cancelled) return false;
  if (!attached.has(tabId)) {
    try {
      await browser.debugger.attach({ tabId }, PROTOCOL);
    } catch {
      return false;
    }
    attached.add(tabId);
    return 'fresh';
  }
  return 'already';
}

// WR1: sends the key events to the tab. false (nothing sent) if real input isn't possible here.
export async function sendKeys(tabId: number, events: KeyEvent[]): Promise<boolean> {
  if (!(await attach(tabId))) return false;
  try {
    for (const e of events) await browser.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', e);
  } catch (err) {
    // Never leave a key held down: a stuck ctrl would turn every later key into a shortcut.
    for (const e of events.filter((x) => x.type !== 'keyUp').reverse()) {
      await browser.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 0, key: e.key, code: e.code, windowsVirtualKeyCode: e.windowsVirtualKeyCode }).catch(() => {});
    }
    throw err;
  }
  return true;
}

// WR2: types text where focus is, the way an input method does (Input.insertText): one input, no key events. false
// (nothing sent) if real input isn't possible here.
export async function sendText(tabId: number, text: string): Promise<boolean> {
  if (!(await attach(tabId))) return false;
  await browser.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
  return true;
}

// Sends the events to the tab. false if real input isn't possible here: the caller falls back to script events.
// Nothing was sent then.
export async function sendMouse(tabId: number, events: MouseEvent[]): Promise<boolean> {
  if (!(await attach(tabId))) return false;
  try {
    for (const e of events) await browser.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', e);
  } catch (err) {
    // Never leave the button held down: a press without its release would drag on every later move.
    const at = events[0]!;
    await browser.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 }).catch(() => {});
    throw err;
  }
  return true;
}

// After each command or run: no debugger stays attached.
export async function detachAll(): Promise<void> {
  const tabs = [...attached];
  attached.clear();
  await Promise.all(tabs.map((tabId) => browser.debugger.detach({ tabId }).catch(() => {})));
}
