// Loop guard (3.7c): notices a run going in circles, in code. A page state is a read with element numbers and text lines dropped.
// No new state for WARN_AFTER steps, the same command SAME_COMMAND times in a row without one, or a swing between two
// states (U1) → warn the model; still none PAUSE_AFTER steps after the warning → pause and ask you.
// U1 also remembers what each command did on each state (Magentic-One's "repeating the same requests and getting the
// same responses", OpenRouter's doom-loop guard): the 2nd identical result steers the model, and known() lets the
// panel refuse a 3rd try (OpenRouter's "observe@2, block@3").
// shortcut: a page that changes by itself (carousel, live prices) looks like progress on every read, so the guard stays
// quiet there; the step budget (3.6) and token ceiling (3.8b) are the backstop.
import { withoutNumbers, withoutText } from './page-diff.ts';

const state = (page: string) => withoutNumbers(withoutText(page));

export const WARN_AFTER = 5;
export const SAME_COMMAND = 3;
export const PAUSE_AFTER = 3;
const MAX_TRIED = 5;

// What a command did, said from counts only (no page text): the step's state against the ones before it.
function outcome(history: string[]): string {
  const now = history.at(-1)!;
  const k = history.length - 1;
  if (history[k - 1] === now) return 'nothing changed';
  const j = history.lastIndexOf(now, k - 2);
  return j >= 0 ? `back to the page from ${k - j} steps ago` : 'a new page';
}

type Outcome = { after: string; times: number; outcome: string; at: number };

export class LoopGuard {
  private seen = new Set<string>();
  private stale: string[] = []; // commands since the last new page state
  private warnedAt = 0; // stale steps when the warning started; 0 = no warning
  private why = '';
  private history: string[] = []; // the state after each step, the first read first
  private recent: string[] = []; // states since the last keep going, back-to-back repeats merged (for swings)
  private outcomes = new Map<string, Outcome>(); // `${state}\n${command}` → what it did there last

  constructor(firstPage: string) {
    const first = state(firstPage);
    this.seen.add(first);
    this.history.push(first);
    this.recent.push(first);
  }

  // After each step: the command it ran and the page read after it. ran: false when the command was refused and never
  // ran, so it isn't an outcome. Every message is built from counts only, never page text.
  after(command: string, page: string, ran = true): { warn?: string; pause?: string; repeat?: string } {
    const now = state(page);
    const before = this.history.at(-1)!;
    this.history.push(now);
    if (this.recent.at(-1) !== now) this.recent.push(now);
    let repeat: string | undefined;
    if (ran && !command.startsWith('(')) {
      const key = `${before}\n${command}`;
      const last = this.outcomes.get(key);
      const times = last?.after === now ? last.times + 1 : 1;
      const did = outcome(this.history);
      this.outcomes.set(key, { after: now, times, outcome: did, at: this.history.length });
      if (times >= 2) repeat = `your last step repeated a command you had already run on this exact page, with the same result ${times} times (${did}). Running it again won't change anything, so a third time is refused`;
    }
    if (!this.seen.has(now)) {
      this.seen.add(now);
      this.stale = [];
      this.warnedAt = 0;
      return repeat ? { repeat } : {};
    }
    this.stale.push(command);
    const n = this.stale.length;
    const r = this.recent;
    const swing = r.length >= 4 && r.at(-1) === r.at(-3) && r.at(-2) === r.at(-4);
    if (!this.warnedAt) {
      if (swing) this.why = 'the page has gone back and forth between the same two states';
      else if (n >= WARN_AFTER) this.why = `no progress on the page in the last ${n} steps`;
      else if (n >= SAME_COMMAND && this.stale.slice(-SAME_COMMAND).every((c) => c === command)) this.why = `the same command ${SAME_COMMAND} times with no progress`;
      else return repeat ? { repeat } : {};
      this.warnedAt = n;
    }
    const said = n - this.warnedAt >= PAUSE_AFTER ? { pause: this.why } : { warn: this.why };
    return repeat ? { ...said, repeat } : said;
  }

  // What command did last on the current page, if it ran there before.
  known(command: string): { times: number; outcome: string } | undefined {
    const o = this.outcomes.get(`${this.history.at(-1)}\n${command}`);
    return o && { times: o.times, outcome: o.outcome };
  }

  // What was tried on the current page and what it did, latest first. Commands are the model's lines (they can quote
  // the page), so this goes inside <steps>, defused.
  tried(): string {
    const prefix = `${this.history.at(-1)}\n`;
    const lines = [...this.outcomes]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_TRIED)
      .map(([key, o]) => `${key.slice(prefix.length).slice(0, 80)} → ${o.outcome}${o.times > 1 ? ` (${o.times}×)` : ''}`);
    return lines.length ? `Already tried on this page: ${lines.join('; ')}` : '';
  }

  // Keep going: count afresh. Pages already seen still don't count as new; what commands did is still remembered.
  reset() {
    this.stale = [];
    this.warnedAt = 0;
    this.recent = [this.history.at(-1)!];
  }
}
