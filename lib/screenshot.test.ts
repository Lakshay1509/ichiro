// Checks the screenshot guards (F1b). Run: npm test
import { OFF_SCREEN, takeShot, type ShotTab } from './screenshot.ts';

const fail = (what: string): never => {
  throw new Error(what);
};

const PAGE = 'https://in.bookmyshow.com/movies/doraemon';
const SECRET = 'a password, card or one-time-code field is on screen';

// A fake tab. Each list gives what the 1st and 2nd call return (get: before/after; numbers: draw/clear).
function fakeTab(o: { active?: boolean[]; urls?: string[]; secret?: string[]; switchDuring?: boolean; captureFails?: boolean } = {}) {
  let gets = 0;
  let switches = 0;
  let captures = 0;
  const marks: boolean[] = [];
  const tab: ShotTab = {
    get: async () => {
      const i = gets++;
      return { active: o.active?.[i] ?? true, url: o.urls?.[i] ?? PAGE };
    },
    switches: () => switches,
    numbers: async (on) => {
      marks.push(on);
      return o.secret?.[marks.length - 1] ?? '';
    },
    capture: async () => {
      captures++;
      if (o.switchDuring) switches++;
      if (o.captureFails) throw new Error('capture failed');
      return 'data:image/png;base64,AAAA';
    },
  };
  return { tab, marks, captures: () => captures };
}

const why = async (onPlan: boolean, f: ReturnType<typeof fakeTab>) => {
  const r = await takeShot(onPlan, f.tab);
  return 'why' in r ? r.why : '';
};

// Happy path: a picture, with the numbers drawn then cleared.
const ok = fakeTab();
const shot = await takeShot(true, ok.tab);
if (!('dataUrl' in shot) || shot.dataUrl !== 'data:image/png;base64,AAAA') fail(`happy path: ${JSON.stringify(shot)}`);
if (ok.marks.join() !== 'true,false') fail(`numbers drawn then cleared: ${ok.marks}`);

// Each guard refuses, with its reason. Refusals before the capture never take a picture at all.
const cases: [string, boolean, ReturnType<typeof fakeTab>, string, number][] = [
  ['off Sites', false, fakeTab(), "not one of the run's Sites", 0],
  ['checkout URL', true, fakeTab({ urls: ['https://in.bookmyshow.com/checkout/payment'] }), 'checkout or payment page', 0],
  ['not active before', true, fakeTab({ active: [false] }), OFF_SCREEN, 0],
  ['secret before', true, fakeTab({ secret: [SECRET] }), SECRET, 0],
  ['secret after', true, fakeTab({ secret: ['', SECRET] }), SECRET, 1],
  ['switch during', true, fakeTab({ switchDuring: true }), OFF_SCREEN, 1],
  ['not active after', true, fakeTab({ active: [true, false] }), OFF_SCREEN, 1],
  ['page changed', true, fakeTab({ urls: [PAGE, `${PAGE}/buytickets`] }), 'the page changed during the picture', 1],
];
for (const [what, onPlan, f, reason, captures] of cases) {
  const got = await why(onPlan, f);
  if (got !== reason) fail(`${what}: got "${got}"`);
  if (f.captures() !== captures) fail(`${what}: ${f.captures()} captures, expected ${captures}`);
  if (f.marks.length && f.marks.at(-1) !== false) fail(`${what}: numbers left on the page`);
}

// A failed capture still clears the numbers, and the error reaches the panel.
const broken = fakeTab({ captureFails: true });
let threw = false;
await takeShot(true, broken.tab).catch(() => (threw = true));
if (!threw || broken.marks.join() !== 'true,false') fail(`failed capture: threw ${threw}, marks ${broken.marks}`);
