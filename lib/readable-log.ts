// Readable log (harness/readable-log.md): how the agent's commands show in the side panel.
import { oneLine } from './agent-prompt.ts';
import { elementWord, parseCommand } from './parse-command.ts';

// RL1: the element's name in place of its number: click 12 → click "Search". A name is page text, so it's one line,
// capped and quoted (JSON escapes its quotes): a page can't fake a panel line. No name → the number stays.
// RL3: the whole line is one line, cut at 100 (a paste can carry 20,000 characters); the block keeps it in full.
export function shownLine(line: string, nameFor: (n: number) => string | undefined): string {
  const target = elementWord(line);
  return oneLine(target ? target.swap(named(target.word, nameFor)) : line, 100);
}
const named = (word: string, nameFor: (n: number) => string | undefined) => {
  const name = /^\d+$/.test(word) ? oneLine(nameFor(Number(word)) ?? '', 60) : '';
  return name ? JSON.stringify(name) : word;
};

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

// Each command as a plain sentence, for someone who doesn't know the commands. t: the element, by name ("Search") or
// in words; arg: the first word after the command, quotes off (goto's URL, key's key, scroll's way).
const SAYS: Record<string, (t: string, arg: string) => string> = {
  goto: (_, url) => `Opened ${URL.parse(url)?.hostname.replace(/^www\./, '') || 'a page'}`,
  back: () => 'Went back a page',
  read: () => 'Read the page',
  look: () => 'Took a picture of the page',
  text: () => 'Read the text on screen',
  find: (_, text) => `Searched the page for ${JSON.stringify(text)}`,
  pick: (t) => (t ? `Listed everything like ${t}` : 'Listed items on the page'),
  click: (t) => `Clicked ${t}`,
  hover: (t) => `Pointed the mouse at ${t}`,
  type: (t) => (t === 'here' ? 'Typed some text' : `Typed into ${t}`),
  paste: () => 'Pasted some text',
  select: (t) => `Picked an option in ${t}`,
  scroll: (t, way) => (t ? `Scrolled ${t} ${way}` : `Scrolled the page ${way}`),
  drag: () => 'Dragged with the mouse',
  key: (_, key) => `Pressed ${key}`,
  pause: () => 'Paused and handed the page to you',
  repeat: (_, step) => `Repeated step ${step} on more items`,
  tip: () => 'Saved a tip about this site',
};

// One command as a sentence: "Clicked "Search"", "Scrolled the page down". An element with no name is "item 3", a
// spot is "a spot on the page". Typed and pasted text stays out (Details has it). Agent and page text: one line, capped.
export function saidLine(line: string, nameFor: (n: number) => string | undefined): string {
  const [name = '', arg = ''] = parseCommand(line);
  const word = elementWord(line)?.word;
  const t = word ? named(word, nameFor) : ''; // still a number: it has no name
  const thing = /^\d+$/.test(t) ? `item ${t}` : /^\d+,\d+$/.test(t) ? 'a spot on the page' : t;
  return oneLine(SAYS[name]?.(thing, arg) ?? shownLine(line, nameFor), 100);
}

// A step card's title: the agent's first action, then how many more ("Agent clicked "Search" and did 2 more things").
export function stepTitle(lines: string[], nameFor: (n: number) => string | undefined): string {
  const said = saidLine(lines[0] ?? '', nameFor);
  const more = lines.length - 1;
  return `Agent ${said.charAt(0).toLowerCase()}${said.slice(1)}${more ? ` and did ${more} more thing${more === 1 ? '' : 's'}` : ''}`;
}
