// V1: the text of the pages and PDFs a run read, kept by URL, so the done check can search them again before an answer
// says "couldn't find" (gpt-oss's find on any earlier page; ReadAgent looks up the original passage). Pure, so Node can test it.
import { findMatches } from './page-text.ts';

// A web page read with text all (one entry), or a PDF (one entry per PDF page).
export type Kept = { url: string; pages: string[] };
export const MAX_KEPT = 10;
export const KEPT_CHARS = 100_000; // per document; also how far lib/pdf.ts reads a PDF
const MAX_HITS = 8;
const HIT_CONTEXT = 120; // characters on each side of a hit: about the sentence around it

// Adds doc, or replaces the one with its URL (it moves to the end), cut to KEPT_CHARS. The oldest goes past MAX_KEPT.
export function keep(store: Kept[], doc: Kept): Kept[] {
  const pages: string[] = [];
  let left = KEPT_CHARS;
  for (const p of doc.pages) {
    if (left <= 0) break;
    pages.push(p.slice(0, left));
    left -= p.length;
  }
  return [...store.filter((d) => d.url !== doc.url), { url: doc.url, pages }].slice(-MAX_KEPT);
}

// Every kept text searched for each phrase (case and spaces ignored, like find), as `URL · page N: "…"` lines; the page
// only for a document with pages. The phrases share MAX_HITS, so one common word can't crowd out the others.
export function searchKept(store: Kept[], phrases: string[]): string[] {
  const each = Math.ceil(MAX_HITS / Math.max(1, phrases.length));
  const hits = phrases.flatMap((q) => store.flatMap((d) => findMatches(d.pages, q, HIT_CONTEXT).map((m) =>
    `${d.url}${d.pages.length > 1 ? ` · page ${m.piece + 1}` : ''}: "${m.snippet}"`)).slice(0, each));
  return [...new Set(hits)].slice(0, MAX_HITS);
}

// The next turn's "output of your last command" after a done the kept pages may answer. Page text: the caller puts it
// inside <page_content>, defused. Bullets, not numbers: a numbered list sat next to Approach items and element numbers.
export const lookAgainText = (phrases: string[], hits: string[]) => [
  `Pages you already read this run mention ${phrases.map((p) => JSON.stringify(p)).join(', ')}:`,
  ...hits.map((h) => `- ${h}`),
  'Check these before saying you couldn\'t find it: use what they say, or goto the page\'s URL and find.',
].join('\n');
