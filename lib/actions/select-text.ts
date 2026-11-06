// select text "start" to "end" [n] (#2): selects a stretch of text by its first and last words, so a partial edit (paste
// or type here over it, or key Delete) needs no screenshot and no pixel clicks. Runs in the content script.
import type { Point } from './real-input.ts';
import { guardClick } from './actions.ts';
import { joinLines, searchable, shownElement, toPiece } from '../page/page-text.ts';
import { allElements, clickable, deepContains, deepElementFromPoint, isSecret, label, name, NO_VALUE, parentOf, role } from '../page/reader.ts';

const MAX_ANCHOR = 100; // characters per anchor, like find's text
const SHOWN_MATCHES = 5;
const USAGE = 'Usage: select text "start" to "end" [n], e.g. select text "\\begin{abstract}" to "\\end{abstract}": selects from the start of "start" to the end of the first "end" after it (case and spaces ignored, each up to 100 characters); n picks the nth "start" when there are several';

// The command's words after "select text". The agent writes them, so anything else is refused. nth: undefined when no n
// was given, so several matches can be refused instead of guessed. Pure.
export function selectArgs(args: string[]): { from: string; to: string; nth?: number } {
  const [from, word, to, n, ...rest] = args;
  const anchor = (s: string | undefined): s is string => !!s?.trim() && s.length <= MAX_ANCHOR;
  if (!anchor(from) || word !== 'to' || !anchor(to) || (n !== undefined && !/^[1-9]\d{0,3}$/.test(n)) || rest.length) throw new Error(USAGE);
  return n === undefined ? { from, to } : { from, to, nth: Number(n) };
}

// Where query shows in text, ignoring case and all spaces (find's rules): each match's start and end in text. Pure.
export function matchesIn(text: string, query: string): { start: number; end: number }[] {
  let key = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    // Lowercasing can lengthen a character (İ → i̇): every unit maps back to the same character.
    if (!/\s/.test(ch)) for (const unit of ch.toLowerCase()) {
      key += unit;
      starts.push(i);
      ends.push(i + ch.length);
    }
    i += ch.length;
  }
  const needle = query.replace(/\s+/g, '').toLowerCase();
  const out: { start: number; end: number }[] = [];
  if (!needle) return out;
  for (let k = key.indexOf(needle); k !== -1; k = key.indexOf(needle, k + needle.length)) out.push({ start: starts[k]!, end: ends[k + needle.length - 1]! });
  return out;
}

// One line of text around a match, for listing matches.
const around = (text: string, start: number, end: number) => {
  const from = Math.max(0, start - 30);
  const to = Math.min(text.length, end + 30);
  return `${from ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ')}${to < text.length ? '…' : ''}`;
};

// The stretch to select across texts (each a text box's text, in page order): from the start of match nth of from to the
// end of the first to after it, in the same text. null if from isn't in any. Throws, listing the matches, when from shows
// more than once and no n was given (never guess), or to isn't after it. Pure.
export function pickSpan(texts: string[], from: string, to: string, nth?: number): { box: number; start: number; end: number } | null {
  const starts = texts.flatMap((text, box) => matchesIn(text, from).map((m) => ({ box, ...m })));
  if (!starts.length) return null;
  const q = (s: string) => JSON.stringify(s);
  const list = starts.slice(0, SHOWN_MATCHES).map((m, i) => `${i + 1}. ${JSON.stringify(around(texts[m.box]!, m.start, m.end))}`);
  if (starts.length > SHOWN_MATCHES) list.push(`… ${starts.length - SHOWN_MATCHES} more`);
  if (nth === undefined && starts.length > 1) throw new Error(`${starts.length} matches for ${q(from)}: add which one, e.g. select text ${q(from)} to ${q(to)} 2\n${list.join('\n')}`);
  if ((nth ?? 1) > starts.length) throw new Error(`Only ${starts.length} match${starts.length > 1 ? 'es' : ''} for ${q(from)}; there is no match ${nth}\n${list.join('\n')}`);
  const s = starts[(nth ?? 1) - 1]!;
  const e = matchesIn(texts[s.box]!.slice(s.end), to)[0];
  if (!e) throw new Error(`No ${q(to)} after ${q(from)}${starts.length > 1 ? ` (match ${nth})` : ''} in the same text box: check the end words, or select a shorter stretch`);
  return { box: s.box, start: s.start, end: s.end + e.end };
}

// Which piece holds character i of the pieces glued together, and where in it: lengths are the pieces' lengths. end: i is
// the end of a stretch, so a piece boundary counts as the end of the piece before (a range never starts past a piece's
// last character or ends at a piece's 0). Pure.
export function pieceAt(lengths: number[], i: number, end = false): { piece: number; offset: number } {
  let at = 0;
  for (const [piece, length] of lengths.entries()) {
    if (end ? i <= at + length : i < at + length) return { piece, offset: i - at };
    at += length;
  }
  return { piece: lengths.length - 1, offset: lengths.at(-1) ?? 0 };
}

// What was selected, for the reply: page text, so quoted, and cut in the middle when long (the agent checks both ends
// before replacing anything). Pure.
export function selectedNote(text: string): string {
  const head = 60;
  const shown = text.length > head * 2 + 10 ? `${JSON.stringify(text.slice(0, head))} … ${JSON.stringify(text.slice(-head))}` : JSON.stringify(text);
  return `${text.length} characters: ${shown}`;
}

// A text box: its text, and how to select a stretch of it (returns what got selected, as the page has it).
type Box = { el: Element; text: string; select: (start: number, end: number) => Promise<string> };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Focus first, then a moment: an editor (CodeMirror) may put its own selection back as it takes focus.
async function focus(el: HTMLElement) {
  if (el.contains(document.activeElement) || el === document.activeElement) return;
  el.focus({ preventScroll: true });
  await sleep(50);
}

// Plain text fields: their value, selected with setSelectionRange. Never a password, card or code field.
// Source: https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/setSelectionRange
function fieldBox(el: HTMLInputElement | HTMLTextAreaElement): Box {
  return {
    el,
    text: el.value,
    select: async (start, end) => {
      await focus(el);
      el.setSelectionRange(start, end);
      return el.value.slice(start, end);
    },
  };
}

// An editable area (contenteditable: CodeMirror 6, ProseMirror, Lexical…): its text nodes glued, selected as a DOM range.
// These editors read the page's selection back into their own when it changes.
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Selection/addRange
function editableBox(el: HTMLElement): Box {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const lengths = nodes.map((n) => n.data.length);
  return {
    el,
    text: nodes.map((n) => n.data).join(''),
    select: async (start, end) => {
      await focus(el);
      const a = pieceAt(lengths, start);
      const b = pieceAt(lengths, end, true);
      const range = document.createRange();
      range.setStart(nodes[a.piece]!, a.offset);
      range.setEnd(nodes[b.piece]!, b.offset);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? '';
    },
  };
}

// The page's text boxes, in page order: shown text fields and the outermost editable areas.
function textBoxes(): Box[] {
  const boxes: Box[] = [];
  for (const el of allElements(document.body)) {
    if (!shownElement(el) || isSecret(el)) continue;
    if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NO_VALUE.includes(el.type))) boxes.push(fieldBox(el));
    else if (el instanceof HTMLElement && el.isContentEditable && !(parentOf(el) as HTMLElement | null)?.isContentEditable) boxes.push(editableBox(el));
  }
  return boxes;
}

const what = (el: Element) => `${role(el)} ${JSON.stringify(name(el).slice(0, 40))}`;
// A text box by its label only: an editor's own text is no name ("\documentclass{article} …").
const boxName = (el: Element) => {
  const named = label(el).slice(0, 40);
  return `${role(el)}${named ? ` ${JSON.stringify(named)}` : ''}`;
};

// Where a real click puts the caret right before (or after, end) the character at offset of node: the middle of its
// left (right) edge, 1 px in. null when that spot isn't on screen.
function caretPoint(node: Text, offset: number, end: boolean): Point | null {
  const range = document.createRange();
  range.setStart(node, end ? offset - 1 : offset);
  range.setEnd(node, end ? offset : offset + 1);
  const rects = [...range.getClientRects()].filter((b) => b.width > 0 && b.height > 0);
  const r = end ? rects.at(-1) : rects[0];
  if (!r) return null;
  const p = { x: end ? r.right - 1 : r.left + 1, y: (r.top + r.bottom) / 2 };
  return p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight ? p : null;
}

// The text from a to b in nodes, as lines (a code editor's lines are boxes, with no line breaks between them).
function between(nodes: Text[], a: { piece: number; offset: number }, b: { piece: number; offset: number }): string {
  const range = document.createRange();
  const pieces = nodes.slice(a.piece, b.piece + 1).flatMap((node, i) => {
    const [start, end] = [i ? 0 : a.offset, a.piece + i === b.piece ? b.offset : node.data.length];
    range.setStart(node, start);
    range.setEnd(node, end);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    return rects.length ? [toPiece(node.data.slice(start, end), rects)] : [];
  });
  return joinLines(pieces);
}

// Text outside any text box (a code editor that keeps its own selection, like Monaco): the real mouse selects it, with
// a click at its start and a shift+click at its end, both checked like a click: on screen, not covered, not on a link or
// button (that click would open it). The guard keeps both on what was checked. Top page only: the points are its own.
function pagePoints(from: string, to: string, nth?: number): { points: Point[]; note: string } | null {
  const nodes = searchable();
  const text = nodes.map((n) => n.data).join('');
  const span = pickSpan([text], from, to, nth);
  if (!span) return null;
  if (window !== window.top) throw new Error('select text works on the top page only: this text is in a frame');
  const lengths = nodes.map((n) => n.data.length);
  const ends = [pieceAt(lengths, span.start), pieceAt(lengths, span.end, true)];
  const hits = ends.map(({ piece, offset }, i) => {
    const node = nodes[piece]!;
    const word = i ? `the end (${JSON.stringify(to)})` : `the start (${JSON.stringify(from)})`;
    const p = caretPoint(node, offset, i === 1);
    if (!p) throw new Error(`That text isn't in a text box, so the real mouse selects it, and ${word} isn't on screen. Scroll so both ends show (find, scroll), then send it again`);
    const hit = deepElementFromPoint(p.x, p.y);
    const parent = parentOf(node);
    if (!hit || !parent || !(deepContains(parent, hit) || deepContains(hit, parent))) throw new Error(`${word} is covered by ${hit ? what(hit) : 'something'}`);
    if (clickable(hit)) throw new Error(`${word} is on ${what(hit)}: a click there would click it, so nothing was selected`);
    return { p, hit };
  });
  guardClick(false, ...hits.map((h) => h.hit));
  return { points: hits.map((h) => h.p), note: ` — selected ${selectedNote(between(nodes, ends[0]!, ends[1]!))}` };
}

// select text: in a text box when the words are in one (the page script selects it), else in the page's text (the
// panel's real mouse does it, from pagePoints). Replies what got selected.
export async function selectText(from: string, to: string, nth?: number): Promise<string | { points: Point[]; note: string }> {
  const boxes = textBoxes();
  const span = pickSpan(boxes.map((b) => b.text), from, to, nth);
  if (span) {
    const box = boxes[span.box]!;
    return `ok — selected in ${boxName(box.el)}: ${selectedNote(await box.select(span.start, span.end))}`;
  }
  const real = pagePoints(from, to, nth);
  if (real) return real;
  // Editors like Overleaf's (CodeMirror) and Monaco keep only the lines near the screen on the page.
  throw new Error(`No match for ${JSON.stringify(from)} (case and spaces ignored). A code editor holds only the lines near the screen on the page: scroll it to the text (find, scroll), then send it again`);
}
