// Side panel: drive the browser by hand with /commands, and run a coding agent's commands (/mcp on). Output appears above; errors in red.
// Inter, shipped inside the extension (no font request leaves it). Source: https://www.npmjs.com/package/@fontsource-variable/inter
import '@fontsource-variable/inter/wght.css';
import './style.css';
import { checkGoto, oneLine, onSites, siteOn, siteToAdd, siteToOpen, wantsSite } from '@/lib/agent-prompt';
import { fileName, RunDownloads } from '@/lib/downloads';
import { captchaAll, clickTextIn, focusedFrame, frameFor, textFrame, labelFor, nameFor, numberFor, numbersAll, pickInFrames, readAll, sendToAllFrames, setOverlayOn, textAll } from '@/lib/frames';
import { allowOnce, batchProblem, batchReply, captchaHold, checkAgentTip, checkCommands, LOOK_HELP, lookShot, MAX_COMMAND, MAX_OUTPUT, MCP_COMMANDS, retryUnlisted, showsPage, TIP_HELP, tipsOnce, type BridgeImage, type BridgeReply } from '@/lib/bridge';
import { HOST_NAME } from '@/lib/host-install';
import { HandOver, StopLine } from '@/lib/messages';
import { back, follow, goto, pinTab, targetTabId } from '@/lib/navigation';
import { pageReport } from '@/lib/page-diff';
import { capText, textArgs } from '@/lib/page-text';
import { parseCommand, restOf } from '@/lib/parse-command';
import { shownLine, splitReply } from '@/lib/readable-log';
import { pickArgs } from '@/lib/pick';
import { readPdf } from '@/lib/pdf';
import { downloadsSince, failed, filesLine, forItem, item1On, itemMiss, itemTarget, MAX_REPEAT_ITEMS, notAlikeError, parseRepeat, recipeFrom, recordLine, repeatAsk, repeatDone, stoppedAt } from '@/lib/repeat';
import { pdfFind, pdfText } from '@/lib/pdf-text';
import { downloadArgs, fileKind, fileUrl, MAX_TEXT_FILE, newestReadable } from '@/lib/run-files';
import { attach, checkPoint, checkScriptClick, clickAtPoint, detachAll, dragAlong, MAX_POINTS, mouseFlags, moveTo, parsePoint, sendKeys, sendMouse, sendText, type Point } from '@/lib/real-input';
import { keyEvents, parseKey, scriptKey } from '@/lib/keys';
import { shrink, takeShot, type Shot } from '@/lib/screenshot';
import { searchUrl } from '@/lib/search';
import { sendToTab } from '@/lib/send-to-tab';
import { settleAfter } from '@/lib/settle';
import { listSites, pruneSites, saveTip, useSite } from '@/lib/site-store';
import { recall, remember, type Remembered } from '@/lib/panel-memory';
import { MAX_TIPS } from '@/lib/site-tips';
import { isCheckoutUrl } from '@/lib/stop-lines';
import { clearLog, closeStep, leaveStep, openStep, show, swap, type Item, type Step } from './log';
import { slashMenu } from './slash-menu';

// allow: run past a stop-line. Only the Allow once button passes true, never a typed command.
// line: the whole command line as typed, for commands that take the rest of it as is (paste, type here).
type Command = { help: string; run: (args: string[], allow: boolean, line?: string) => string | void | Promise<string | void> };

const form = document.querySelector('form')!;
const input = form.querySelector('input')!;

function print(text: string, className = '') {
  show({ kind: 'line', text, className });
}

// The command box's bottom row ("MCP" + this word). starting: the local helper is connecting; on: it said ready.
const mcpStatus = document.querySelector<HTMLElement>('#mcp')!;
function showMcp(state: 'off' | 'starting' | 'on') {
  mcpStatus.dataset.state = state;
  mcpStatus.querySelector('.mcp-state')!.textContent = state;
}

// The open choice: a stop-line's Allow once / I'll do it, or a run's pause. Valid only until another command starts:
// a new read renumbers elements, and an old Allow must never land on a different element.
let pendingAsk: Item | null = null;
let lastCommand = 0; // counts started commands, so a late stop-line can tell another one ran meanwhile
let onAskClosed: (() => void) | null = null; // a paused run waiting on the open ask: closing it any other way ends that run

function closeAsk(note: string) {
  if (!pendingAsk) return;
  swap(pendingAsk, { kind: 'line', text: note });
  pendingAsk = null;
  onAskClosed?.();
  onAskClosed = null;
}

// Asks you mid-command (4.1 pause, 4.3 stop-lines, a new site, a download): the keep button goes on; the other button,
// or any command you start, resolves false (a command also bumps lastCommand, so the caller can tell "I'll do it" from
// being stopped). Focus stays in the command box, so a reflex Enter can never press Allow.
function askKeepGoing(message: string, keepLabel = 'Keep going', stopLabel = 'Stop'): Promise<boolean> {
  print(message, 'stop');
  return new Promise((resolve) => {
    onAskClosed = () => resolve(false);
    pendingAsk = show({
      kind: 'ask',
      buttons: [
        {
          label: keepLabel,
          // A promise settles once: Keep going's true wins over the false that closeAsk sends right after.
          onClick: () => {
            resolve(true);
            closeAsk('Going on.');
          },
        },
        { label: stopLabel, onClick: () => closeAsk(stopLabel === 'Stop' ? 'Stopped.' : `${stopLabel}.`) },
      ],
    });
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
  // Focus stays in the command box, so a reflex Enter can never press Allow.
  pendingAsk = show({
    kind: 'ask',
    buttons: [
      {
        label: 'Allow once',
        onClick: () => {
          closeAsk('Allowed once.');
          void runAndPrint(run, true);
        },
      },
      { label: "I'll do it", onClick: () => closeAsk('Cancelled. This step is yours: do it by hand on the page.') },
    ],
  });
}

// Where the run's tab is (its URL and site name) and whether that's one of the run's Sites.
async function where(sites: string[]): Promise<{ onPlan: boolean; site: string; url: string; title: string }> {
  const tab = await browser.tabs.get(await targetTabId());
  return { onPlan: onSites(tab.url, sites), site: (tab.url && URL.parse(tab.url)?.hostname) || 'this page', url: tab.url ?? '', title: tab.title ?? '' };
}

// The tab's top document: a real page load makes a new one, a script's own URL change (pushState) keeps it. '' unknown.
// Source: https://developer.chrome.com/docs/extensions/reference/api/webNavigation#method-getFrame
const topDocument = (tabId: number) => browser.webNavigation.getFrame({ tabId, frameId: 0 }).then((f) => f?.documentId ?? '', () => '');

// Settles once the agent's command has fully stopped. A command you type waits for it, so the agent's last step can't
// land on your tab after the pin is gone, and your command can't land on the agent's tab.
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
  if (!(await askKeepGoing(repeatAsk(step, r.steps.length, r.site, names, perItem), 'Repeat', 'No'))) {
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

// Runs one command line, yours or the agent's. Quoted element words are looked up as labels here, where the quotes are
// still known (click "19"). R1: click "text" that names no element clicks the shown page text reading exactly that.
function runLine(command: Command, line: string, allow: boolean) {
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
  return command.run(words.slice(1), allow, line);
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
async function typeHere(text: string, allow: boolean): Promise<string> {
  const tabId = await targetTabId();
  const where = await sendToTab({ type: 'aimText', paste: false, allow }, await typingFrame());
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

// text download [page N]: the agent's newest download you allowed (run-files.ts), a PDF or a text file, read from where
// Chrome saved it. Never a path the agent names, never a download from before its turn, never a command you type.
async function readDownload(args: string[]): Promise<string> {
  const from = downloadArgs(args);
  const own = forAgent ? agentDownloads : null;
  if (!own) throw new Error("text download reads only the agent's own downloads");
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
  if (kind === 'pdf') return `Download ${name}:\n${pdfText(await readPdf(url), from)}`;
  return `Download ${name}:\n${capText(await (await fetch(url)).text())}`;
}

// WR1: the last screenshot's tab and size: click x,y and drag points are its pixels, what the model saw.
let lastShot: { tabId: number; width: number; height: number } | null = null;

// F1a: look's screenshot of the agent's tab with the latest read's numbers on it, or why there's none (F1b guards).
async function screenshot(onPlan: boolean): Promise<Shot | string> {
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
      numbers: numbersAll,
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

// The MCP bridge (/mcp on): a coding agent's commands come from the local helper's pipe (host/mcp.ts). Each shows
// here and runs like a typed one, with the agent's guards: only MCP_COMMANDS, only on the bridge's Sites (a new site
// asks you first, so a tricked agent can't take your data elsewhere), never past a stop-line or a hand-over.
type Port = ReturnType<typeof browser.runtime.connectNative>;
// RP1: one bridge call: its commands that worked, by label (recordLine), and the downloads count when it began.
type BridgeStep = { ran?: string[]; downloadsAt?: number };
// page: the last page list the agent got (null: none yet, so the next one goes whole). tipped: the sites whose saved
// tips the agent already got this session (F10, tipsOnce).
// steps (RP1): one per call, with what worked, for repeat <step>; each reply starts with its number.
// solved: the CAPTCHA you last resumed from (captchaHold), so a solved one still on screen doesn't ask again.
let bridge: { port: Port; sites: string[]; refused: Set<string>; page: string | null; tipped: Set<string>; steps: BridgeStep[]; solved: string } | null = null;

// S2 for the bridge: a site off its Sites asks you first. No: refused and not asked again while the bridge is on.
async function bridgeSite(site: string, url: string): Promise<void> {
  const b = bridge;
  if (!b) throw new Error('The MCP bridge is off.');
  const id = lastCommand;
  const add = !b.refused.has(site) && await askKeepGoing(`${wantsSite(site, url)}. Add ${site} to the bridge's Sites (${b.sites.join(', ') || 'none yet'})?`, 'Add site', 'No');
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
  showMcp('starting');
  port.onMessage.addListener((m) => void onBridge(port, m));
  // Chrome's reason (not installed, host crashed) is in lastError.
  port.onDisconnect.addListener(() => {
    if (bridge?.port !== port) return; // you turned it off
    bridge = null;
    showMcp('off');
    endAgentTurn();
    print(`MCP bridge off: ${browser.runtime.lastError?.message ?? 'the local helper stopped'}`, 'error');
  });
  port.postMessage({ type: 'bridge' });
  return `MCP bridge starting. Sites: ${sites.join(', ') || 'none yet'}. Any other site asks you first.`;
}

async function onBridge(port: Port, m: { type?: string; commands?: unknown; error?: unknown }) {
  if (m.type === 'ready') return showMcp('on');
  if (m.type === 'error') return print(`MCP bridge: ${String(m.error)}`, 'error');
  if (m.type !== 'run') return;
  let reply: BridgeReply;
  // RP1: the call's step number goes first, so the agent can send repeat <step>; none when nothing was recorded.
  const before = bridge?.steps.length ?? 0;
  const numbered = () => ((bridge?.steps.length ?? 0) > before ? `Step ${bridge!.steps.length}.\n` : '');
  // RL2: one block per call that passed checkCommands; agentBatch then always records its step, so the number holds.
  let block: Step | null = null;
  try {
    const lines = checkCommands(m.commands);
    block = openStep(`Step ${before + 1}`, lines);
    const { text, image } = await agentBatch(lines);
    const tips = await bridgeTips(); // first, so a long page can't cut them off
    reply = { type: 'output', text: (numbered() + (tips ? `${tips}\n\n${text}` : text)).slice(0, MAX_OUTPUT), ...(image && { image }) };
  } catch (err) {
    // Cut too: a stopped batch's error carries a page report, and the reply must fit the host's frame.
    const message = err instanceof Error ? err.message : String(err);
    reply = { type: 'error', error: (numbered() + message).slice(0, MAX_OUTPUT) };
    show({ kind: 'line', className: 'error', ...splitReply(message) }); // RL4: the block already says Step N
  }
  if (block) closeStep(block, reply.type === 'error' ? 'Stopped' : 'Done');
  if (bridge?.port === port) port.postMessage(reply); // a port you closed meanwhile can't send
}

// 4.2–4.3 for the bridge (allowOnce): a stop-line asks Allow once / I'll do it, and a step you take
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
    if (why && !showsPage(lines[i + 1]!)) return { text: batchReply(lines, replies, `Stopped: ${why}, so the rest could land on a page you haven't seen.`, await agentReport()) };
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
  print(shownLine(line, nameFor), 'cmd'); // RL1: named before it runs, while its number is still this read's
  // Like a command you type: closes an open ask first.
  closeAsk('Closed, nothing ran: the agent sent a command.');
  const id = ++lastCommand;
  await runEnded;
  // A command you type waits until this one has fully stopped, its downloads asked about.
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
  const docBefore = await topDocument(from);
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
      // Right after the read, so the picture's numbers are this read's. Every screenshot guard (F1b) applies.
      const shot = lookShot(await screenshot((await where(sites)).onPlan));
      output = `${shot.line}\n\n${read}`;
      image = shot.image;
    } else if (name === 'read') {
      output = agentRead = await readAll(false); // always the whole list
    } else {
      // The re-read isn't the agent's: agentRead and bridge.page stay as they were.
      output = await allowOnce(async (allow) => {
        // Downloads that start during an Allow once command are part of what you allowed.
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
  if (output) show({ kind: 'line', ...splitReply(output) }); // RL4: the result; the page behind a click
  // A new document, not a new URL: Maps' tabs change the URL by script (pushState) on the same page. Unknown: stops.
  const docAfter = await topDocument(await targetTabId());
  const stop = followed ? 'it opened a new tab' : !docBefore || docBefore !== docAfter ? 'a new page loaded' : undefined;
  return { text: output || 'ok', image, ...(stop && { stop }) };
}

// All console commands. To add one, add an entry here.
const commands: Record<string, Command> = {
  help: {
    help: 'list commands',
    run: () => ['Commands start with /:', ...Object.entries(commands).map(([name, c]) => `/${name} — ${c.help}`)].join('\n'),
  },
  clear: {
    help: 'empty the output',
    run: () => clearLog(),
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
    help: 'text [all | page N | download [page N]] — show the plain text on screen, like dates and prices (iframes included); text all reads the whole page, not just the screen; text page N reads a PDF from page N on; text download reads the newest file you downloaded with the user\'s ok (a PDF, from page N, or a text file)',
    run: async (args) => {
      if (args[0] === 'download') return readDownload(args.slice(1));
      const { all, page } = textArgs(args); // the AI writes these words, so anything else is refused
      const pdf = await pdfTabUrl(); // P1: a PDF's text comes from its file, all of it either way
      let text: string;
      if (pdf) {
        const doc = await readPdf(pdf);
        if (page !== undefined && page > doc.total) throw new Error(`Usage: text page 1 to ${doc.total}: the PDF has ${doc.total} pages`);
        text = pdfText(doc, page ?? 1);
      } else {
        if (page !== undefined) throw new Error('text page N works on a PDF tab only: use text all or find here');
        text = capText(await textAll(all)) || `(no text ${all ? 'on the page' : 'on screen'})`;
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
    run: ([nArg, text, ...flags], allow, line) => {
      if (nArg === 'here') return act(() => typeHere(checkText(restOf(line ?? '', 2), 'type here <text>'), allow));
      const usage = 'type <number|"label"> "text" [enter] [slow], e.g. type 3 "new york" enter';
      const n = target(nArg, usage);
      if (text === undefined || flags.some((f) => f !== 'enter' && f !== 'slow')) throw new Error(`Usage: ${usage}`);
      return act(() => sendToTab({ type: 'type', n, text, enter: flags.includes('enter'), slow: flags.includes('slow'), allow }, frameFor(n)));
    },
  },
  select: {
    help: 'select <n|"label"> "option" — pick an option in dropdown n (real <select> only)',
    run: ([nArg, option], allow) => {
      const usage = 'select <number|"label"> "option", e.g. select 5 "Price: low to high"';
      const n = target(nArg, usage);
      if (option === undefined) throw new Error(`Usage: ${usage}`);
      return act(() => sendToTab({ type: 'select', n, option, allow }, frameFor(n)));
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
    run: (_args, allow, line) => {
      const text = checkText(restOf(line ?? '', 1), 'paste <text>, e.g. paste {"type":"…"}');
      return act(async () => sendToTab({ type: 'pasteText', text, allow }, await typingFrame()));
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
    help: 'search "words" — look the words up on DuckDuckGo in this tab',
    run: (args) => act(() => goto(searchUrl(args.join(' ')))),
  },
  back: {
    help: 'go back one page (in a tab a link opened, back to the tab that opened it)',
    run: () => act(back),
  },
  repeat: {
    help: `repeat <step> on <numbers> — once item 1 of a list is fully done, redo its commands (from step <step> of your history to your last step) on each other item, by their numbers in the current page list (usually from a pick like item 1 just before), 1 to ${MAX_REPEAT_ITEMS} items, e.g. repeat 5 on 15-23 or repeat 5 on 15, 17, 20-23. Step <step> must start with item 1's click. The user approves the list once; it runs with no AI steps and stops at the first item that doesn't go like item 1, saying which are done and left`,
    run: async () => {
      throw new Error("repeat is the MCP agent's: it redoes steps of its history");
    },
  },
  pause: {
    help: 'pause "reason" — stop and hand the page to the user (sign-in, CAPTCHA, a choice only they can make); they press Resume when done',
    run: async (args) => {
      await askResume(args);
    },
  },
  stop: {
    help: "stop the agent's running command (any other command stops it too)",
    run: () => {},
  },
  tips: {
    help: 'tips — the tips you saved for each site, with Delete buttons. The agent reads a site\'s tips only while it works there',
    run: async () => {
      const sites = await listSites();
      if (!sites.length) return 'No saved tips yet. The MCP agent can suggest one with tip; you choose Save or No.';
      for (const { site, tips } of sites) show({ kind: 'tips', site, tips: tips.map((t) => t.text) });
      return `${sites.length} site(s) with saved tips.`;
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
        showMcp('off');
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
  if (mcpOn && !bridge) startBridge(mcpSites); // the line under the command box shows it, not the log
  // A tab with no page to draw on (chrome://, the Web Store) just stays as it is; the next /overlay on draws it.
  if (!overlayOn) return;
  setOverlayOn(true);
  await sendToAllFrames({ type: 'overlay', on: true }).catch(() => {});
}).catch((err: Error) => print(`Couldn't read saved settings: ${err.message}`, 'error'));

slashMenu(input, commands);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const line = input.value.trim();
  input.value = '';
  if (!line) return;
  leaveStep();
  print(`> ${line}`, 'mine');
  // Only /commands: a sentence never runs one by accident, and nothing else runs at all.
  if (!line.startsWith('/')) return print('Commands start with /. Type /help for the list.', 'error');
  closeAsk('Closed, nothing ran: you moved on.');
  // Stop the agent's command and wait until it has: it finishes in its own tab and unpins, so what you type goes to
  // the tab you're looking at.
  lastCommand++;
  await runEnded;
  endAgentTurn(); // what you do from here is yours, downloads included

  const [name = ''] = parseCommand(line.slice(1));
  // hasOwn so names like "toString" don't match built-in object methods.
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command) return print(`Unknown command "/${name}". Type /help.`, 'error');

  // Re-parsed inside, so a quoted label that matches nothing prints as an error like any other.
  await runAndPrint((allow) => runLine(command, line.slice(1), allow));
});
