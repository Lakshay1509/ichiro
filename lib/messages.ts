// Messages the side panel sends to the page, and the page's replies. Add new commands here.
export type Message =
  | { type: 'ping' }
  | { type: 'read'; next: number; overlay: boolean } // next: the last element number given out (lib/page/numbers.ts); overlay: /overlay's setting
  | { type: 'text'; all?: boolean } // all: the whole page, not just the screen (F3a)
  | { type: 'find'; query: string; nth: number }
  | { type: 'pick'; selector: string } // F3b: read-only, text only
  | { type: 'pickLike'; n: number } // F3c: everything built like element n
  | { type: 'alike'; n: number; items: number[] } // RP1: the items not built like element n (read-only)
  // allow: skip the stop-line check for this one action. Only the panel's Allow once button sets it, never a command.
  | { type: 'click'; n: number; allow?: boolean }
  // R1: click "text" that names no element: count, then click, the shown page text reading exactly that.
  | { type: 'textCount'; text: string }
  | { type: 'clickText'; text: string; allow?: boolean }
  // I1: every check a click (or hover) needs and its point, for the panel's real mouse; aimDone ends the click's guard.
  | { type: 'aim'; n?: number; text?: string; allow?: boolean; hover?: boolean }
  | { type: 'aimDone' }
  // WR1: a click or drag at points in the last screenshot (shot: its size), and a real key: checks only, the panel acts.
  | { type: 'aimPoints'; points: { x: number; y: number }[]; shot: { width: number; height: number }; allow?: boolean }
  | { type: 'aimKey'; key: string; allow?: boolean }
  // WR2: does focus end in this frame; the checks before typing or pasting text there.
  | { type: 'focusHere' }
  | { type: 'aimText'; paste: boolean; allow?: boolean }
  | { type: 'pasteText'; text: string; allow?: boolean }
  | { type: 'hover'; n: number }
  | { type: 'type'; n: number; text: string; enter: boolean; slow: boolean; allow?: boolean }
  | { type: 'select'; n: number; option: string; allow?: boolean }
  | { type: 'scroll'; dir: 'up' | 'down' | 'left' | 'right'; n?: number }
  | { type: 'key'; key: string; allow?: boolean }
  | { type: 'settle'; maxMs: number }
  | { type: 'captcha' }
  | { type: 'inView' } // #16: does this frame show on the tab's screen (null: no answer, a hidden tab)
  | { type: 'overlay'; on: boolean }
  // F1a: draw (on) or clear the numbers for a screenshot. Replies true if a secret field is on screen.
  | { type: 'shot'; on: boolean };

// contentType: application/pdf in a PDF tab, whose content Chrome's own viewer shows (P1).
export type PingReply = { url: string; title: string; contentType?: string; visible: boolean }; // visible: BG3, isDrawn

// One frame's part of a read: header (top frame only), numbered element lines, and how many were found in total.
// page: what the AI reads (F2): the element lines with the visible text around them, in page order.
export type ReadReply = { header: string; lines: string[]; numbers: number[]; total: number; page: string[] };

// Reply type for each message type.
export type Replies = {
  ping: PingReply;
  read: ReadReply;
  text: string;
  find: string;
  pick: string;
  pickLike: string;
  alike: number[];
  click: string;
  textCount: number;
  clickText: string;
  aim: { x: number; y: number; note: string } | null; // null: in a frame, so the panel uses script events. note: R1's pick among texts
  aimDone: string; // why the guard stopped the gesture, '' if it didn't
  aimPoints: { points: { x: number; y: number }[]; note: string }; // the points in this viewport; note: what's under them
  aimKey: string | null; // where the key lands; null: Escape for the panel on top, as a script event
  focusHere: boolean;
  aimText: string; // where the text lands
  pasteText: string;
  hover: string;
  type: string;
  select: string;
  scroll: string;
  key: string;
  settle: boolean;
  captcha: string;
  inView: boolean | null;
  overlay: string;
  shot: boolean;
};

// What actually crosses the channel: the reply, the error text (thrown errors don't cross on their own),
// a stop-line message (the action wasn't done; it needs your ok) or a hand-over (it's yours to do).
export type Envelope<T> = { value: T } | { error: string } | { stop: string } | { handOver: string };

// Thrown when an action hit a stop-line. Its own class so the panel can tell it from a failure.
export class StopLine extends Error {}

// Thrown when only you may do it (4.2: a secret field, a CAPTCHA). No Allow once: a run pauses until you Resume.
export class HandOver extends Error {}

// After this long without an answer the panel checks whether the page is frozen (a browser dialog),
// and the page ignores messages that arrive later than this, so nothing runs after the panel gave up.
export const STALE_MS = 5000;
