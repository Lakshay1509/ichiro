// WR1: key names and shortcuts (ctrl+z, shift+Tab, r) as the real key events chrome.debugger sends, and the rules
// that keep them safe. US layout. Codes as in Puppeteer's USKeyboardLayout.
// Sources: Input.dispatchKeyEvent in https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Input.pdl
// https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/common/USKeyboardLayout.ts

// The protocol's modifier bits. Source: Input.pdl, dispatchKeyEvent's modifiers.
export const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;
type Modifier = keyof typeof MODIFIERS;
const ALIASES: Record<string, Modifier> = { control: 'ctrl', cmd: 'meta', command: 'meta', option: 'alt' };
// Pressed and named in this order: ctrl+shift+z, never shift+ctrl+z.
const ORDER: Modifier[] = ['ctrl', 'alt', 'shift', 'meta'];
const MODIFIER_KEYS: Record<Modifier, [key: string, code: string, keyCode: number]> = {
  ctrl: ['Control', 'ControlLeft', 17], alt: ['Alt', 'AltLeft', 18], shift: ['Shift', 'ShiftLeft', 16], meta: ['Meta', 'MetaLeft', 91],
};

// Keys with a name: [key, code, keyCode, text it types]. Enter's '\r' is what makes a real Enter submit.
const NAMED: Record<string, [string, string, number, string?]> = {
  enter: ['Enter', 'Enter', 13, '\r'], escape: ['Escape', 'Escape', 27], tab: ['Tab', 'Tab', 9],
  backspace: ['Backspace', 'Backspace', 8], delete: ['Delete', 'Delete', 46], insert: ['Insert', 'Insert', 45],
  space: [' ', 'Space', 32, ' '], home: ['Home', 'Home', 36], end: ['End', 'End', 35],
  pageup: ['PageUp', 'PageUp', 33], pagedown: ['PageDown', 'PageDown', 34],
  arrowleft: ['ArrowLeft', 'ArrowLeft', 37], arrowup: ['ArrowUp', 'ArrowUp', 38],
  arrowright: ['ArrowRight', 'ArrowRight', 39], arrowdown: ['ArrowDown', 'ArrowDown', 40],
};
const KEY_ALIASES: Record<string, string> = { esc: 'escape', del: 'delete', return: 'enter', left: 'arrowleft', up: 'arrowup', right: 'arrowright', down: 'arrowdown' };

// Punctuation: [code, keyCode, with shift].
const PUNCTUATION: Record<string, [string, number, string]> = {
  '-': ['Minus', 189, '_'], '=': ['Equal', 187, '+'], '[': ['BracketLeft', 219, '{'], ']': ['BracketRight', 221, '}'],
  ';': ['Semicolon', 186, ':'], "'": ['Quote', 222, '"'], ',': ['Comma', 188, '<'], '.': ['Period', 190, '>'],
  '/': ['Slash', 191, '?'], '\\': ['Backslash', 220, '|'], '`': ['Backquote', 192, '~'],
};
const SHIFTED_DIGITS = ')!@#$%^&*(';

// printable: a key that types a character (a letter, digit, punctuation, Space), so it can't go into a field.
export type KeyPress = { key: string; code: string; keyCode: number; text: string; modifiers: number; printable: boolean; name: string };

// Own keys only: a plain lookup would also find "constructor".
const own = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

const KEY_HELP = 'a letter or digit, punctuation, Enter, Escape, Tab, Backspace, Delete, Space, an arrow, Home, End, PageUp, PageDown, Insert or F1–F12, with ctrl+, alt+, shift+ or meta+ in front for a shortcut (ctrl+z)';

// "ctrl+shift+z" → the key press. Letters ignore case: shift+a for a capital.
export function parseKey(input: string): KeyPress {
  const parts = input.split('+');
  const last = parts.pop()!;
  if (input.length > 40 || !last || parts.some((p) => !p)) throw new Error(`Not a key: ${JSON.stringify(input.slice(0, 40))}. Use ${KEY_HELP}`);
  let modifiers = 0;
  for (const part of parts) {
    const lower = part.toLowerCase();
    const m = own(ALIASES, lower) ?? (Object.hasOwn(MODIFIERS, lower) ? (lower as Modifier) : null);
    if (!m) throw new Error(`Not a modifier: ${JSON.stringify(part)}. Use ctrl, alt, shift or meta`);
    if (modifiers & MODIFIERS[m]) throw new Error(`${m} twice in ${JSON.stringify(input)}`);
    modifiers |= MODIFIERS[m];
  }
  const shift = !!(modifiers & MODIFIERS.shift);
  const lower = last.toLowerCase();
  let k: Pick<KeyPress, 'key' | 'code' | 'keyCode' | 'text' | 'printable'> & { label: string };
  const named = own(NAMED, own(KEY_ALIASES, lower) ?? lower);
  const f = /^f([1-9]|1[0-2])$/.exec(lower);
  if (named) {
    const [key, code, keyCode, text = ''] = named;
    k = { key, code, keyCode, text, printable: key === ' ', label: key === ' ' ? 'Space' : key };
  } else if (f) {
    k = { key: `F${f[1]}`, code: `F${f[1]}`, keyCode: 111 + Number(f[1]), text: '', printable: false, label: `F${f[1]}` };
  } else if (/^[a-z]$/.test(lower)) {
    const key = shift ? lower.toUpperCase() : lower;
    k = { key, code: `Key${lower.toUpperCase()}`, keyCode: lower.charCodeAt(0) - 32, text: key, printable: true, label: lower };
  } else if (/^[0-9]$/.test(last)) {
    const key = shift ? SHIFTED_DIGITS[Number(last)]! : last;
    k = { key, code: `Digit${last}`, keyCode: 48 + Number(last), text: key, printable: true, label: last };
  } else if (own(PUNCTUATION, last)) {
    const [code, keyCode, shifted] = own(PUNCTUATION, last)!;
    const key = shift ? shifted : last;
    k = { key, code, keyCode, text: key, printable: true, label: last };
  } else {
    throw new Error(`Not a key: ${JSON.stringify(last.slice(0, 20))}. Use ${KEY_HELP}`);
  }
  // With ctrl, alt or meta held a key types nothing: it's a shortcut (Puppeteer does the same).
  const shortcut = !!(modifiers & ~MODIFIERS.shift);
  const name = [...ORDER.filter((m) => modifiers & MODIFIERS[m]), k.label].join('+');
  return { key: k.key, code: k.code, keyCode: k.keyCode, text: shortcut ? '' : k.text, modifiers, printable: k.printable && !shortcut, name };
}

export type KeyEvent = { type: 'rawKeyDown' | 'keyDown' | 'keyUp'; modifiers: number; key: string; code: string; windowsVirtualKeyCode: number; text?: string; unmodifiedText?: string };

// What a person's fingers do: each modifier down, the key down and up, the modifiers up. keyDown with text also types
// it (keypress, input); rawKeyDown is the key alone.
export function keyEvents(k: KeyPress): KeyEvent[] {
  const held = ORDER.filter((m) => k.modifiers & MODIFIERS[m]);
  const events: KeyEvent[] = [];
  let mods = 0;
  for (const m of held) {
    mods |= MODIFIERS[m];
    const [key, code, keyCode] = MODIFIER_KEYS[m];
    events.push({ type: 'rawKeyDown', modifiers: mods, key, code, windowsVirtualKeyCode: keyCode });
  }
  const main = { modifiers: k.modifiers, key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode };
  events.push(k.text ? { type: 'keyDown', ...main, text: k.text, unmodifiedText: k.text } : { type: 'rawKeyDown', ...main });
  events.push({ type: 'keyUp', ...main });
  for (const m of held.reverse()) {
    mods &= ~MODIFIERS[m];
    const [key, code, keyCode] = MODIFIER_KEYS[m];
    events.push({ type: 'keyUp', modifiers: mods, key, code, windowsVirtualKeyCode: keyCode });
  }
  return events;
}

const held = (k: KeyPress, ...ms: Modifier[]) => ms.some((m) => k.modifiers & MODIFIERS[m]);

// Why this key must never be sent where focus is, or null. Not even Allow once: these are about what leaves you.
// field: focus is in a text field; frame: focus is inside an iframe, whose element our checks can't see.
export function keyRefusal(k: KeyPress, focus: 'field' | 'frame' | 'other'): string | null {
  // ctrl+v pastes whatever you last copied (a password, an address) into the page.
  if ((k.code === 'KeyV' && held(k, 'ctrl', 'meta')) || (k.key === 'Insert' && held(k, 'shift'))) {
    return `${k.name} would paste your own clipboard into the page`;
  }
  if (focus === 'frame' && (k.printable || k.key === 'Enter')) {
    return `focus is inside a frame, where ${k.name} can't be checked: click or type on that frame's element instead`;
  }
  // Letter by letter would get past type's personal-data check and its secret-field hand-over.
  if (focus === 'field' && k.printable) return `${k.name} would type into a field: use type <n> "text"`;
  return null;
}

// Why this key needs your ok first, or null. Enter and Space on what they'd press are checked on the page itself.
export function keyStop(k: KeyPress): string | null {
  if (held(k, 'ctrl', 'meta') && ['KeyS', 'KeyP', 'KeyO'].includes(k.code)) return `${k.name} saves, prints or opens a file`;
  if (held(k, 'ctrl', 'meta') && k.key === 'Enter') return `${k.name} usually sends or submits`;
  return null;
}

// Chrome's own zoom keys, or null. A key we send goes to the page only, so Chrome itself never zooms (seen live: ctrl+=
// said "ok"). It's still sent: the page may zoom its own canvas on it. Only zoom is listed: the keys Chrome's help gives
// for it. Sources: https://support.google.com/chrome/answer/157179 (zoom: Ctrl and +, Ctrl and -, Ctrl + 0; ⌘ on Mac)
// and dispatchKeyEvent ("Dispatches a key event to the page") in Input.pdl, linked at the top.
export function browserKey(k: KeyPress): string | null {
  const zoom = held(k, 'ctrl', 'meta') && !held(k, 'alt') && ['Equal', 'Minus', 'Digit0'].includes(k.code);
  return zoom ? `${k.name} is Chrome's own zoom shortcut, which keys sent to the page can't do: Chrome didn't zoom (only the page's own zoom, if it has one, got the key)` : null;
}

// The keys F-phase pressKey can send as script events (actions.ts KEY_CODES), with no modifier. They go real like the
// rest, and fall back to the script event for Escape to the panel on top, or where there's no real keyboard.
export const SCRIPT_KEYS = ['Enter', 'Escape', 'Tab', 'Backspace', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'];
export const scriptKey = (k: KeyPress) => k.modifiers === 0 && SCRIPT_KEYS.includes(k.key);
