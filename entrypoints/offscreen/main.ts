// The hidden page's script: reads a PDF's text with pdf.js when one of this extension's own pages asks (lib/offscreen.ts).
import { fromOwnPage, isPdfAsk } from '@/lib/offscreen';
import { loadPdf } from '@/lib/pdf';

browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  // This page fetches with your cookies and reads file:// downloads, so a content script (which a page can drive) never gets an answer.
  if (!isPdfAsk(msg) || !fromOwnPage(sender, browser.runtime.id, browser.runtime.getURL('/'))) return false;
  loadPdf(msg.url).then(
    (value) => sendResponse({ value }),
    // Thrown errors don't cross the message channel, so send their text.
    (err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }),
  );
  // Keep the channel open for the async reply.
  // Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
  return true;
});
