// Checks reading the run's downloads: the file URL from Chrome's path, which download is read, and the command's words. Run: npm test
import { downloadArgs, fileKind, fileUrl, newestReadable } from './run-files.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const throws = (f: () => unknown, what: string) => {
  try {
    f();
  } catch {
    return;
  }
  fail(`${what} should throw`);
};

// Windows and POSIX paths; every part encoded, so a # or ? stays part of the name and can't end the path.
if (fileUrl('C:\\Users\\ann\\Downloads\\Judy Hopps_Resume.pdf') !== 'file:///C:/Users/ann/Downloads/Judy%20Hopps_Resume.pdf') fail('windows path');
if (fileUrl('/home/ann/Downloads/a#b?c.csv') !== 'file:///home/ann/Downloads/a%23b%3Fc.csv') fail('posix path with # and ?');
if (fileUrl('D:\\x\\résumé.pdf') !== 'file:///D:/x/r%C3%A9sum%C3%A9.pdf') fail('non-ASCII name');
throws(() => fileUrl('\\\\server\\share\\x.pdf'), 'a network path');
throws(() => fileUrl('//server/share/x.pdf'), 'a network path, POSIX style');
throws(() => fileUrl('Downloads\\x.pdf'), 'a relative path');
throws(() => fileUrl(''), 'no path');

// The newest allowed download that finished and is still on disk; others (going, failed, deleted, not allowed) never.
type Item = Parameters<typeof newestReadable>[1][number];
const it = (id: number, more: Partial<Item> = {}) => ({ id, filename: `C:\\d\\${id}.pdf`, state: 'complete', exists: true, mime: 'application/pdf', fileSize: 8_000, ...more }) as Item;
const items = [it(1), it(2, { state: 'in_progress' }), it(3, { exists: false }), it(4, { state: 'interrupted' }), it(9)];
if (newestReadable([1, 2, 3, 4], items)?.id !== 1) fail('newest readable of the allowed');
if (newestReadable([2, 3, 4], items) !== null) fail('nothing finished and on disk');
if (newestReadable([1], items.concat(it(7)))?.id !== 1) fail('a download you didn\'t allow (7, 9) is never read');
if (newestReadable([], items) !== null) fail('no allowed downloads');

// PDF or text, from Chrome's type, else the name's ending; anything else isn't read.
if (fileKind(it(1)) !== 'pdf' || fileKind(it(1, { mime: '', filename: 'C:\\d\\CV.PDF' })) !== 'pdf') fail('pdf');
if (fileKind(it(1, { mime: 'text/csv', filename: 'C:\\d\\r.csv' })) !== 'text' || fileKind(it(1, { mime: 'application/octet-stream', filename: '/d/notes.txt' })) !== 'text') fail('text');
if (fileKind(it(1, { mime: 'application/zip', filename: 'C:\\d\\a.zip' })) !== null) fail('zip is not read');

// text download → from page 1; text download page N; anything else is refused (never a path).
if (downloadArgs([]) !== 1 || downloadArgs(['page', '3']) !== 3) fail('download args');
for (const bad of [['page'], ['page', '0'], ['page', 'x'], ['all'], ['page', '2', 'more'], ['C:\\secret.txt']]) throws(() => downloadArgs(bad), `text download ${bad.join(' ')}`);
