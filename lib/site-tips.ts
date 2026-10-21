// F10 site tips, the rules: which tip text may be saved, the 10-per-site cap, and which sites to remove. Pure, so Node
// can test it; loading and saving (chrome.storage.local) live elsewhere. Design: harness/site-memory.md.
import { MAX_NEW_TIPS, NAMED_HOST, siteOf } from './agent-prompt.ts';

export type Tip = { text: string; added: number }; // added: ms since 1970
export type SiteMemory = { used: number; tips: Tip[] }; // used: the last run that read it, ms
export const MAX_TIPS = 10;
export const TIP_CHARS = 200;
export const UNUSED_DAYS = 180;
export const MAX_BYTES = 8 * 1024 * 1024; // of chrome.storage.local's 10 MB, so 2 MB stays free for everything else

// A tip says where to click, never where to go off its own site or anything private. So a link (http/https only) or a
// domain name must be on site, the tip's own (subdomains count, like Sites: in.bookmyshow.com is bookmyshow.com), and
// emails and long numbers (phones, OTPs, account numbers) are refused. Unknown endings (node.js, report.pdf) name no
// site, so they pass. Spaces and line breaks become one space, so a tip is always one line.
export function checkTip(raw: string, site: string): { text: string } | { why: string } {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return { why: 'the tip is empty' };
  if (text.length > TIP_CHARS) return { why: `the tip is over ${TIP_CHARS} characters` };
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return { why: 'a tip can\'t hold an email address' };
  if (/\d{6}/.test(text)) return { why: 'a tip can\'t hold 6 or more digits in a row' };
  const away = `a tip can only link to its own site${site ? `, ${site}` : ''}`;
  for (const link of text.match(/[a-z][a-z0-9+.-]*:\/\/\S*/gi) ?? []) {
    const url = URL.parse(link);
    if (!site || !url || (url.protocol !== 'https:' && url.protocol !== 'http:') || siteOf(url.hostname) !== site) return { why: away };
  }
  if ((text.match(NAMED_HOST) ?? []).some((host) => ![site, ''].includes(siteOf(host.toLowerCase())))) return { why: away };
  return { text };
}

// The tip ask's reply (buildTipAsk), untrusted like a step's: the model read page text. Anything but {"tips": [text]},
// or more than MAX_NEW_TIPS, refuses the whole reply. Then each tip goes through checkTip for site: the refused ones
// are dropped, never shown to you.
export function parseTips(answer: { text: string; stop_reason: string }, site: string): string[] {
  if (answer.stop_reason !== 'end_turn') throw new Error(`The tip ask stopped early (${answer.stop_reason}).`);
  let tips: unknown;
  try {
    ({ tips } = JSON.parse(answer.text) ?? {});
  } catch {
    // not JSON: refused just below
  }
  if (!Array.isArray(tips) || !tips.every((t) => typeof t === 'string')) throw new Error(`The tip ask must reply {"tips": ["..."]}; got: ${JSON.stringify(answer.text.slice(0, 200))}`);
  if (tips.length > MAX_NEW_TIPS) throw new Error(`The tip ask sent ${tips.length} tips; at most ${MAX_NEW_TIPS}.`);
  return [...new Set(tips.flatMap((t) => {
    const checked = checkTip(t, site);
    return 'text' in checked ? [checked.text] : [];
  }))];
}

// Checks raw for site, then adds it at the end. The same tip again (case and spaces ignored) replaces the old one, so
// it's kept once and counts as new. The oldest goes past MAX_TIPS.
export function addTip(tips: Tip[], raw: string, site: string, now: number): { tips: Tip[] } | { why: string } {
  const checked = checkTip(raw, site);
  if ('why' in checked) return checked;
  const same = checked.text.toLowerCase();
  return { tips: [...tips.filter((t) => t.text.toLowerCase() !== same), { text: checked.text, added: now }].slice(-MAX_TIPS) };
}

// The site keys to remove: every site unused for UNUSED_DAYS, then the least recently used until the store is under
// MAX_BYTES. bytesInUse is the whole store's (getBytesInUse), each site's share counted like Chrome does: key + JSON.
export function prune(sites: Record<string, SiteMemory>, now: number, bytesInUse: number): string[] {
  const old = now - UNUSED_DAYS * 24 * 60 * 60 * 1000;
  const gone: string[] = [];
  let bytes = bytesInUse;
  for (const [key, site] of Object.entries(sites).sort((a, b) => a[1].used - b[1].used)) {
    if (site.used >= old && bytes <= MAX_BYTES) break;
    gone.push(key);
    bytes -= new TextEncoder().encode(key + JSON.stringify(site)).length;
  }
  return gone;
}
