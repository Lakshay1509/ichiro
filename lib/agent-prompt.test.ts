// Checks the shared site rules (Sites, a new site's ask, goto's check) and history lines. Run: npm test
import { checkGoto, onSites, siteOn, siteToAdd, siteToOpen, summarize, wantsSite } from './agent-prompt.ts';
import { splitReply } from './readable-log.ts';

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
for (const url of [undefined, '', 'github.com', 'http://github.com/', 'https://evil.example/?d=secret', 'https://github.com@evil.example/', 'https://u:p@github.com/', 'javascript:alert(1)', 'https://github.io/']) {
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
site(wantsSite('flipkart.com', 'https://www.flipkart.com/'), 'The agent wants to use flipkart.com (https://www.flipkart.com/)', 'ask for www');
site(wantsSite('flipkart.com', 'https://c2vjcmv0.flipkart.com/'), 'The agent wants to use c2vjcmv0.flipkart.com, part of flipkart.com (https://c2vjcmv0.flipkart.com/)', 'ask for a subdomain');
