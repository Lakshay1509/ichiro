// BG4: real input on the command's tab (mouse, keyboard, typing where the cursor is) and look's screenshot.
import { MAX_COMMAND } from '@/lib/bridge';
import { focusedFrame, numbersAll } from '@/lib/frames';
import { keyEvents, parseKey, scriptKey } from '@/lib/keys';
import { targetTabId } from '@/lib/navigation';
import { attach, checkPoint, checkScriptClick, clickAtPoint, dragAlong, moveTo, sendKeys, sendMouse, sendText, type Point } from '@/lib/real-input';
import { isDrawn, shrink, takeShot, type Shot } from '@/lib/screenshot';
import { send, sendToTab } from '@/lib/send-to-tab';

// Tab switches in any window. A switch during a capture means the picture may show your tab, so it's dropped (takeShot).
export let tabSwitches = 0;
// Called once when the worker starts (index.ts): no listener at a module's top level.
export const watchTabSwitches = () => browser.tabs.onActivated.addListener(() => tabSwitches++);

// WR1: the last screenshot's tab and size: click x,y and drag points are its pixels, what the model saw.
let lastShot: { tabId: number; width: number; height: number } | null = null;

// I1: a click (or hover) with the real mouse when it can: an element on the top page, and the debugger attached.
// The content script checks first (on screen, not covered, stop-lines unless allowed) and guards the click so it
// can't land on anything else. Otherwise, our script click (frames, a cancelled debugging bar, pages Chrome won't
// attach to). clicks and modifiers as for click x,y; the script click can't carry them, so it refuses them.
// Source: https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json
export async function realMouse(target: { n?: number; text?: string }, allow: boolean, hover: boolean, frameId: number, script: () => Promise<string>, clicks: 1 | 2 = 1, modifiers = 0): Promise<string> {
  const fallback = () => {
    checkScriptClick(clicks, modifiers);
    return script();
  };
  if (frameId !== 0) return fallback();
  const tabId = await targetTabId();
  const aimed = await sendToTab({ type: 'aim', ...target, allow, hover });
  if (!aimed) return fallback();
  let sent = false;
  let blocked = '';
  try {
    const point = checkPoint(aimed);
    sent = await sendMouse(tabId, hover ? moveTo(point) : clickAtPoint(point, clicks, modifiers));
  } finally {
    // A click that navigates leaves no page to ask: nothing was stopped then.
    if (!hover) blocked = await sendToTab({ type: 'aimDone' }).catch(() => '');
  }
  if (!sent) return fallback();
  if (blocked) throw new Error(`${blocked}. Look at the page again`);
  return `${hover ? 'ok — real mouse' : clicks === 2 ? 'ok — real double-click' : 'ok — real click'}${aimed.note}`;
}

const NO_REAL_MOUSE = "No real mouse on this page (the debugging bar was cancelled, or Chrome won't attach here): clicks and drags at points need it";

// WR1: a click or drag at points in the last screenshot, with the real mouse only: a canvas has no element to fall back
// to. The content script checks both ends (stop-lines unless allowed) and guards them, as for a click.
// Round 2 (harness/mcp-context.md): checked again once the mouse is at the press point, because a page can change under
// a hovering mouse (Google Slides does): the press then lands on exactly what that second check passed. The first check
// refuses a bad point before the mouse moves at all.
export async function realPoints(points: Point[], clicks: 1 | 2, modifiers: number, allow: boolean): Promise<string> {
  const tabId = await targetTabId();
  if (lastShot?.tabId !== tabId) throw new Error('No screenshot of this tab yet: x,y are pixels in the last screenshot (look takes one)');
  // Attached before the checks, so they see the page with Chrome's debugging bar, as the mouse will.
  if (!(await attach(tabId))) throw new Error(NO_REAL_MOUSE);
  const shot = { width: lastShot.width, height: lastShot.height };
  const aim = () => sendToTab({ type: 'aimPoints', points, shot, allow });
  let aimed = await aim();
  const drag = points.length > 1;
  let sent = false;
  let blocked = '';
  try {
    if (await sendMouse(tabId, moveTo(checkPoint(aimed.points[0])))) {
      aimed = await aim();
      const css = aimed.points.map(checkPoint);
      sent = await sendMouse(tabId, drag ? dragAlong(css, modifiers) : clickAtPoint(css[0]!, clicks, modifiers));
    }
  } finally {
    blocked = await sendToTab({ type: 'aimDone' }).catch(() => '');
  }
  if (!sent) throw new Error(NO_REAL_MOUSE);
  if (blocked) throw new Error(`${blocked}. Take a new screenshot`);
  return `ok — real ${drag ? 'drag' : clicks === 2 ? 'double-click' : 'click'}${aimed.note}`;
}

const NO_REAL_KEYBOARD = "No real keyboard on this page (the debugging bar was cancelled, or Chrome won't attach here): this needs it";

// A Mac (keyEvents adds its Cmd editing commands): asked once, on the first key; the OS can't change while Chrome runs.
// Source: https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getPlatformInfo
let mac: Promise<boolean> | undefined;

// WR1: a key or shortcut with the real keyboard, after the checks on what has focus, in the frame focus is in (WR2): a
// same-site frame checks its own field; another site's frame gets the top page's frame rules. Pages like Google Slides
// ignore script keys, so F's keys (Enter, Escape, Tab, Backspace, arrows) go real too, and fall back to F's script
// event, in that frame, for Escape to the panel on top or when there's no real keyboard.
export async function realKey(input: string, allow: boolean): Promise<string> {
  const k = parseKey(input);
  const tabId = await targetTabId();
  const frame = (await focusedFrame()) ?? 0;
  const where = await sendToTab({ type: 'aimKey', key: input, allow }, frame);
  mac ??= browser.runtime.getPlatformInfo().then((p) => p.os === 'mac');
  if (where !== null && (await sendKeys(tabId, keyEvents(k, await mac)))) return `ok — pressed ${k.name} on ${where}`;
  if (!scriptKey(k)) throw new Error(NO_REAL_KEYBOARD);
  return sendToTab({ type: 'key', key: k.key, allow }, frame);
}

// WR2: the frame focus is in, for text; never another site's frame, which no check can see into.
export async function typingFrame(): Promise<number> {
  const frame = await focusedFrame();
  if (frame === null) throw new Error("Not sent: focus is inside another site's frame, which can't be checked. Click into the field first");
  return frame;
}

// WR2: the text a paste or type here was given, checked: something, and not past what a command line may carry.
export function checkText(text: string, usage: string): string {
  if (!text) throw new Error(`Usage: ${usage}`);
  if (text.length > MAX_COMMAND) throw new Error(`Text too long: ${text.length} characters, at most ${MAX_COMMAND}. Split it`);
  return text;
}

// WR2: type here: text typed where the cursor is with the real keyboard's input method (Input.insertText), after the
// checks in the frame focus is in. For text boxes that aren't in the page list (a drawing app's, a slide's).
export async function typeHere(text: string, allow: boolean): Promise<string> {
  const tabId = await targetTabId();
  const where = await sendToTab({ type: 'aimText', paste: false, allow }, await typingFrame());
  if (!(await sendText(tabId, text))) throw new Error(NO_REAL_KEYBOARD);
  return `ok — typed ${text.length} characters into ${where}`;
}

// F1a: look's screenshot of the agent's tab with the latest read's numbers on it, or why there's none (F1b guards).
export async function screenshot(onPlan: boolean): Promise<Shot | string> {
  try {
    const tabId = await targetTabId();
    const { windowId } = await browser.tabs.get(tabId);
    // WR1: attached first, so the picture has Chrome's debugging bar as real input will (it shows while attached and
    // 5 s after), and points in it map onto the page. A fresh attach gets a moment for the bar to come in.
    if (onPlan && (await attach(tabId)) === 'fresh') await new Promise((resolve) => setTimeout(resolve, 250));
    const shot = await takeShot(onPlan, {
      get: async () => {
        const tab = await browser.tabs.get(tabId);
        // Same window too: captureVisibleTab shoots the window's active tab, which isn't ours if ours moved away.
        // And drawn (isDrawn), asked of the tab itself, so it holds in any window, with the panel open or not.
        const drawn = isDrawn(await send(tabId, { type: 'ping' }).catch(() => null), await browser.windows.get(windowId));
        return { active: tab.active && tab.windowId === windowId && drawn, url: tab.url ?? '' };
      },
      switches: () => tabSwitches,
      numbers: numbersAll,
      // PNG, so the only lossy step is shrink's one JPEG pass. Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab
      capture: () => browser.tabs.captureVisibleTab(windowId, { format: 'png' }),
    });
    if ('why' in shot) return shot.why;
    const small = await shrink(shot.dataUrl);
    lastShot = { tabId, width: small.width, height: small.height };
    return small;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
