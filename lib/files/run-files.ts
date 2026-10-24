// Reading the run's own downloads (text download): only ones you allowed, finished and still on disk, by Chrome's path.
// The agent never names a path. Needs Chrome's "Allow access to file URLs" switch for this extension, which only you set.
// Sources: https://developer.chrome.com/docs/extensions/reference/api/downloads (DownloadItem: filename, exists, mime)
// https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions (file URLs need your ok)

type Item = Pick<Browser.downloads.DownloadItem, 'id' | 'filename' | 'state' | 'exists' | 'mime' | 'fileSize'>;

// Biggest text file read; PDFs have pdf.ts's own cap.
export const MAX_TEXT_FILE = 2_000_000;

// The file URL for Chrome's absolute path (Windows or POSIX). Each part is encoded, so a # or ? stays part of the
// name. Network paths (\\server\share) and relative ones are refused: a download is always saved on this computer.
export function fileUrl(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/');
  const encoded = (from: number) => parts.slice(from).map(encodeURIComponent).join('/');
  if (/^[A-Za-z]:$/.test(parts[0]!)) return `file:///${parts[0]}/${encoded(1)}`;
  if (parts[0] === '' && parts[1] !== '' && parts.length > 1) return `file:///${encoded(1)}`;
  throw new Error(`not a local file path: ${JSON.stringify(path.slice(0, 60))}`);
}

// The newest download in allowed (RunDownloads.allowed, oldest first) that finished and is still on disk, or null.
// items: Chrome's records for them (downloads.search); any other item is never picked.
export function newestReadable<T extends Item>(allowed: number[], items: T[]): T | null {
  for (const id of allowed.toReversed()) {
    const item = items.find((i) => i.id === id);
    if (item?.state === 'complete' && item.exists) return item;
  }
  return null;
}

// How the file is read: Chrome's type, else the name's ending. null: neither a PDF nor text, so it isn't read.
export function fileKind(item: Item): 'pdf' | 'text' | null {
  const name = item.filename.toLowerCase();
  if (item.mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (/^(text\/|application\/(json|csv|xml)\b)/.test(item.mime) || /\.(txt|csv|tsv|json|md|xml)$/.test(name)) return 'text';
  return null;
}

// text download [page N]: the page to read from. The AI writes these words, so anything else is refused.
export function downloadArgs(args: string[]): number {
  if (!args.length) return 1;
  if (args.length === 2 && args[0] === 'page' && /^[1-9]\d{0,3}$/.test(args[1]!)) return Number(args[1]);
  throw new Error('Usage: text download, or text download page N (a PDF)');
}
