// Readable log (harness/readable-log.md): how the agent's commands show in the side panel.
import { oneLine } from './agent-prompt.ts';
import { elementWord } from './parse-command.ts';

// RL1: the element's name in place of its number: click 12 → click "Search". A name is page text, so it's one line,
// capped and quoted (JSON escapes its quotes): a page can't fake a panel line. No name → the number stays.
// RL3: the whole line is one line, cut at 100 (a paste can carry 20,000 characters); the block keeps it in full.
export function shownLine(line: string, nameFor: (n: number) => string | undefined): string {
  const target = elementWord(line);
  const name = target && /^\d+$/.test(target.word) ? oneLine(nameFor(Number(target.word)) ?? '', 60) : '';
  return oneLine(name ? target!.swap(JSON.stringify(name)) : line, 100);
}

// RL2: an agent call's status, as a word (no icons: a screen reader says it, and it needs no legend). ended: set
// once the call has replied; asking: an ask of yours is open inside it.
export const stepStatus = (s: { ended?: 'Done' | 'Stopped'; asking: boolean }) => s.ended ?? (s.asking ? 'Waiting for you' : 'Running');

// RL4: a reply's result, shown: its first paragraph ("ok — real click", a batch's numbered results), or its first line
// when it has no blank line (read's list). more: the rest, the page as the agent got it, behind a click.
export function splitReply(reply: string): { text: string; more: string } {
  const blank = reply.indexOf('\n\n');
  const cut = blank >= 0 ? blank : reply.indexOf('\n');
  return cut < 0 ? { text: reply, more: '' } : { text: reply.slice(0, cut), more: reply.slice(cut).trim() };
}
