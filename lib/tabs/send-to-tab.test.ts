// Checks canRunOn against allowed and blocked URLs. Run: npm test
import { canRunOn } from './send-to-tab.ts';

const cases: [string | undefined, boolean][] = [
  ['https://en.wikipedia.org/wiki/Alan_Turing', true],
  ['http://localhost:3000/', true],
  ['file:///C:/notes.html', true],
  ['https://chrome.google.com/search', true],
  ['chrome://extensions/', false],
  ['edge://settings/', false],
  ['about:blank', false],
  ['view-source:https://example.com/', false],
  ['chrome-extension://abcdef/sidepanel.html', false],
  ['https://chromewebstore.google.com/detail/abc', false],
  ['https://chrome.google.com/webstore/category/extensions', false],
  [undefined, false],
];

for (const [url, want] of cases) {
  if (canRunOn(url) !== want) throw new Error(`canRunOn(${url}) should be ${want}`);
}
