// Checks P1's PDF text for the model: pdf.js text items joined per page, text all and find on a PDF, the %PDF- check.
// P2: text page N, the read-on note, pages without text. Run: npm test
import { isPdf, pageText, pdfFind, pdfPageLine, pdfText } from './pdf-text.ts';
import { TEXT_CAP } from './page-text.ts';

const fail = (what: string): never => {
  throw new Error(what);
};

// pdf.js gives text items in reading order; hasEOL ends a line. Runs of spaces collapse; empty items are fine.
const page = pageText([{ str: 'Fee  Structure', hasEOL: true }, { str: 'Reissue 36 pages:' }, { str: ' ' }, { str: 'Rs. 2500', hasEOL: true }, { str: '' }]);
if (page !== 'Fee Structure\nReissue 36 pages: Rs. 2500') fail(`page text: ${JSON.stringify(page)}`);

// text all: how many pages there are and how many were read, the pages without text, a marker per page, the unread rest.
const doc = { pages: ['Fee Structure\nReissue: Rs. 2500', ''], total: 3 };
const all = pdfText(doc);
const wanted = [
  'PDF, 3 pages (text read from the first 2). Its text is below; it has nothing to click.',
  'Pages without text (a scan, or text drawn as shapes): 2. text page N puts one in the picture.',
  '— page 1 —\nFee Structure\nReissue: Rs. 2500',
  '— page 2 —\n(no text on this page: text page 2 puts it in the picture)',
  "… page 3 weren't read as text (too long); text page N still puts one in the picture.",
].join('\n');
if (all !== wanted) fail(`text all:\n${all}`);
if (!pdfText({ pages: ['one'], total: 1 }).startsWith('PDF, 1 page. ')) fail('one page');
// The picture's page says so instead of asking for it again.
if (!pdfText(doc, 2, 2).includes('— page 2 —\n(no text on this page: the picture with your next step shows it)')) fail('pictured page');
// Pages without text as ranges, like a scanned file.
if (!pdfText({ pages: ['', '', '', 'x', ''], total: 5 }).includes('drawn as shapes): 1–3, 5. ')) fail('blank ranges');

// text page N: from page N on, cut at a page with the page to read on from (each page is read in full or not at all).
const many = { pages: Array.from({ length: 6 }, (_, i) => `page ${i + 1} ${'w'.repeat(4000)}`), total: 6 };
const first = pdfText(many);
if (!first.includes('— page 3 —') || first.includes(`page 4 ${'w'.repeat(4000)}`) || !first.endsWith('… read on with text page 3.')) fail(`read-on note:\n${first.slice(-120)}`);
const later = pdfText(many, 3);
if (!later.startsWith('PDF, 6 pages. From page 3. ') || later.includes('— page 2 —') || !later.endsWith('… read on with text page 5.')) fail(`text page 3:\n${later.slice(0, 120)}…${later.slice(-60)}`);
// A page longer than one read: find for the rest, not a read-on note that would show the same page again.
if (!pdfText({ pages: ['x'.repeat(TEXT_CAP + 50)], total: 1 }).endsWith(`… page 1 goes on past ${TEXT_CAP} characters: use find for the rest.`)) fail('one long page');
// A page past the text read (over 50 pages or 100,000 characters): its picture still comes.
if (!pdfText(doc, 3, 3).endsWith("Page 3 isn't in the text read; the picture with your next step shows it.")) fail('page past the text read');

// find: matches on any page, with the page number; a miss says how much was searched.
const found = pdfFind({ pages: ['Fresh passport', 'Fee for reissue: Rs. 2500', 'Reissue rules'], total: 3 }, 'reissue');
if (!found.startsWith('2 matches for "reissue" in the PDF:\n1. page 2: ') || !found.includes('2. page 3: ')) fail(`find:\n${found}`);
// V1: lib/pdf.ts reads past text all's cut. text all still shows only TEXT_CAP, and find reaches a later page.
const long = { pages: ['a '.repeat(TEXT_CAP), 'Late more than three hours: TDR before the actual departure'], total: 2 };
if (pdfText(long).includes('actual departure') || !pdfFind(long, 'actual departure').includes('1. page 2: ')) fail('find past the text all cut');
if (pdfFind(doc, 'tatkaal') !== 'No match for "tatkaal" in the PDF (2 of 3 pages read).') fail(`find miss: ${pdfFind(doc, 'tatkaal')}`);

// The page list's line for a PDF tab: which page the picture shows, and how to read on.
if (pdfPageLine(doc, 2) !== 'PDF: 3 pages. The picture shows page 2, drawn from the file. Read it with text all, text page N (also puts page N in the picture), or find "words"; it has nothing to click.') fail(`page line: ${pdfPageLine(doc, 2)}`);

// A PDF file has %PDF- in its first 1024 bytes; an HTML error page doesn't.
const bytes = (s: string) => new TextEncoder().encode(s);
if (!isPdf(bytes('%PDF-1.7\n%âãÏÓ')) || !isPdf(bytes(`${' '.repeat(10)}%PDF-1.4`))) fail('PDF bytes');
if (isPdf(bytes('<!doctype html><title>Not found</title>')) || isPdf(bytes(`${' '.repeat(1100)}%PDF-1.4`))) fail('not PDF bytes');
