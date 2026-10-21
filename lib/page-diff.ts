// What a command changed on the page (3.7b): compares two `read` outputs by element role + name + state, never by
// number (numbers shift between reads). Returns a short note for the history and the new page with new elements marked *.
import { ranges } from './reader.ts';

const URL_LINE = /^URL: (.*)$/m;
const ELEMENT = /^\[\d+\] (.*)$/;
const ELEMENT_NUMBER = /^\[(\d+)\] /;
export const withoutNumbers = (page: string) => page.replace(/^\[\d+\] /gm, '');
// Quoted lines are page text (F2). A clock or carousel changes them on its own, so the loop guard ignores them.
export const withoutText = (page: string) => page.split('\n').filter((line) => !line.startsWith('"')).join('\n');
// One step on one page, whatever number its element had this read: `[15] "Password"` and `[8] "Password"` match (4.2).
export const stepKey = (url: string, message: string) => `${url} ${message.replace(/\[\d+\] /g, '')}`;

export function pageChange(before: string, after: string): { note: string; page: string } {
  const urlBefore = URL_LINE.exec(before)?.[1];
  const urlAfter = URL_LINE.exec(after)?.[1];
  // A hidden page (off the run's Sites) has no URL line or list: only same or not.
  if (urlBefore === undefined || urlAfter === undefined) return { note: before === after ? 'nothing changed' : 'page changed', page: after };
  // A new URL means a new page: everything would be "new", so no marks.
  if (urlBefore !== urlAfter) return { note: 'URL changed', page: after };

  // Counts, not a set: a results list repeats the same "Add to cart" button many times.
  const left = new Map<string, number>();
  for (const line of before.split('\n')) {
    const key = ELEMENT.exec(line)?.[1];
    if (key !== undefined) left.set(key, (left.get(key) ?? 0) + 1);
  }
  let added = 0;
  const page = after.split('\n').map((line) => {
    const key = ELEMENT.exec(line)?.[1];
    if (key === undefined) return line;
    const n = left.get(key) ?? 0;
    if (n) {
      left.set(key, n - 1);
      return line;
    }
    added++;
    return `*${line}`;
  }).join('\n');
  const gone = [...left.values()].reduce((a, b) => a + b, 0);

  const parts = [added && `${added} new`, gone && `${gone} gone`].filter(Boolean);
  if (parts.length) return { note: parts.join(', '), page };
  // Same elements: "nothing changed" only if the header (scroll, focus, modal, headings) is the same too.
  return { note: withoutNumbers(before) === withoutNumbers(after) ? 'nothing changed' : 'no new elements', page };
}

// A page, for the MCP change report and batches: its URL without the ?query and #hash (Slides' #slide= is one deck).
export const pagePath = (url: string) => url.replace(/[?#].*/, '');

// MCP replies (harness/mcp-context.md, option 1): a page as what changed since the page the agent last got. The agent
// keeps every reply, so the whole list again is mostly repeats. Lines compare whole, numbers included: numbers stick
// (numbers.ts), so a label under a new number is a new element the agent must see. Gone elements are a count and their
// numbers (ranges), not their lines: enough to stop using them, and the lines are in the agent's earlier reply.
// The whole list instead: no earlier page, a hidden or failed read (no URL line), or a new page (another path; a
// ?query or #hash, like Slides' #slide=, doesn't count).
export function pageReport(before: string | null, after: string): string {
  const path = (page: string) => pagePath(URL_LINE.exec(page)?.[1] ?? '');
  if (before === null || !path(before) || path(before) !== path(after)) return after;

  // Counts, not a set: page text can repeat. The "Elements (N):" line is left out: alone it would read like the list.
  const left = new Map<string, number>();
  for (const line of before.split('\n')) left.set(line, (left.get(line) ?? 0) + 1);
  const added = after.split('\n').filter((line) => {
    const n = left.get(line) ?? 0;
    if (n) left.set(line, n - 1);
    return !n && !line.startsWith('Elements (');
  });

  // What's left was in before only. Not gone: an element still listed (its state changed, its new line is above) or a
  // header line with a new value (Scroll: 0% → 40%).
  const listed = new Set(after.match(/^\[\d+\]/gm));
  const word = (line: string) => line.split(/[\s:]/, 1)[0];
  const newWords = new Set(added.map(word));
  const nums: number[] = [];
  const heads: string[] = [];
  let texts = 0;
  for (const [line, n] of left) {
    const num = ELEMENT_NUMBER.exec(line)?.[1];
    if (!n || line.startsWith('Elements (')) continue;
    if (num) {
      if (!listed.has(`[${num}]`)) nums.push(Number(num));
    } else if (/^[A-Z]/.test(line)) {
      if (!newWords.has(word(line))) heads.push(line); // a header line with no new value: the panel closed, focus left
    } else texts += n; // quoted page text, iframe lines
  }
  const gone = [nums.length && `${nums.length} element${nums.length > 1 ? 's' : ''} ${ranges(nums)}`, ...heads, texts && `${texts} text line${texts > 1 ? 's' : ''}`].filter(Boolean);

  if (!added.length && !gone.length) return 'Page: nothing changed since your last page list.';
  const report = ['Page changes since your last page list (read gives the whole list):', ...added, ...(gone.length ? [`Gone: ${gone.join('; ')}`] : [])].join('\n');
  // A page that changed nearly all over: the whole list is no longer, and easier to read.
  return report.length < after.length ? report : after;
}
