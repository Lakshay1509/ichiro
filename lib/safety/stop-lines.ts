// Stop-lines: actions that pause and ask you first (pay, buy, send…). The content script checks clicks and Enter against this.
import { StopLine } from '../messages.ts';
import { findInteractive, isSecret, name, parentOf } from '../page/reader.ts';

// Whole words or phrases, matched on letters only: "Pay ₹1,234" matches "pay", "Paypal help" doesn't.
const STOP_WORDS = [
  // Money
  'pay', 'buy', 'purchase', 'checkout', 'check out', 'place order', 'place your order', 'order now',
  'subscribe', 'donate', 'transfer', 'rent',
  // Bookings and agreements
  'book', 'reserve', 'confirm', 'accept', 'agree', 'allow', 'authorize',
  // Sending and publishing
  'send', 'post', 'publish', 'submit', 'comment',
  // Hard to undo
  'delete', 'deactivate', 'download', 'install',
];

// URL path words of pages where any click can move money.
const CHECKOUT_PATHS = ['checkout', 'check out', 'payment', 'pay', 'billing', 'buy'];

// Labels longer than this are titles (videos, products, posts), not buttons.
const MAX_WORDS = 8;

// Lowercase letters only, one space between words: "Pay-now ₹12" → "pay now".
const words = (s: string) => s.toLowerCase().replace(/\P{L}+/gu, ' ').trim();

const find = (text: string, list: string[]) => list.find((s) => ` ${text} `.includes(` ${s} `)) ?? null;

// The stop word or phrase in a short label, or null.
export function stopWord(label: string): string | null {
  const w = words(label);
  return w && w.split(' ').length <= MAX_WORDS ? find(w, STOP_WORDS) : null;
}

// Every word a necessary-only cookie choice may have. Fixed list: "and analytics", "all", "selected" can't sneak in.
const LEAST = ['i', 'accept', 'agree', 'allow', 'only', 'the', 'necessary', 'essential', 'required', 'strictly', 'technically', 'cookie', 'cookies'];
const NEEDED = ['necessary', 'essential', 'required'];

// A cookie choice that consents to the least: "I accept only necessary cookies", "I do not agree".
// Not "Confirm my choice": it saves whatever switches are on, and the page often doesn't say if they're on.
export function privacyLabel(label: string): boolean {
  const w = words(label);
  const list = w.split(' ');
  if (/^(i )?(do not|don t) (accept|agree|allow)( cookies)?$/.test(w)) return true;
  return list.every((x) => LEAST.includes(x)) && list.includes('only') && NEEDED.some((x) => list.includes(x));
}

// Same as reader.ts DIALOGS: any dialog tag.
const DIALOGS = 'dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]';
const COOKIE = /cookie|consent/i;

// el sits in a cookie popup or banner: a box below <body> named for cookies (id, class, aria-label), or its nearest
// dialog or pinned box mentions cookies. A checkout drawer or terms popup without that stops the search: no.
export function inCookieBox(el: Element): boolean {
  for (let x: Element | null = el; x && x.localName !== 'body'; x = parentOf(x)) {
    if (COOKIE.test(`${x.id} ${x.getAttribute('class') ?? ''} ${x.getAttribute('aria-label') ?? ''}`)) return true;
    if (x.matches(DIALOGS) || ['fixed', 'sticky'].includes(getComputedStyle(x).position)) return COOKIE.test(x.textContent ?? '');
  }
  return false;
}

// The stop word in an element's labels, or null. A cookie box's least-consent button isn't one: declining is the
// privacy-friendly choice. Every label with a stop word must be one ("Only necessary" text + "Accept all" aria-label stops).
export function riskyWord(labels: string[], inBox: () => boolean): string | null {
  const risky = labels.filter((label) => stopWord(label));
  if (!risky.length || (risky.every(privacyLabel) && inBox())) return null;
  return stopWord(risky[0]!);
}

// True on checkout and payment pages. Path and #route only: a search for "buy shoes" isn't a checkout.
export function isCheckoutUrl(href: string): boolean {
  const url = URL.parse(href);
  return !!url && find(words(`${url.pathname} ${url.hash}`), CHECKOUT_PATHS) !== null;
}

// Why acting on these elements needs a yes first, or null. Their labels first, then the page they're on.
export function stopReason(els: Element[]): string | null {
  for (const el of els) {
    // Every label source on its own: a short visible "Buy" still counts when its aria-label is a long product title.
    const labels = [name(el), el.textContent, ...['aria-label', 'title', 'alt', 'value'].map((a) => el.getAttribute(a))];
    const word = riskyWord(labels.map((label) => label ?? ''), () => inCookieBox(el));
    if (word) return `word "${word}"`;
  }
  if (isCheckoutUrl(location.href)) return 'checkout page';
  // Card fields inside a payment provider's iframe are another frame, not seen here: the checkout URL and the judge (3.5) cover those.
  if (findInteractive().some((f) => isSecret(f) && f.checkVisibility())) return 'page shows a password or card field';
  return null;
}

// A click on el lands on hit, which can be a button inside el (a card's "Buy now"): hit and everything up to el.
export function clickTargets(el: Element, hit: Element): Element[] {
  const chain: Element[] = [];
  for (let x: Element | null = hit; x; x = x === el ? null : parentOf(x)) chain.push(x);
  return chain;
}

// What Enter on el can trigger: el itself and its form's default button, the first submit button.
// Source: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission
// Outside a form, the page sends on Enter itself (chat and mail composers), with its Send button beside the box: the
// buttons in the nearest box around el that holds any, up to 4 levels up, so "send" stops Enter like a click on Send.
// Erring wide on purpose: a stop word on any button there asks, even one Enter wouldn't press. Never past <body>: the
// whole page's buttons aren't "beside" anything (Enter with nothing focused lands on body).
export function enterTargets(el: Element): Element[] {
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  if (!form) {
    for (let x = parentOf(el), up = 0; x && !['body', 'html'].includes(x.localName) && up < 4; x = parentOf(x), up++) {
      const buttons = [...x.querySelectorAll('button, [role=button], input[type=submit]')];
      if (buttons.length) return [el, ...buttons];
    }
    return [el];
  }
  const submit = [...form.elements].find(
    (e) => (e instanceof HTMLButtonElement || e instanceof HTMLInputElement) && ['submit', 'image'].includes(e.type),
  );
  return submit ? [el, submit] : [el];
}

// Throws a StopLine (the panel asks you) if acting on els needs a yes. `what` names the action for the message.
export function checkStopLine(what: string, els: Element[]) {
  const reason = stopReason(els);
  if (reason) throw new StopLine(`Stop-line: ${what} (${reason}). Needs your ok.`);
}

// Every stop-line of one command, asked as one: "type into [3] … (personal data); then Enter … (word "subscribe")".
// Allow once re-runs the whole command, so the ask must name each check it waives, never just the first one thrown.
export function checkStopLines(checks: (() => void)[]) {
  const found: string[] = [];
  for (const check of checks) {
    try {
      check();
    } catch (err) {
      if (!(err instanceof StopLine)) throw err;
      found.push(err.message.replace(/^Stop-line: /, '').replace(/\. Needs your ok\.$/, ''));
    }
  }
  if (found.length) throw new StopLine(`Stop-line: ${found.join('; then ')}. Needs your ok.`);
}

// A stop-line as the panel's ask: a headline, then what it would do and why. "Stop-line:" and "Needs your ok." (in the
// message for the agent) only repeat the headline.
export const stopLineAsk = (message: string) => `This step needs your OK\n${message.replace(/^Stop-line: /, '').replace(/ Needs your ok\.$/, '')}`;
