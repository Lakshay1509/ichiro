// pick (F3b, F3c): collects many similar things at once (every showtime, price, result, row) anywhere on the page, by
// example (pick like 14: everything built like element 14) or by a CSS selector. Read-only: our code walks the page
// (it runs no page code) and returns visible text only, grouped by the record box each match sits in.
import { loadPage, withNote } from './load-page.ts';
import { joinLines, shownElement, shownPieces } from './page-text.ts';
import { allElements, cut, getElement, getElements, isSecret, label, parentOf, role, shadowRootOf } from './reader.ts';

// One match: its record box (index; -1 = a plain list), the box's label ('' = no text of its own), its number in the
// page list (0 if not listed) and its visible text.
export type Match = { record: number; label: string; n: number; text: string };
export const MAX_MATCHES = 100;
const MAX_CHARS = 8000;
const MAX_TEXT = 100; // characters per box label
const MAX_MATCH = 6000; // characters per match: whole lines (a license file on GitHub), yet one match still fits MAX_CHARS
const MAX_SELECTOR = 200;
const ALIKE = 0.2; // attributes at least 20% alike, Scrapling's default: https://scrapling.readthedocs.io/en/latest/parsing/selection.html

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// A match's text, quoted. Past MAX_MATCH it's cut, and a note outside the quotes (so it isn't page text) says so.
const quote = (text: string) => (text.length > MAX_MATCH
  ? `${JSON.stringify(text.slice(0, MAX_MATCH))} (cut: ${text.length - MAX_MATCH} more characters)`
  : JSON.stringify(text));

// Matches → lines, a box line each time the record box changes, uncapped. Text is always quoted, like the page list's
// text lines, so page text can't pass for an element line or a box line. Pure.
export function matchLines(matches: Match[]): string[] {
  const out: string[] = [];
  let record = -1;
  for (const m of matches) {
    if (m.record !== record && m.record >= 0) out.push(m.label ? `In ${JSON.stringify(cut(clean(m.label), MAX_TEXT))}:` : 'In the next box (no text of its own):');
    out.push(`${m.record >= 0 ? '  ' : ''}${m.n ? `[${m.n}] ` : ''}${quote(clean(m.text))}`);
    record = m.record;
  }
  return out;
}
// Match lines start with a quote, a [n] or spaces, so only box lines start like this.
const isBox = (line: string) => line.startsWith('In ');

// Lines from matchLines (F3d: maybe stitched from several scroll stops) → the output: a count, then up to MAX_MATCHES
// matches / MAX_CHARS (the first always, so a long one isn't only "1 more not shown"), each box line only with its
// first match. what: "for \"h3\"" or "built like [14]". more: matches past the cap that weren't read. '' for none. Pure.
export function pickOut(what: string, lines: string[], more = 0): string {
  const total = lines.filter((l) => !isBox(l)).length + more;
  if (!total) return '';
  const out = [`${total} match${total === 1 ? '' : 'es'} ${what} (whole page; [n] = in the page list, can be clicked):`];
  let size = out[0]!.length;
  let box = '';
  let shown = 0;
  for (const line of lines) {
    if (isBox(line)) {
      box = line;
      continue;
    }
    const add = (box ? box.length + 1 : 0) + line.length + 1;
    if (shown >= MAX_MATCHES || (shown && size + add > MAX_CHARS)) break;
    out.push(...(box ? [box, line] : [line]));
    size += add;
    box = '';
    shown++;
  }
  if (total > shown) out.push(`… ${total - shown} more not shown: use a narrower selector or example`);
  return out.join('\n');
}
// Matches → the output. Pure, so Node can test it.
export const pickLines = (what: string, matches: Match[], more = 0) => pickOut(what, matchLines(matches), more);

// The AI's pick arguments: like <n|"label">, or exactly one CSS selector (one line, up to MAX_SELECTOR characters,
// its syntax checked on the page).
export function pickArgs(args: string[]): { like: string } | { css: string } {
  const [first = '', ...rest] = args;
  if (first === 'like' ? rest.length === 1 && rest[0] : !rest.length && first.trim() && first.length <= MAX_SELECTOR && !/[\r\n]/.test(first)) {
    return first === 'like' ? { like: rest[0]! } : { css: first };
  }
  throw new Error(`Usage: pick like <n|"label"> (everything built like element n), or pick "css selector" (one line, up to ${MAX_SELECTOR} characters), e.g. pick like 14 or pick "table tr"`);
}

// F3c: how alike two elements' attributes are: shared tokens over all tokens (1 when neither has any). Pure.
export function similarity(a: string[], b: string[]): number {
  const all = new Set([...a, ...b]);
  if (!all.size) return 1;
  const inB = new Set(b);
  return new Set(a.filter((t) => inB.has(t))).size / all.size;
}

// F3c: record boxes, like MDR's data records (https://www.cs.uic.edu/~liub/WebDataExtraction/MDR-download.html).
// chains: each match's boxes from the top of the page down to itself. The box holding every match is their shared
// start; each match's record is the next box down. All records different (one match each) → a plain list: nulls.
export function recordsOf<T>(chains: T[][]): (T | null)[] {
  if (!chains.length) return [];
  let depth = 0;
  while (chains.every((c) => depth < c.length && c[depth] === chains[0]![depth])) depth++;
  const records = chains.map((c) => c[Math.min(depth, c.length - 1)]!);
  return new Set(records).size === records.length ? records.map(() => null) : records;
}

// Text you typed or chose stays out: inside a textarea, a select or an editable area.
const typed = (node: Node) => {
  const p = parentOf(node);
  return !p || !!p.closest('textarea, select') || (p instanceof HTMLElement && p.isContentEditable);
};
// el's visible text pieces by text all's rules (its own shadow root first, like the text walk), without typed text.
const piecesOf = (el: Element) => {
  const shadow = shadowRootOf(el);
  return [...(shadow ? shownPieces(shadow, true) : []), ...shownPieces(el, true)].filter((p) => !typed(p.node));
};
// el's visible text on one line. A field gives only its label, never its value.
const textOf = (el: Element) => (el.matches('input, textarea, select') ? label(el) : joinLines(piecesOf(el)).replace(/\n/g, ' · '));
// A password, card or one-time-code field, or a box holding one: skipped whole.
const hasSecret = (el: Element) => isSecret(el) || [...el.querySelectorAll('input, [autocomplete]')].some(isSecret);

// el's boxes from the top of the page down to itself, through shadow hosts.
function chainOf(el: Element): Element[] {
  const chain: Element[] = [];
  for (let e: Element | null = el; e; e = parentOf(e)) chain.unshift(e);
  return chain;
}
// F3c: the tag path (tag names only, top down): repeated records share it (tag path clustering, Miao et al., WWW 2009:
// https://archives.iw3c2.org/www2009/proceedings/pdf/p981.pdf). No classes, so scrambled class names don't matter.
const tagPath = (el: Element) => chainOf(el).map((e) => e.tagName).join('>');
// Attribute tokens for similarity: every attribute but href and src (they differ per item, as in Scrapling), each
// class name on its own, so one state class (selected, fast filling) changes one token, not the whole class list.
const attrTokens = (el: Element) => [...el.attributes].filter((a) => a.name !== 'href' && a.name !== 'src')
  .flatMap((a) => (a.name === 'class' ? a.value.split(/\s+/).filter(Boolean).map((c) => `.${c}`) : [`${a.name}=${a.value}`]));

// A record box's label: its first line of visible text that isn't inside a match ('' if none).
function boxLabel(box: Element, matched: Set<Element>): string {
  const inMatch = (node: Node) => {
    for (let a = parentOf(node); a && a !== box; a = parentOf(a)) if (matched.has(a)) return true;
    return false;
  };
  return joinLines(piecesOf(box).filter((p) => !inMatch(p.node)).slice(0, 10)).split('\n')[0] ?? '';
}

// This frame's matches now, in page order (shadow roots included), grouped by record box. Hidden, secret and textless
// matches are skipped; past MAX_MATCHES they're only counted, so a broad match on a big page stays fast.
function matchesNow(isMatch: (el: Element) => boolean): { matches: Match[]; more: number } {
  const numbers = new Map([...getElements()].map(([n, el]) => [el, n]));
  const found: { el: Element; text: string }[] = [];
  let more = 0;
  for (const el of allElements(document)) {
    if (!isMatch(el)) continue;
    if (found.length >= MAX_MATCHES) more++;
    else if (shownElement(el) && !hasSecret(el)) {
      const text = textOf(el);
      if (text) found.push({ el, text });
    }
  }
  const records = recordsOf(found.map((f) => chainOf(f.el)));
  const matched = new Set(found.map((f) => f.el));
  const boxes = [...new Set(records.filter((r) => r !== null))];
  const labels = new Map(boxes.map((box) => [box, boxLabel(box, matched)]));
  const matches = found.map(({ el, text }, i) => {
    const box = records[i];
    return { record: box ? boxes.indexOf(box) : -1, label: box ? labels.get(box)! : '', n: numbers.get(el) ?? 0, text };
  });
  return { matches, more };
}

// The matches as output, loading a lazy page first (F3d): every scroll stop's lines, stitched.
async function collect(what: string, isMatch: (el: Element) => boolean): Promise<string> {
  let more = 0;
  const read = () => {
    const now = matchesNow(isMatch);
    more = Math.max(more, now.more);
    return matchLines(now.matches);
  };
  const full = (lines: string[]) => lines.filter((l) => !isBox(l)).length >= MAX_MATCHES || lines.join('\n').length >= MAX_CHARS;
  const { lines, note } = await loadPage(read, full);
  return withNote(note, pickOut(what, lines, more));
}

// pick "css selector" (F3b) in this frame.
export function pickAll(selector: string): Promise<string> {
  try {
    document.querySelector(selector);
  } catch {
    // Source: https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelectorAll (SyntaxError on bad syntax)
    throw new Error(`Bad selector ${JSON.stringify(selector)}: not valid CSS. Try pick like <n> with one of the things you want, or a tag (h3, a, li), a list (table tr) or a role ([role=listitem]).`);
  }
  return collect(`for ${JSON.stringify(selector)}`, (el) => el.matches(selector));
}

// F3c: what "built like" compares: the tag path, attribute tokens and the page-list word (clickable, link, button…).
export type Shape = { path: string; tokens: string[]; kind: string };
// Same tag path and page-list word, attributes at least 20% alike. Pure.
export const builtLike = (a: Shape, b: Shape) => a.path === b.path && a.kind === b.kind && similarity(a.tokens, b.tokens) >= ALIKE;
const shapeOf = (el: Element): Shape => ({ path: tagPath(el), tokens: attrTokens(el), kind: role(el) });

// pick like n (F3c): everything built like element n of the latest read. n itself is included. The example is
// measured once, before any scrolling (F3d), since a virtual list may drop it.
export function pickLike(n: number): Promise<string> {
  const example = getElement(n);
  const shape = shapeOf(example);
  // Cheapest check first: most elements fail on the tag name.
  return collect(`built like [${n}]`, (el) => el.tagName === example.tagName && builtLike(shapeOf(el), shape));
}

// RP1's item check (2.3): the items not built like element n by pick like's rules, or not in this frame's latest read
// (a repeat's items must all be in item 1's list). Read-only.
export function notAlike(n: number, items: number[]): number[] {
  const shape = shapeOf(getElement(n));
  return items.filter((i) => {
    try {
      return !builtLike(shapeOf(getElement(i)), shape);
    } catch {
      return true; // not in this frame's read, or gone
    }
  });
}
