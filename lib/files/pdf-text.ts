// P1: a PDF's text for the model, from pdf.js's text items: the page list's line, text all and find on a PDF tab.
// P2: text page N reads on from page N, and pages without text are named. Pure, so Node can test it; lib/files/pdf.ts reads.
import { findMatches, TEXT_CAP } from '../page/page-text.ts';

export type PdfText = { pages: string[]; total: number }; // the text of each page read, and how many pages there are
const MAX_FIND = 10;

// One page: its text items in reading order, a space between them and a new line where pdf.js marks a line's end.
export function pageText(items: { str?: string; hasEOL?: boolean }[]): string {
  const joined = items.map((i) => `${i.str ?? ''}${i.hasEOL ? '\n' : ' '}`).join('');
  return joined.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const pagesSaid = (p: PdfText) => `${p.total} page${p.total === 1 ? '' : 's'}`;

// [1, 2, 3, 5] → "1–3, 5"
const ranges = (ns: number[]) => ns.reduce<[number, number][]>((r, n) => {
  const last = r.at(-1);
  if (last && last[1] === n - 1) last[1] = n;
  else r.push([n, n]);
  return r;
}, []).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');

// text all (from 1) or text page N (from N) on a PDF tab: page markers from that page on, up to text all's cap, cut at
// a page so the note can say where to read on.
export function pdfText(p: PdfText, from = 1): string {
  const read = p.pages.length < p.total ? ` (text read from the first ${p.pages.length})` : '';
  const blank = p.pages.flatMap((t, i) => (t ? [] : [i + 1]));
  const head = [
    `PDF, ${pagesSaid(p)}${read}.${from > 1 ? ` From page ${from}.` : ''} Its text is below; it has nothing to click.`,
    ...(blank.length ? [`Pages without text (a scan, or text drawn as shapes): ${ranges(blank)}.`] : []),
  ];
  if (from > p.pages.length) return [...head, `Page ${from} isn't in the text read.`].join('\n');
  const parts: string[] = [];
  let size = 0;
  const unread = ranges(Array.from({ length: p.total - p.pages.length }, (_, i) => p.pages.length + i + 1));
  let tail = unread ? `… page${p.total - p.pages.length > 1 ? 's' : ''} ${unread} weren't read as text (too long).` : '';
  for (let i = from - 1; i < p.pages.length; i++) {
    const n = i + 1;
    const part = `— page ${n} —\n${p.pages[i] || '(no text on this page)'}`;
    if (size + part.length > TEXT_CAP) {
      parts.push(part.slice(0, Math.max(0, TEXT_CAP - size)));
      // Read on from the page that was cut; if that's the first one shown, it alone is too long for one read.
      tail = n === from ? `… page ${n} goes on past ${TEXT_CAP} characters: use find for the rest.` : `… read on with text page ${n}.`;
      break;
    }
    parts.push(part);
    size += part.length + 1;
  }
  return [...head, ...parts, ...(tail ? [tail] : [])].join('\n');
}

// find on a PDF tab: the matches on every page read, each with its page.
export function pdfFind(p: PdfText, query: string): string {
  const hits = p.pages.flatMap((t, i) => findMatches([t], query).map((m) => `page ${i + 1}: ${m.snippet}`));
  if (!hits.length) return `No match for ${JSON.stringify(query)} in the PDF (${p.pages.length} of ${p.total} pages read).`;
  return `${hits.length} matches for ${JSON.stringify(query)} in the PDF:\n${hits.slice(0, MAX_FIND).map((h, i) => `${i + 1}. ${h}`).join('\n')}`;
}

// A PDF file has %PDF- in its first 1024 bytes (where readers look for it); a site's HTML error page doesn't.
export const isPdf = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-');
