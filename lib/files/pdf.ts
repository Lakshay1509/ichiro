// P1: reads a PDF tab's text with pdf.js (Mozilla), the way browser-use downloads PDFs and reads them: Chrome's own PDF
// viewer doesn't run our content script. Runs only in the hidden page (entrypoints/offscreen/); others ask through lib/files/offscreen.ts. No PDF script ever runs (scripting is a viewer feature we
// don't load). pdf.js 6 has no eval at all (CVE-2024-4367 needed it; 4.2.67 removed it), so there's no
// isEvalSupported to turn off.
// Sources: https://github.com/mozilla/pdf.js, https://github.com/advisories/GHSA-wgrm-67xf-hhpq
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { checkPdfResponse, isPdf, pageText, PDF_FETCH, type PdfText } from './pdf-text.ts';

GlobalWorkerOptions.workerSrc = workerSrc; // bundled with the extension, served from its own origin

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 50;
const MAX_MS = 15_000;
const MAX_CHARS = 100_000; // read past text all's cut, so find reaches the later pages

// The tab's own URL, with its cookies, from the cache when it can be (browser-use fetches with force-cache too).
// Never through a redirect (PDF_FETCH).
async function fetchPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { ...PDF_FETCH, signal: AbortSignal.timeout(MAX_MS) });
  checkPdfResponse(res);
  if (!res.body) throw new Error(`the PDF didn't load (HTTP ${res.status})`);
  const bytes = await capped(res.body);
  if (!isPdf(bytes)) throw new Error('the file at this URL isn\'t a PDF');
  return bytes;
}

export async function loadPdf(url: string): Promise<PdfText> {
  const deadline = Date.now() + MAX_MS;
  const task = getDocument({ data: await fetchPdf(url), disableFontFace: true, useSystemFonts: false, enableXfa: false });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    let chars = 0;
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES) && chars < MAX_CHARS && Date.now() < deadline; i++) {
      const items = (await (await doc.getPage(i)).getTextContent()).items;
      const text = pageText(items.map((it) => ('str' in it ? it : {})));
      pages.push(text);
      chars += text.length;
    }
    return { pages, total: doc.numPages };
  } finally {
    await task.destroy(); // in pdf.js 6, the loading task frees the document and its worker
  }
}

// The body, refused past MAX_BYTES while it's still coming in, so a huge file never fills memory.
async function capped(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error(`the PDF is over ${MAX_BYTES / 1024 / 1024} MB`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}
