// Checks WR1's keys: names and shortcuts become the right real key events, and the rules refuse or stop the risky
// ones (paste, typing into fields or frames, save/print/open, ctrl+Enter). Run: npm test
import { browserKey, keyEvents, keyRefusal, keyStop, parseKey, scriptKey } from './keys.ts';

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

// Names: canonical order and spelling, whatever was typed.
for (const [input, name] of [['ctrl+z', 'ctrl+z'], ['Shift+Control+Z', 'ctrl+shift+z'], ['esc', 'Escape'], ['cmd+a', 'meta+a'], ['f5', 'F5'], ['space', 'Space'], ['left', 'ArrowLeft']]) {
  if (parseKey(input!).name !== name) fail(`${input} should be named ${name}, got ${parseKey(input!).name}`);
}
for (const bad of ['', '+', 'ctrl+', 'ctrl++', 'hyper+z', 'ctrl+ctrl+z', 'F13', 'ab', 'constructor', 'constructor+z', 'toString', 'é', 'x'.repeat(41)]) throws(() => parseKey(bad), `key ${JSON.stringify(bad)}`);

// A letter types itself; shift makes a capital or the shifted sign; ctrl, alt or meta make it a shortcut that types nothing.
const r = parseKey('r');
if (r.key !== 'r' || r.code !== 'KeyR' || r.keyCode !== 82 || r.text !== 'r' || !r.printable) fail(`r: ${JSON.stringify(r)}`);
if (parseKey('shift+r').text !== 'R' || parseKey('shift+1').text !== '!' || parseKey('shift+/').key !== '?') fail('shift should give R, ! and ?');
const z = parseKey('ctrl+shift+z');
if (z.text !== '' || z.printable || z.key !== 'Z' || z.modifiers !== 10) fail(`ctrl+shift+z: ${JSON.stringify(z)}`);
if (parseKey('Enter').text !== '\r' || parseKey('Enter').printable) fail('Enter types \\r but is not printable');
if (!parseKey('Space').printable || parseKey('Tab').printable || parseKey('Delete').printable) fail('Space is printable; Tab and Delete are not');

// Events: modifiers down in order, key down and up, modifiers up in reverse, each with the bits still held.
const ev = keyEvents(z).map((e) => `${e.type} ${e.key} ${e.modifiers}${e.text ? ` "${e.text}"` : ''}`);
const want = ['rawKeyDown Control 2', 'rawKeyDown Shift 10', 'rawKeyDown Z 10', 'keyUp Z 10', 'keyUp Shift 2', 'keyUp Control 0'];
if (JSON.stringify(ev) !== JSON.stringify(want)) fail(`ctrl+shift+z events: ${JSON.stringify(ev)}`);
const typed = keyEvents(parseKey('r'));
if (typed.length !== 2 || typed[0]!.type !== 'keyDown' || typed[0]!.text !== 'r' || typed[0]!.unmodifiedText !== 'r') fail(`r events: ${JSON.stringify(typed)}`);

// Never sent: pasting your clipboard (any focus), typing into a field, typing or Enter inside a frame.
for (const paste of ['ctrl+v', 'meta+v', 'ctrl+shift+v', 'shift+Insert']) if (!keyRefusal(parseKey(paste), 'other')) fail(`${paste} should be refused`);
for (const t of ['a', 'shift+a', '1', 'Space', '/']) if (!keyRefusal(parseKey(t), 'field')) fail(`${t} into a field should be refused`);
for (const t of ['a', 'Enter', 'shift+Enter', 'Space']) if (!keyRefusal(parseKey(t), 'frame')) fail(`${t} in a frame should be refused`);
// Allowed: shortcuts and editing keys in a field, tool letters on a canvas, moving keys in a frame.
for (const [t, focus] of [['ctrl+a', 'field'], ['Backspace', 'field'], ['shift+Tab', 'field'], ['r', 'other'], ['ctrl+z', 'frame'], ['Delete', 'frame']] as const) {
  if (keyRefusal(parseKey(t), focus)) fail(`${t} (${focus}) should be allowed: ${keyRefusal(parseKey(t), focus)}`);
}

// Needs your ok: save, print, open a file; ctrl+Enter or meta+Enter (send). Not: other shortcuts, shift+Enter.
for (const s of ['ctrl+s', 'ctrl+shift+s', 'meta+p', 'ctrl+o', 'ctrl+Enter', 'meta+Enter']) if (!keyStop(parseKey(s))) fail(`${s} should need an ok`);
for (const s of ['ctrl+z', 'ctrl+d', 'shift+Enter', 'Enter', 's']) if (keyStop(parseKey(s))) fail(`${s} should not need an ok`);

// F-phase keys alone may fall back to script events (no real keyboard, Escape for the panel on top); with a modifier,
// or any other key, there's no script path: real only.
for (const s of ['esc', 'Enter', 'Tab', 'Backspace', 'up', 'down', 'left', 'right']) if (!scriptKey(parseKey(s))) fail(`${s} should have a script fallback`);
for (const s of ['shift+Tab', 'shift+Down', 'ctrl+End', 'Delete', 'Home', 'r']) if (scriptKey(parseKey(s))) fail(`${s} should be real only`);

// Chrome's own zoom keys: still sent (a drawing app may zoom itself), but the reply says Chrome itself can't zoom from
// them. Seen live: ctrl+= said "ok" and nothing zoomed. Others aren't zoom: ctrl+alt+= is the page's, = alone types.
for (const s of ['ctrl+=', 'ctrl+shift+=', 'ctrl+-', 'ctrl+0', 'meta+=', 'meta+-', 'meta+0']) if (!browserKey(parseKey(s))?.includes('zoom')) fail(`${s} should say it's Chrome's zoom`);
for (const s of ['=', '-', '0', 'ctrl+alt+=', 'shift+=', 'ctrl+z', 'ctrl+1']) if (browserKey(parseKey(s))) fail(`${s} is not a browser shortcut`);
