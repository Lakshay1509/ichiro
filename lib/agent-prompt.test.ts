// Checks the shared site rules (Sites, a new site's ask, goto's check) and history lines. Run: npm test
import { checkGoto, frameSiteToAsk, onSites, siteOn, siteToAdd, siteToOpen, summarize, wantsSite } from './agent-prompt.ts';
import { splitReply } from './panel/readable-log.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const throws = (f: () => unknown, what: string) => {
  try {
    f();
  } catch {
    return;
  }
  fail(`${what} should throw`);
};

// S1: a stand-in for chrome.publicSuffix.getDomain. Registrable domain = the longest known suffix plus one label;
// a suffix itself (github.io, co.uk, httpbin.org: Postman's entry on the real list) only with allowPlainSuffix; null
// for IPs and unknown endings, like Chrome's defaults.
const SUFFIXES = ['com', 'org', 'in', 'io', 'uk', 'co.uk', 'github.io', 'httpbin.org', 'example'];
const getDomain = (host: string, options?: { allowPlainSuffix?: boolean }) => {
  if (SUFFIXES.includes(host)) return options?.allowPlainSuffix ? host : null;
  const labels = host.split('.');
  for (let i = 1; i < labels.length; i++) if (SUFFIXES.includes(labels.slice(i).join('.'))) return labels.slice(i - 1).join('.');
  return null;
};
Object.assign(globalThis, { browser: { publicSuffix: { getDomain } } });

// Whose tips: the page's site when it's on the run's Sites (a subdomain counts), nobody's off them.
const tipSites = ['bookmyshow.com'];
if (siteOn('https://in.bookmyshow.com/explore', tipSites) !== 'bookmyshow.com') fail('siteOn subdomain');
for (const off of ['https://www.google.com/search?q=doraemon', 'https://bookmyshow.com.evil.com/', 'chrome://newtab/', undefined]) {
  if (siteOn(off, tipSites) !== '') fail(`siteOn(${off}) should be ''`);
}

// History lines: first non-empty line, capped; nothing printed → ok.
if (summarize('ok\n\nURL: x\n[1] link') !== 'ok' || summarize(undefined) !== 'ok' || summarize('\n\nTyped') !== 'Typed') fail('summarize');
if (summarize('x'.repeat(300)).length !== 201) fail('summarize cap');

// On the run's Sites (S1): the same registrable domain, so subdomains count (www., gist., in.). Never a lookalike,
// the brand's other domain, or another user's site on a shared host.
const sites = ['github.com'];
for (const href of ['https://github.com/', 'https://www.github.com/x', 'http://github.com/?q=1', 'https://gist.github.com/']) if (!onSites(href, sites)) fail(`on site: ${href}`);
for (const href of [undefined, 'chrome://newtab/', 'https://evilgithub.com/', 'https://github.com.evil.com/', 'https://github.com@evil.com/', 'file:///github.com', 'https://github.io/']) {
  if (onSites(href, sites)) fail(`off site: ${href}`);
}
if (!onSites('https://in.bookmyshow.com/movies', ['bookmyshow.com'])) fail('subdomain of a plan site');
if (!onSites('https://bookmyshow.com/', ['in.bookmyshow.com'])) fail('a plan subdomain covers its whole site');
if (!onSites('https://bbc.co.uk/news', ['www.bbc.co.uk'])) fail('two-part suffix');
if (onSites('https://www.amazon.com/', ['amazon.in'])) fail("the brand's other domain");
if (onSites('https://bob.github.io/', ['alice.github.io'])) fail("another user's site on a shared host");
// A host that is itself a public suffix (live: httpbin.org) is a one-host site: never its users' subdomains.
if (!onSites('https://httpbin.org/get', ['httpbin.org'])) fail('a suffix host on its own Sites line');
for (const href of ['https://alice.httpbin.org/', 'https://www.httpbin.org/']) if (onSites(href, ['httpbin.org'])) fail(`a suffix host covers ${href}`);
// The AI's goto: full https URL on a plan site only; returns the normalized URL.
if (checkGoto('https://github.com/search?q=browser automation&type=repositories', sites) !== 'https://github.com/search?q=browser%20automation&type=repositories') fail('goto ok');
if (checkGoto('https://www.github.com/x', sites) !== 'https://www.github.com/x') fail('goto www');
if (checkGoto('https://gist.github.com/x', sites) !== 'https://gist.github.com/x') fail('goto subdomain');
for (const url of [undefined, '', 'github.com', 'http://github.com/', 'https://evil.example/?d=secret', 'https://github.com@evil.example/', 'https://u:p@github.com/', 'javascript:alert(1)', 'https://github.io/', 'http://localhost:3000/']) {
  throws(() => checkGoto(url, sites), `goto ${JSON.stringify(url)}`);
}

// S2: a page the run landed on off the Sites → the site to ask you to add. Nothing for plan sites, non-web pages, a
// login part or IPs.
const shop = ['amazon.in'];
const site = (got: string, want: string, label: string) => {
  if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
site(siteToAdd('https://www.flipkart.com/laptops?q=1', shop), 'flipkart.com', 'landed on a new site');
site(siteToAdd('https://bob.github.io/x', shop), 'bob.github.io', 'a user site on a shared host');
site(siteToAdd('https://github.io/', shop), 'github.io', "a shared ending's own page is its own site");
for (const href of [undefined, 'https://in.amazon.in/x', 'chrome://newtab/', 'about:blank', 'https://u:p@flipkart.com/', 'https://192.168.0.1/']) {
  site(siteToAdd(href, shop), '', `no ask for ${href}`);
}
// The AI's goto / tab new: only a new site's bare home page asks, on any of its hosts. A path, query or # could carry
// page data out to a site you never added, so those are refused without asking.
site(siteToOpen('https://flipkart.com', shop), 'flipkart.com', 'goto a new home page');
site(siteToOpen('https://www.flipkart.com/', shop), 'flipkart.com', 'goto a new www home page');
site(siteToOpen('https://httpbin.org/', ['excalidraw.com']), 'httpbin.org', 'goto a new home page that is itself a public suffix (live bug)');
site(siteToOpen('https://seller.flipkart.com/', shop), 'flipkart.com', 'goto a new subdomain home page (cloud run 2: finred.usalearning.gov)');
for (const url of [undefined, 'https://flipkart.com/search', 'https://flipkart.com/?q=secret', 'https://flipkart.com/#secret', 'https://seller.flipkart.com/x', 'http://flipkart.com/', 'https://u:p@flipkart.com/', 'https://amazon.in/', 'https://in.amazon.in/', 'https://192.168.0.1/']) {
  site(siteToOpen(url, shop), '', `no ask for goto ${url}`);
}
// A deep URL on a new site is refused with how to ask: goto that host's own home page (its site's may be dead).
for (const [url, hint] of [['https://www.flipkart.com/search?q=x', 'goto https://www.flipkart.com/'], ['https://seller.flipkart.com/x', 'goto https://seller.flipkart.com/']] as const) {
  try {
    checkGoto(url, shop);
    fail(`goto deep URL on a new site: ${url}`);
  } catch (err) {
    if (!(err as Error).message.includes(hint)) fail(`deep URL hint: ${(err as Error).message}`);
    // The panel shows only the first paragraph (splitReply): no Sites list there. The agent still gets it.
    const shown = splitReply((err as Error).message);
    if (shown.text.includes('amazon.in') || !shown.more.includes('amazon.in')) fail(`Sites list only behind the click: ${(err as Error).message}`);
  }
}
// The ask names the exact host when it's more than the site or www., so data hidden in a host name shows.
site(wantsSite('flipkart.com', 'https://www.flipkart.com/'), 'The agent wants to open flipkart.com:\nhttps://www.flipkart.com/', 'ask for www');
site(wantsSite('flipkart.com', 'https://c2vjcmv0.flipkart.com/'), 'The agent wants to open c2vjcmv0.flipkart.com, part of flipkart.com:\nhttps://c2vjcmv0.flipkart.com/', 'ask for a subdomain');

// Lead 1 (audit 2026-10-24): click, type or select inside a frame asks to add that frame's site, like a tab on a new
// site. The frame and every frame above it count (nearest first), so a blank frame inside an ad's frame is the ad's.
const shopOnly = ['shop.com'];
const frameAsk = (urls: string[]) => frameSiteToAsk(urls, shopOnly)?.site ?? null;
if (frameAsk(['https://ads.evil.example/slot']) !== 'evil.example') fail('a frame on a new site asks for it');
if (frameAsk(['https://pay.shop.com/card']) !== null) fail('a frame on the Sites asks nothing');
if (frameAsk(['about:blank', 'https://ads.evil.example/']) !== 'evil.example') fail('a blank frame inside an ad counts as the ad');
if (frameAsk(['about:srcdoc']) !== null) fail('a srcdoc frame of the top page asks nothing');
if (frameAsk(['blob:https://evil.example/1f2e']) !== 'evil.example') fail("a blob frame is its creator's site");
throws(() => frameSiteToAsk(['http://192.168.0.1/'], shopOnly), 'a frame on an IP address (no site to add)');

// #7: a dev server on this computer. goto takes http on localhost, 127.0.0.1 and [::1] only; each port is its own
// site (another app), asked once like any new site, home page first.
const dev = ['github.com', 'localhost:3000'];
for (const [url, want] of [['http://localhost:3000/api?x=1', 'http://localhost:3000/api?x=1'], ['https://localhost:3000/', 'https://localhost:3000/'], ['http://LOCALHOST:3000/', 'http://localhost:3000/']] as const) {
  site(checkGoto(url, dev), want, `goto ${url}`);
}
for (const url of ['http://localhost:5173/', 'http://127.0.0.1:3000/', 'http://localhost/', 'http://localhost.evil.example:3000/', 'http://github.com/', 'http://192.168.0.1:3000/', 'http://u:p@localhost:3000/', 'ftp://localhost:3000/']) {
  throws(() => checkGoto(url, dev), `goto ${url} off the Sites or not http(s) on loopback`);
}
// The same host, port and https default (443) all count; a different port or loopback host doesn't.
if (!onSites('http://localhost:3000/x', dev) || onSites('http://localhost:3001/', dev) || onSites('http://127.0.0.1:3000/', dev)) fail('onSites by port');
if (!onSites('http://127.0.0.1/', ['127.0.0.1:80']) || !onSites('https://[::1]/', ['[::1]:443']) || onSites('http://[::1]/', ['[::1]:443'])) fail('onSites default ports');
site(siteOn('http://localhost:3000/app', dev), 'localhost:3000', 'a loopback page gets its own tips');
site(siteToOpen('http://localhost:5173/', dev), 'localhost:5173', 'goto a new loopback port asks for it');
site(siteToOpen('http://127.1:8080', dev), '127.0.0.1:8080', 'URL rewrites 127.1');
site(siteToOpen('http://[0:0:0:0:0:0:0:1]/', dev), '[::1]:80', 'URL rewrites IPv6 loopback; http defaults to 80');
site(siteToOpen('https://localhost/', dev), 'localhost:443', 'https defaults to 443');
for (const url of ['http://localhost:5173/login', 'http://localhost:5173/?q=secret', 'http://localhost:3000/', 'http://flipkart.com/', 'http://10.0.0.1:3000/', 'http://localhost.:3000/']) {
  site(siteToOpen(url, dev), '', `no ask for goto ${url}`);
}
site(siteToAdd('http://localhost:5173/x', dev), 'localhost:5173', 'landed on another local port');
site(frameSiteToAsk(['http://localhost:9000/embed'], dev)?.site ?? '', 'localhost:9000', 'a frame from another local port asks');
// The deep-link hint names the loopback home page over its own scheme and port.
try {
  checkGoto('http://localhost:5173/dashboard', dev);
  fail('goto a deep link on a new loopback port');
} catch (err) {
  if (!(err as Error).message.startsWith('goto refused: localhost:5173 is not') || !(err as Error).message.includes('goto http://localhost:5173/)')) fail(`loopback hint: ${(err as Error).message}`);
}
site(wantsSite('localhost:5173', 'http://localhost:5173/'), 'The agent wants to open localhost:5173:\nhttp://localhost:5173/', 'ask for a loopback port');
