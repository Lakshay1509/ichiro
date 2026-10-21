// P1: reads a PDF tab's text in the side panel with pdf.js (Mozilla), the way browser-use downloads PDFs and reads them:
// Chrome's own PDF viewer doesn't run our content script. No PDF script ever runs (scripting is a viewer feature we
// don't load). pdf.js 6 has no eval at all (CVE-2024-4367 needed it; 4.2.67 removed it), so there's no
// isEvalSupported to turn off. P2: it also draws one page as a picture (renderPage), for scans and background tabs.
// Sources: https://github.com/mozilla/pdf.js, https://github.com/advisories/GHSA-wgrm-67xf-hhpq
import { AnnotationMode, getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { isPdf, pageText, type PdfText } from './pdf-text.ts';
import { KEPT_CHARS } from './read-store.ts';
import { shrink, type Shot } from './screenshot.ts';

GlobalWorkerOptions.workerSrc = workerSrc; // bundled with the extension, served from its own origin

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 50;
const MAX_MS = 15_000;

// Per URL for this panel session: the same PDF is fetched and read once.
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

// The tab's own URL, with its cookies, from the cache when it can be (browser-use fetches with force-cache too).
async function fetchPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'include', cache: 'force-cache', signal: AbortSignal.timeout(MAX_MS) });
  if (!res.ok || !res.body) throw new Error(`the PDF didn't load (HTTP ${res.status})`);
  const bytes = await capped(res.body);
  if (!isPdf(bytes)) throw new Error('the file at this URL isn\'t a PDF');
  return bytes;
}

async function load(url: string): Promise<PdfText> {
  const deadline = Date.now() + MAX_MS;
  const task = getDocument({ data: await fetchPdf(url), disableFontFace: true, useSystemFonts: false, enableXfa: false });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    let chars = 0;
    // V1: read past text all's cut (it still shows only that), so find and the done check's search reach the later pages.
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES) && chars < KEPT_CHARS && Date.now() < deadline; i++) {
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

// P2: the picture's longer side. An A4 page at about 110 dpi: small print stays readable, ~1.6k image tokens.
const MAX_SIDE = 1280;
// A scanned image bigger than this (pixels) isn't decoded, so a hostile file can't fill memory.
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;

// The plain-JS image decoders wxt.config.ts copies into the extension (wasm stays off: the extension's CSP blocks it).
const DECODERS = new URL('/pdfjs/', location.href).href;

// P2: page n drawn from the file, as a picture for the model: a scan or text drawn as shapes has no text to read, and a
// background tab has no screenshot. Parsing and image decoding stay in pdf.js's worker. No annotations or forms drawn,
// fonts drawn as paths. Source: node_modules/pdfjs-dist/types/src/display/api.d.ts (RenderParameters, DocumentInitParameters)
export async function renderPage(url: string, n: number): Promise<Shot> {
  const task = getDocument({ data: await fetchPdf(url), disableFontFace: true, useSystemFonts: false, enableXfa: false, useWasm: false, wasmUrl: DECODERS, maxImageSize: MAX_IMAGE_PIXELS });
  const timer = setTimeout(() => void task.destroy(), MAX_MS); // destroying rejects whatever is still running
  try {
    const doc = await task.promise;
    if (!(n >= 1 && n <= doc.numPages)) throw new Error(`the PDF has ${doc.numPages} pages`);
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(width, height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
    return await shrink(canvas.toDataURL('image/png')); // one JPEG pass, like a screenshot
  } finally {
    clearTimeout(timer);
    await task.destroy();
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
