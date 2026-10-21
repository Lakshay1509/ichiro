// Checks keyTarget: Escape goes to the panel on top unless focus is already inside it; other keys stay on focus.
// And guardStops: a real click's press must land on what we checked; after it, only stop-lines stop the rest. And the
// guard's place in line: it stops a moved press before the page's own listeners, and never calls a click it couldn't
// stop "Stopped". Run: npm test
import { endGuard, guardClick, guardStops, keyTarget, watchMouse } from './actions.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
// deepContains steps out of shadow roots at the top of a chain; Node has no ShadowRoot.
(globalThis as { ShadowRoot?: unknown }).ShadowRoot ??= class {};
// A fake DOM: each element knows only its parent.
const el = (parent: Element | null = null) => ({ parentElement: parent, parentNode: parent }) as unknown as Element;
const body = el();
const panel = el(body);
const inPanel = el(panel);
const behind = el(body);

// Seen live (Amazon's Filters): focus on the body, Escape on it did nothing; on the panel it closed.
if (keyTarget('Escape', body, panel) !== panel) fail('Escape with focus on body should go to the panel');
if (keyTarget('Escape', behind, panel) !== panel) fail('Escape with focus behind the panel should go to the panel');
if (keyTarget('Escape', inPanel, panel) !== inPanel) fail('Escape with focus inside the panel should stay there');
if (keyTarget('Escape', body, null) !== body) fail('Escape with no panel should stay on focus');
if (keyTarget('Enter', behind, panel) !== behind) fail('Enter should stay on focus (a search box behind a popup)');

// guardStops, one gesture at a time. Each event: [press?, on what we checked?, stop-line where it landed ('' = none)].
const gesture = (events: [boolean, boolean, string][]) => {
  const g = { blocked: '', pressed: false };
  const asked: string[] = [];
  const stops = events.map(([press, aimed, stop]) => guardStops(g, press, aimed, () => (asked.push('at'), 'button "X"'), () => (asked.push('stop'), stop)));
  return { stops: stops.map(Number).join(''), blocked: g.blocked, asked: asked.join(' ') };
};
// pointerdown, mousedown, pointerup, mouseup, click.
const down: [boolean, boolean, string] = [true, true, ''];

// Seen live (Google Slides): the press selects, the page puts handles under the mouse, the release lands on them. It goes on.
let r = gesture([down, down, [false, false, ''], [false, false, ''], [false, false, '']]);
if (r.stops !== '00000' || r.blocked) fail(`a release on the page's handles should pass: ${JSON.stringify(r)}`);
if (r.asked !== 'stop stop stop') fail(`only what's new after the press gets the stop-lines: ${r.asked}`);
// A drag whose shape follows the mouse: everything on what we checked, nothing asked.
r = gesture([down, down, [false, true, ''], [false, true, ''], [false, true, '']]);
if (r.stops !== '00000' || r.asked) fail(`a drag on what we checked should pass unasked: ${JSON.stringify(r)}`);
// A popup came up before the press: stopped, and so is the rest, even back on what we checked. No stop-line asked: moved is enough.
r = gesture([[true, false, ''], [true, false, ''], [false, true, ''], [false, true, ''], [false, true, '']]);
if (r.stops !== '11111' || !r.blocked.includes('the page moved') || r.asked.includes('stop')) fail(`a press on a popup should stop it all: ${JSON.stringify(r)}`);
// The first click of a double-click opened a dialog under the mouse; the second press lands on its Delete: stopped there.
r = gesture([down, down, [false, true, ''], [false, true, ''], [false, true, ''], [true, false, 'needs your ok'], [true, false, ''], [false, false, '']]);
if (r.stops !== '00000111' || !r.blocked.includes('after the press (needs your ok)')) fail(`a stop-line after the press should stop the rest: ${JSON.stringify(r)}`);
// A release on what we checked isn't a press: a press elsewhere after it is still stopped.
r = gesture([[false, true, ''], [true, false, '']]);
if (r.stops !== '01' || !r.blocked.includes('the page moved')) fail(`only a press counts as ours: ${JSON.stringify(r)}`);

// The guard on a fake window: each type's listeners run in the order added, and stopImmediatePropagation stops the rest
// (the DOM's rule). The page's own window listener is added when its scripts load (Google Slides has one).
const listeners: { type: string; fn: (e: Event) => void }[] = [];
const doc = { readyState: 'loading' };
Object.assign(globalThis, { addEventListener: (type: string, fn: (e: Event) => void) => listeners.push({ type, fn }), Element: class {}, document: doc });
const press = (target: object) => {
  let stopped = false;
  const e = { type: 'pointerdown', isTrusted: true, composedPath: () => [target], preventDefault() {}, stopImmediatePropagation: () => (stopped = true) };
  for (const l of listeners) if (l.type === 'pointerdown' && !stopped) l.fn(e as unknown as Event);
};
const checked = Object.assign(new Element(), { closest: () => null, parentElement: null, parentNode: null });
let pageSaw = 0;
const pageListens = () => addEventListener('pointerdown', () => pageSaw++, true);

// (a) Content script at document_start, then the page: a press that lands on something else never reaches the page.
watchMouse();
pageListens();
guardClick(false, checked);
press({});
let why = endGuard();
if (pageSaw) fail('a moved press reached the page: the guard must be first in line');
if (why !== 'Stopped: something else was at that spot when the mouse got there (the page moved): nothing reached the page') fail(`moved: ${why}`);
// A press on what we checked goes through, and nothing is reported.
guardClick(false, checked);
press(checked);
if (pageSaw !== 1 || endGuard()) fail('a press on what we checked should reach the page');

// (b) Script came late (a tab open before the extension loaded): the page's listener is first and takes the press. The
// reply must not say "Stopped" (seen live: Slides took 12 such clicks, and the agent did them again).
listeners.length = 0;
pageSaw = 0;
pageListens();
doc.readyState = 'complete';
watchMouse();
guardClick(false, checked);
press({});
why = endGuard();
if (pageSaw !== 1 || why.startsWith('Stopped') || !why.startsWith('Maybe done:') || !why.includes('reload the tab')) fail(`late: ${pageSaw} ${why}`);
