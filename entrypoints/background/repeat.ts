// BG4: repeat <step> on <numbers> (RP1): item 1's recorded commands, run again on each other item in a list.
import { oneLine } from '@/lib/agent-prompt';
import { captchaAll, frameFor, labelFor, nameFor, numberFor, readAll } from '@/lib/page/frames';
import { downloadsSince, failed, filesLine, forItem, item1On, itemMiss, itemTarget, notAlikeError, parseRepeat, recipeFrom, repeatAsk, repeatDone, stoppedAt } from '@/lib/memory/repeat';
import { sendToTab } from '@/lib/tabs/send-to-tab';
import { askOrAuto, lastCommand } from './asks';
import type { BridgeStep } from './bridge';
import { print } from './panels';

// RP1 (2.4, 2.5): repeat <step> on <numbers>, for the MCP bridge: item 1's recorded commands on each item, with no
// agent calls. You approve the list once, and each item may start as many downloads as item 1 did; any
// other download still asks. Each command gets a CAPTCHA check and a fresh read (its names resolve on the page it's on
// now), then the caller's run with all of its own checks (Sites, stop-lines, hand-overs). It stops at the first item
// that doesn't go like item 1. Returns the step's result, or null when you stopped it; throws when refused first.
type RepeatRun = {
  steps: BridgeStep[]; // the history <step> points into
  site: string; // the page's, for the ask
  onSites: boolean; // the page is one the agent may see; else its names stay hidden
  count: () => number; // downloads so far, on downloadsAt's scale
  allow: (n: number) => void; // RunDownloads.allowance
  news: () => Promise<string[]>; // download lines since the last call
  run: (line: string) => Promise<{ output: string | void; took?: boolean } | null>; // null: stopped
};
export async function runRepeat(args: string[], r: RepeatRun): Promise<string | null> {
  const id = lastCommand;
  if (!r.onSites) throw new Error("repeat refused: the items must be on this page's list, on the run's Sites.");
  const { step, items } = parseRepeat(args, r.steps.length);
  const recipe = recipeFrom(r.steps, step);
  await readAll(false); // numbers stay; names are now's (the bridge agent's last read may be older)
  const item1 = item1On(recipe, numberFor);
  const named = (n: number) => nameFor(n) ?? `[${n}]`;
  const odd = await sendToTab({ type: 'alike', n: item1, items }, frameFor(item1));
  if (odd.length) throw new Error(notAlikeError(odd, item1, named));
  const names = items.map(named);
  const targets = items.map((n) => itemTarget(n, labelFor));
  const perItem = downloadsSince(r.steps, step, r.count());
  if (!(await askOrAuto(`Repeat on more items?\n${repeatAsk(step, r.steps.length, r.site, names, perItem)}`, 'Repeat', 'No'))) {
    return id !== lastCommand ? null : 'Refused: the user said no to this repeat. Do the items one by one, or pause to ask the user.';
  }
  const allNews: string[] = []; // every item's download lines, named in the result (filesLine)
  for (const [k, target] of targets.entries()) {
    const lines = forItem(recipe, target);
    const before = r.count();
    const outputs: (string | void)[] = [];
    let why = '';
    r.allow(perItem);
    try {
      for (const line of lines) {
        const captcha = await captchaAll().catch(() => '');
        if (captcha) {
          why = `a CAPTCHA is on the page (${captcha}): the user solves it first`;
          break;
        }
        await readAll(false).catch(() => '');
        const ran = await r.run(line);
        if (!ran) return null;
        outputs.push(ran.output);
        if (ran.took) {
          why = 'the user took this step over';
          break;
        }
        if (failed(ran.output)) break;
      }
    } finally {
      r.allow(0);
    }
    const news = await r.news();
    if (id !== lastCommand) return null;
    allNews.push(...news);
    const got = r.count() - before;
    why ||= itemMiss(lines, outputs, news, perItem, got);
    print(`   ${k + 1}/${items.length} ${JSON.stringify(oneLine(names[k]!, 40))}: ${why || 'done'}${news.length ? ` — ${news.join(' — ')}` : ''}`);
    if (why) return stoppedAt(names, k, why, filesLine(allNews));
  }
  return repeatDone(names, filesLine(allNews));
}
