// sendToTab: sends a message to the target tab's content script, injecting the script if it's missing.
// .ts extension: Node's test runner (send-to-tab.test.ts) needs it for value imports.
import { HandOver, STALE_MS, StopLine, type Envelope, type Message, type Replies } from './messages.ts';
import { targetTabId } from './navigation.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Chrome only lets extensions run on http(s) and file pages, and never on the Web Store.
export function canRunOn(url: string | undefined): boolean {
  if (!url) return false;
  const { protocol, hostname, pathname } = new URL(url);
  if (hostname === 'chromewebstore.google.com') return false;
  if (hostname === 'chrome.google.com' && pathname.startsWith('/webstore')) return false;
  return ['http:', 'https:', 'file:'].includes(protocol);
}

// Plain send to one frame (0 = the top page), no injecting. Unwraps the reply, or throws the page's error.
// Always pass a frameId: without one Chrome delivers to every frame, and all of them would act.
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage
export async function send<M extends Message>(tabId: number, msg: M, frameId = 0): Promise<Replies[M['type']]> {
  // sentAt lets the page ignore messages that arrive after we gave up (see STALE_MS).
  const ask = (m: Message): Promise<Envelope<Replies[M['type']]>> =>
    browser.tabs.sendMessage(tabId, { ...m, sentAt: Date.now() }, { frameId });
  const reply = ask(msg);
  // A browser alert/confirm/prompt freezes the page, so it never answers. Every 5 s, check it still answers a ping.
  const settled = () => reply.then(() => true, () => true);
  while (!(await Promise.race([settled(), sleep(STALE_MS).then(() => false)]))) {
    const alive = await Promise.race([ask({ type: 'ping' }).then(() => true, () => true), sleep(1000).then(() => false)]);
    if (!alive) throw new Error('Page blocked — maybe a browser dialog (alert/confirm/prompt) is open. Close it, then try again.');
  }
  const answer = await reply;
  if ('stop' in answer) throw new StopLine(answer.stop);
  if ('handOver' in answer) throw new HandOver(answer.handOver);
  if ('error' in answer) throw new Error(answer.error);
  return answer.value;
}

// Waits for the tab's content script to answer (e.g. after a page load). true right away on pages we can't run on.
export async function scriptReady(tabId: number, deadline: number): Promise<boolean> {
  if (!canRunOn((await browser.tabs.get(tabId)).url)) return true; // nothing to wait for
  while (Date.now() < deadline) {
    try {
      await send(tabId, { type: 'ping' });
      return true;
    } catch {
      await sleep(100);
    }
  }
  return false;
}

// How long a command waits for a loading page before giving up.
const LOAD_WAIT_MS = 15000;

// To the tab commands go to: the agent command's own tab, else the active one (targetTabId).
export async function sendToTab<M extends Message>(msg: M, frameId = 0): Promise<Replies[M['type']]> {
  const tab = await browser.tabs.get(await targetTabId());
  if (!tab.id || !canRunOn(tab.url)) throw new Error("Can't run on this page");
  try {
    return await send(tab.id, msg, frameId);
  } catch (err) {
    // Tabs opened before the extension (re)loaded have no content script yet: inject it, retry once.
    // Only on this error, so we never inject a second copy into a page that already has one.
    if (!String(err).includes('Receiving end does not exist')) throw err;
    if (frameId !== 0) throw new Error('That frame is gone — run read again');
    // While loading, Chrome is about to inject its own copy (document_start); injecting too would load it twice
    // (and every command would run twice). So wait for that copy to answer instead of failing.
    // Source: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
    if (tab.status !== 'complete') {
      if (!(await scriptReady(tab.id, Date.now() + LOAD_WAIT_MS))) throw new Error('Page is still loading — try again in a moment');
      return await send(tab.id, msg);
    }
    await browser.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['/content-scripts/content.js'] });
    return await send(tab.id, msg);
  }
}
