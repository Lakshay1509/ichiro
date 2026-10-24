// Checks BG2's guard: the hidden page answers only this extension's own pages, and only a read-pdf ask. Run: npm test
import { fromOwnPage, isPdfAsk, isTextAsk } from './offscreen.ts';

const fail = (what: string): never => {
  throw new Error(what);
};

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${ID}/`;
const cases: [string, { id?: string; tab?: unknown; url?: string }, boolean][] = [
  ['the side panel', { id: ID, url: `${ORIGIN}sidepanel.html` }, true],
  ['the background worker', { id: ID, url: `${ORIGIN}background.js` }, true],
  ['our content script in a tab', { id: ID, tab: { id: 7 }, url: 'https://evil.example/' }, false],
  ['a tab showing one of our pages', { id: ID, tab: { id: 7 }, url: `${ORIGIN}sidepanel.html` }, false],
  ['another extension', { id: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', url: 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/x.html' }, false],
  ['our id with a web URL', { id: ID, url: 'https://evil.example/' }, false],
  ['an origin that only starts like ours', { id: ID, url: `chrome-extension://${ID}x/x.html` }, false],
  ['no URL', { id: ID }, false],
  ['no id', { url: `${ORIGIN}sidepanel.html` }, false],
];
for (const [what, sender, want] of cases) {
  if (fromOwnPage(sender, ID, ORIGIN) !== want) fail(`fromOwnPage, ${what}: want ${want}`);
}

const asks: [unknown, boolean][] = [
  [{ type: 'read-pdf', url: 'https://example.com/a.pdf' }, true],
  [{ type: 'read-pdf', url: 42 }, false],
  [{ type: 'read-pdf' }, false],
  [{ type: 'click', url: 'https://example.com/' }, false],
  [null, false],
  ['read-pdf', false],
];
for (const [msg, want] of asks) {
  if (isPdfAsk(msg) !== want) fail(`isPdfAsk ${JSON.stringify(msg)}: want ${want}`);
}

// BG4: a text read is only ever a local file, never a web URL fetched with your cookies.
const texts: [unknown, boolean][] = [
  [{ type: 'read-text', url: 'file:///C:/Users/ann/Downloads/a.csv' }, true],
  [{ type: 'read-text', url: 'https://example.com/a.csv' }, false],
  [{ type: 'read-text', url: 'file://server/share/a.csv' }, false],
  [{ type: 'read-text' }, false],
  [{ type: 'read-pdf', url: 'file:///C:/a.pdf' }, false],
];
for (const [msg, want] of texts) {
  if (isTextAsk(msg) !== want) fail(`isTextAsk ${JSON.stringify(msg)}: want ${want}`);
}
