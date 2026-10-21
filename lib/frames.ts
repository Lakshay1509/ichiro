// Frames: reads every frame of the tab and numbers elements across all of them, so actions reach the right frame.
import { captchaKind } from './captcha';
import { findByLabel, labelOf, nameOf } from './find-by-label';
import { claim, clashed } from './numbers';
import type { Message } from './messages';
import { targetTabId } from './navigation';
import { send, sendToTab } from './send-to-tab';

// Element number → the frame that owns it, from the latest read.
let frameOfElement = new Map<number, number>();
// The last element number given out. Kept for the browser session, so a reopened panel never gives out a number the
// AI already saw. Source: https://developer.chrome.com/docs/extensions/reference/api/storage (session area)
let lastNumber: number | undefined;
// One read at a time: two at once would give the same new numbers to two frames.
let reading: Promise<unknown> = Promise.resolve();
// The element lines of the latest read, all frames, for finding elements by label.
let readLines: string[] = [];
// /overlay's setting (remembered across panel opens): every read sends it, so a newly opened page draws numbers too.
let overlayOn = false;
export const setOverlayOn = (on: boolean) => void (overlayOn = on);

// The number of the element called label in the latest read. Throws on no match or several.
export const numberFor = (label: string) => findByLabel(readLines, label);
// RP1: element n's name in the latest read, when that name is its alone (labelOf).
export const labelFor = (n: number) => labelOf(readLines, n);
// RP1: element n's name in the latest read, shared or not (to show it).
export const nameFor = (n: number) => nameOf(readLines, n);

// The frame to send an action for element n to.
export function frameFor(n: number): number {
  if (clashed(n)) throw new Error(`Element [${n}] has a number another element had — reload the page, then run read again`);
  const frameId = frameOfElement.get(n);
  if (frameId === undefined) throw new Error(`Element [${n}] not found — run read again`);
  return frameId;
}

// Every frame except the top page. Source: https://developer.chrome.com/docs/extensions/reference/api/webNavigation
async function childFrames(tabId: number) {
  return ((await browser.webNavigation.getAllFrames({ tabId })) ?? []).filter((f) => f.frameId !== 0);
}

const frameLine = (url: string) => `--- iframe: ${URL.parse(url)?.hostname || url} ---`;

// Visible text of the top page, then of each frame that has any (a payment form or embed can hold the answer).
// whole: the whole page, not just the screen (F3a). Not cut: the caller cuts it with capText for the model, and V1 keeps
// the whole of a text all for the done check's search.
export async function textAll(whole = false): Promise<string> {
  const tabId = await targetTabId();
  const msg = { type: 'text', all: whole } as const;
  const parts = [await sendToTab(msg)];
  for (const frame of await childFrames(tabId)) {
    const text = await send(tabId, msg, frame.frameId).catch(() => '');
    if (text) parts.push(frameLine(frame.url), text);
  }
  return parts.filter(Boolean).join('\n');
}

// F3b: pick in the top page (a bad selector throws there), then in each frame that has matches.
export async function pickInFrames(selector: string): Promise<string> {
  const tabId = await targetTabId();
  const msg = { type: 'pick', selector } as const;
  const parts = [await sendToTab(msg)];
  for (const frame of await childFrames(tabId)) {
    const part = await send(tabId, msg, frame.frameId).catch(() => '');
    if (part) parts.push(frameLine(frame.url), part);
  }
  return parts.filter(Boolean).join('\n') || `No match for ${JSON.stringify(selector)} (hidden elements, secret fields and ones without text are skipped).`;
}

// R1: the frame holding the shown page texts reading exactly text (that frame picks among several). None, or texts
// in two frames, → error.
export async function textFrame(text: string): Promise<number> {
  const tabId = await targetTabId();
  const frames = [0, ...(await childFrames(tabId)).map((f) => f.frameId)];
  const counts = await Promise.all(frames.map((id) => (id ? send(tabId, { type: 'textCount', text }, id).catch(() => 0) : sendToTab({ type: 'textCount', text }))));
  const total = counts.reduce((a, b) => a + b, 0);
  const holding = frames.filter((_, i) => counts[i]);
  if (holding.length > 1) throw new Error(`${total} shown texts read ${JSON.stringify(text)}: click a numbered element or a longer text`);
  if (!total) throw new Error(`Nothing called ${JSON.stringify(text)} on this page, as an element or as page text. Use a number, or the exact words of a quoted line`);
  return holding[0]!;
}

// R1: the script click on that text, in its frame.
export async function clickTextIn(frameId: number, text: string, allow: boolean): Promise<string> {
  return frameId ? send(await targetTabId(), { type: 'clickText', text, allow }, frameId) : sendToTab({ type: 'clickText', text, allow });
}

// 4.2: the CAPTCHA shown in any frame of the tab, or ''. Most pages have no CAPTCHA frame at all: then no frame is asked.
export async function captchaAll(): Promise<string> {
  const tabId = await targetTabId();
  const frames = await childFrames(tabId);
  if (!frames.some((f) => captchaKind(f.url))) return '';
  // The frame's parent page knows if it's shown, so every frame is asked; frames without the script are skipped.
  const kinds = [await sendToTab({ type: 'captcha' })];
  for (const frame of frames) kinds.push(await send(tabId, { type: 'captcha' }, frame.frameId).catch(() => ''));
  return kinds.find(Boolean) ?? '';
}

// footer=false drops the debug footer for the AI.
export function readAll(footer = true): Promise<string> {
  const run = reading.then(() => readFrames(footer));
  reading = run.catch(() => {});
  return run;
}

async function readFrames(footer: boolean): Promise<string> {
  const start = performance.now();
  const tabId = await targetTabId();
  lastNumber ??= Number((await browser.storage.session.get('lastNumber')).lastNumber ?? 0);
  // Top page first (sendToTab also injects the script into tabs opened before the extension loaded).
  const top = await sendToTab({ type: 'read', next: lastNumber, overlay: overlayOn });
  lastNumber = Math.max(lastNumber, ...top.numbers);
  claim(top.numbers, `tab ${tabId} frame 0`);
  frameOfElement = new Map(top.numbers.map((n) => [n, 0]));
  const lines = [...top.lines];
  // What's printed: elements with the text around them (F2). Numbers and labels come from the element lines only.
  const parts = [...top.page];
  let total = top.total;

  for (const frame of await childFrames(tabId)) {
    // No script there (a browser page, or still loading): skip that frame.
    const part = await send(tabId, { type: 'read', next: lastNumber, overlay: overlayOn }, frame.frameId).catch(() => null);
    if (!part?.lines.length) continue;
    lastNumber = Math.max(lastNumber, ...part.numbers);
    claim(part.numbers, `tab ${tabId} frame ${frame.frameId}`);
    part.numbers.forEach((n) => frameOfElement.set(n, frame.frameId));
    total += part.total;
    lines.push(...part.lines);
    parts.push(frameLine(frame.url), ...part.page);
  }
  readLines = lines;
  // Saved before the AI sees the read, so every number it saw is at or below the saved one.
  await browser.storage.session.set({ lastNumber });

  const text = [top.header, `Elements (${frameOfElement.size}):`, ...parts].join('\n');
  const ms = Math.round(performance.now() - start);
  if (!footer) return text;
  // Debug footer for you, not for the AI. Tokens ≈ characters ÷ 4.
  return `${text}\n(${frameOfElement.size} of ${total} visible · ${ms} ms · ~${Math.round(text.length / 4)} tokens)`;
}

// F1a/F1b: draws (on) or clears the screenshot numbers in every frame at once. Returns why no picture may be taken, or ''.
// Fails closed: a frame that can't answer (another extension's, still loading) might be showing a secret field.
export async function numbersAll(on: boolean): Promise<string> {
  const tabId = await targetTabId();
  const frames = [{ frameId: 0, url: '' }, ...(await childFrames(tabId))];
  const replies = await Promise.all(frames.map((f) =>
    send(tabId, { type: 'shot', on }, f.frameId).then(
      (secret) => (secret ? 'a password, card or one-time-code field is on screen' : ''),
      () => `a frame didn't answer (${URL.parse(f.url)?.hostname || f.url || 'top page'}), so it may show a secret field`,
    )));
  return replies.find(Boolean) ?? '';
}

// Sends the same message to the top page and every frame; frames without the script are skipped.
// WR2: the frame focus is in: the top page (0), or a same-site frame focus went into (a canvas app's hidden text box),
// which checks itself. null: focus is in another site's frame, which no check can see into.
export async function focusedFrame(): Promise<number | null> {
  const tabId = await targetTabId();
  if (await sendToTab({ type: 'focusHere' })) return 0;
  for (const frame of await childFrames(tabId)) if (await send(tabId, { type: 'focusHere' }, frame.frameId).catch(() => false)) return frame.frameId;
  return null;
}

export async function sendToAllFrames<M extends Message>(msg: M) {
  const tabId = await targetTabId();
  const result = await sendToTab(msg);
  for (const frame of await childFrames(tabId)) await send(tabId, msg, frame.frameId).catch(() => null);
  return result;
}
