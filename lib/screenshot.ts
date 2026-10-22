// Screenshot (F1): look's picture of the agent's tab, with element numbers on it, and the guards that keep any other
// tab, off-Sites page or secret out of it (F1b). Inspired by browser-use's numbered screenshots (set-of-marks).
import { isCheckoutUrl } from './stop-lines.ts';

// Anthropic's computer-use docs suggest 1280×800 for web apps; wider costs more tokens for little gain.
// Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
const MAX_WIDTH = 1280;
// Heavy JPEG compression makes small text hard to read (vision docs); checked by eye in the live run.
const JPEG_QUALITY = 0.85;

export const OFF_SCREEN = "the run's tab isn't on screen. Ask the user to keep it the front tab in a Chrome window that isn't minimized, or read the page as text";

export interface Shot {
  data: string; // base64 JPEG
  width: number;
  height: number;
}

// What takeShot needs from the browser, so the guards can be tested without one.
export interface ShotTab {
  get(): Promise<{ active: boolean; url: string }>; // the run's tab right now
  switches(): number; // tab switches seen so far (tabs.onActivated)
  numbers(on: boolean): Promise<string>; // draws (on) or clears the numbers in every frame; why no picture may be taken, or ''
  capture(): Promise<string>; // the window's visible tab, as a data URL
}

// F1b: a picture only of the run's tab, only on a plan Site, never with a secret field or on a checkout page.
// captureVisibleTab shoots whatever tab is on screen, so the run's tab must be active before and after, with no switch
// in between. Any doubt → no picture, and the reason.
export async function takeShot(onPlan: boolean, tab: ShotTab): Promise<{ dataUrl: string } | { why: string }> {
  if (!onPlan) return { why: "not one of the run's Sites" };
  const before = await tab.get();
  if (isCheckoutUrl(before.url)) return { why: 'checkout or payment page' };
  if (!before.active) return { why: OFF_SCREEN };
  const seen = tab.switches();
  let dataUrl = '';
  let why = '';
  try {
    why = await tab.numbers(true);
    if (!why) dataUrl = await tab.capture();
  } finally {
    // Always cleared, even when the capture fails. A secret that showed up meanwhile still drops the picture.
    const later = await tab.numbers(false);
    why ||= later;
  }
  if (why) return { why };
  const after = await tab.get();
  if (tab.switches() !== seen || !after.active) return { why: OFF_SCREEN };
  if (after.url !== before.url) return { why: 'the page changed during the picture' };
  return { dataUrl };
}

// Shrinks a captured PNG to at most MAX_WIDTH wide (HiDPI screens capture at 2×) and encodes it once as JPEG:
// every extra lossy pass blurs small text. Browser only.
// Sources: https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
// https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob
export async function shrink(dataUrl: string): Promise<Shot> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })).arrayBuffer());
  // In chunks: spreading a whole screenshot into fromCharCode overflows the stack.
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(bin), width, height };
}
