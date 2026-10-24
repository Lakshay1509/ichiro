// Checks BG4's port: the log ops both sides apply, the panel-only sender guard, message shapes, and stale presses. Run: npm test
import { apply, isFromPanel, isPanelSender, MAX_LOG, pressed, type Item, type Log, type Step } from './panel-port.ts';

const fail = (what: string): never => {
  throw new Error(what);
};

// The log: a step collects what shows while it's open; leave and close end that; swap finds items inside steps too.
const line = (id: number, text: string): Item => ({ id, kind: 'line', text });
const step = (id: number): Step => ({ id, kind: 'step', n: id, title: 'Read the page', raw: ['read'], items: [] });
const log: Log = { items: [], open: null };
apply(log, { type: 'show', item: line(1, 'mine') });
apply(log, { type: 'open', step: step(2) });
apply(log, { type: 'show', item: { id: 3, kind: 'ask', buttons: ['Allow once', "I'll do it"] } });
if (log.items.length !== 2 || (log.items[1] as Step).items.length !== 1) fail(`show into the open step: ${JSON.stringify(log)}`);
apply(log, { type: 'swap', id: 3, item: line(3, 'Allowed once.') });
if ((log.items[1] as Step).items[0]!.kind !== 'line') fail('swap inside a step');
apply(log, { type: 'leave' });
apply(log, { type: 'show', item: line(4, '> /read') });
if (log.items.length !== 3) fail('leave: the next line goes outside the step');
apply(log, { type: 'close', id: 2, ended: 'Done' });
if ((log.items[1] as Step).ended !== 'Done') fail('close');
apply(log, { type: 'open', step: step(5) });
apply(log, { type: 'close', id: 5, ended: 'Stopped' });
apply(log, { type: 'show', item: line(6, 'after') });
if (log.items.length !== 5 || log.open !== null) fail('close ends the open step');
apply(log, { type: 'swap', id: 99, item: line(99, 'x') });
if (log.items.some((i) => i.id === 99)) fail('swap of a gone item adds nothing');
// An ask whose answer a later line says (Refused…) just goes: swap with null takes it away, inside a step too.
apply(log, { type: 'show', item: { id: 7, kind: 'ask', buttons: ['Add site', 'No'] } });
apply(log, { type: 'swap', id: 7, item: null });
if (log.items.some((i) => i.id === 7) || log.items.length !== 5) fail('swap with null removes the ask');
const inStep = log.items[1] as Step;
inStep.items.push({ id: 8, kind: 'ask', buttons: ['Allow', 'No'] });
apply(log, { type: 'swap', id: 8, item: null });
if (inStep.items.some((i) => i.id === 8)) fail('swap with null removes an ask inside a step');
apply(log, { type: 'clear' });
if (log.items.length || log.open !== null) fail('clear');

// Capped: the oldest top-level entries drop off, the newest stay.
for (let i = 1; i <= MAX_LOG + 5; i++) apply(log, { type: 'show', item: line(i, String(i)) });
if (log.items.length !== MAX_LOG || log.items[0]!.id !== 6) fail(`cap: ${log.items.length}, first ${log.items[0]!.id}`);

// Only our own side panel may connect: never a content script (a page can drive one), our panel page in a tab, or
// another extension.
const ID = 'abcdefghijklmnopabcdefghijklmnop';
const PANEL = `chrome-extension://${ID}/sidepanel.html`;
const senders: [string, { id?: string; tab?: unknown; url?: string }, boolean][] = [
  ['the side panel', { id: ID, url: PANEL }, true],
  ['our content script in a tab', { id: ID, tab: { id: 7 }, url: 'https://evil.example/' }, false],
  ['our panel page opened in a tab', { id: ID, tab: { id: 7 }, url: PANEL }, false],
  ['the hidden page', { id: ID, url: `chrome-extension://${ID}/offscreen.html` }, false],
  ['another extension', { id: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', url: PANEL }, false],
  ['our id with a web URL', { id: ID, url: 'https://evil.example/sidepanel.html' }, false],
  ['a URL that only starts like the panel', { id: ID, url: `${PANEL}x` }, false],
  ['no URL', { id: ID }, false],
  ['no id', { url: PANEL }, false],
];
for (const [what, sender, want] of senders) {
  if (isPanelSender(sender, ID, PANEL) !== want) fail(`isPanelSender, ${what}: want ${want}`);
}

// Message shapes: a line, a press by whole numbers, a ping. Nothing else.
const msgs: [unknown, boolean][] = [
  [{ type: 'line', text: '/read' }, true],
  [{ type: 'line', text: 5 }, false],
  [{ type: 'line' }, false],
  [{ type: 'press', id: 3, button: 0 }, true],
  [{ type: 'press', id: '3', button: 0 }, false],
  [{ type: 'press', id: 3, button: -1 }, false],
  [{ type: 'press', id: 3, button: 0.5 }, false],
  [{ type: 'press', id: 3 }, false],
  [{ type: 'ping' }, true],
  [{ type: 'connected' }, true],
  [{ type: 'run', commands: ['click 1'] }, false],
  [null, false],
  ['ping', false],
];
for (const [msg, want] of msgs) {
  if (isFromPanel(msg) !== want) fail(`isFromPanel ${JSON.stringify(msg)}: want ${want}`);
}

// A press counts only for the open ask: a closed (null) or replaced one gets nothing, and a button out of range too.
const open = { id: 8, buttons: ['allow', 'stop'] };
if (pressed(open, { id: 8, button: 0 }) !== 'allow' || pressed(open, { id: 8, button: 1 }) !== 'stop') fail('press on the open ask');
if (pressed(open, { id: 7, button: 0 }) !== undefined) fail('press on a replaced ask');
if (pressed(null, { id: 8, button: 0 }) !== undefined) fail('press with no ask open');
if (pressed(open, { id: 8, button: 2 }) !== undefined) fail('press on a button that isn\'t there');

console.log('panel-port: ok');
