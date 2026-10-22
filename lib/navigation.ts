// Navigation: goto, back, and following a tab a page opened. They run in the side panel because they use the tabs API, not the page.

// Only http(s) URLs. Blocks javascript:, data:, file:, chrome: and anything else.
export function safeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Not a full URL: ${JSON.stringify(input)}. Use e.g. https://example.com`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked: only http and https URLs are allowed, not ${url.protocol}`);
  }
  return url.href;
}

// The tab an agent command works in (#16). While set, every command goes to this tab by its id, never to whatever tab
// you're looking at, so the agent can't wander into your tabs. The panel clears it when you type a command.
let pinned: number | null = null;
export const pinTab = (id: number | null) => {
  pinned = id;
};

// The tab commands go to: the agent command's pinned tab, else the active tab of this window (hand commands).
export async function targetTabId(): Promise<number> {
  if (pinned !== null) return pinned;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab.id;
}

// How long goto waits for the new page to commit, like settle's cap.
const LOAD_MS = 15000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until the new page has replaced the old one (or the load ended without it), then says where the tab really is.
// pendingUrl is "the URL the tab is navigating to, before it has committed".
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab
export async function goto(input: string): Promise<string> {
  const url = safeUrl(input);
  const tabId = await targetTabId();
  const before = (await browser.tabs.get(tabId)).url ?? '';
  let tab = await browser.tabs.update(tabId, { url });
  let started = !!tab?.pendingUrl || tab?.status === 'loading';
  const start = Date.now();
  while (Date.now() - start < LOAD_MS) {
    tab = await browser.tabs.get(tabId);
    started ||= !!tab.pendingUrl || tab.status === 'loading';
    // Committed: a new URL, nothing pending. Same URL: done once the load ends; a load that never starts gets 2 s.
    if (!tab.pendingUrl && (tab.url !== before || (tab.status === 'complete' && (started || Date.now() - start > 2000)))) break;
    await sleep(100);
  }
  return arrived(url, before, tab?.url ?? '', tab?.pendingUrl);
}

// goto's result from where the tab ended up. Never "ok" unless the tab is on the page (or the site's redirect).
export function arrived(url: string, before: string, now: string, pending?: string): string {
  if (pending) throw new Error(`goto ${url}: still loading after ${LOAD_MS / 1000} s, so the tab still shows ${before}. Send read in a moment to see if it arrived`);
  if (now === url) return `ok — on ${url}`;
  if (now === before) throw new Error(`goto ${url} did not navigate: the tab is still on ${before}. Try goto again`);
  return `ok — asked for ${url}, the site sent it on to ${now}`;
}

const tabOf = (id: number) => browser.tabs.get(id).catch(() => undefined); // undefined once it's closed

// Waits for a tab's page to load (up to LOAD_MS), so the next read sees the site, not a blank tab. false: the tab is
// gone. A pendingUrl means its page hasn't committed yet, even if the blank tab says complete.
export async function loaded(id: number): Promise<boolean> {
  const end = Date.now() + LOAD_MS;
  for (;;) {
    const tab = await tabOf(id);
    if (!tab) return false;
    if ((tab.status === 'complete' && !tab.pendingUrl) || Date.now() >= end) return true;
    await sleep(200);
  }
}

// Makes tab id the active one, where hand and MCP commands go, if it's in the same window as tab from.
async function bringForward(id: number, from: number): Promise<boolean> {
  const [tab, was] = [await tabOf(id), await tabOf(from)];
  if (!tab || tab.windowId !== was?.windowId) return false;
  await browser.tabs.update(id, { active: true });
  return true;
}

// #8, #14: a tab that tab from's page opened (a link with target=_blank) becomes the one commands go to, once loaded.
// false: it's gone (a download closes its tab) or in another window, where commands can't go.
export async function follow(id: number, from: number): Promise<boolean> {
  return (await loaded(id)) && bringForward(id, from);
}

export async function back(): Promise<string> {
  const id = await targetTabId();
  try {
    await browser.tabs.goBack(id);
    return 'ok — went back';
  } catch (err) {
    // Chrome's words when there's no earlier page: "Cannot find a next page in history."
    if (!/page in history/i.test(String(err))) throw err;
  }
  // #15: a tab a link opened has no earlier page: the page it came from is in the tab that opened it.
  const opener = (await tabOf(id))?.openerTabId;
  const none = "Can't go back: this tab has no earlier page";
  if (opener === undefined) throw new Error(`${none}.`);
  // A command pinned to its tab (a repeat's recipe) stays there, so it never jumps to the opener midway.
  if (pinned !== null) throw new Error(`${none}. Another tab opened it: send back on its own to go there.`);
  if (!(await bringForward(opener, id))) throw new Error(`${none}, and the tab that opened it is in another window.`);
  return 'ok — this tab had no earlier page, so went to the tab that opened it';
}
