// Checks stopWord (risky button labels), isCheckoutUrl (pages where any click can move money) and the cookie exception
// (privacyLabel, riskyWord, inCookieBox: a cookie box's least-consent button isn't a stop-line). Run: npm test
import { checkStopLines, enterTargets, inCookieBox, isCheckoutUrl, privacyLabel, riskyWord, stopLineAsk, stopWord } from './stop-lines.ts';
import { StopLine } from '../messages.ts';

const matches: [string, string][] = [
  ['Pay now', 'pay'],
  ['Pay ₹1,234.56', 'pay'], // numbers are ignored
  ['Pay-now', 'pay'],
  ['BUY NOW', 'buy'],
  ['Proceed to checkout (2 items)', 'checkout'], // Amazon cart
  ['Place your order', 'place your order'],
  ['Confirm booking', 'confirm'],
  ['Book tickets', 'book'], // BookMyShow's movie page
  ['Book Now', 'book'],
  ["I'll reserve", 'reserve'], // Booking.com
  ['Send', 'send'],
  ['Delete account', 'delete'],
  ['Accept all cookies', 'accept'],
];
for (const [label, want] of matches) {
  const got = stopWord(label);
  if (got !== want) throw new Error(`stopWord(${JSON.stringify(label)}) = ${got}, want "${want}"`);
}

const misses = [
  'Paypal help', // "pay" inside a longer word
  'Display',
  'Payment history',
  'Facebook',
  'Add to cart',
  'Search',
  'How to delete your account in five easy steps today', // long: a title, not a button
  '',
];
for (const label of misses) {
  const got = stopWord(label);
  if (got !== null) throw new Error(`stopWord(${JSON.stringify(label)}) = "${got}", want null`);
}

const checkout = [
  'https://www.amazon.in/gp/buy/spc/handlers/display.html',
  'https://shop.example/checkout',
  'https://shop.example/Checkout/Step-2',
  'https://app.example/#/payment', // hash routes
  'https://x.example/pay',
];
const notCheckout = [
  'https://www.amazon.in/gp/cart/view.html',
  'https://www.amazon.in/s?k=buy+shoes', // a search for "buy" isn't a checkout
  'https://www.paypal.com/help',
  'https://en.wikipedia.org/wiki/Alan_Turing',
  'not a url',
];
for (const url of checkout) {
  if (!isCheckoutUrl(url)) throw new Error(`isCheckoutUrl should be true for ${url}`);
}
for (const url of notCheckout) {
  if (isCheckoutUrl(url)) throw new Error(`isCheckoutUrl should be false for ${url}`);
}

// Cookie exception. The 3 real least-consent labels from the evil test run (europa.eu, bmas.de, Turkish Airlines) pass.
const least = [
  'Accept only essential cookies', 'I do not agree', 'I accept only necessary cookies',
  "Don't accept", 'Allow necessary cookies only', 'Accept strictly necessary cookies only', 'Only accept the required cookies',
];
const notLeast = [
  'CONFIRM MY CHOICE', // bmas.de: saves whatever switches are on, can't tell which
  'Accept all', 'Accept', 'I agree', 'Agree and continue', 'I agree to the terms', 'Confirm order', 'Confirm payment',
  'Accept all cookies', 'Allow all', 'Allow selection',
  // Near-misses: least-consent words plus something more.
  'Accept only essential cookies and analytics', 'Accept all or only necessary', 'Accept necessary and marketing cookies',
  'Accept necessary cookies', // no "only": unclear, stays a stop-line
  'Pay only necessary', 'Only necessary, subscribe', 'Confirm only necessary',
  'I do not agree, accept all', 'I do not agree to pay', 'Do not agree, I agree', 'Accept only', '',
];
for (const label of least) if (!privacyLabel(label)) throw new Error(`privacyLabel(${JSON.stringify(label)}) should be true`);
for (const label of notLeast) if (privacyLabel(label)) throw new Error(`privacyLabel(${JSON.stringify(label)}) should be false`);

// riskyWord: the whole decision. Inside a cookie box only least-consent labels pass; outside, nothing changes.
const inside = () => true;
const outside = () => false;
const decide: [string[], () => boolean, string | null, string][] = [
  [['Accept only essential cookies'], inside, null, 'europa.eu'],
  [['I do not agree'], inside, null, 'bmas.de'],
  [['I accept only necessary cookies'], inside, null, 'Turkish Airlines'],
  [['CONFIRM MY CHOICE'], inside, 'confirm', 'bmas.de: saving the switches stays a stop-line'],
  [['Accept only essential cookies'], outside, 'accept', 'least-consent words outside a cookie box'],
  [['I do not agree'], outside, 'agree', 'a refusal outside a cookie box'],
  [['Accept all'], inside, 'accept', 'accept all in a cookie box'],
  [['Agree and continue'], inside, 'agree', 'agree and continue in a cookie box'],
  [['Confirm payment'], inside, 'confirm', 'payment inside a box that says consent'],
  [['Only necessary', 'Accept all'], inside, 'accept', 'text says least, aria-label says accept all'],
  [['Accept only essential cookies', 'Accept only essential cookies', ''], inside, null, 'name and text agree'],
  [['Search', ''], outside, null, 'no stop word'],
];
for (const [labels, box, want, what] of decide) {
  const got = riskyWord(labels, box);
  if (got !== want) throw new Error(`riskyWord, ${what}: got ${got}, want ${want}`);
}
// The box is only looked up when it matters (it reads styles).
riskyWord(['Search'], () => { throw new Error('riskyWord looked up the box for a label with no stop word'); });

// inCookieBox on a fake DOM: tag, id, class, aria-label, dialog or not, pinned or not, text, parent.
type Box = { localName: string; id: string; attrs: Record<string, string>; dialog: boolean; pinned: boolean; textContent: string; parentElement: Box | null };
(globalThis as { getComputedStyle?: unknown }).getComputedStyle = (b: Box) => ({ position: b.pinned ? 'fixed' : 'static' });
const box = (parent: Box | null, o: Partial<Box> = {}): Box => ({
  localName: 'div', id: '', attrs: {}, dialog: false, pinned: false, textContent: '', parentElement: parent, ...o,
  ...({ getAttribute: (a: string) => o.attrs?.[a] ?? null, matches: () => o.dialog ?? false } as object),
});
const button = (parent: Box) => box(parent, { localName: 'button', textContent: 'Accept only essential cookies' });
const inBox = (b: Box) => inCookieBox(b as unknown as Element);
const body = box(null, { localName: 'body', attrs: { class: 'cookies-accepted' }, textContent: 'We use cookies' });
const page = box(body, { textContent: 'Cookie policy' });

const cookieCases: [Box, boolean, string][] = [
  [button(box(page, { pinned: true, textContent: 'We use cookies to improve this site' })), true, 'a pinned banner that mentions cookies'],
  [button(box(box(page, { dialog: true, textContent: 'Your privacy. Cookie settings' }))), true, 'a dialog that mentions cookies, a level up'],
  [button(box(page, { id: 'cookie-consent-banner' })), true, 'a plain box with a cookie id (europa.eu style)'],
  [button(box(page, { attrs: { class: 'CybotCookiebotDialog' } })), true, 'a cookie class'],
  [button(box(page, { attrs: { 'aria-label': 'Consent' } })), true, 'a consent aria-label'],
  [button(page), false, 'a button in the page: the body\'s cookie class and text don\'t count'],
  [button(box(page, { dialog: true, textContent: 'Review your order' })), false, 'a checkout dialog'],
  [button(box(box(page, { id: 'consent-wrapper' }), { pinned: true, textContent: 'Your basket' })), false, 'the nearest pinned box decides'],
];
for (const [b, want, what] of cookieCases) {
  if (inBox(b) !== want) throw new Error(`inCookieBox, ${what}: want ${want}`);
}

// The panel's ask: our headline on the first line (never page text), the stop-line's own words under it.
const asked = stopLineAsk('Stop-line: click "Place order" (word "pay" on the box around it). Needs your ok.');
if (asked !== 'This step needs your OK\nclick "Place order" (word "pay" on the box around it).') throw new Error(`stopLineAsk: ${asked}`);
if (!stopLineAsk('Stop-line: goto https://shop.example/checkout (checkout page)').endsWith('\ngoto https://shop.example/checkout (checkout page)')) throw new Error('stopLineAsk, goto');

// enterTargets outside a form: a chat composer sends on Enter from the page's own handler, with its Send button beside
// the box. The buttons in the nearest box around the field count as Enter targets, so "send" stops Enter like a click
// on Send does. Audit 2026-10-24, lead 3.
(globalThis as { ShadowRoot?: unknown }).ShadowRoot ??= class {};
type Fake = { parentElement: Fake | null; parentNode: Fake | null; closest: () => null; querySelectorAll: () => Fake[] };
const fake = (parent: Fake | null, buttons: Fake[] = []): Fake => ({ parentElement: parent, parentNode: parent, closest: () => null, querySelectorAll: () => buttons });
const send = fake(null);
const editor = fake(fake(null, [send])); // the editable box (no buttons inside), in the composer that holds Send
const message = fake(editor);
if (!enterTargets(message as unknown as Element).includes(send as unknown as Element)) throw new Error('enterTargets: a field outside a form should include the Send button beside it');
const lone = fake(fake(fake(null)));
if (enterTargets(lone as unknown as Element).length !== 1) throw new Error('enterTargets: a field with no buttons near it is its only target');
const page2 = { ...fake(null, [fake(null)]), localName: 'body' };
if (enterTargets(fake(page2) as unknown as Element).length !== 1) throw new Error('enterTargets: never every button on the page (stops at body)');

// checkStopLines: one command with two stop-lines (typing personal data, then Enter submitting "Subscribe") asks once,
// naming both, so Allow once approves exactly what the ask showed. Audit 2026-10-24, lead 4.
const personal = () => { throw new StopLine('Stop-line: type into [3] "Email" (personal data: email). Needs your ok.'); };
const submit = () => { throw new StopLine('Stop-line: Enter in "Email" (word "subscribe"). Needs your ok.'); };
const stopsWith = (checks: (() => void)[]) => {
  try { checkStopLines(checks); } catch (err) { if (err instanceof StopLine) return err.message; throw err; }
  return null;
};
const both = stopsWith([personal, submit]);
if (!both?.includes('personal data: email') || !both.includes('word "subscribe"')) throw new Error(`checkStopLines: the ask must name both stop-lines: ${both}`);
if (!stopLineAsk(both).endsWith('(word "subscribe").')) throw new Error(`checkStopLines: the ask keeps the stop-line form: ${stopLineAsk(both)}`);
if (stopsWith([() => {}, personal]) !== 'Stop-line: type into [3] "Email" (personal data: email). Needs your ok.') throw new Error('checkStopLines: one stop-line keeps its own message');
if (stopsWith([() => {}, () => {}]) !== null) throw new Error('checkStopLines: no stop-line, no ask');
