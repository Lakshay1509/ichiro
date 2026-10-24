// Settle: after an action, wait until the page stops loading and changing, so you never act on an old view.
// Adapts to the connection (waits for the page's own requests) and the machine (waits out busy JS).
import { targetTabId } from './navigation.ts';
import { scriptReady, send } from './send-to-tab.ts';

// Safety nets only; the real signals are requests, DOM changes and busy JS. Slow requests get the long one,
// endless DOM churn (videos, tickers) the short one.
const MAX_MS = 15000;
const DOM_MAX_MS = 5000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Content script side: true once the page has had 500 ms with no DOM changes and no busy JS, false if it's still
// changing at maxMs. Busy JS = tasks of 50 ms+, so a slow machine or heavy page waits longer.
export function waitForQuiet(maxMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (quiet: boolean) => {
      observer.disconnect();
      busy.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(capTimer);
      resolve(quiet);
    };
    let quietTimer = setTimeout(finish, 500, true);
    const capTimer = setTimeout(finish, maxMs, false);
    const restart = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, 500, true);
    };
    const observer = new MutationObserver(restart);
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    // Source: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming
    const busy = new PerformanceObserver(restart);
    busy.observe({ type: 'longtask' });
  });
}

// Side panel side. Never injects: during a page load Chrome injects the script itself.
async function domQuiet(tabId: number, deadline: number): Promise<boolean> {
  const maxMs = Math.min(deadline - Date.now(), DOM_MAX_MS);
  if (maxMs <= 0) return false;
  try {
    return await send(tabId, { type: 'settle', maxMs });
  } catch {
    // No script to ask (navigation killed it, or a page we can't run on). A page load is handled by the caller.
    return true;
  }
}

// Chrome closes the message channel when the page navigates away mid-action: into the back/forward cache (since
// Chrome 123) or unloaded. The action was delivered, so it's the new page we settle on.
// Source: https://developer.chrome.com/blog/bfcache-extension-messaging-changes
const NAVIGATED_AWAY = /back\/forward cache|message (channel|port) closed before a response was received/i;

// Runs the action, then waits for the DOM to go quiet and a full page load (if one started). If a request is still
// running, waits for it and checks again: SPAs fetch first and swap content later.
// Adds "(page still changing)" if a cap hits; pages with videos or tickers never go quiet.
export async function settleAfter(action: () => Promise<string>): Promise<string> {
  const tabId = await targetTabId();
  let loading = false;
  let markLoaded = () => {};
  const loaded = new Promise<void>((resolve) => (markLoaded = resolve));
  // Listen before acting, so the start of a page load can't be missed.
  // Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onUpdated
  const onUpdated = (id: number, info: { status?: string }) => {
    if (id !== tabId) return;
    if (info.status === 'loading') loading = true;
    if (info.status === 'complete' && loading) markLoaded();
  };
  // The top page's data, script and page requests still running. fetch() counts as xmlhttprequest. Images, media,
  // beacons, websockets and iframes (ads) are ignored. Source: https://developer.chrome.com/docs/extensions/reference/api/webRequest
  // shortcut: a long-poll request started after the action holds settle until MAX_MS. Upgrade: ignore requests by URL pattern.
  const pending = new Set<string>();
  const filter: Browser.webRequest.RequestFilter = { urls: ['<all_urls>'], tabId, types: ['main_frame', 'script', 'xmlhttprequest'] };
  const onStart = (d: { requestId: string; frameId: number }): undefined => {
    if (d.frameId === 0) pending.add(d.requestId);
  };
  const onEnd = (d: { requestId: string }) => {
    pending.delete(d.requestId);
  };
  browser.tabs.onUpdated.addListener(onUpdated);
  browser.webRequest.onBeforeRequest.addListener(onStart, filter);
  browser.webRequest.onCompleted.addListener(onEnd, filter);
  browser.webRequest.onErrorOccurred.addListener(onEnd, filter);
  try {
    let result: string;
    try {
      result = await action();
    } catch (err) {
      // Counts as sent only if a page load really started (within 2 s); otherwise it's a real failure.
      if (!NAVIGATED_AWAY.test(String(err))) throw err;
      for (const end = Date.now() + 2000; !loading && Date.now() < end; ) await sleep(50);
      if (!loading) throw err;
      result = 'sent; the page navigated away before it could reply';
    }
    const deadline = Date.now() + MAX_MS;
    let quiet: boolean;
    for (;;) {
      quiet = await domQuiet(tabId, deadline);
      if (loading) {
        await Promise.race([loaded, sleep(deadline - Date.now())]);
        quiet = (await scriptReady(tabId, deadline)) && (await domQuiet(tabId, deadline));
      }
      // Settled, unless the DOM is quiet while a request still runs (an SPA fetching its next view).
      // A DOM that never goes quiet (videos) stops here too: waiting on its requests would only add delay.
      if (!quiet || !pending.size || Date.now() >= deadline) break;
      while (pending.size && Date.now() < deadline) await sleep(100);
    }
    return quiet ? result : `${result} (page still changing)`;
  } finally {
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.webRequest.onBeforeRequest.removeListener(onStart);
    browser.webRequest.onCompleted.removeListener(onEnd);
    browser.webRequest.onErrorOccurred.removeListener(onEnd);
  }
}
