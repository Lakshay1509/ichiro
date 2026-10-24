// Checks the readable log (harness/readable-log.md): RL1 names, RL2 status words, RL3 the cut, RL4 the result. Run: npm test
import { saidLine, shownLine, splitReply, stepStatus, stepTitle } from './readable-log.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const same = (got: unknown, want: unknown, what: string) => {
  if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const names: Record<number, string> = { 12: 'Search', 5: 'Email', 7: 'x'.repeat(80), 8: 'Pay\nnow  "fast"', 9: '   ' };
const nameFor = (n: number) => names[n];

// RL1: a named element shows by name, wherever its command keeps the element word.
same(shownLine('click 12', nameFor), 'click "Search"', 'named click');
same(shownLine('type 5 "hello"', nameFor), 'type "Email" "hello"', 'named type');
same(shownLine('scroll down 12', nameFor), 'scroll down "Search"', 'named scroll');
// No name, a blank name, no element word, or a label already: the line stays as sent.
same(shownLine('click 3', nameFor), 'click 3', 'unnamed');
same(shownLine('click 9', nameFor), 'click 9', 'blank name');
same(shownLine('key Enter', nameFor), 'key Enter', 'no element');
same(shownLine('click "Search"', nameFor), 'click "Search"', 'label already');
// Page text: capped at 60, one line, its quotes escaped, so it can't fake a line or end the quote early.
same(shownLine('click 7', nameFor), `click "${'x'.repeat(60)}…"`, 'too long');
same(shownLine('click 8', nameFor), 'click "Pay now \\"fast\\""', 'line break and quotes');

// RL2: running until the call replies; an open ask shows as waiting; the reply's end wins over an ask left open.
same(stepStatus({ asking: false }), 'Running', 'running');
same(stepStatus({ asking: true }), 'Waiting for you', 'asking');
same(stepStatus({ ended: 'Done', asking: false }), 'Done', 'done');
same(stepStatus({ ended: 'Stopped', asking: true }), 'Stopped', 'stopped with an ask open');

// RL3: a long command shows as one line of 100 characters; the block keeps the full text.
const paste = `paste {"type":"excalidraw",\n  "elements":[${'{"x":1},'.repeat(2500)}]}`;
same(shownLine(paste, nameFor), `${paste.replace(/\s+/g, ' ').slice(0, 100)}…`, 'long paste cut');
same(shownLine('paste "a\n\nb"', nameFor), 'paste "a b"', 'short paste on one line');

// RL4: the result shows; the page after it goes behind a click.
const shown = (reply: string) => JSON.stringify(splitReply(reply));
same(shown('ok — real click'), JSON.stringify({ text: 'ok — real click', more: '' }), 'one line');
same(shown('ok — real click\n\nURL: https://a.com/\n[1] link "x"'), JSON.stringify({ text: 'ok — real click', more: 'URL: https://a.com/\n[1] link "x"' }), 'page after a blank line');
same(shown('URL: https://a.com/\nTitle: A\n[1] link "x"'), JSON.stringify({ text: 'URL: https://a.com/', more: 'Title: A\n[1] link "x"' }), "read's list");
same(shown('1. ok — real click\n2. Error: not found\nNot run: 3. key Enter\n\nURL: https://a.com/'), JSON.stringify({ text: '1. ok — real click\n2. Error: not found\nNot run: 3. key Enter', more: 'URL: https://a.com/' }), "a batch's results");

// Each command as a plain sentence: named like its line, an unnamed element in words, typed text left out.
same(saidLine('click 12', nameFor), 'Clicked "Search"', 'named click');
same(saidLine('click 3', nameFor), 'Clicked item 3', 'unnamed');
same(saidLine('click 9', nameFor), 'Clicked item 9', 'blank name');
same(saidLine('click 340,220', nameFor), 'Clicked a spot on the page', 'a spot');
same(saidLine('click "Search"', nameFor), 'Clicked "Search"', 'label already');
same(saidLine('type 5 "secret words"', nameFor), 'Typed into "Email"', 'typed text stays out');
same(saidLine('type here hello', nameFor), 'Typed some text', 'type here');
same(saidLine('scroll down', nameFor), 'Scrolled the page down', 'scroll the page');
same(saidLine('scroll down 12', nameFor), 'Scrolled "Search" down', 'scroll a box');
same(saidLine('goto nowhere', nameFor), 'Opened a page', 'not a URL');
same(saidLine('click 8', nameFor), 'Clicked "Pay now \\"fast\\""', 'page text stays one quoted line');
same(saidLine('click 7', nameFor), `Clicked "${'x'.repeat(60)}…"`, 'a long name is capped');

// A step card's title: "Agent" and its first action, then how many more.
same(stepTitle(['goto https://www.nodejs.org/'], nameFor), 'Agent opened nodejs.org', 'goto names the host');
same(stepTitle(['click 12', 'scroll down', 'read'], nameFor), 'Agent clicked "Search" and did 2 more things', 'a batch');
same(stepTitle(['click 12', 'read'], nameFor), 'Agent clicked "Search" and did 1 more thing', 'one more');
same(stepTitle(['read'], nameFor), 'Agent read the page', 'only a read');
