// The MCP agent's downloads (D1, D2): what it's told about each one, and the pause that waits for your yes.
// Source: https://developer.chrome.com/docs/extensions/reference/api/downloads
import { oneLine, onSites } from '../agent-prompt.ts';

type Item = Browser.downloads.DownloadItem;

// The file's name only, never its folder (the path has your user name). The site picked it, so one line, capped.
export const fileName = (item: Item) => oneLine(item.filename.split(/[\\/]/).pop() || '(no name yet)', 100);

// fileSize is -1 when unknown.
const size = (bytes: number) => (bytes < 0 ? '' : bytes < 1e6 ? ` (${Math.ceil(bytes / 1e3)} KB)` : ` (${(bytes / 1e6).toFixed(1)} MB)`);

// One download's news for the step's result: a download doesn't change the page, so this is all the model sees of it.
export function downloadNote(item: Item): string {
  const name = `"${fileName(item)}"`;
  if (item.state === 'complete') return `downloaded ${name}${size(item.fileSize)}`;
  if (item.state === 'interrupted') return `download failed: ${name} (${item.error ?? 'unknown error'})`;
  return `download started: ${name} (still going)`;
}

// Lead 7 (audit 2026-10-24): a download came from a page on the Sites: its referrer, else its own URL (a blob:'s
// creator). Only those ride an Allow once step or a repeat's allowance; any other pauses and asks as usual.
export function fromSites(item: Item, sites: string[]): boolean {
  const src = item.referrer || item.url || '';
  return onSites(src.startsWith('blob:') ? src.slice(5) : src, sites);
}

export class RunDownloads {
  // Says if a new download came from the agent's Sites (fromSites): required, so no window can let any download in.
  readonly ours: (item: Item) => boolean;
  constructor(ours: (item: Item) => boolean) {
    this.ours = ours;
  }
  allowing = false; // true only while an Allow once step runs: downloads it starts are part of what you allowed
  created = 0; // RP1: downloads started in the run so far, to compare a repeat's items with item 1
  // RP1: downloads the repeat item now running may start without asking: item 1's count, which you approved with the
  // list. The panel sets it per item and back to 0 after; any download past it pauses and asks as usual.
  allowance = 0;
  // Downloads you allowed, oldest first: in an Allow once step, by a repeat's allowance, or with your yes. Only these
  // may be read (text download); one that finished before it could be asked never is.
  readonly allowed: number[] = [];
  private told = new Map<number, string>(); // downloads not finished yet → the last line the model got about each
  private waiting = new Set<number>(); // paused until you say yes

  // For chrome.downloads.onCreated while the run goes. Not allowed: paused at once. Pausing fails only if it's
  // already finished or failed; report says so.
  readonly onCreated = (item: Item) => {
    this.created++;
    this.told.set(item.id, '');
    const ours = this.ours(item);
    if (this.allowing && ours) return void this.allowed.push(item.id);
    if (this.allowance > 0 && ours) {
      this.allowance--;
      this.allowed.push(item.id);
      return;
    }
    this.waiting.add(item.id);
    browser.downloads.pause(item.id).catch(() => {});
  };

  // Paused downloads still waiting for your yes when the run ends. They stay paused: you decide in chrome://downloads.
  get paused() {
    return this.waiting.size;
  }

  // News since the last call, one line per download. A paused one asks you first: yes resumes it, no cancels it.
  async report(ask: (item: Item) => Promise<boolean>): Promise<string[]> {
    const lines: string[] = [];
    for (const [id, told] of this.told) {
      const [item] = await browser.downloads.search({ id });
      const wasWaiting = this.waiting.delete(id);
      if (!item) {
        this.told.delete(id); // cleared from Chrome's list
        continue;
      }
      let line = downloadNote(item);
      if (wasWaiting && item.state === 'in_progress') {
        if (await ask(item)) {
          this.allowed.push(id);
          await browser.downloads.resume(id).catch(() => {});
        } else {
          await browser.downloads.cancel(id).catch(() => {});
          lines.push(`download refused: the user said no to "${fileName(item)}"`);
          this.told.delete(id);
          continue;
        }
      } else if (wasWaiting && item.state === 'complete') line += ' (it finished before it could be paused for the user\'s ok)';
      if (line !== told) lines.push(line);
      if (item.state === 'in_progress') this.told.set(id, line);
      else this.told.delete(id);
    }
    return lines;
  }
}
