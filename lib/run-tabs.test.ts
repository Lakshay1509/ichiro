// Checks the run's tabs (3.7e): only its own tabs, fixed numbers, start tab kept, new tabs on plan Sites only. Run: npm test
import { parseTab, RunTabs } from './run-tabs.ts';

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
// Stand-in for chrome.publicSuffix.getDomain (S1): enough for .com and .in sites.
Object.assign(globalThis, { browser: { publicSuffix: { getDomain: (host: string) => host.split('.').slice(-2).join('.') } } });

// tab commands: a new tab only on the run's Sites (goto's rules); numbers only from 1.
const sites = ['amazon.in', 'flipkart.com'];
if (JSON.stringify(parseTab(['new', 'https://www.flipkart.com'], sites)) !== '{"kind":"new","url":"https://www.flipkart.com/"}') fail('tab new');
if (JSON.stringify(parseTab(['2'], sites)) !== '{"kind":"switch","n":2}' || JSON.stringify(parseTab(['close', '3'], sites)) !== '{"kind":"close","n":3}') fail('tab switch/close');
for (const bad of [['new', 'https://evil.example/'], ['new', 'http://flipkart.com/'], ['new', 'https://flipkart.com@evil.example/'], ['new'], [], ['0'], ['-1'], ['x'], ['close'], ['close', 'all'], ['1000']]) {
  throws(() => parseTab(bad, sites), `tab ${bad.join(' ')}`);
}

// The start tab is [1] and current; opened tabs get the next number and become current.
const run = new RunTabs(100);
const cur = () => run.current; // read fresh: TypeScript would keep an earlier narrowing across method calls
if (cur() !== 100 || run.add(200) !== 2 || cur() !== 200) fail('add');
if (run.add(200) !== 2 || run.list().length !== 2) fail('add twice');
if (run.switchTo(1) !== 100 || cur() !== 100) fail('switch');

// Only the run's own tabs: your tab 999 has no number, so it can't be reached.
throws(() => run.switchTo(3), 'switch to a tab the run did not open');
if (run.has(999)) fail('your tab listed');

// Never closes the start tab; closing one it opened is fine, and numbers stay fixed.
throws(() => run.closing(1), 'close the start tab');
if (run.closing(2) !== 200) fail('close 2');
run.add(300); // [3]
run.removed(200);
if (JSON.stringify(run.list()) !== '[{"n":1,"id":100},{"n":3,"id":300}]') fail(`fixed numbers: ${JSON.stringify(run.list())}`);
throws(() => run.switchTo(2), 'switch to a closed tab');

// You close the current tab: the run goes on in the first one left; all closed → no current tab.
run.removed(300);
if (cur() !== 100) fail('current closed');
run.removed(100);
if (cur() !== null) fail('all closed');

// T1: the working tab comes forward only while the window shows another of the run's tabs, never over one of yours.
const front = new RunTabs(10);
front.add(11); // the background search tab, now the working tab
if (!front.toFront(10) || front.toFront(11) || front.toFront(99) || front.toFront(undefined)) fail('toFront');
front.removed(10);
front.removed(11);
if (front.toFront(10)) fail('toFront with no tabs left');
