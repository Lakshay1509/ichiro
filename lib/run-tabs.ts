// The tabs a goal run may use (3.7e): the tab it started on plus tabs it opened. Your other tabs are never listed,
// switched to or closed. Numbers stay fixed for the run: closing [2] doesn't renumber [3].
import { checkGoto } from './agent-prompt.ts';

// background: opened without taking your screen (W1b's search tab; T1 brings it forward only while you watch the run);
// else it follows you, like the tab it came from.
export type TabCommand = { kind: 'new'; url: string; background?: boolean } | { kind: 'switch' | 'close'; n: number };

// The AI's `tab new <url>` | `tab <n>` | `tab close <n>`. A new tab follows goto's rules (https, plan Sites, no user:pw@).
export function parseTab([sub, arg]: string[], sites: string[]): TabCommand {
  if (sub === 'new') return { kind: 'new', url: checkGoto(arg, sites) };
  const n = sub === 'close' ? arg : sub;
  if (!n || !/^[1-9]\d{0,2}$/.test(n)) throw new Error('Usage: tab new <https url> | tab <n> | tab close <n>, e.g. tab 2');
  return { kind: sub === 'close' ? 'close' : 'switch', n: Number(n) };
}

export class RunTabs {
  private tabs: { n: number; id: number }[];
  private next = 2;
  current: number | null; // the tab the run works in; null once all its tabs are closed
  acting = false; // true while one of the run's commands runs: tabs its pages open then are the run's

  constructor(startId: number) {
    this.tabs = [{ n: 1, id: startId }];
    this.current = startId;
  }

  list() {
    return [...this.tabs];
  }

  has(id: number) {
    return this.tabs.some((t) => t.id === id);
  }

  // T1: Chrome paints only the tab on screen, so a run tab in the background gets no picture. The working tab comes
  // forward when the window shows (shown) another of the run's tabs: you're watching the run. Never over one of yours.
  toFront(shown: number | undefined): boolean {
    return this.current !== null && shown !== undefined && shown !== this.current && this.has(shown);
  }

  // A tab the run opened: listed (once) and made current. Returns its number.
  add(id: number): number {
    let tab = this.tabs.find((t) => t.id === id);
    if (!tab) this.tabs.push((tab = { n: this.next++, id }));
    this.current = id;
    return tab.n;
  }

  // Switch to tab n: only one of the run's own.
  switchTo(n: number): number {
    return (this.current = this.idOf(n));
  }

  // The tab to close for `tab close n`: one the run opened, never the start tab.
  closing(n: number): number {
    if (n === 1) throw new Error("Tab [1] is where the run started; it can't be closed");
    return this.idOf(n);
  }

  // A tab closed, by the run or by you: it drops out; if it was current, the run goes on in the first one left.
  removed(id: number) {
    this.tabs = this.tabs.filter((t) => t.id !== id);
    if (this.current === id) this.current = this.tabs[0]?.id ?? null;
  }

  private idOf(n: number): number {
    const tab = this.tabs.find((t) => t.n === n);
    if (!tab) throw new Error(`No tab [${n}] in this run; its tabs: ${this.tabs.map((t) => `[${t.n}]`).join(' ')}`);
    return tab.id;
  }
}
