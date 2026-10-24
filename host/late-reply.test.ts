// Checks host/late-reply.ts: a slow panel reply turns into "still waiting", and the next call gets it first. Run: npm test
import { lateReplies } from './late-reply.ts';
import type { BridgeReply } from '../lib/bridge/bridge.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const WAIT = 20; // ms, stands in for the real 50 s

// A fake panel: each run returns a reply you settle by hand, and every run is logged.
const ran: string[][] = [];
let answer: (r: BridgeReply) => void = () => {};
let refuse: (e: Error) => void = () => {};
const slow = (commands: string[]) => {
  ran.push(commands);
  return new Promise<BridgeReply>((resolve, reject) => {
    answer = resolve;
    refuse = reject;
  });
};
const call = lateReplies(slow, WAIT);
const text = (r: BridgeReply | undefined) => (r?.type === 'output' ? r.text : `(${JSON.stringify(r)})`);

// A fast reply is the call's own, with no note.
const fast = await lateReplies(async () => ({ type: 'output', text: 'ok' }), WAIT)(['read']);
if (fast.note !== '' || text(fast.reply) !== 'ok') fail('a fast reply comes back as is');

// No reply in time: the call answers before the agent's limit, with no reply.
const first = await call(['click 4']);
if (first.reply || !/send read/.test(first.note)) fail(`a slow reply says to send read: ${first.note}`);
if (!/Ichiro icon/.test(first.note)) fail(`a slow reply says where a closed panel's ask is (BG6): ${first.note}`);

// Still no reply: the next call waits on the old run and doesn't run its own commands.
const second = await call(['read']);
if (second.reply || !/Not run/.test(second.note)) fail(`still waiting: ${second.note}`);
if (ran.length !== 1) fail('nothing new runs while an earlier reply is owed');

// The user answers: the next call gets that late reply first, and says its own commands didn't run.
answer({ type: 'output', text: 'The user allowed this step once: ok' });
const third = await call(['read']);
if (text(third.reply) !== 'The user allowed this step once: ok' || !/Not run/.test(third.note)) fail(`late reply first: ${third.note}`);
if (ran.length !== 1) fail('the late reply call runs nothing');

// Owed nothing now: the next call runs its own commands.
const fourth = call(['read']);
answer({ type: 'output', text: 'page' });
const own = await fourth;
if (own.note !== '' || text(own.reply) !== 'page' || ran.length !== 2 || ran[1]![0] !== 'read') fail('back to normal runs');

// The bridge closes while nobody waits: the next call gets that error (and says its commands didn't run), then runs normally.
await call(['click 9']);
refuse(new Error('The side panel closed the bridge before replying.'));
try {
  await call(['read']);
  fail('a late error should throw');
} catch (e) {
  if (!/Not run.*closed the bridge/s.test((e as Error).message)) fail(`late error: ${(e as Error).message}`);
}
const after = call(['read']);
answer({ type: 'output', text: 'page 2' });
if (text((await after).reply) !== 'page 2' || ran.length !== 4) fail('runs again after a late error');

// BG7: an ask to show in a dialog stops the wait early. The reply stays owed, and nothing new runs.
let ask = () => {};
const asked = call(['goto https://new.example/'], { until: new Promise<void>((done) => (ask = done)) });
ask();
const early = await asked;
if (early.reply || ran.length !== 5) fail('an ask ends the wait early, with no reply');
// The same call again after the dialog (resumed): it gets its own reply, with no note, and runs nothing again.
const resumed = call(['goto https://new.example/'], { resumed: true });
answer({ type: 'output', text: 'Step 3. page' });
const own2 = await resumed;
if (own2.note !== '' || text(own2.reply) !== 'Step 3. page' || ran.length !== 5) fail(`resumed call gets its own reply: ${own2.note}`);
// A resumed call with nothing owed (its reply went to another call) never runs its commands a second time.
const gone = await call(['click 4'], { resumed: true });
if (gone.reply || !/Not run again/.test(gone.note) || ran.length !== 5) fail(`resumed with nothing owed: ${gone.note}`);

// A late call (an earlier reply owed) that shows a dialog stays late when resumed: the reply isn't for its commands.
await call(['click 5']);
const lateAsk = call(['read'], { until: Promise.resolve() });
if ((await lateAsk).reply) fail('a late call stops early for an ask too');
const lateResumed = call(['read'], { resumed: true });
answer({ type: 'output', text: 'clicked' });
const lr = await lateResumed;
if (text(lr.reply) !== 'clicked' || !/Not run/.test(lr.note) || ran.length !== 6) fail(`a resumed late call keeps its note: ${lr.note}`);

console.log('late-reply: all checks passed');
