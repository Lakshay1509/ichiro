// Checks the loop guard (3.7c): warns, then pauses, on runs going in circles; quiet on normal runs. Run: npm test
import { LoopGuard } from './loop-guard.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
// A page: its URL and scroll position, plus some elements (numbered from `from`).
const page = (url: string, scroll: string, from = 1) => `URL: ${url}\nScroll: ${scroll}\n[${from}] link "Laptop A"\n[${from + 1}] link "Laptop B"`;
// Runs steps [command, page after] and returns what the guard said at each: '', 'warn' or 'pause'.
const run = (guard: LoopGuard, steps: [string, string][]) => steps.map(([c, p]) => {
  const r = guard.after(c, p);
  return r.pause ? 'pause' : r.warn ? 'warn' : '';
});
const expect = (got: string[], want: string[], what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${what}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

// The 2026-10-13 laptop run, steps 16–28: scroll down/up between the same spots, with reads and text in between.
const s = 'https://amazon.in/s?k=lenovo&rh=16gb';
const laptop = new LoopGuard(page(s, '41%'));
expect(run(laptop, [
  ['scroll down', page(s, '55%')], // new
  ['read', page(s, '55%')],
  ['text', page(s, '55%')],
  ['scroll down', page(s, '69%')], // new
  ['scroll down', page(s, '84%')], // new
  ['scroll up', page(s, '69%')],
  ['read', page(s, '69%')],
  ['scroll down', page(s, '84%')],
  ['scroll up', page(s, '69%')],
  ['scroll up', page(s, '55%')],
  ['read', page(s, '55%')],
  ['scroll down', page(s, '69%')],
  ['read', page(s, '69%')],
  // U1: 69% → 84% → 69% → 84% (steps 4–8) is a swing, caught at its 2nd round, step 8 (before U1: step 10, the 5th
  // step with nothing new). 3 stale steps after the warning → pause.
]), ['', '', '', '', '', '', '', 'warn', 'warn', 'warn', 'pause', 'pause', 'pause'], 'laptop loop');

// Keep going: counting starts afresh, and pages already seen still aren't progress.
laptop.reset();
expect(run(laptop, [['scroll up', page(s, '55%')], ['scroll down', page(s, '69%')], ['scroll down', page(s, '84%')], ['scroll up', page(s, '69%')], ['scroll up', page(s, '55%')]]),
  ['', '', '', '', 'warn'], 'after keep going');

// A normal run (task 1): search, open the article, read the date. Never warns.
const wiki = new LoopGuard(page('https://en.wikipedia.org/', '0%'));
expect(run(wiki, [
  ['type 1 "Alan Turing" enter', page('https://en.wikipedia.org/wiki/Alan_Turing', '0%')],
  ['text', page('https://en.wikipedia.org/wiki/Alan_Turing', '0%')],
  ['scroll down', page('https://en.wikipedia.org/wiki/Alan_Turing', '20%')],
  ['text', page('https://en.wikipedia.org/wiki/Alan_Turing', '20%')],
]), ['', '', '', ''], 'normal run');

// Repeating a failing command warns after 3; a new page clears the warning.
const stuck = new LoopGuard(page(s, '0%'));
expect(run(stuck, [['click 9', page(s, '0%')], ['click 9', page(s, '0%')], ['click 9', page(s, '0%')], ['click 4', page(`${s}&page=2`, '0%')], ['click 9', page(`${s}&page=2`, '0%')]]),
  ['', '', 'warn', '', ''], 'same command');

// Renumbered elements are the same state, not progress.
const renumbered = new LoopGuard(page(s, '0%'));
expect(run(renumbered, [1, 2, 3, 4, 5].map((i) => ['scroll down', page(s, '0%', i * 10)] as [string, string])), ['', '', 'warn', 'warn', 'warn'], 'renumbered');

// U1 (Passport Seva run 5): click 5 opens a menu, click 8 closes it, again and again. The guard remembers what each
// command did on each page: the 2nd identical result steers, the swing warns within 2 rounds, and known() tells the
// panel to refuse a 3rd try. tried() lists what was tried on the current page.
const home = 'URL: https://passportindia.gov.in/psp\n[1] button "Menu"';
const closed = `${home}\n[5] link "Services" collapsed\n[8] link "Login"`;
const open = `${home}\n[5] link "Services" expanded\n[8] link "Apply For"`;
const menu = new LoopGuard(closed);
const said = (r: { warn?: string; pause?: string; repeat?: string }) => [r.repeat ? 'repeat' : '', r.warn ? 'warn' : '', r.pause ? 'pause' : ''].filter(Boolean).join('+');
const swing = [['click 5', open], ['click 8', closed], ['click 5', open], ['click 8', closed]].map(([c, p]) => said(menu.after(c!, p!)));
expect(swing, ['', '', 'repeat+warn', 'repeat+warn'], 'swing and repeats');
const known = menu.known('click 5');
if (known?.times !== 2 || known.outcome !== 'back to the page from 2 steps ago') fail(`known: ${JSON.stringify(known)}`);
if (menu.known('click 9') !== undefined) fail('an untried command is unknown');
if (menu.tried() !== 'Already tried on this page: click 5 → back to the page from 2 steps ago (2×)') fail(`tried: ${menu.tried()}`);
// A result that changes isn't a repeat: the count starts again.
const varies = new LoopGuard(closed);
varies.after('click 5', open);
varies.after('back', closed);
varies.after('click 5', `${open}\n[9] link "Fee Calculator"`);
if (varies.after('back', closed).repeat || varies.known('click 5')?.times !== 1) fail(`a different result counted as a repeat: ${JSON.stringify(varies.known('click 5'))}`);
// A command that didn't run (refused) isn't an outcome; "nothing changed" is one.
const still = new LoopGuard(closed);
still.after('scroll down', closed, false);
if (still.known('scroll down') !== undefined) fail('a refused command was recorded');
still.after('scroll down', closed);
if (still.known('scroll down')?.outcome !== 'nothing changed') fail(`nothing changed: ${JSON.stringify(still.known('scroll down'))}`);
// Unusable replies aren't commands.
still.after('(unusable reply) x', closed);
if (still.tried().includes('unusable')) fail('an unusable reply listed as tried');

// F2: page text that changes by itself (a clock, "12 people viewing") is not progress; quoted lines are ignored.
const ticking = new LoopGuard(`${page(s, '0%')}\n"10:01:00"`);
expect(run(ticking, [1, 2, 3].map((i) => ['click 9', `${page(s, '0%')}\n"10:01:0${i}"`] as [string, string])), ['', '', 'warn'], 'text-only change');
