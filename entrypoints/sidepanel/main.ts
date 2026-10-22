// Side panel: say what you want in plain words (a goal), or drive by hand with /commands. Output appears above; errors in red.
import { buildAsk, buildDoneCheck, buildTipAsk, checkGoto, livePlan, MAX_BAD_REPLIES, MAX_CHECKS, MAX_NOTES, oneLine, onSites, parseStep, parseVerdict, progress, startSites, STEP_BUDGET, stepsAdded, submits, addVisit, visitedLines, type Visit, savedNotes, siteOn, siteToAdd, siteToOpen, summarize, type Step } from '@/lib/agent-prompt';
import { fileName, RunDownloads } from '@/lib/downloads';
import { captchaAll, clickTextIn, focusedFrame, frameFor, textFrame, labelFor, nameFor, numberFor, numbersAll, pickInFrames, readAll, sendToAllFrames, setOverlayOn, textAll } from '@/lib/frames';
import { allowOnce, batchProblem, batchReply, captchaHold, checkAgentTip, checkCommands, LOOK_HELP, lookShot, MAX_COMMAND, MAX_OUTPUT, MCP_COMMANDS, retryUnlisted, TIP_HELP, tipsOnce, type BridgeImage, type BridgeReply } from '@/lib/bridge';
import { HOST_NAME } from '@/lib/host-install';
import { JUDGE, PLANNER, type Ask, type Reply } from '@/lib/host-request';
import { HandOver, StopLine } from '@/lib/messages';
import { back, follow, goto, loaded, pinTab, targetTabId } from '@/lib/navigation';
import { LoopGuard } from '@/lib/loop-guard';
import { pageChange, pagePath, pageReport, stepKey } from '@/lib/page-diff';
import { capText, textArgs } from '@/lib/page-text';
import { parseCommand, restOf } from '@/lib/parse-command';
import { inGoal } from '@/lib/personal';
import { pickArgs } from '@/lib/pick';
import { readPdf, renderPage } from '@/lib/pdf';
import { downloadsSince, failed, filesLine, forItem, item1On, itemMiss, itemTarget, MAX_REPEAT_ITEMS, notAlikeError, parseRepeat, recipeFrom, recordLine, repeatAsk, repeatDone, stoppedAt } from '@/lib/repeat';
import { pdfFind, pdfPageLine, pdfText } from '@/lib/pdf-text';
import { downloadArgs, fileKind, fileUrl, MAX_TEXT_FILE, newestReadable } from '@/lib/run-files';
import { keep, lookAgainText, searchKept, type Kept } from '@/lib/read-store';
import { attach, checkPoint, checkScriptClick, clickAtPoint, detachAll, dragAlong, MAX_POINTS, mouseFlags, moveTo, parsePoint, sendKeys, sendMouse, sendText, type Point } from '@/lib/real-input';
import { keyEvents, parseKey, scriptKey } from '@/lib/keys';
import { parseTab, RunTabs, type TabCommand } from '@/lib/run-tabs';
import { attachShot, shrink, takeShot, type Shot } from '@/lib/screenshot';
import { onlySearched, SEARCH_SITE, searchAsk, searchUrl } from '@/lib/search';
import { sendToTab } from '@/lib/send-to-tab';
import { settleAfter } from '@/lib/settle';
import { deleteSite, deleteTip, listSites, pruneSites, saveTip, useSite } from '@/lib/site-store';
import { recall, remember, type Remembered } from '@/lib/panel-memory';
import { MAX_TIPS, parseTips, TIP_CHARS } from '@/lib/site-tips';
import { isCheckoutUrl } from '@/lib/stop-lines';

// allow: run past a stop-line. Only the Allow once button passes true, never a typed command.
// goal: what you typed, passed only by a goal run. A value found in it skips the personal-data ask (4.3).
// line: the whole command line as typed, for commands that take the rest of it as is (paste, type here).
type Command = { help: string; run: (args: string[], allow: boolean, goal?: string, line?: string) => string | void | Promise<string | void> };

const out = document.querySelector<HTMLElement>('#out')!;
const form = document.querySelector('form')!;
const input = form.querySelector('input')!;

function print(text: string, className = '') {
  const line = document.createElement('div');
  line.textContent = text;
  line.className = className;
  out.append(line);
  out.scrollTop = out.scrollHeight;
}

// While you're at the bottom, the log stays there when the panel gets shorter or narrower (Chrome's debugging bar
// coming in, a resize): else an ask's buttons slide below the visible area. Only the scroll changes, so no resize loop.
// Source: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
let atBottom = true;
out.addEventListener('scroll', () => (atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 8));
new ResizeObserver(() => {
  if (atBottom) out.scrollTop = out.scrollHeight;
}).observe(out);

// The open choice: a stop-line's Allow once / I'll do it, or a run's pause. Valid only until another command starts:
// a new read renumbers elements, and an old Allow must never land on a different element.
let pendingAsk: HTMLElement | null = null;
let lastCommand = 0; // counts started commands, so a late stop-line can tell another one ran meanwhile
let onAskClosed: (() => void) | null = null; // a paused run waiting on the open ask: closing it any other way ends that run

function closeAsk(note: string) {
  if (!pendingAsk) return;
  pendingAsk.replaceWith(Object.assign(document.createElement('div'), { textContent: note }));
  pendingAsk = null;
  onAskClosed?.();
  onAskClosed = null;
}

// Pauses a run (3.7c loop guard, 3.6 step budget, 4.1 pause, 4.3 stop-lines): the keep button continues the same run
// and history; the other button, or any command you start, resolves false (a command also bumps lastCommand, so a run
// can tell "I'll do it" from being stopped). Focus stays in the command box, so a reflex Enter can never press Allow.
function askKeepGoing(message: string, keepLabel = 'Keep going', stopLabel = 'Stop'): Promise<boolean> {
  print(message, 'stop');
  return new Promise((resolve) => {
    const keep = Object.assign(document.createElement('button'), { type: 'button', textContent: keepLabel });
    const stop = Object.assign(document.createElement('button'), { type: 'button', textContent: stopLabel });
    // A promise settles once: Keep going's true wins over the false that closeAsk sends right after.
    keep.onclick = () => {
      resolve(true);
      closeAsk('Going on.');
    };
    stop.onclick = () => closeAsk(stopLabel === 'Stop' ? 'Stopped.' : `${stopLabel}.`);
    onAskClosed = () => resolve(false);
    pendingAsk = Object.assign(document.createElement('div'), { className: 'ask' });
    pendingAsk.append(keep, stop);
    out.append(pendingAsk);
    out.scrollTop = out.scrollHeight;
  });
}

// 4.1 pause "reason": hands the page to you. The agent wrote the reason after reading the page, so it's shown quoted,
// one line, capped, like its other words.
function askResume(args: string[]): Promise<boolean> {
  const why = args.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200) || '(no reason given)';
  return askKeepGoing(`Paused: "${why}". Do what's needed on the page, then Resume.`, 'Resume');
}

type Run = (allow: boolean) => string | void | Promise<string | void>;

// Runs a command and prints the result. A stop-line asks instead of failing: Allow once re-runs it one time with allow.
async function runAndPrint(run: Run, allow = false) {
  const id = ++lastCommand;
  try {
    const result = await run(allow);
    if (result) print(result);
  } catch (err) {
    if (!(err instanceof StopLine)) return print(err instanceof Error ? err.message : String(err), 'error');
    askAllow(err, run, id);
  } finally {
    await detachAll(); // I1: the debugger is attached only while a command or run goes
  }
}

// Shows a stop-line with Allow once / I'll do it. id: the command that hit it; stale if another one started since.
function askAllow(err: StopLine, run: Run, id: number) {
  print(err.message, 'stop');
  if (id !== lastCommand) return print('Another command ran meanwhile. Run this one again to choose.', 'error');
  const allowOnce = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Allow once' });
  const mine = Object.assign(document.createElement('button'), { type: 'button', textContent: "I'll do it" });
  allowOnce.onclick = () => {
    closeAsk('Allowed once.');
    void runAndPrint(run, true);
  };
  mine.onclick = () => closeAsk('Cancelled. This step is yours: do it by hand on the page.');
  // Focus stays in the command box, so a reflex Enter can never press Allow.
  pendingAsk = Object.assign(document.createElement('div'), { className: 'ask' });
  pendingAsk.append(allowOnce, mine);
  out.append(pendingAsk);
  out.scrollTop = out.scrollHeight;
}

// Where the run's tab is (its URL and site name) and whether that's one of the run's Sites.
async function where(sites: string[]): Promise<{ onPlan: boolean; site: string; url: string; title: string }> {
  const tab = await browser.tabs.get(await targetTabId());
  return { onPlan: onSites(tab.url, sites), site: (tab.url && URL.parse(tab.url)?.hostname) || 'this page', url: tab.url ?? '', title: tab.title ?? '' };
}

// `Tabs: [1] amazon.in (current) · [2] flipkart.com`. Site names only: page titles are written by the page.
async function tabsLine(run: RunTabs): Promise<string> {
  const parts = await Promise.all(run.list().map(async ({ n, id }) => {
    const url = await browser.tabs.get(id).then((t) => t.url || t.pendingUrl, () => undefined);
    return `[${n}] ${(url && URL.parse(url)?.hostname) || 'new tab'}${id === run.current ? ' (current)' : ''}`;
  }));
  return `Tabs: ${parts.join(' · ')}`;
}

// The AI's tab command (3.7e), on the run's own tabs only. A run works in the background if you look elsewhere (your
// choice), so it brings a tab to the front only while you're looking at the run's current tab.
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs
async function tabStep(run: RunTabs, cmd: TabCommand, allow: boolean): Promise<string> {
  const now = await browser.tabs.get(run.current!);
  if (cmd.kind === 'new') {
    if (!allow && isCheckoutUrl(cmd.url)) throw new StopLine(`Stop-line: tab new ${cmd.url} (checkout page)`);
    const tab = await browser.tabs.create({ url: cmd.url, active: !cmd.background && now.active, windowId: now.windowId, openerTabId: now.id });
    const n = run.add(tab.id!);
    pinTab(tab.id!);
    await loaded(tab.id!);
    return `ok — opened tab [${n}]`;
  }
  if (cmd.kind === 'close') {
    const id = run.closing(cmd.n);
    await browser.tabs.remove(id);
    run.removed(id);
  } else run.switchTo(cmd.n);
  if (run.current === null) return `ok — closed tab [${cmd.n}]`;
  pinTab(run.current);
  if (now.active) await browser.tabs.update(run.current, { active: true });
  return cmd.kind === 'close' ? `ok — closed tab [${cmd.n}]` : `ok — now in tab [${cmd.n}]`;
}

// Settles once the run's work (a goal run, or its Allow once) has fully stopped. A command you type waits for it, so
// the run's last step can't land on your tab after the pin is gone, and your command can't land on the run's tab.
let runEnded: Promise<void> = Promise.resolve();

// Runs f with commands pinned to a run's tab (null: the active tab until the run pins its own), then unpins.
async function inRunTab<T>(tab: number | null, f: () => T | Promise<T>): Promise<T> {
  let ended = () => {};
  runEnded = new Promise((resolve) => (ended = resolve));
  pinTab(tab);
  try {
    return await f();
  } finally {
    pinTab(null);
    ended(); // always, or a typed command would wait forever
  }
}

// A goal's run, in the tab you're looking at when you send it. From then on it works in its own tabs only.
// sites: the run's first Sites (startSites, G1).
function runGoal(goal: string, sites: string[]): Promise<string> {
  return inRunTab(null, async () => {
    const run = new RunTabs(await targetTabId());
    // A tab opened by one of the run's pages during one of its commands (a link with target=_blank) joins the run.
    const onCreated = (tab: Browser.tabs.Tab) => {
      if (run.acting && tab.id !== undefined && tab.openerTabId !== undefined && run.has(tab.openerTabId)) run.add(tab.id);
    };
    // A run's tab closed, by the run or by you, drops out.
    const onRemoved = (tabId: number) => run.removed(tabId);
    // D1, D2: every download that starts while the run goes is the run's, so it's reported and needs your yes.
    const downloads = new RunDownloads();
    browser.tabs.onCreated.addListener(onCreated);
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.downloads.onCreated.addListener(downloads.onCreated);
    goalDownloads = downloads;
    try {
      return await runSteps(goal, sites, run, downloads);
    } finally {
      goalDownloads = null;
      browser.tabs.onCreated.removeListener(onCreated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      unwatch(downloads);
    }
  });
}

// F10: the last goal run whose done check passed on one of its Sites, set by runSteps and taken by the goal command.
let passedRun = null as { goal: string; site: string; steps: Step[] } | null;

// F10: one proposed tip. Save keeps it as shown; Edit opens a box to change it first (checked again on save); No, or
// any command you start, drops it. Resolves the text to save, or null.
function askTip(site: string, tip: string): Promise<string | null> {
  print(`Save this tip for ${site}? "${tip}"`, 'stop');
  return new Promise((resolve) => {
    const button = (label: string, onclick: () => void) => Object.assign(document.createElement('button'), { type: 'button', textContent: label, onclick });
    const save = (text: string) => {
      resolve(text);
      closeAsk('Saving…');
    };
    const no = button('No', () => closeAsk('Not saved.'));
    const box = Object.assign(document.createElement('textarea'), { value: tip, maxLength: TIP_CHARS, rows: 2, ariaLabel: 'Tip text' });
    const edit = button('Edit', () => {
      pendingAsk?.replaceChildren(box, button('Save', () => save(box.value)), no);
      box.focus();
    });
    onAskClosed = () => resolve(null);
    pendingAsk = Object.assign(document.createElement('div'), { className: 'ask' });
    pendingAsk.append(button('Save', () => save(tip)), edit, no);
    out.append(pendingAsk);
    out.scrollTop = out.scrollHeight;
  });
}

// F10: after a passed run, the model proposes up to 3 tips for the site it ended on. Each one checkTip lets through is
// asked about in turn; only your Save keeps one. A tip refused on save comes back so you can edit it. Any command you
// start ends this.
async function offerTips({ goal, site, steps }: { goal: string; site: string; steps: Step[] }) {
  const id = lastCommand;
  let tips: string[];
  try {
    const reply = await askModel(buildTipAsk(goal, site, steps));
    tips = parseTips(reply, site);
    if (id !== lastCommand) return;
    print(`Tips for ${site}: ${tips.length || 'none'} proposed (${reply.usage.input_tokens} tokens in, ${reply.usage.output_tokens} out).`);
  } catch (err) {
    // Not a guard: no tips is how runs were before F10.
    return print(`No tips this time: ${(err as Error).message}`, 'error');
  }
  for (const tip of tips) {
    let text = tip;
    for (;;) {
      const chosen = await askTip(site, text);
      if (id !== lastCommand) return; // you moved on
      if (chosen === null) break;
      const saved = await saveTip(site, chosen, Date.now());
      if ('tips' in saved) {
        print(`Saved for ${site} (${saved.tips.length} of ${MAX_TIPS} tips).`);
        break;
      }
      print(`Not saved: ${saved.why}. Edit it, or No.`, 'error');
      text = chosen;
    }
  }
}

// D2's ask. The punycode hostname, like S2's.
function askDownload(item: Browser.downloads.DownloadItem, more = ''): Promise<boolean> {
  const from = URL.parse(item.finalUrl)?.hostname || URL.parse(item.referrer)?.hostname || 'the page';
  return askKeepGoing(`The agent started a download: "${fileName(item)}" from ${from}. Allow it?${more}`, 'Allow', 'No');
}

// The agent's turn is over: downloads still paused stay paused, and you decide.
function unwatch(downloads: RunDownloads) {
  browser.downloads.onCreated.removeListener(downloads.onCreated);
  if (downloads.paused) print(`${downloads.paused} download(s) the agent started are paused, waiting for your ok: resume or cancel them in chrome://downloads.`, 'stop');
}

// F9: a step's results in its history line (each command's first line, "skipped …"), so 5 commands can't flood it.
const MAX_STEP_RESULT = 400;

// read → ask → run a step's commands, until done. At the step budget it asks you (+N steps / Stop). Any command you start stops it.
async function runSteps(goal: string, firstSites: string[], run: RunTabs, downloads: RunDownloads): Promise<string> {
  const id = lastCommand; // this run; any command you start bumps it, which stops the loop
  passedRun = null;
  const steps: Step[] = [];
  let lastText = '';
  let lastPage = ''; // the page the last command ran on, to say what it changed (3.7b)
  let acted = false; // the last step ran a command that can change the page (not text, not an unusable reply)
  let guard: LoopGuard | undefined; // set from the first page read
  let tokensIn = 0;
  let tokensOut = 0;
  let badReplies = 0;
  let checks = 0; // F7: done checks used this run
  let missing = ''; // what the last done check said is missing ('' after a pass)
  let budget = STEP_BUDGET; // only your +N click raises it, never the model
  let added = 0; // B1: steps your last +N added; the next ask says so once
  let solvedCaptcha = ''; // page + kind of the CAPTCHA you last resumed from: a solved one often stays on screen
  const yours = new Set<string>(); // steps you took over (stepKey): a retry is refused, never asked twice
  const cost = () => `${steps.length} / ${budget} steps · ${tokensIn} tokens in, ${tokensOut} out`;
  const sites = [...firstSites]; // S2: this run's Sites. Only your Add site click grows it, never the model
  const refused = new Set<string>(); // sites you said no to: never asked again this run
  // W1: after a search you allowed, its results site can be read and clicked, but it never joins Sites: goto or
  // tab new there would carry words you never saw.
  let searched = false;
  const readable = () => (searched ? [...sites, SEARCH_SITE] : sites);
  let searchTab: number | null = null; // W1b: the run's one search tab
  let visits: Visit[] = []; // N1: plan-site pages read this run, so one can be reopened by its URL
  let kept: Kept[] = []; // V1: the text of plan-site pages read with text all, and PDFs, for the done check's search
  const siteTips = new Map<string, string[]>(); // F10: each site's saved tips, read once per run
  pdfShown = null; // P2: each run's PDF pictures start at page 1
  // S2: asks you to add site for this run. true: added; false: no; null: the run was stopped meanwhile.
  const askSite = async (site: string, url: string): Promise<boolean | null> => {
    const add = await askKeepGoing(`The agent wants to use ${site} (${url.slice(0, 150)}), which isn't on this run's Sites (${sites.join(', ') || 'none yet'}). Add it for this run? (${cost()})`, 'Add site', 'No');
    if (id !== lastCommand) return null;
    if (add) sites.push(site);
    else refused.add(site);
    return add;
  };
  for (;;) {
    // 3.6: running out asks, never just dies. +N continues the same run and history; you see progress and cost first.
    if (steps.length >= budget) {
      const more = Math.ceil(STEP_BUDGET / 2);
      if (!(await askKeepGoing(`Step budget used up. ${progress(steps)} · ${cost()}.`, `+${more} steps`)) || id !== lastCommand) {
        return `Stopped at the step budget (${cost()}).`;
      }
      budget += more;
      // B1: your +N means keep going: the model is told, and its next done gets a check again instead of passing
      // unchecked because the checks ran out (live: it sent done at once and left 18 steps unused).
      added = more;
      checks = Math.min(checks, MAX_CHECKS - 1);
    }
    // Off the run's Sites the AI sees only the site name (no page text, so nothing there can steer it) and may only
    // goto, back, tab or done. Like Chrome's agent origin sets: https://blog.google/security/architecting-security-for-agentic/
    if (run.current === null) return `Stopped: all of its tabs were closed (${cost()}).`;
    pinTab(run.current); // a tab its click opened, or one you closed, may have changed it
    // T1: while you watch one of the run's tabs, the one it works in comes forward, so it can be pictured. Not a guard:
    // if the tab is gone meanwhile, the step goes on without it.
    try {
      const [shown] = await browser.tabs.query({ active: true, windowId: (await browser.tabs.get(run.current)).windowId });
      if (run.toFront(shown?.id)) await browser.tabs.update(run.current, { active: true });
    } catch {
      // the next read reports a closed tab
    }
    const here = await where(readable());
    // S2: the run landed on a new site (a link, a redirect, a tab its page opened): you decide before the model sees it.
    // Only after a command that can change the page: the start tab's site is left out only when your goal names others.
    const landed = siteToAdd(here.url, readable());
    if (landed && acted && !refused.has(landed)) {
      if ((await askSite(landed, here.url)) === null) return `Stopped (${cost()}).`;
      continue; // read again: on the Sites now, or hidden
    }
    // 4.2: a CAPTCHA is yours. Pause before the model sees the page; Resume reads it again. Once per page and kind.
    const captcha = here.onPlan ? await captchaAll() : '';
    if (captcha && `${here.url} ${captcha}` !== solvedCaptcha) {
      if (!(await askKeepGoing(`CAPTCHA on the page (${captcha}). Solve it yourself, then Resume. (${cost()})`, 'Resume')) || id !== lastCommand) {
        return `Stopped at a CAPTCHA (${cost()}).`;
      }
      solvedCaptcha = `${here.url} ${captcha}`;
      continue;
    }
    // D2: a download you hadn't allowed waits, paused, for your yes. D1: the page doesn't show downloads, so their news
    // goes in the last step's result.
    const fetched = await downloads.report((item) => askDownload(item, ` (${cost()})`));
    if (id !== lastCommand) return `Stopped (${cost()}).`;
    const hidden = `(Page hidden: ${here.site} is not one of the run's Sites${refused.has(landed) ? '; the user said no to adding it' : ''}. Only goto, back, tab, search and done work here.)`;
    // P1: a PDF tab is read from its file: Chrome's own viewer doesn't run our content script.
    const pdf = here.onPlan ? await pdfTabUrl() : null;
    const seen = `${await tabsLine(run)}\n${!here.onPlan ? hidden : pdf ? await pdfPage(pdf, here.title) : await readAll(false)}`;
    // Sites only: a search results page is readable but never a goto target (W1).
    if (onSites(here.url, sites)) visits = addVisit(visits, { url: here.url, title: here.title });
    // V1: a PDF the run saw is kept whole (readPdf reads each URL once, so this costs nothing more).
    if (pdf && onSites(pdf, sites)) {
      const pages = await readPdf(pdf).then((p) => p.pages, () => []);
      if (pages.length) kept = keep(kept, { url: pdf, pages });
    }
    // Right after the read, so the numbers on the picture are this read's.
    // P2: on a PDF tab the picture is a page drawn from the file (it works in a background tab and on scans); if that
    // fails, a screenshot of the tab as before.
    let shot: Shot | string = pdf ? await pdfPicture(pdf) : '';
    if (typeof shot === 'string') {
      if (shot) print(`   ${shot}`);
      shot = await screenshot(here.onPlan, !!pdf);
    }
    let page = seen;
    const last = steps.at(-1);
    if (acted && last) {
      const change = pageChange(lastPage, seen);
      last.result += ` — ${change.note}`;
      page = change.page;
      print(`   ${change.note}`);
    }
    if (fetched.length) {
      if (last) last.result += ` — ${fetched.join(' — ')}`;
      print(`   ${fetched.join('\n   ')}`);
    }
    lastPage = seen;
    // Loop guard (3.7c), in code: warn the model, then pause and ask you. The warning is ours, so it goes outside the
    // untrusted blocks; its reason is built from counts only.
    let warning = '';
    if (!guard) guard = new LoopGuard(seen);
    else if (last) {
      // U1: a step refused before it ran isn't an outcome of its command.
      const check = guard.after(last.command, seen, !/^Refused\b/.test(last.result));
      if (check.pause) {
        if (!(await askKeepGoing(`Looks stuck after ${cost()}: ${check.pause}.`)) || id !== lastCommand) return `Stopped: it looked stuck (${cost()}).`;
        guard.reset();
      } else {
        // U1: a repeat with a known result steers; going in circles asks for a rethink before another way.
        warning = [
          check.repeat && `Warning from the harness: ${check.repeat}.`,
          check.warn && `Warning from the harness: you seem to be going in circles (${check.warn}). Stop and rethink: in memory, write what you know and why the last tries failed, send a new plan that avoids it, then try another way (the rule on other ways lists them), or send done and say why you can't finish.`,
        ].filter(Boolean).join('\n');
        if (check.repeat) print('   loop guard: repeated a command with the same result');
        if (check.warn) print(`   loop guard: ${check.warn}`);
      }
    }
    if (added) {
      warning = [warning, stepsAdded(added, steps.length, budget, !!missing)].filter(Boolean).join('\n');
      added = 0;
    }
    // F10: the tips you saved for this page's site (on the Sites only), read the first time the run is there: useSite
    // marks the site used. Not a guard: unreadable tips mean a step without them, as before F10.
    const tipSite = siteOn(here.url, sites);
    if (tipSite && !siteTips.has(tipSite)) {
      const tips = await useSite(tipSite, Date.now()).catch((err: Error) => (print(`   saved tips unread: ${err.message}`, 'error'), []));
      siteTips.set(tipSite, tips.map((t) => t.text));
      if (tips.length) print(`   ${tips.length} saved tip(s) for ${tipSite}`);
    }
    // The model reads the budget every step: after your +N it must see the raised one, or it thinks it's out and quits.
    const [ask, shotLine] = attachShot(buildAsk(goal, { sites, budget }, page, commands, steps, lastText, warning, guard.tried(), visitedLines(visits), { site: tipSite, tips: siteTips.get(tipSite) ?? [] }), shot);
    print(`   ${shotLine}`);
    let answer = await askModel(ask);
    if (id !== lastCommand) return `Stopped (${cost()}).`;
    // Haiku (the executor) has no server-side fallback, and its filters can decline harmless pages. So a declined step
    // is asked once more on the planner model, which has one. Same ask, so nothing new reaches it.
    if (answer.stop_reason === 'refusal') {
      tokensIn += answer.usage.input_tokens;
      tokensOut += answer.usage.output_tokens;
      print('   step model declined; asking the planner model instead', 'error');
      answer = await askModel({ ...ask, model: PLANNER });
      if (id !== lastCommand) return `Stopped (${cost()}).`;
    }
    tokensIn += answer.usage.input_tokens;
    tokensOut += answer.usage.output_tokens;
    let parsed: ReturnType<typeof parseStep>;
    try {
      parsed = parseStep(answer, livePlan(steps).items.length);
      badReplies = 0;
    } catch (err) {
      // A refusal or cut-off ends the run. A bad format or a command it may not use goes back to the model, which
      // usually fixes it; nothing runs, and it counts toward the step cap.
      if (answer.stop_reason !== 'end_turn' || ++badReplies >= MAX_BAD_REPLIES) throw err;
      const result = `Error: ${(err as Error).message}`;
      steps.push({ command: `(unusable reply) ${summarize(answer.text)}`, result });
      print(`${steps.length}. (unusable reply)\n   ${result}`, 'error');
      lastText = '';
      acted = false;
      continue;
    }
    const { commands: batch, lastStep, memory, note, plan, nextGoal, item, doneItems } = parsed;
    // F9: the step's commands as one history line. done and pause always come alone, so they're the first.
    const line = batch.map((c) => c.line).join(' ; ');
    const [name = '', ...stepArgs] = batch[0]!.words;
    const full = savedNotes(steps).length >= MAX_NOTES; // the model was told; you see it here too
    // G1: a new plan from the agent is shown in full when it arrives; the progress line after each step tracks it.
    const planned = plan.length ? `\n   new plan:\n${plan.map((p, i) => `     ${i + 1}. ${p}`).join('\n')}` : '';
    print(`${steps.length + 1}. ${line}\n   last step: ${lastStep}\n   why: ${nextGoal}\n   memory: ${memory}${note ? `\n   note${full ? ' (not saved: notes full)' : ''}: ${note}` : ''}${planned}`);
    // F7: a done check before the run ends; a fail sends the model back with what's missing, as this step's result.
    // After MAX_CHECKS the next done is accepted, and you see what the last check missed.
    if (name === 'done') {
      const said = stepArgs.join(' ') || '(no answer)';
      let passed = false; // this done's check said pass (not a broken check, not one accepted unchecked)
      if (checks < MAX_CHECKS) {
        checks++;
        let lookFor: string[] = [];
        try {
          const reply = await askModel(buildDoneCheck(goal, [...steps, parsed], said, page, lastText));
          tokensIn += reply.usage.input_tokens;
          tokensOut += reply.usage.output_tokens;
          ({ missing, lookFor } = parseVerdict(reply));
          passed = !missing;
          print(`   done check ${checks} / ${MAX_CHECKS}: ${missing ? `fail: ${missing}` : 'pass'}`);
        } catch (err) {
          // Not a security guard: a broken check leaves done as it was before F7.
          missing = '';
          print(`   done check failed, answer accepted: ${(err as Error).message}`, 'error');
        }
        if (id !== lastCommand) return `Stopped (${cost()}).`;
        // V1: what the answer leaves out or says it couldn't find is searched for in the pages this run read, even on a
        // pass (an honest "couldn't find" passes the check). Any match sends it back with the matches to read.
        const hits = searchKept(kept, lookFor);
        const words = lookFor.map((p) => JSON.stringify(p)).join(', ');
        if (lookFor.length) print(`   look again for ${words} in ${kept.length} kept page(s): ${hits.length ? `${hits.length} match(es)\n   ${hits.join('\n   ')}` : 'no match'}`);
        if (missing || hits.length) {
          const told = [missing && `The done check says what's missing: ${missing}`, hits.length && 'Pages you already read mention it: see the output below'].filter(Boolean).join('. ');
          steps.push({ command: line, result: `Not done yet. ${told}`, nextGoal, memory, plan, item, doneItems, note, lastStep });
          print(`   ${progress(steps)} · ${cost()}`);
          lastText = hits.length ? lookAgainText(lookFor, hits) : ''; // page text: it goes inside <page_content>, defused
          if (!missing) missing = `pages already read mention ${words}`; // shown with the answer if the next done is accepted
          acted = false;
          continue;
        }
      }
      // F10: a passed check on one of the run's Sites offers tips for that site once the run has ended (offerTips).
      const tipSite = passed ? siteOn((await where(sites).catch(() => null))?.url, sites) : '';
      if (tipSite) passedRun = { goal, site: tipSite, steps: [...steps] };
      return `Done: ${said}${missing ? `\n(The done check still says missing: ${missing})` : ''}\n(${progress([...steps, parsed])} · ${cost()})`;
    }
    // 4.1: wait for you; Resume goes on with the same run and history. Works on any site: it doesn't touch the page.
    if (name === 'pause') {
      if (!(await askResume(stepArgs)) || id !== lastCommand) return `Stopped while paused (${cost()}).`;
      steps.push({ command: line, result: 'the user resumed you', nextGoal, memory, plan, item, doneItems, note, lastStep });
      lastText = '';
      acted = true; // you may have changed the page: the next read is fresh and says what changed
      continue;
    }
    // U1: this exact step already gave the same result twice on this exact page: refused, not run (OpenRouter's
    // block@3). It costs a step, but the page isn't touched and the model is pushed to another way.
    const known = guard.known(line);
    if (known && known.times >= 2) {
      steps.push({ command: line, result: `Refused: you already ran this on this exact page ${known.times} times, and each time: ${known.outcome}. It won't do anything new; try another way (the rule on other ways lists them).`, nextGoal, memory, plan, item, doneItems, note, lastStep });
      print(`   ${steps.at(-1)!.result}`, 'error');
      lastText = '';
      acted = false;
      continue;
    }
    // One command with every check of its own: Sites, stop-lines, hand-overs. Returns its output, whether it needed
    // you (stop-line or hand-over, which ends the step), or null if the run was stopped meanwhile.
    const runCommand = async (line: string, [name = '', ...stepArgs]: string[]): Promise<{ output: string | void; stop: boolean; took?: boolean } | null> => {
      // S2: goto or tab new to a new site's home page asks you first. No: refused, nothing opens.
      const opening = name === 'goto' ? stepArgs[0] : name === 'tab' && stepArgs[0] === 'new' ? stepArgs[1] : undefined;
      const newSite = siteToOpen(opening, sites);
      if (newSite) {
        const added = refused.has(newSite) ? false : await askSite(newSite, opening!);
        if (added === null) return null;
        if (!added) return { output: `Refused: the user said no to adding ${newSite}. Use the run's Sites.`, stop: true };
      }
      // The AI never sets allow: only your Allow once does, for this exact step, never a new model call.
      // goto: checked against the run's Sites, and a checkout URL is a stop-line like a checkout button.
      const step: Run = name === 'goto'
        ? (allow) => {
            const href = checkGoto(stepArgs[0], sites);
            if (!allow && isCheckoutUrl(href)) throw new StopLine(`Stop-line: goto ${href} (checkout page)`);
            return commands.goto!.run([href], allow);
          }
        : name === 'tab'
        ? (allow) => tabStep(run, parseTab(stepArgs, sites), allow)
        : name === 'search'
        ? async () => {
            // W1: you see the exact words before they leave; No refuses. A new tab, so the run keeps its place.
            const words = stepArgs.join(' ');
            const url = searchUrl(words);
            if (!(await askKeepGoing(`${searchAsk(words)} (${cost()})`, 'Search', 'No'))) throw new Error("Refused: the user said no to this search. Use the run's Sites, or search other words.");
            searched = true;
            // W1b: one search tab per run, in the background so it never takes your screen (no screenshots there). Reused
            // while it still shows results; once the model opened a result in it, that page stays and a new one opens.
            const said = `in the background: DuckDuckGo results for "${words.trim()}"`;
            if (searchTab !== null && run.has(searchTab) && onSites((await browser.tabs.get(searchTab)).url, [SEARCH_SITE])) {
              const n = run.add(searchTab);
              pinTab(searchTab);
              await settleAfter(() => goto(url));
              return `ok — tab [${n}] ${said}`;
            }
            const opened = await tabStep(run, { kind: 'new', url, background: true }, false);
            searchTab = run.current;
            return `${opened} ${said}`;
          }
        : async (allow) => {
            // Checked again right before acting: the page may have moved to another site while the model thought.
            const now = await where(readable());
            if (!now.onPlan && name !== 'back') throw new Error(`Blocked: ${now.site} is not one of the run's Sites. Use goto, back, tab or search.`);
            if (name === 'type' && onlySearched(now.url, sites)) throw new Error('Typing on search results is refused: use search "words" to search again (the user sees the words first).');
            return runLine(commands[name]!, line, allow, goal);
          };
      let output: string | void;
      let handOver = '';
      let stopLine = '';
      const attempt = async (allow: boolean): Promise<string | void> => {
        run.acting = true;
        downloads.allowing = allow;
        try {
          return await step(allow);
        } catch (err) {
          if (err instanceof StopLine) stopLine = err.message;
          else if (err instanceof HandOver) handOver = err.message;
          return `Error: ${err instanceof Error ? err.message : String(err)}`; // the model sees it and tries another way
        } finally {
          run.acting = false;
          downloads.allowing = false;
        }
      };
      output = await attempt(false);
      if (id !== lastCommand) return null;
      // In code, not the prompt: the model ignored "don't redo it" and handed the same password back to you.
      const key = stepKey(here.url, stopLine || handOver);
      if ((stopLine || handOver) && yours.has(key)) {
        stopLine = handOver = '';
        return { output: "Refused: the user already took this step over on this page. It stays theirs: don't try it again. Report what the page shows.", stop: true };
      }
      // 4.3: a stop-line (pay, submit, personal data…) asks you inside the run. Allow once runs this exact command and
      // goes on; I'll do it hands it to you (below).
      const neededYou = !!(stopLine || handOver);
      if (stopLine) {
        const allowed = await askKeepGoing(`${stopLine} (${cost()})`, 'Allow once', "I'll do it");
        if (id !== lastCommand) return null;
        if (allowed) output = await attempt(true);
        else handOver = `You chose to do this step yourself (${line}): do it on the page.`;
        if (id !== lastCommand) return null;
      }
      // 4.2: a secret field or a CAPTCHA is never the agent's, not even with Allow once: you do it, then Resume.
      if (handOver) {
        if (!(await askKeepGoing(`${handOver} Then press Resume. (${cost()})`, 'Resume')) || id !== lastCommand) return null;
        yours.add(key);
        // Said first (summarize keeps 200 chars): without it the model retypes a secret forever, or claims you filled it.
        output = `The user had this step, then resumed you. Don't redo it. Report what the page shows, not what you expect: a filled secret reads value=•••, an empty one has no value. Was: ${handOver}`;
      }
      return { output, stop: neededYou, took: !!handOver };
    };

    const downloadsAt = downloads.created; // RP1: item 1's downloads count from here
    // RP1: repeat runs item 1's recorded commands on each item (runRepeat); it comes alone (ALONE). The page must be one
    // the model saw: on the Sites, not a PDF.
    if (name === 'repeat') {
      let result: string | null;
      try {
        result = await runRepeat(stepArgs, {
          steps,
          site: here.site,
          onSites: here.onPlan && !pdf,
          count: () => downloads.created,
          allow: (n) => void (downloads.allowance = n),
          news: () => downloads.report((d) => askDownload(d, ` (${cost()})`)),
          run: (cmd) => runCommand(cmd, parseCommand(cmd)),
          more: ` (${cost()})`,
        });
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (result === null) return `Stopped (${cost()}).`;
      // Kept in ran when it ran, so a later recipe that would hold it is refused (recipeFrom).
      steps.push({ command: line, result: oneLine(result, MAX_STEP_RESULT), nextGoal, memory, plan, item, doneItems, note, lastStep, ran: failed(result) ? [] : [line], downloadsAt });
      print(`   ${steps.at(-1)!.result}\n   ${progress(steps)} · ${cost()}`);
      lastText = '';
      acted = true;
      continue;
    }

    // F9: the step's commands in order. The rest are skipped once one fails, needed you, or changed the URL. Only the
    // last re-reads the page, so every number stays this read's; a command whose element is gone fails, which skips the
    // rest too.
    const results: string[] = [];
    let output: string | void = '';
    let ranAll = false; // the last command ran too: only then is its read the next turn's "output of your last command"
    // A choice can reveal new fields the model hasn't seen (live: Calculate pressed with a required field still empty),
    // so the step stops before anything that can submit once the page shows more fields than at its start.
    // shortcut: counts the top page's fields only; upgrade if a form inside a frame needs it.
    const fields = () => sendToTab({ type: 'fields' }).catch(() => -1);
    const startFields = batch.some((c, i) => i > 0 && submits(c.words)) ? await fields() : -1;
    takeRead(); // one from your own typed text all isn't this step's
    const worked: string[] = []; // RP1: by label, for a later repeat
    for (const [i, cmd] of batch.entries()) {
      const before = (await where(readable())).url;
      const recorded = recordLine(cmd.line, labelFor); // before it runs, while its number is still this read's
      skipRead = i < batch.length - 1;
      let ran: Awaited<ReturnType<typeof runCommand>>;
      try {
        ran = await runCommand(cmd.line, cmd.words);
      } finally {
        skipRead = false;
      }
      if (!ran) return `Stopped (${cost()}).`;
      output = ran.output;
      results.push(summarize(output));
      const bad = failed(output);
      if (!bad) worked.push(recorded);
      const left = batch.length - i - 1;
      ranAll = !left;
      if (!left) break;
      const why = ran.stop ? 'it needed you'
        : bad ? 'it failed'
        : (await where(readable())).url !== before ? 'the URL changed'
        : startFields >= 0 && submits(batch[i + 1]!.words) && (await fields()) > startFields ? 'new fields appeared: fill them first'
        : '';
      if (why) {
        results.push(`skipped the next ${left}: ${why}`);
        break;
      }
    }
    if (parsed.cut) results.push(`not run: ${parsed.cut}`);
    if (parsed.slip) results.push(parsed.slip);
    steps.push({ command: line, result: oneLine(results.join(' ; '), MAX_STEP_RESULT), nextGoal, memory, plan, item, doneItems, note, lastStep, ran: worked, downloadsAt });
    // V1: a text all on the Sites is kept whole (search results aren't: they're not the run's pages).
    const read = takeRead();
    if (read && onSites(read.url, sites)) kept = keep(kept, read);
    const lastName = batch.at(-1)!.words[0];
    lastText = ranAll && (lastName === 'text' || lastName === 'find' || lastName === 'pick') && output ? output : '';
    acted = batch.some(({ words: [n] }) => n !== 'text' && n !== 'pick'); // read-only: the page didn't change
    print(`   ${steps.at(-1)!.result}\n   ${progress(steps)} · ${cost()}`);
  }
}

// RP1 (2.4, 2.5): repeat <step> on <numbers>, for a goal run and the MCP bridge: item 1's recorded commands on each
// item, with no AI calls. You approve the list once, and each item may start as many downloads as item 1 did; any
// other download still asks. Each command gets a CAPTCHA check and a fresh read (its names resolve on the page it's on
// now), then the caller's run with all of its own checks (Sites, stop-lines, hand-overs). It stops at the first item
// that doesn't go like item 1. Returns the step's result, or null when you stopped it; throws when refused first.
type RepeatRun = {
  steps: Pick<Step, 'ran' | 'downloadsAt'>[]; // the history <step> points into
  site: string; // the page's, for the ask
  onSites: boolean; // the page is one the agent may see; else its names stay hidden
  count: () => number; // downloads so far, on downloadsAt's scale
  allow: (n: number) => void; // RunDownloads.allowance
  news: () => Promise<string[]>; // download lines since the last call
  run: (line: string) => Promise<{ output: string | void; took?: boolean } | null>; // null: stopped
  more?: string; // after the ask (a goal run's cost)
};
async function runRepeat(args: string[], r: RepeatRun): Promise<string | null> {
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
  if (!(await askKeepGoing(`${repeatAsk(step, r.steps.length, r.site, names, perItem)}${r.more ?? ''}`, 'Repeat', 'No'))) {
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

// Runs one command line, yours or the AI's. Quoted element words are looked up as labels here, where the quotes are
// still known (click "19"). R1: click "text" that names no element clicks the shown page text reading exactly that.
function runLine(command: Command, line: string, allow: boolean, goal?: string) {
  let words: string[];
  try {
    words = parseCommand(line, numberFor);
  } catch (err) {
    const text = /^click\s+"([^"]+)"\s*$/.exec(line)?.[1];
    if (text === undefined || !(err as Error).message.startsWith('Nothing called')) throw err;
    return act(async () => {
      const frameId = await textFrame(text);
      return realMouse({ text }, allow, false, frameId, () => clickTextIn(frameId, text, allow));
    });
  }
  return command.run(words.slice(1), allow, goal, line);
}

// I1: a click (or hover) with the real mouse when it can: an element on the top page, and the debugger attached.
// The content script checks first (on screen, not covered, stop-lines unless allowed) and guards the click so it
// can't land on anything else. Otherwise, our script click (frames, a cancelled debugging bar, pages Chrome won't
// attach to). clicks and modifiers as for click x,y; the script click can't carry them, so it refuses them.
// Source: https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json
async function realMouse(target: { n?: number; text?: string }, allow: boolean, hover: boolean, frameId: number, script: () => Promise<string>, clicks: 1 | 2 = 1, modifiers = 0): Promise<string> {
  const fallback = () => {
    checkScriptClick(clicks, modifiers);
    return script();
  };
  if (frameId !== 0) return fallback();
  const tabId = await targetTabId();
  const aimed = await sendToTab({ type: 'aim', ...target, allow, hover });
  if (!aimed) return fallback();
  let sent = false;
  let blocked = '';
  try {
    const point = checkPoint(aimed);
    sent = await sendMouse(tabId, hover ? moveTo(point) : clickAtPoint(point, clicks, modifiers));
  } finally {
    // A click that navigates leaves no page to ask: nothing was stopped then.
    if (!hover) blocked = await sendToTab({ type: 'aimDone' }).catch(() => '');
  }
  if (!sent) return fallback();
  if (blocked) throw new Error(`${blocked}. Look at the page again`);
  return `${hover ? 'ok — real mouse' : clicks === 2 ? 'ok — real double-click' : 'ok — real click'}${aimed.note}`;
}

const NO_REAL_MOUSE = "No real mouse on this page (the debugging bar was cancelled, or Chrome won't attach here): clicks and drags at points need it";

// WR1: a click or drag at points in the last screenshot, with the real mouse only: a canvas has no element to fall back
// to. The content script checks both ends (stop-lines unless allowed) and guards them, as for a click.
// Round 2 (harness/mcp-context.md): checked again once the mouse is at the press point, because a page can change under
// a hovering mouse (Google Slides does): the press then lands on exactly what that second check passed. The first check
// refuses a bad point before the mouse moves at all.
async function realPoints(points: Point[], clicks: 1 | 2, modifiers: number, allow: boolean): Promise<string> {
  const tabId = await targetTabId();
  if (lastShot?.tabId !== tabId) throw new Error('No screenshot of this tab yet: x,y are pixels in the last screenshot (look takes one)');
  // Attached before the checks, so they see the page with Chrome's debugging bar, as the mouse will.
  if (!(await attach(tabId))) throw new Error(NO_REAL_MOUSE);
  const shot = { width: lastShot.width, height: lastShot.height };
  const aim = () => sendToTab({ type: 'aimPoints', points, shot, allow });
  let aimed = await aim();
  const drag = points.length > 1;
  let sent = false;
  let blocked = '';
  try {
    if (await sendMouse(tabId, moveTo(checkPoint(aimed.points[0])))) {
      aimed = await aim();
      const css = aimed.points.map(checkPoint);
      sent = await sendMouse(tabId, drag ? dragAlong(css, modifiers) : clickAtPoint(css[0]!, clicks, modifiers));
    }
  } finally {
    blocked = await sendToTab({ type: 'aimDone' }).catch(() => '');
  }
  if (!sent) throw new Error(NO_REAL_MOUSE);
  if (blocked) throw new Error(`${blocked}. Take a new screenshot`);
  return `ok — real ${drag ? 'drag' : clicks === 2 ? 'double-click' : 'click'}${aimed.note}`;
}

const NO_REAL_KEYBOARD = "No real keyboard on this page (the debugging bar was cancelled, or Chrome won't attach here): this needs it";

// WR1: a key or shortcut with the real keyboard, after the checks on what has focus, in the frame focus is in (WR2): a
// same-site frame checks its own field; another site's frame gets the top page's frame rules. Pages like Google Slides
// ignore script keys, so F's keys (Enter, Escape, Tab, Backspace, arrows) go real too, and fall back to F's script
// event, in that frame, for Escape to the panel on top or when there's no real keyboard.
async function realKey(input: string, allow: boolean): Promise<string> {
  const k = parseKey(input);
  const tabId = await targetTabId();
  const frame = (await focusedFrame()) ?? 0;
  const where = await sendToTab({ type: 'aimKey', key: input, allow }, frame);
  if (where !== null && (await sendKeys(tabId, keyEvents(k)))) return `ok — pressed ${k.name} on ${where}`;
  if (!scriptKey(k)) throw new Error(NO_REAL_KEYBOARD);
  return sendToTab({ type: 'key', key: k.key, allow }, frame);
}

// WR2: the frame focus is in, for text; never another site's frame, which no check can see into.
async function typingFrame(): Promise<number> {
  const frame = await focusedFrame();
  if (frame === null) throw new Error("Not sent: focus is inside another site's frame, which can't be checked. Click into the field first");
  return frame;
}

// WR2: the text a paste or type here was given, checked: something, and not past what a command line may carry.
function checkText(text: string, usage: string): string {
  if (!text) throw new Error(`Usage: ${usage}`);
  if (text.length > MAX_COMMAND) throw new Error(`Text too long: ${text.length} characters, at most ${MAX_COMMAND}. Split it`);
  return text;
}

// WR2: type here: text typed where the cursor is with the real keyboard's input method (Input.insertText), after the
// checks in the frame focus is in. For text boxes that aren't in the page list (a drawing app's, a slide's).
async function typeHere(text: string, allow: boolean, goal?: string): Promise<string> {
  const tabId = await targetTabId();
  const given = goal !== undefined && inGoal(text, goal);
  const where = await sendToTab({ type: 'aimText', paste: false, allow, given }, await typingFrame());
  if (!(await sendText(tabId, text))) throw new Error(NO_REAL_KEYBOARD);
  return `ok — typed ${text.length} characters into ${where}`;
}

// The element a command targets: a number (4) or a label from the last read ("Search"). Never guesses between two.
function target(arg: string | undefined, usage: string): number {
  if (!arg) throw new Error(`Usage: ${usage}`);
  // Plain digits are a number. Quoted labels, even all digits ("19"), were already looked up by parseCommand.
  if (!/^\d+$/.test(arg)) return numberFor(arg);
  const n = Number(arg);
  if (n < 1) throw new Error(`Usage: ${usage}`);
  return n;
}

// F9: true while a step's earlier commands run. A read renumbers the page's elements, so it waits for the last one:
// otherwise the step's next number could point at a different element.
let skipRead = false;
// P2: the PDF page the next step's picture shows: page 1, or the page the last text page N named on that PDF.
let pdfShown: { url: string; page: number } | null = null;
const pictured = (url: string) => (pdfShown?.url === url ? pdfShown.page : 1);
// V1: the whole text of the last text all (before capText's cut) and its page's URL; the run loop takes and keeps it.
let lastRead: Kept | null = null;
const takeRead = () => {
  const read = lastRead;
  lastRead = null;
  return read;
};

// MCP option 1 (harness/mcp-context.md): true while a bridge command runs. Its page replies say what changed since the
// last page list the agent got (bridge.page), not the whole list: the agent keeps every reply. agentRead is this
// command's read; it becomes bridge.page only once it's sent (agentCommand).
let forAgent = false;
let agentRead: string | null = null;

// Act, wait for the page to settle, then show the new state: the same loop the AI agent will use.
async function act(action: () => Promise<string>): Promise<string> {
  const result = await settleAfter(action);
  if (skipRead) return result;
  const page = await readAll(!forAgent).catch((err: Error) => `(read failed: ${err.message})`);
  return `${result}\n\n${forAgent ? agentPage(page) : page}`;
}

// A fresh read as the agent gets it: the change since its last page list, or the whole list (pageReport says when).
function agentPage(page: string): string {
  agentRead = page;
  return pageReport(bridge?.page ?? null, page);
}

// Asks the model through the local host, called straight from the panel: no background relay, so content scripts
// have no path to it. The key stays in the host; only the answer comes back.
// shortcut: one host process per ask (it re-reads the key each time); keep one port open if the loop (3.3) feels slow.
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
// Tab switches in any window. A switch during a capture means the picture may show your tab, so it's dropped (takeShot).
let tabSwitches = 0;
browser.tabs.onActivated.addListener(() => tabSwitches++);

// P1: the target tab's URL if it shows a PDF in Chrome's own viewer: the content script says so (the top page's
// contentType), or, when it can't answer, the file at the URL is a PDF. null otherwise.
async function pdfTabUrl(): Promise<string | null> {
  const url = (await browser.tabs.get(await targetTabId())).url ?? '';
  const ping = await sendToTab({ type: 'ping' }).catch(() => null);
  if (ping) return ping.contentType === 'application/pdf' ? url : null;
  return /^https?:/.test(url) && (await readPdf(url).then(() => true, () => false)) ? url : null;
}

// The goal run's downloads while it goes (the bridge's are agentDownloads), for text download.
let goalDownloads: RunDownloads | null = null;

// text download [page N]: this run's newest download you allowed (run-files.ts), a PDF or a text file, read from where
// Chrome saved it. Never a path the agent names, never a download from before the run, never a command you type.
async function readDownload(args: string[]): Promise<string> {
  const from = downloadArgs(args);
  const own = forAgent ? agentDownloads : goalDownloads;
  if (!own) throw new Error("text download reads only a run's own downloads");
  const items = (await Promise.all(own.allowed.map((id) => browser.downloads.search({ id })))).flat();
  const item = newestReadable(own.allowed, items);
  if (!item) throw new Error('No download to read: none that the user allowed in this run has finished and is still on disk');
  const name = `"${fileName(item)}"`;
  const kind = fileKind(item);
  if (!kind) throw new Error(`Can't read ${name} (${item.mime || 'unknown type'}): text download reads PDFs and text files only`);
  if (kind === 'text' && from > 1) throw new Error(`${name} isn't a PDF: send text download`);
  if (kind === 'text' && (item.fileSize < 0 || item.fileSize > MAX_TEXT_FILE)) throw new Error(`${name} is too big to read (text files up to ${MAX_TEXT_FILE / 1e6} MB)`);
  // Only you can turn this on. Source: https://developer.chrome.com/docs/extensions/reference/api/extension#method-isAllowedFileSchemeAccess
  if (!(await browser.extension.isAllowedFileSchemeAccess())) {
    throw new Error(`Can't read ${name}: Chrome's "Allow access to file URLs" is off for this extension. Ask the user to turn it on (chrome://extensions → Browser Agent → Details), then try again`);
  }
  const url = fileUrl(item.filename);
  if (kind === 'pdf') return `Download ${name}:\n${pdfText(await readPdf(url), from, 0)}`;
  return `Download ${name}:\n${capText(await (await fetch(url)).text())}`;
}

// P1: the page list for a PDF tab, in read's own header shape.
async function pdfPage(url: string, title: string): Promise<string> {
  const head = `URL: ${url}\nTitle: ${title}`;
  try {
    return `${head}\n${pdfPageLine(await readPdf(url), pictured(url))}`;
  } catch (err) {
    return `${head}\nPDF: couldn't read its text (${err instanceof Error ? err.message : String(err)}). The picture shows page ${pictured(url)}.`;
  }
}

// P2: the PDF page the picture shows, drawn from the file, or why not. A checkout URL gets none, like a screenshot;
// the caller only asks on the run's Sites.
async function pdfPicture(url: string): Promise<Shot | string> {
  if (isCheckoutUrl(url)) return 'no PDF picture: checkout or payment page';
  const page = pictured(url);
  try {
    const shot = await renderPage(url, page);
    print(`   picture: PDF page ${page}, drawn from the file`);
    return shot;
  } catch (err) {
    return `no PDF picture of page ${page} (${err instanceof Error ? err.message : String(err)}); trying a screenshot`;
  }
}

// WR1: the last screenshot's tab and size: click x,y and drag points are its pixels, what the model saw.
let lastShot: { tabId: number; width: number; height: number } | null = null;

// F1a: one screenshot of the run's tab with the latest read's numbers on it, or why there's none (F1b guards).
// pdf: a PDF tab (P1). Its viewer can't answer the frames' secret-field check, which fails closed, and a PDF has no web
// form fields to hide; every other guard (Sites, checkout page, the run's tab on screen, no switch) still applies.
async function screenshot(onPlan: boolean, pdf = false): Promise<Shot | string> {
  try {
    const tabId = await targetTabId();
    const { windowId } = await browser.tabs.get(tabId);
    // Source: https://developer.chrome.com/docs/extensions/reference/api/windows#method-getCurrent
    const panelWindow = (await browser.windows.getCurrent()).id;
    // WR1: attached first, so the picture has Chrome's debugging bar as real input will (it shows while attached and
    // 5 s after), and points in it map onto the page. A fresh attach gets a moment for the bar to come in.
    if (onPlan && (await attach(tabId)) === 'fresh') await new Promise((resolve) => setTimeout(resolve, 250));
    const shot = await takeShot(onPlan, {
      get: async () => {
        const tab = await browser.tabs.get(tabId);
        // Same window too: captureVisibleTab shoots the window's active tab, which isn't ours if ours moved away.
        // And drawn: Chrome stops drawing a window that is minimized or behind others, and a capture then returns the
        // last frame it drew, maybe of an earlier page or tab. This panel is in that window, so it's drawn only if we are.
        const drawn = windowId === panelWindow && document.visibilityState === 'visible';
        return { active: tab.active && tab.windowId === windowId && drawn, url: tab.url ?? '' };
      },
      switches: () => tabSwitches,
      numbers: pdf ? async () => '' : numbersAll,
      // PNG, so the only lossy step is shrink's one JPEG pass. Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab
      capture: () => browser.tabs.captureVisibleTab(windowId, { format: 'png' }),
    });
    if ('why' in shot) return shot.why;
    const small = await shrink(shot.dataUrl);
    lastShot = { tabId, width: small.width, height: small.height };
    return small;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function askModel(ask: Ask): Promise<Extract<Reply, { type: 'answer' }>> {
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((reply: Reply) => {
      port.disconnect();
      if (reply.type === 'error') reject(new Error(`Model: ${reply.error}`));
      else resolve(reply);
    });
    // Chrome's reason (not installed, forbidden, host crashed) is in lastError.
    port.onDisconnect.addListener(() => reject(new Error(`Model helper: ${browser.runtime.lastError?.message ?? 'disconnected'}`)));
    port.postMessage({ type: 'ask', ...ask });
  });
}

// The MCP bridge (/mcp on): a coding agent's commands come from the local helper's pipe (host/mcp.ts). Each shows
// here and runs like a typed one, with a goal run's guards: only MCP_COMMANDS, only on the bridge's Sites (a new site
// asks you first, so a tricked agent can't take your data elsewhere), never past a stop-line or a hand-over.
type Port = ReturnType<typeof browser.runtime.connectNative>;
// page: the last page list the agent got (null: none yet, so the next one goes whole). tipped: the sites whose saved
// tips the agent already got this session (F10, tipsOnce).
// steps (RP1): one per call, with what worked, for repeat <step>; each reply starts with its number.
// solved: the CAPTCHA you last resumed from (captchaHold), so a solved one still on screen doesn't ask again.
let bridge: { port: Port; sites: string[]; refused: Set<string>; page: string | null; tipped: Set<string>; steps: Pick<Step, 'ran' | 'downloadsAt'>[]; solved: string } | null = null;

// S2 for the bridge: a site off its Sites asks you first. No: refused and not asked again while the bridge is on.
async function bridgeSite(site: string, url: string): Promise<void> {
  const b = bridge;
  if (!b) throw new Error('The MCP bridge is off.');
  const id = lastCommand;
  const add = !b.refused.has(site) && await askKeepGoing(`The agent wants to use ${site} (${url.slice(0, 150)}). Add it to the bridge's Sites (${b.sites.join(', ') || 'none yet'})?`, 'Add site', 'No');
  if (id !== lastCommand) throw new Error('Stopped: the user ran another command. Ask them what to do.');
  if (add) {
    b.sites.push(site);
    return save({ mcpSites: b.sites });
  }
  b.refused.add(site);
  throw new Error(`Refused: the user said no to ${site}. Use the bridge's Sites (${b.sites.join(', ') || 'none yet'}) or ask them.`);
}

// Saves a switch for the next panel open (panel-memory.ts). A failed save only loses that, so it says so and goes on.
const save = (change: Partial<Remembered>) => remember(change).catch((err: Error) => print(`Couldn't save settings: ${err.message}`, 'error'));

// Connects to the local helper (host/mcp.ts) with these Sites. Used by mcp on and by the panel turning it back on.
function startBridge(sites: string[]): string {
  const port = browser.runtime.connectNative(HOST_NAME);
  bridge = { port, sites, refused: new Set(), page: null, tipped: new Set(), steps: [], solved: '' };
  port.onMessage.addListener((m) => void onBridge(port, m));
  // Chrome's reason (not installed, host crashed) is in lastError.
  port.onDisconnect.addListener(() => {
    if (bridge?.port !== port) return; // you turned it off
    bridge = null;
    endAgentTurn();
    print(`MCP bridge off: ${browser.runtime.lastError?.message ?? 'the local helper stopped'}`, 'error');
  });
  port.postMessage({ type: 'bridge' });
  return `MCP bridge starting. Sites: ${sites.join(', ') || 'none yet'}. Any other site asks you first.`;
}

async function onBridge(port: Port, m: { type?: string; commands?: unknown; error?: unknown }) {
  if (m.type === 'ready') return print('MCP bridge on: a coding agent can use the browser tool now.');
  if (m.type === 'error') return print(`MCP bridge: ${String(m.error)}`, 'error');
  if (m.type !== 'run') return;
  let reply: BridgeReply;
  // RP1: the call's step number goes first, so the agent can send repeat <step>; none when nothing was recorded.
  const before = bridge?.steps.length ?? 0;
  const numbered = () => ((bridge?.steps.length ?? 0) > before ? `Step ${bridge!.steps.length}.\n` : '');
  try {
    const { text, image } = await agentBatch(checkCommands(m.commands));
    const tips = await bridgeTips(); // first, so a long page can't cut them off
    reply = { type: 'output', text: (numbered() + (tips ? `${tips}\n\n${text}` : text)).slice(0, MAX_OUTPUT), ...(image && { image }) };
  } catch (err) {
    // Cut too: a stopped batch's error carries a page report, and the reply must fit the host's frame.
    reply = { type: 'error', error: (numbered() + (err instanceof Error ? err.message : String(err))).slice(0, MAX_OUTPUT) };
    print(reply.error, 'error');
  }
  if (bridge?.port === port) port.postMessage(reply); // a port you closed meanwhile can't send
}

// 4.2–4.3 for the bridge (allowOnce), as in a goal run: a stop-line asks Allow once / I'll do it, and a step you take
// over waits for your Resume. A command you start meanwhile closes the ask and stops this one.
const askYou = (keep: string, stop: string) => async (why: string): Promise<boolean> => {
  const id = lastCommand;
  const yes = await askKeepGoing(why, keep, stop);
  if (id !== lastCommand) throw new Error('Stopped: the user ran another command. Ask them what to do.');
  return yes;
};
const bridgeAsks = { allow: askYou('Allow once', "I'll do it"), resume: askYou('Resume', 'Stop') };

// 4.2 (captchaHold): true once you solved a CAPTCHA on url and pressed Resume; false if none asked. Stop ends the call.
async function bridgeCaptcha(name: string, url: string): Promise<boolean> {
  const held = await captchaHold(name, url, captchaAll, bridge?.solved ?? '');
  if (!held) return false;
  if (!(await bridgeAsks.resume(held.ask))) throw new Error('Stopped: the user pressed Stop at a CAPTCHA. Ask them what to do.');
  if (bridge) bridge.solved = held.seen;
  return true;
}

// F10: the saved tips for the site the agent's tab is on, with its first reply there this session (tipsOnce); useSite
// marks the site used. Not a guard: unreadable tips mean a reply without them, as before F10.
async function bridgeTips(): Promise<string> {
  const b = bridge;
  if (!b) return '';
  try {
    const site = siteOn((await where(b.sites)).url, b.sites);
    const tips = await tipsOnce(site, b.tipped, async (s) => (await useSite(s, Date.now())).map((t) => t.text));
    if (tips) print(`   sent the agent the saved tips for ${site}`);
    return tips;
  } catch (err) {
    print(`   saved tips unread: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return '';
  }
}

// F10: the agent's tip "<text>": checkAgentTip first (a refused tip never asks you), then Save / No. Only your Save
// keeps it; the reply tells the agent which.
async function agentTip(args: string[], site: string): Promise<AgentReply> {
  const text = checkAgentTip(args, site);
  const id = lastCommand;
  const save = await askKeepGoing(`The agent suggests a tip for ${site}: "${text}"`, 'Save', 'No');
  if (id !== lastCommand) throw new Error('Stopped: the user ran another command. Ask them what to do.');
  if (!save) return { text: 'Not saved: the user said no.' };
  const saved = await saveTip(site, text, Date.now());
  if ('why' in saved) throw new Error(`Not saved: ${saved.why}.`);
  print(`Saved for ${site} (${saved.tips.length} of ${MAX_TIPS} tips).`);
  return { text: `Saved: the user kept your tip for ${site}.` };
}

// MCP option 2 (harness/mcp-context.md): a run's commands in order, each through agentRun with all of its own checks
// (Sites, a new site's ask, stop-lines, downloads, your takeover). Only the last reads the page, so the reply has one
// change report. It stops early at an error, a new page or tab, a tab brought forward, or a command you typed: the
// rest could land on a page the agent hasn't seen. The page then comes once at the end, unless you took over.
async function agentBatch(lines: string[]): Promise<{ text: string; image?: BridgeImage }> {
  // RP1: each call is one step of the bridge's history: what worked, by label (recordLine), for a later repeat.
  const b = bridge;
  const step = { ran: [] as string[], downloadsAt: agentCreated() };
  try {
    return await batchRun(lines, step.ran);
  } finally {
    b?.steps.push(step);
  }
}

async function batchRun(lines: string[], ran: string[]): Promise<{ text: string; image?: BridgeImage }> {
  if (lines.length === 1) {
    const recorded = recordLine(lines[0]!, labelFor); // before it runs, while its number is still this read's
    const reply = await agentRun(lines[0]!);
    if (!failed(reply.text)) ran.push(recorded);
    return reply;
  }
  const problem = batchProblem(lines);
  if (problem) throw new Error(problem);
  const replies: string[] = [];
  const switches = tabSwitches;
  for (const [i, line] of lines.entries()) {
    const last = i === lines.length - 1;
    const recorded = recordLine(line, labelFor);
    const running = agentRun(line, last);
    const id = lastCommand; // taken by agentRun before its first await; a command you type bumps it
    let reply: Awaited<typeof running>;
    try {
      reply = await running;
    } catch (err) {
      replies.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
      throw new Error(batchReply(lines, replies, '', i && lastCommand === id ? await agentReport() : ''));
    }
    replies.push(reply.text);
    if (!failed(reply.text)) ran.push(recorded);
    if (last) return { text: batchReply(lines, replies), image: reply.image };
    if (lastCommand !== id) throw new Error(batchReply(lines, replies, 'Stopped: the user ran another command. Ask them what to do.'));
    const why = reply.stop ?? (tabSwitches !== switches ? 'another tab came forward' : '');
    if (why) return { text: batchReply(lines, replies, `Stopped: ${why}, so the rest could land on a page you haven't seen.`, await agentReport()) };
  }
  throw new Error('unreachable: a batch has a last command');
}

// A stopped batch's page, as the agent gets it: the change since its last list, with a command's Sites check.
async function agentReport(): Promise<string> {
  try {
    const now = await where(bridge?.sites ?? []);
    if (!now.onPlan) return `The tab is on ${now.site}, off the bridge's Sites, so its content is hidden.`;
    const report = agentPage(await readAll(false));
    if (bridge && agentRead !== null) bridge.page = agentRead; // sent with this reply
    return report;
  } catch (err) {
    return `(read failed: ${err instanceof Error ? err.message : String(err)})`;
  }
}

// D1, D2 for the bridge: from the agent's first command until you take over (a command you type, or the bridge stops),
// every download is the agent's: paused until you say yes. Not only during a command: a page can start one seconds
// after the click.
let agentDownloads: RunDownloads | null = null;
// RP1: downloads counted by earlier agent turns, so agentCreated never goes back (the bridge's downloadsAt).
let agentDownloadsBefore = 0;
const agentCreated = () => agentDownloadsBefore + (agentDownloads?.created ?? 0);

function endAgentTurn() {
  if (agentDownloads) {
    agentDownloadsBefore += agentDownloads.created;
    unwatch(agentDownloads);
  }
  agentDownloads = null;
}

// What one agent command gives back. stop: why a batch's next commands mustn't run (a new page, a new tab, off the Sites).
type AgentReply = { text: string; image?: BridgeImage; stop?: string };

// last: false for a batch's earlier commands, which don't read the page (agentBatch).
async function agentRun(line: string, last = true): Promise<AgentReply> {
  print(`agent> ${line}`);
  // Like a command you type: closes an open ask and stops a goal run first.
  closeAsk('Closed, nothing ran: the agent sent a command.');
  const id = ++lastCommand;
  await runEnded;
  // Like a goal run: a command you type waits until this one has fully stopped, its downloads asked about.
  return inRunTab(null, async () => {
    if (!agentDownloads) browser.downloads.onCreated.addListener((agentDownloads = new RunDownloads()).onCreated);
    const downloads = agentDownloads;
    const late = await downloads.report(askDownload); // started after its last command ended
    if (id !== lastCommand) throw new Error('Stopped: the user ran another command. Ask them what to do.');
    let reply: AgentReply | undefined;
    let error: unknown;
    try {
      reply = await agentCommand(line, last);
    } catch (err) {
      error = err;
    }
    // D1: a download doesn't change the page, so this line is all the agent learns of it, failed command or not.
    const news = [...late, ...(await downloads.report(askDownload))].join('\n');
    if (news) print(`   ${news.replaceAll('\n', '\n   ')}`);
    if (!reply) throw news ? new Error(`${error instanceof Error ? error.message : String(error)}\n${news}`) : error;
    return news ? { ...reply, text: `${reply.text}\n${news}` } : reply;
  });
}

// RP1 2.5: repeat over the bridge (runRepeat). <step> is a bridge call ("Step N." starts each reply). Each recipe
// command goes through agentCommand with all of its checks, without a read: only the page report at the end is the
// agent's, so the change it gets is from the last page it saw.
async function bridgeRepeat(args: string[]): Promise<string> {
  const b = bridge;
  const d = agentDownloads; // agentRun made it for this command
  if (!b || !d) throw new Error('The MCP bridge is off.');
  const now = await where(b.sites);
  const result = await runRepeat(args, {
    steps: b.steps,
    site: now.site,
    onSites: now.onPlan,
    count: agentCreated,
    allow: (n) => void (d.allowance = n),
    news: () => d.report(askDownload),
    run: async (line) => {
      try {
        return { output: (await agentCommand(line, false)).text };
      } catch (err) {
        return { output: `Error: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
  if (result === null) throw new Error('Stopped: the user ran another command. Ask them what to do.');
  return `${result}\n\n${await agentReport()}`;
}

async function agentCommand(line: string, last: boolean): Promise<AgentReply> {
  const [name = '', ...args] = parseCommand(line);
  if (name === 'help') return { text: MCP_COMMANDS.map((n) => `${n} — ${n === 'look' ? LOOK_HELP : n === 'tip' ? TIP_HELP : commands[n]!.help}`).join('\n') };
  if (!MCP_COMMANDS.includes(name)) throw new Error(`Not a command you can use: ${name.slice(0, 50)}. Send help for the list.`);
  const sites = bridge?.sites ?? [];
  // #16: one command, one tab. Its checks, action and read all go to the tab it started on, even if another comes
  // forward meanwhile. Not back: with no earlier page it goes to the tab that opened this one (#15). The pin ends with
  // the command (inRunTab).
  const from = await targetTabId();
  if (name !== 'back') pinTab(from);
  // Checked right before acting: you may have switched tabs, or a click may have left the Sites. back and goto (to
  // the Sites only, checked below) get it home.
  const now = await where(sites);
  // F10: a tip is for the site the tab is on, and never asks to add one.
  if (name === 'tip') return agentTip(args, siteOn(now.url, sites));
  if (!now.onPlan && name !== 'back' && name !== 'goto') {
    const site = siteToAdd(now.url, sites);
    if (!site) throw new Error(`Blocked: this tab (${now.site}) isn't a web page you can use. Use goto.`);
    await bridgeSite(site, now.url);
  }
  // 4.2 (captchaHold). After the Sites check, so a site just added is checked too. "Refused" keeps it out of repeat's history.
  if (await bridgeCaptcha(name, now.url)) {
    return { text: "Refused: a CAPTCHA was on the page; the user solved it and pressed Resume. Your command didn't run: read the page, then send it again if it's still needed.", stop: 'the user solved a CAPTCHA' };
  }
  if (name === 'repeat') return { text: await bridgeRepeat(args) };
  if (name === 'pause') {
    if (await askResume(args)) return { text: 'The user pressed Resume. Report what the page shows now, not what you expect.' };
    throw new Error('The user pressed Stop. Stop and ask them what to do.');
  }
  // #8: a tab this command's page opens (a link with target=_blank) is followed: the next commands go to it.
  let opened: number | undefined;
  const onCreated = (tab: Browser.tabs.Tab) => {
    if (tab.openerTabId === from) opened = tab.id;
  };
  browser.tabs.onCreated.addListener(onCreated);
  let output: string | void;
  let image: BridgeImage | undefined;
  forAgent = true;
  agentRead = null;
  skipRead = !last; // F9's pattern: in a batch only the last command reads, so the reply has one change report
  try {
    if (name === 'goto') {
      // Only a new site's bare home page asks: a path or query could carry page data to a site you never added.
      const newSite = siteToOpen(args[0], sites);
      if (newSite) await bridgeSite(newSite, args[0]!);
      const href = checkGoto(args[0], sites);
      output = await allowOnce(async (allow) => {
        if (!allow && isCheckoutUrl(href)) throw new StopLine(`Stop-line: goto ${href} (checkout page)`);
        return commands.goto!.run([href], allow);
      }, bridgeAsks);
    } else if (name === 'look') {
      if (args.length) throw new Error('Usage: look (no arguments)');
      const read = agentPage(await readAll(false));
      // Right after the read, so the picture's numbers are this read's. Every guard of a goal step's picture applies.
      const shot = lookShot(await screenshot((await where(sites)).onPlan));
      output = `${shot.line}\n\n${read}`;
      image = shot.image;
    } else if (name === 'read') {
      output = agentRead = await readAll(false); // always the whole list
    } else {
      // The re-read isn't the agent's: agentRead and bridge.page stay as they were.
      output = await allowOnce(async (allow) => {
        // As in a goal run: downloads that start during an Allow once command are part of what you allowed.
        if (agentDownloads) agentDownloads.allowing = allow;
        try {
          return await retryUnlisted(async () => runLine(commands[name]!, line, allow), () => readAll(false));
        } finally {
          if (agentDownloads) agentDownloads.allowing = false;
        }
      }, bridgeAsks);
    }
  } catch (err) {
    // allowOnce took the first try's stop-line or hand-over; one from the allowed try (or goto's site ask) ends here.
    if (err instanceof StopLine || err instanceof HandOver) throw new Error(`${err.message}. Not done: tell the user to do this step by hand.`);
    throw err;
  } finally {
    forAgent = false;
    skipRead = false;
    browser.tabs.onCreated.removeListener(onCreated);
    await detachAll(); // I1: the debugger is attached only while a command goes
  }
  // #14: once loaded, so the next read sees its page, not a blank tab.
  let followed = false;
  if (opened !== undefined && (await follow(opened, from))) {
    pinTab(opened); // the Sites check below is of the new tab
    followed = true;
  }
  // A click can land off the Sites (here or in the new tab): that page's text stays here, like a redirect's.
  // In both returns below the read isn't sent, so bridge.page stays the last list the agent got.
  const after = await where(sites);
  if (!after.onPlan) return { text: `Done, but ${followed ? 'it opened a new tab' : 'the tab is now'} on ${after.site}, off the bridge's Sites, so its content is hidden. Use back, or send read to ask the user to add it.`, stop: "the tab left the bridge's Sites" };
  // 4.2: a CAPTCHA this command brought (goto onto a Turnstile page) waits for you now, not at the next call. The read
  // in output is of the page before you solved it, so it isn't sent.
  if (await bridgeCaptcha('', after.url)) {
    return { text: `${(output || 'ok').split('\n')[0]} — then a CAPTCHA showed; the user solved it and pressed Resume. Read the page to see it now.`, stop: 'the user solved a CAPTCHA' };
  }
  // The read in output is of the old tab: the agent reads the new one next.
  if (followed) output = `${(output || 'ok').split('\n')[0]} — it opened a new tab, now the current one: ${after.url}. Send read to see it (text page 1 if it's a PDF).`;
  else if (bridge && agentRead !== null) bridge.page = agentRead;
  if (output) print(output);
  const stop = followed ? 'it opened a new tab' : pagePath(now.url) !== pagePath(after.url) ? 'a new page loaded' : undefined;
  return { text: output || 'ok', image, ...(stop && { stop }) };
}

// All console commands. To add one, add an entry here.
const commands: Record<string, Command> = {
  help: {
    help: 'list commands',
    run: () => ['Type what you want in plain words. To drive by hand, start with /:', ...Object.entries(commands).map(([name, c]) => `/${name} — ${c.help}`)].join('\n'),
  },
  clear: {
    help: 'empty the output',
    run: () => out.replaceChildren(),
  },
  echo: {
    help: 'print each argument on its own line',
    run: (args) => args.join('\n'),
  },
  ping: {
    help: "show the current tab's title and URL",
    run: async () => {
      const { title, url } = await sendToTab({ type: 'ping' });
      return `${title}\n${url}`;
    },
  },
  read: {
    help: 'list what you can click or type into on the page',
    run: () => readAll(),
  },
  text: {
    help: 'text [all | page N | download [page N]] — show the plain text on screen, like dates and prices (iframes included); text all reads the whole page, not just the screen; text page N reads a PDF from page N on and puts that page in the next picture; text download reads the newest file this run downloaded with the user\'s ok (a PDF, from page N, or a text file)',
    run: async (args) => {
      if (args[0] === 'download') return readDownload(args.slice(1));
      const { all, page } = textArgs(args); // the AI writes these words, so anything else is refused
      const pdf = await pdfTabUrl(); // P1: a PDF's text comes from its file, all of it either way
      let text: string;
      if (pdf) {
        const doc = await readPdf(pdf);
        if (page !== undefined) {
          if (page > doc.total) throw new Error(`Usage: text page 1 to ${doc.total}: the PDF has ${doc.total} pages`);
          pdfShown = { url: pdf, page }; // P2: the next step's picture
        }
        text = pdfText(doc, page ?? 1, pictured(pdf));
      } else {
        if (page !== undefined) throw new Error('text page N works on a PDF tab only: use text all or find here');
        const full = await textAll(all);
        if (all && full) lastRead = { url: (await browser.tabs.get(await targetTabId())).url ?? '', pages: [full] };
        text = capText(full) || `(no text ${all ? 'on the page' : 'on screen'})`;
      }
      // Debug footer, like read's. Tokens ≈ characters ÷ 4.
      return `${text}\n(~${Math.round(text.length / 4)} tokens)`;
    },
  },
  find: {
    help: 'find "text" [n] — search the whole page\'s visible text (case and spaces ignored), scroll to match n (default 1) and list up to 5 matches',
    run: async ([query, nArg]) => {
      // The AI writes these args, so they're checked like any other input from it.
      if (!query?.trim() || query.length > 100 || (nArg !== undefined && !/^[1-9]\d{0,3}$/.test(nArg))) {
        throw new Error('Usage: find "text" [n], e.g. find "16 GB" or find "16 GB" 2 (text up to 100 characters)');
      }
      const pdf = await pdfTabUrl(); // P1: searched in the PDF's own text
      return pdf ? pdfFind(await readPdf(pdf), query) : sendToTab({ type: 'find', query, nth: Number(nArg ?? 1) });
    },
  },
  pick: {
    help: 'pick like <n|"label"> — list everything on the whole page built like element n (all showtimes, results, prices), grouped by the box each sits in; pick "css selector" does the same by CSS, e.g. pick "table tr". Text only; numbered ones can be clicked',
    // The AI writes these args, so they're checked here; a selector's syntax is checked on the page.
    run: async (args) => {
      if (await pdfTabUrl()) return 'This tab shows a PDF: read it with text all, or find "words".';
      const by = pickArgs(args);
      if ('css' in by) return pickInFrames(by.css);
      const n = target(by.like, 'pick like <number|"label">, e.g. pick like 14');
      return sendToTab({ type: 'pickLike', n }, frameFor(n))
        .then((r) => r || `Nothing to list for [${n}]: it has no visible text of its own, or holds a secret field. Pick one with text, like a showtime or a title.`);
    },
  },
  click: {
    help: 'click <n|"label"|x,y> [double] [shift|ctrl|alt|meta] — click element n (or the one with that name, else the shown page text reading exactly that) from the last read; or click the spot x,y in pixels of the last screenshot, for canvases and drawings (click 640,360 double)',
    run: ([nArg, ...flags], allow) => {
      const { clicks, modifiers } = mouseFlags(flags, true, 'click <n|"label"|x,y> [double] [shift|ctrl|alt|meta], e.g. click 4 shift or click 640,360 double');
      const at = parsePoint(nArg ?? '');
      if (at) return act(() => realPoints([at], clicks, modifiers, allow));
      const n = target(nArg, 'click <number|"label"|x,y>, e.g. click 4, click "Search" or click 640,360');
      return act(() => realMouse({ n }, allow, false, frameFor(n), () => sendToTab({ type: 'click', n, allow }, frameFor(n)), clicks, modifiers));
    },
  },
  hover: {
    help: 'hover <n|"label"> — move the mouse over element n (opens hover menus made with JavaScript)',
    run: ([nArg]) => {
      const n = target(nArg, 'hover <number|"label">, e.g. hover 7');
      return act(() => realMouse({ n }, false, true, frameFor(n), () => sendToTab({ type: 'hover', n }, frameFor(n))));
    },
  },
  type: {
    help: 'type <n|"label"> "text" [enter] [slow] — type into field n; enter also presses Enter, slow types letter by letter. type here <text> types the rest of the line, as is, where the cursor is: for a text box you opened by clicking or double-clicking (a shape label, a slide text)',
    run: ([nArg, text, ...flags], allow, goal, line) => {
      if (nArg === 'here') return act(() => typeHere(checkText(restOf(line ?? '', 2), 'type here <text>'), allow, goal));
      const usage = 'type <number|"label"> "text" [enter] [slow], e.g. type 3 "new york" enter';
      const n = target(nArg, usage);
      if (text === undefined || flags.some((f) => f !== 'enter' && f !== 'slow')) throw new Error(`Usage: ${usage}`);
      const given = goal !== undefined && inGoal(text, goal);
      return act(() => sendToTab({ type: 'type', n, text, enter: flags.includes('enter'), slow: flags.includes('slow'), allow, given }, frameFor(n)));
    },
  },
  select: {
    help: 'select <n|"label"> "option" — pick an option in dropdown n (real <select> only)',
    run: ([nArg, option], allow, goal) => {
      const usage = 'select <number|"label"> "option", e.g. select 5 "Price: low to high"';
      const n = target(nArg, usage);
      if (option === undefined) throw new Error(`Usage: ${usage}`);
      const given = goal !== undefined && inGoal(option, goal);
      return act(() => sendToTab({ type: 'select', n, option, allow, given }, frameFor(n)));
    },
  },
  scroll: {
    help: 'scroll up|down|left|right [n|"label"] — scroll the page, or the box around element n (left|right: a box that scrolls sideways, like a wide table)',
    run: ([dir, nArg]) => {
      const usage = 'scroll up|down|left|right [number|"label"], e.g. scroll down or scroll right 12';
      if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') throw new Error(`Usage: ${usage}`);
      const n = nArg === undefined ? undefined : target(nArg, usage);
      return act(() => sendToTab({ type: 'scroll', dir, n }, n === undefined ? 0 : frameFor(n)));
    },
  },
  drag: {
    help: 'drag x,y x,y [x,y …] [shift|ctrl|alt|meta] — press the mouse at the first spot, move through the others, let go at the last (pixels of the last screenshot): draws shapes and lines, moves and resizes things (drag 100,200 300,400)',
    run: (args, allow) => {
      const usage = `drag x,y x,y [x,y …] (up to ${MAX_POINTS}) [shift|ctrl|alt|meta], e.g. drag 100,200 300,400`;
      const points = args.map(parsePoint);
      const count = points.findIndex((p) => !p);
      const pts = (count < 0 ? points : points.slice(0, count)) as Point[];
      if (pts.length < 2 || pts.length > MAX_POINTS) throw new Error(`Usage: ${usage}`);
      const { modifiers } = mouseFlags(args.slice(pts.length), false, usage);
      return act(() => realPoints(pts, 1, modifiers, allow));
    },
  },
  paste: {
    help: 'paste <text> — paste the rest of the line, as is (quotes and all), where focus is: for what an app reads on paste, like a drawing app JSON. Your own clipboard is not used',
    run: (_args, allow, goal, line) => {
      const text = checkText(restOf(line ?? '', 1), 'paste <text>, e.g. paste {"type":"…"}');
      const given = goal !== undefined && inGoal(text, goal);
      return act(async () => sendToTab({ type: 'pasteText', text, allow, given }, await typingFrame()));
    },
  },
  key: {
    help: 'key <Key> — press a key or shortcut where focus is: Enter, Escape, Tab, Backspace, Delete, Space, an arrow, a letter or digit (tool keys like r), F1–F12, or a combo like ctrl+z, ctrl+shift+z, shift+Tab. Not for typing text: use type',
    run: ([k], allow) => {
      if (!k) throw new Error('Usage: key <Key>, e.g. key Escape or key ctrl+z');
      parseKey(k); // a bad key name fails here, before the page is touched
      return act(() => realKey(k, allow));
    },
  },
  goto: {
    help: 'goto <url> — open a URL in this tab (http/https only)',
    run: ([url]) => act(() => goto(url ?? '')),
  },
  search: {
    help: 'search "words" — look the words up on DuckDuckGo; in a run the user sees them first and the results open in a new tab',
    run: (args) => act(() => goto(searchUrl(args.join(' ')))),
  },
  back: {
    help: 'go back one page (in a tab a link opened, back to the tab that opened it)',
    run: () => act(back),
  },
  tab: {
    help: 'tab new <url> | tab <n> | tab close <n> — open a page on the run\'s Sites in a new tab, switch to one of the run\'s tabs, or close one it opened',
    // Typing any command ends a run, so by hand there are no run tabs to use.
    run: () => {
      throw new Error('tab is for the agent during a goal run: it works in its own tabs, never yours');
    },
  },
  repeat: {
    help: `repeat <step> on <numbers> — once item 1 of a list is fully done, redo its commands (from step <step> of your history to your last step) on each other item, by their numbers in the current page list (usually from a pick like item 1 just before), 1 to ${MAX_REPEAT_ITEMS} items, e.g. repeat 5 on 15-23 or repeat 5 on 15, 17, 20-23. Step <step> must start with item 1's click. The user approves the list once; it runs with no AI steps and stops at the first item that doesn't go like item 1, saying which are done and left`,
    run: async () => {
      throw new Error("repeat works only inside a goal: it redoes steps of the agent's history");
    },
  },
  pause: {
    help: 'pause "reason" — stop and hand the page to the user (sign-in, CAPTCHA, a choice only they can make); they press Resume when done',
    run: async (args) => {
      await askResume(args);
    },
  },
  goal: {
    help: `goal "what you want" — the agent starts at once and plans as it goes. Sites: the ones your goal names, else this tab's; any other asks you. Step budget ${STEP_BUDGET}, then +N asks you; stop-lines ask you; any command stops it`,
    // G1: no plan to approve first (frontier agents plan as they go). Sites stay enforced in code from the first step.
    run: async (args) => {
      const goal = args.join(' ');
      if (!goal) throw new Error('Usage: goal "what you want", e.g. goal "open the Alan Turing article and read his birth date"');
      const tab = await browser.tabs.get(await targetTabId());
      const sites = startSites(goal, tab.url);
      print(`Sites: ${sites.join(', ') || 'none yet'}. The agent asks you before using any other site.`);
      const done = await runGoal(goal, sites);
      const pass = passedRun;
      passedRun = null;
      if (!pass) return done;
      // F10: tips are asked after the run's Done line, with the run's tab and debugger let go.
      print(done);
      await detachAll();
      await offerTips(pass);
    },
  },
  stop: {
    help: 'stop a running goal (any other command stops it too)',
    run: () => {},
  },
  tips: {
    help: 'tips — the tips you saved for each site, with Delete buttons. The agent reads a site\'s tips only while it works there',
    run: async () => {
      const sites = await listSites();
      if (!sites.length) return 'No saved tips yet. After a run passes its done check, you can save tips for its site.';
      // A Delete button: once it worked, its line says what went. Tips go by their text (deleteTip), so an old list is safe.
      const deleter = (line: HTMLElement, label: string, job: () => Promise<void>, gone: string) =>
        Object.assign(document.createElement('button'), {
          type: 'button',
          textContent: label,
          onclick: () => job().then(() => line.replaceChildren(gone), (err: Error) => print(`Not deleted: ${err.message}`, 'error')),
        });
      for (const { site, tips } of sites) {
        const block = Object.assign(document.createElement('div'), { className: 'tips' });
        const head = document.createElement('div');
        head.append(`${site} (${tips.length} of ${MAX_TIPS} tips) `, deleter(block, 'Delete all', () => deleteSite(site), `${site}: all tips deleted.`));
        block.append(head, ...tips.map((t) => {
          const line = document.createElement('div');
          line.append(`- ${t.text} `, deleter(line, 'Delete', () => deleteTip(site, t.text), `- deleted: ${t.text}`));
          return line;
        }));
        out.append(block);
      }
      out.scrollTop = out.scrollHeight;
      return `${sites.length} site(s) with saved tips.`;
    },
  },
  model: {
    help: 'model ["question"] — ask the small model through the local helper (tests the setup)',
    run: async ([question = 'Say OK.']) => {
      const r = await askModel({ model: JUDGE, max_tokens: 300, messages: [{ role: 'user', content: question }] });
      return `${r.text}\n(${r.stop_reason} · ${r.usage.input_tokens} tokens in, ${r.usage.output_tokens} out)`;
    },
  },
  mcp: {
    help: "mcp on [sites…] | off — let a coding agent (Claude Code, Codex…) drive this browser. Any other site than its Sites asks you first. mcp on adds this tab's site to the saved Sites; mcp on <sites> sets exactly those. On/off and Sites are remembered when you close the panel. Its commands show here; stop-lines ask you first (Allow once, or do it yourself and press Resume)",
    run: async ([on, ...named]) => {
      if (on === 'off') {
        await save({ mcpOn: false }); // also after a crash, so the next panel open doesn't turn it back on
        if (!bridge) return 'MCP bridge is already off.';
        bridge.port.disconnect();
        bridge = null;
        return 'MCP bridge off.';
      }
      if (on !== 'on') throw new Error('Usage: mcp on [sites…] | mcp off');
      // No sites named: the saved Sites plus this tab's, if it shows a web page (each new site asks you).
      const sites = named.length
        ? named.map((s) => siteToAdd(`https://${s}/`, []))
        : [...new Set([...(await recall()).mcpSites, siteToAdd((await browser.tabs.get(await targetTabId())).url, [])])].filter(Boolean);
      if (sites.some((s) => !s)) throw new Error('Usage: mcp on [amazon.in wikipedia.org…] (site names)');
      await save({ mcpOn: true, mcpSites: sites });
      if (bridge) {
        bridge.sites = sites;
        return `MCP bridge Sites: ${sites.join(', ') || 'none yet'}.`;
      }
      return startBridge(sites);
    },
  },
  overlay: {
    help: 'overlay on|off — draw element numbers on every page you read (remembered when you close the panel)',
    run: async (args) => {
      if (args[0] !== 'on' && args[0] !== 'off') throw new Error('Usage: overlay on|off');
      setOverlayOn(args[0] === 'on');
      await save({ overlayOn: args[0] === 'on' });
      return sendToAllFrames({ type: 'overlay', on: args[0] === 'on' });
    },
  },
};

// F10: saved site tips unused for 180 days (or the least used, over 8 MB) are removed each time the panel opens.
pruneSites(Date.now()).catch((err: Error) => print(`Couldn't tidy saved site tips: ${err.message}`, 'error'));

// Turns back on what you left on (panel-memory.ts): the MCP bridge with its saved Sites, and the overlay.
recall().then(async ({ mcpOn, mcpSites, overlayOn }) => {
  if (mcpOn && !bridge) print(`Remembered from last time: ${startBridge(mcpSites)}`);
  // A tab with no page to draw on (chrome://, the Web Store) just stays as it is; the next /overlay on draws it.
  if (!overlayOn) return;
  setOverlayOn(true);
  await sendToAllFrames({ type: 'overlay', on: true }).catch(() => {});
}).catch((err: Error) => print(`Couldn't read saved settings: ${err.message}`, 'error'));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const line = input.value.trim();
  input.value = '';
  if (!line) return;
  closeAsk('Closed, nothing ran: you moved on.');
  print(`> ${line}`);
  // Stop a goal run and wait until it has: it finishes its current step in its own tab and unpins, so what you type
  // goes to the tab you're looking at.
  lastCommand++;
  await runEnded;
  endAgentTurn(); // what you do from here is yours, downloads included

  // You talk in plain words: that's always a goal (it only writes a plan; nothing touches the page before Run).
  // Commands are the agent's hands and eyes; type them with / to drive by hand, so a sentence never runs one by accident.
  if (!line.startsWith('/')) return runAndPrint((allow) => commands.goal!.run([line], allow));
  const [name = ''] = parseCommand(line.slice(1));
  // hasOwn so names like "toString" don't match built-in object methods.
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command) return print(`Unknown command "/${name}". Type /help.`, 'error');

  // Re-parsed inside, so a quoted label that matches nothing prints as an error like any other.
  await runAndPrint((allow) => runLine(command, line.slice(1), allow));
});
