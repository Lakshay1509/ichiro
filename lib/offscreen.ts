// BG2: reads PDFs through the hidden page (an offscreen document: an extension page with no window, entrypoints/offscreen/),
// so pdf.js has a page to run in even when the caller is the background worker, which can't start pdf.js's worker.
// Source: https://developer.chrome.com/docs/extensions/reference/api/offscreen
import type { PdfText } from './pdf-text.ts';

export type PdfAsk = { type: 'read-pdf'; url: string };
type PdfAnswer = { value: PdfText } | { error: string };

export const isPdfAsk = (msg: unknown): msg is PdfAsk =>
  typeof msg === 'object' && msg !== null && (msg as PdfAsk).type === 'read-pdf' && typeof (msg as PdfAsk).url === 'string';

// Only this extension's own pages: our id, an extension URL, and no tab. Content scripts carry our id too, but run in
// tabs, and a page can drive one. Chrome fills in sender, so a page can't fake it.
// Source: https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender
export function fromOwnPage(sender: { id?: string; tab?: unknown; url?: string }, id: string, origin: string): boolean {
  return sender.id === id && sender.tab === undefined && sender.url?.startsWith(origin) === true;
}

// One hidden page per extension. createDocument resolves once the page has loaded, so it can take messages right away.
let creating: Promise<void> | null = null; // the docs' guard against creating it twice at once
async function openPage(): Promise<void> {
  if (await browser.offscreen.hasDocument()) return;
  creating ??= browser.offscreen
    .createDocument({ url: '/offscreen.html', reasons: [browser.offscreen.Reason.WORKERS], justification: 'pdf.js reads PDF text in a worker' })
    .finally(() => { creating = null; });
  await creating;
}

async function load(url: string): Promise<PdfText> {
  await openPage();
  const answer: PdfAnswer | undefined = await browser.runtime.sendMessage({ type: 'read-pdf', url } satisfies PdfAsk);
  if (!answer) throw new Error("the PDF reader didn't answer");
  if ('error' in answer) throw new Error(answer.error);
  return answer.value;
}

// Per URL for this session: the same PDF is fetched and read once.
const read = new Map<string, Promise<PdfText>>();
export function readPdf(url: string): Promise<PdfText> {
  let p = read.get(url);
  if (!p) {
    p = load(url);
    read.set(url, p);
    p.catch(() => read.delete(url)); // a failed read can be tried again
  }
  return p;
}
