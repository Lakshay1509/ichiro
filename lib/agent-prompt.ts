// Shared agent rules: which sites a command may use (Sites, S1–S2), and how page text is cut and kept in its block.

// Block tags a page could print to fake our blocks. Only page_content wraps page text now; the rest stay defused, since
// an agent may still read them as ours.
const TAGS = ['plan', 'steps', 'page_content', 'site_tips'];

// S1: a host's site is its registrable domain from Chrome's Public Suffix List, like browsers' "same site":
// in.bookmyshow.com → bookmyshow.com, but alice.github.io stays alice's (github.io is a public suffix). A host that
// is itself a suffix is a one-host site, as in the HTML spec's "obtain a site": live, httpbin.org is on the list
// (Postman's private entry), and refusing it meant its home page never asked. github.io then covers only github.io,
// never alice.github.io. '' for an IP or an unknown ending (getDomain's defaults), which matches nothing.
// Source: https://developer.chrome.com/docs/extensions/reference/api/publicSuffix
export const siteOf = (host: string) => browser.publicSuffix.getDomain(host, { allowPlainSuffix: true }) || '';

// #7: this computer's own hosts, where a coding agent's dev server runs. URL already rewrites LOCALHOST, 127.1 and
// [0:0::1] to these, and keeps IPv6's brackets.
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
export const isLoopback = (url: URL) => LOOPBACK.includes(url.hostname);

// A web page's site (S1). #7: on a loopback host it's the host and port (localhost:3000): each port there is another
// app, and no public suffix covers it. '' for none.
export const siteOfUrl = (url: URL) => (isLoopback(url) ? `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}` : siteOf(url.hostname));

// A Sites entry's site (amazon.in, localhost:3000), read like mcp on reads a name, so getDomain never gets a port.
const siteOfEntry = (s: string) => {
  const url = URL.parse(`https://${s}/`);
  return url ? siteOfUrl(url) : '';
};

// The agent's goto may open https, or plain http on a loopback host (#7): dev servers rarely have a certificate.
const gotoable = (url: URL) => url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url));

// A site name in a tip ("amazon.in", "https://www.irctc.co.in/nget"): dotted labels ending in a letter one, so IPs
// and localhost aren't names. Not inside an email or login part (bob@gmail.com) or a longer word.
export const NAMED_HOST = /(?<![\w@.-])(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*/gi;

// Is this page on the run's Sites? Same site (S1): github.com covers www. and gist.github.com; amazon.in doesn't cover
// amazon.com (a different site). localhost:3000 covers only that port.
export function onSites(href: string | undefined, sites: string[]): boolean {
  const url = href ? URL.parse(href) : null;
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return false;
  const site = siteOfUrl(url);
  return !!site && sites.some((s) => siteOfEntry(s) === site);
}

// F10: the site of a page on the run's Sites, the one whose saved tips it gets; '' off the Sites (no tips).
export const siteOn = (href: string | undefined, sites: string[]) => (onSites(href, sites) ? siteOfUrl(new URL(href!)) : '');

// The AI's goto: a full https URL on the run's Sites, without a login part. Anything else is refused and never opened.
// #7: http too on localhost, 127.0.0.1 and [::1].
export function checkGoto(input: string | undefined, sites: string[]): string {
  const url = URL.parse(input ?? '');
  if (!url || !gotoable(url)) throw new Error(`goto needs a full https:// URL (http:// only on localhost, 127.0.0.1 or [::1]); got ${JSON.stringify((input ?? '').slice(0, 100))}`);
  if (url.username || url.password) throw new Error('goto refused: no user:password@ part allowed in URLs');
  if (!onSites(url.href, sites)) {
    const site = siteOfUrl(url);
    const home = isLoopback(url) ? url.origin : `https://${url.hostname}`;
    const how = site ? `To use ${site}, goto this host's home page (goto ${home}/): the user is asked whether to add ${site}. ` : '';
    // The rest after a blank line: the agent gets it, the panel shows it only behind a click (splitReply).
    throw new Error(`goto refused: ${isLoopback(url) ? site : url.hostname} is not one of the run's Sites.\n\n${how}The run's Sites: ${sites.join(', ') || 'none yet'}.`);
  }
  return url.href;
}

// S2: the site of a page off the Sites that you may be asked to add for this run: a web page without a login part.
// '' otherwise (a site on Sites, a browser page, an IP other than a loopback one, an unknown ending).
export function siteToAdd(href: string | undefined, sites: string[]): string {
  const url = href ? URL.parse(href) : null;
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || onSites(url.href, sites)) return '';
  return siteOfUrl(url);
}

// S2 in frames (audit 2026-10-24, lead 1): before a click, type or select inside a frame. urls: that frame's URL, then
// each frame's above it, up to the top page. about:blank, srcdoc and data: frames take a parent's site, so only web
// URLs count (a blob:'s own). The first site off the Sites to ask you to add, or null. Throws when one can't be added.
export function frameSiteToAsk(urls: string[], sites: string[]): { site: string; url: string } | null {
  for (const href of urls) {
    const url = URL.parse(href.startsWith('blob:') ? href.slice(5) : href);
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || onSites(url.href, sites)) continue;
    const site = siteToAdd(url.href, sites);
    if (!site) throw new Error(`Blocked: that element is in a frame from ${url.hostname}, which isn't a web page you can use.`);
    return { site, url: url.href };
  }
  return null;
}

// S2: the agent's goto to a new site asks you first, but only for a bare home page (https://host/): a path,
// query or # could carry page data out to a site you never added. A host name can too, so the ask names it in full
// (wantsSite). Any host: finred.usalearning.gov's site has no working home page of its own. '' = no ask.
// #7: the same on a loopback host (http://localhost:3000/): a local server can still pass a path on.
export function siteToOpen(input: string | undefined, sites: string[]): string {
  const url = URL.parse(input ?? '');
  if (!url || !gotoable(url) || url.pathname !== '/' || url.search || url.hash) return '';
  return siteToAdd(url.href, sites);
}

// S2's ask names the exact host when it's more than the site or www., so data hidden in a host name is in plain
// sight: "The agent wants to open finred.usalearning.gov, part of usalearning.gov:", then the URL on its own line.
// A loopback site already is its host (localhost:3000).
export function wantsSite(site: string, url: string): string {
  const parsed = URL.parse(url);
  const host = parsed && !isLoopback(parsed) ? parsed.hostname : '';
  const named = host && host !== site && host !== `www.${site}` ? `${host}, part of ${site}` : site;
  return `The agent wants to open ${named}:\n${url.slice(0, 150)}`;
}

// A page could print our closing tag to escape an untrusted block, so tag lookalikes inside one are defused.
export const defuse = (s: string) => s.replace(new RegExp(`<(/?)(${TAGS.join('|')})`, 'gi'), '[$1$2');

const cap =(s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
// One line, capped: the model's text can't fake extra history lines or grow without end.
export const oneLine = (s: string, max: number) => cap(s.replace(/\s+/g, ' ').trim(), max);

// A step's result for the history: its first line, short. Commands that act also print the whole page, which the next turn reads anyway.
export function summarize(output: string | void): string {
  return cap((output ?? '').split('\n').find((l) => l.trim()) ?? 'ok', 200);
}
