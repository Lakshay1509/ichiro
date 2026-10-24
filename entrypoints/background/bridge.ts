// BG4: the MCP bridge (/mcp on) and the coding agent's commands, each run like a typed one with the agent's guards.
import { checkGoto, onSites, siteOn, siteToAdd, siteToOpen, wantsSite } from '@/lib/agent-prompt';
import { allowOnce, batchProblem, batchReply, captchaHold, checkAgentTip, checkCommands, isAnswer, LOOK_HELP, lookShot, MAX_ASK, MAX_OUTPUT, MCP_COMMANDS, picksTab, retryUnlisted, showsPage, TIP_HELP, tipsOnce, type AskNotice, type BridgeAsk, type BridgeImage, type BridgeReply } from '@/lib/bridge';
import { fileName, RunDownloads } from '@/lib/downloads';
import { captchaAll, labelFor, nameFor, readAll } from '@/lib/frames';
import { HOST_NAME } from '@/lib/host-install';
import { HandOver, StopLine } from '@/lib/messages';
import { follow, openBehind, pinTab, targetTabId } from '@/lib/navigation';
import { pageReport } from '@/lib/page-diff';
import { remember, type Remembered } from '@/lib/panel-memory';
import type { Step } from '@/lib/panel-port';
import { parseCommand } from '@/lib/parse-command';
import { saidLine, splitReply, stepTitle } from '@/lib/readable-log';
import { detachAll } from '@/lib/real-input';
import { failed, recordLine } from '@/lib/repeat';
import { saveTip, useSite } from '@/lib/site-store';
import { MAX_TIPS } from '@/lib/site-tips';
import { isCheckoutUrl, stopLineAsk } from '@/lib/stop-lines';
import { groupTab, ungroupAll } from '@/lib/tab-group';
import { answerAsk, askKeepGoing, askOrAuto, askResume, closeAsk, lastCommand, nextCommand } from './asks';
import { commands, runLine } from './commands';
import { screenshot } from './input';
import { closeStep, openStep, print, show, showMcp } from './panels';
import { runRepeat } from './repeat';

// Where the run's tab (or tab tabId) is (its URL and site name) and whether that's one of the run's Sites.
async function where(sites: string[], tabId?: number): Promise<{ onPlan: boolean; site: string; url: string; title: string }> {
  const tab = await browser.tabs.get(tabId ?? (await targetTabId()));
  return { onPlan: onSites(tab.url, sites), site: (tab.url && URL.parse(tab.url)?.hostname) || 'this page', url: tab.url ?? '', title: tab.title ?? '' };
}

// The tab's top document: a real page load makes a new one, a script's own URL change (pushState) keeps it. '' unknown.
// Source: https://developer.chrome.com/docs/extensions/reference/api/webNavigation#method-getFrame
const topDocument = (tabId: number) => browser.webNavigation.getFrame({ tabId, frameId: 0 }).then((f) => f?.documentId ?? '', () => '');

// Settles once the agent's command has fully stopped. A command you type waits for it, so the agent's last step can't
// land on your tab after the pin is gone, and your command can't land on the agent's tab.
export let runEnded: Promise<void> = Promise.resolve();

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
  // No leaves no note: the "download refused" line right after says it.
  return askOrAuto(`Allow this download?\n"${fileName(item)}" from ${from}.${more}`, 'Allow', 'No', '');
}

// The agent's turn is over: downloads still paused stay paused, and you decide.
function unwatch(downloads: RunDownloads) {
  browser.downloads.onCreated.removeListener(downloads.onCreated);
  if (downloads.paused) print(`Downloads waiting for you\n${downloads.paused} download(s) the agent started are paused: resume or cancel them in chrome://downloads.`, 'stop');
}

// F9: true while a step's earlier commands run. A read renumbers the page's elements, so it waits for the last one:
// otherwise the step's next number could point at a different element.
export let skipRead = false;
// MCP option 1 (harness/mcp-context.md): true while a bridge command runs. Its page replies say what changed since the
// last page list the agent got (bridge.page), not the whole list: the agent keeps every reply. agentRead is this
// command's read; it becomes bridge.page only once it's sent (agentCommand).
export let forAgent = false;
let agentRead: string | null = null;

// A fresh read as the agent gets it: the change since its last page list, or the whole list (pageReport says when).
export function agentPage(page: string): string {
  agentRead = page;
  return pageReport(bridge?.page ?? null, page);
}

// The MCP bridge (/mcp on): a coding agent's commands come from the local helper's pipe (host/mcp.ts). Each shows
// here and runs like a typed one, with the agent's guards: only MCP_COMMANDS, only on the bridge's Sites (a new site
// asks you first, so a tricked agent can't take your data elsewhere), never past a stop-line or a hand-over.
type Port = ReturnType<typeof browser.runtime.connectNative>;
// RP1: one bridge call: its commands that worked, by label (recordLine), and the downloads count when it began.
export type BridgeStep = { ran?: string[]; downloadsAt?: number };
// page: the last page list the agent got (null: none yet, so the next one goes whole). tipped: the sites whose saved
// tips the agent already got this session (F10, tipsOnce).
// steps (RP1): one per call, with what worked, for repeat <step>; each reply starts with its number.
// solved: the CAPTCHA you last resumed from (captchaHold), so a solved one still on screen doesn't ask again.
// session: the agent whose runs these are (host/mcp.ts). page and tipped are what that agent got, so they reset with it.
// tab (OT1): that agent's own tab, kept whatever tab is in front; null until a command picks one (agentTab). came: for
// each tab it followed, the tab it came from: where its back goes (#15), never Chrome's opener, which can be your tab.
export let bridge: { port: Port; sites: string[]; refused: Set<string>; page: string | null; tipped: Set<string>; steps: BridgeStep[]; solved: string; session: string; tab: number | null; came: Map<number, number> } | null = null;

// S2 for the bridge: a site off its Sites asks you first. No: refused and not asked again while the bridge is on.
async function bridgeSite(site: string, url: string): Promise<void> {
  const b = bridge;
  if (!b) throw new Error('The MCP bridge is off.');
  const id = lastCommand;
  // The ask names only the new site: the whole Sites list is noise in the panel and the agent app's dialog. No leaves
  // no note: the "Refused" line right after says it.
  const add = !b.refused.has(site) && await askOrAuto(`Let the agent use ${site}?\n${wantsSite(site, url)}`, 'Add site', 'No', '');
  if (id !== lastCommand) throw new Error('Stopped: the user ran another command. Ask them what to do.');
  if (add) {
    b.sites.push(site);
    return save({ mcpSites: b.sites });
  }
  b.refused.add(site);
  // The list after a blank line: the agent gets it, the panel shows it only behind a click (splitReply).
  throw new Error(`Refused: the user said no to ${site}.\n\nUse the bridge's Sites (${b.sites.join(', ') || 'none yet'}) or ask them.`);
}

// Saves a switch for the next panel open (panel-memory.ts). A failed save only loses that, so it says so and goes on.
export const save = (change: Partial<Remembered>) => remember(change).catch((err: Error) => print(`Couldn't save settings: ${err.message}`, 'error'));

// OT2: changes to the Ichiro tab group, one at a time in order, so an ungroup can't take out a tab grouped after it.
// The group is only a sign: a failed change says so, and nothing else stops.
let grouping = Promise.resolve();
function sign(change: () => Promise<void>) {
  grouping = grouping.then(change).catch((err: unknown) => print(`   Couldn't change the Ichiro tab group: ${err instanceof Error ? err.message : String(err)}`, 'error'));
}
// Connects to the local helper (host/mcp.ts) with these Sites. Used by mcp on and by the panel turning it back on.
export function startBridge(sites: string[]): string {
  const port = browser.runtime.connectNative(HOST_NAME);
  bridge = { port, sites, refused: new Set(), page: null, tipped: new Set(), steps: [], solved: '', session: '', tab: null, came: new Map() };
  sign(ungroupAll); // OT2: a group left from before (the worker restarted) has no agent tab now
  showMcp('starting');
  port.onMessage.addListener((m) => void onBridge(port, m));
  // Chrome's reason (not installed, host crashed) is in lastError. Never reconnects here: a crashing host would loop.
  // The next panel open turns it back on (BG5, also with always-on).
  // shortcut: with no panel open, Chrome stops this worker ~30 s later and this line goes with the log; keep it in
  // storage.session if it's missed.
  port.onDisconnect.addListener(() => {
    if (bridge?.port !== port) return; // you turned it off
    bridge = null;
    sign(ungroupAll);
    showMcp('off');
    endAgentTurn();
    print(`MCP bridge off: ${browser.runtime.lastError?.message ?? 'the local helper stopped'}`, 'error');
  });
  port.postMessage({ type: 'bridge' });
  return `MCP bridge starting. Sites: ${sites.join(', ') || 'none yet'}. Any other site asks you first.`;
}

// Disconnects the local helper (mcp off, or the last panel closing). Saves nothing: mcp off saves mcpOn false itself,
// and a closing panel leaves it on, so the next panel open turns it back on. false: it was already off.
export function stopBridge(): boolean {
  sign(ungroupAll); // OT2: also when already off, so mcp off clears a group left from before the worker restarted
  if (!bridge) return false;
  bridge.port.disconnect();
  bridge = null;
  showMcp('off');
  return true;
}

// BG7: true while the agent's call waits on a run here. Its asks then go to the agent app too (askAgent).
export let running = false;

// BG7: the open ask (null: it closed), sent on to the agent's call, whose agent app shows it as a dialog you can answer
// (host/mcp.ts). Capped: it quotes page and agent text.
export function askAgent(ask: BridgeAsk | null) {
  if (running) bridge?.port.postMessage({ type: 'ask', ask: ask && { ...ask, text: ask.text.slice(0, MAX_ASK) } } satisfies AskNotice);
}

async function onBridge(port: Port, m: { type?: string; commands?: unknown; error?: unknown; session?: unknown }) {
  if (m.type === 'ready') return showMcp('on');
  if (m.type === 'error') return print(`MCP bridge: ${String(m.error)}`, 'error');
  if (isAnswer(m)) return answerAsk(m); // BG7: your answer in the agent app's dialog (the host checked where it came from)
  if (m.type !== 'run') return;
  // A new agent never saw the last one's replies: the whole page and each site's saved tips go to it again. The bridge
  // outlives agents (it lives in the worker, and with always-on all day), so without this only the first agent got tips.
  const session = typeof m.session === 'string' ? m.session : '';
  if (bridge && bridge.session !== session) {
    Object.assign(bridge, { session, page: null, tipped: new Set<string>(), tab: null, came: new Map<number, number>() });
    sign(ungroupAll);
  }
  running = true;
  let reply: BridgeReply;
  // RP1: the call's step number goes first, so the agent can send repeat <step>; none when nothing was recorded.
  const before = bridge?.steps.length ?? 0;
  const numbered = () => ((bridge?.steps.length ?? 0) > before ? `Step ${bridge!.steps.length}.\n` : '');
  // RL2: one block per call that passed checkCommands; agentBatch then always records its step, so the number holds.
  let block: Step | null = null;
  try {
    const lines = checkCommands(m.commands);
    block = openStep(before + 1, stepTitle(lines, nameFor), lines); // named before it runs, like each line (RL1)
    const { text, image } = await agentBatch(lines);
    const tips = await bridgeTips(); // first, so a long page can't cut them off
    reply = { type: 'output', text: (numbered() + (tips ? `${tips}\n\n${text}` : text)).slice(0, MAX_OUTPUT), ...(image && { image }) };
  } catch (err) {
    // Cut too: a stopped batch's error carries a page report, and the reply must fit the host's frame.
    const message = err instanceof Error ? err.message : String(err);
    reply = { type: 'error', error: (numbered() + message).slice(0, MAX_OUTPUT) };
    show({ kind: 'line', className: 'error', ...splitReply(message) }); // RL4: the block already says Step N
  }
  running = false;
  if (block) closeStep(block, reply.type === 'error' ? 'Stopped' : 'Done');
  if (bridge?.port === port) port.postMessage(reply); // a port you closed meanwhile can't send
}

// 4.2–4.3 for the bridge (allowOnce): a stop-line asks Allow once / I'll do it (auto mode allows it), and a step you
// take over waits for your Resume (never auto). A command you start meanwhile closes the ask and stops this one.
const askYou = (ask: (why: string) => Promise<boolean>) => async (why: string): Promise<boolean> => {
  const id = lastCommand;
  const yes = await ask(why);
  if (id !== lastCommand) throw new Error('Stopped: the user ran another command. Ask them what to do.');
  return yes;
};
// OT3: an ask that needs your hands in the agent's tab names it: you may be working in another tab. The site is the
// hostname, not page text.
const inAgentTab = async () => ` in the agent's tab (${(await where(bridge?.sites ?? [])).site})`;
const bridgeAsks = {
  allow: askYou((why) => askOrAuto(stopLineAsk(why), 'Allow once', "I'll do it")),
  resume: askYou(async (why) => askKeepGoing(`Your turn${await inAgentTab()}\n${why}`, 'Resume', 'Stop')),
};

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
  if (!b || b.tab === null) return '';
  try {
    const site = siteOn((await where(b.sites, b.tab)).url, b.sites);
    const tips = await tipsOnce(site, b.tipped, async (s) => (await useSite(s, Date.now())).map((t) => t.text));
    if (tips) print(`   sent the agent the saved tips for ${site}`);
    return tips;
  } catch (err) {
    print(`   saved tips unread: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return '';
  }
}

// F10: the agent's tip "<text>": checked (checkAgentTip: on its own site, no links away, emails or long numbers), then
// saved at once, no ask. The log shows it, and /tips shows and deletes them.
async function agentTip(args: string[], site: string): Promise<AgentReply> {
  const text = checkAgentTip(args, site);
  const saved = await saveTip(site, text, Date.now());
  if ('why' in saved) throw new Error(`Not saved: ${saved.why}.`);
  print(`   saved for ${site} (${saved.tips.length} of ${MAX_TIPS} tips). /tips to see or delete them`);
  return { text: `Saved your tip for ${site}.` };
}

// MCP option 2 (harness/mcp-context.md): a run's commands in order, each through agentRun with all of its own checks
// (Sites, a new site's ask, stop-lines, downloads, your takeover). Only the last reads the page, so the reply has one
// change report. It stops early at an error, a new page or tab, or a command you typed: the rest could land on a page
// the agent hasn't seen. Your switching tabs doesn't stop it (OT1: it stays in its tab). The page then comes once at
// the end, unless you took over.
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
      throw new Error(batchReply(lines, replies, '', i && lastCommand === id ? await tabReport() : ''));
    }
    replies.push(reply.text);
    if (!failed(reply.text)) ran.push(recorded);
    if (last) return { text: batchReply(lines, replies), image: reply.image };
    if (lastCommand !== id) throw new Error(batchReply(lines, replies, 'Stopped: the user ran another command. Ask them what to do.'));
    const why = reply.stop;
    if (why && !showsPage(lines[i + 1]!)) return { text: batchReply(lines, replies, `Stopped: ${why}, so the rest could land on a page you haven't seen.`, await tabReport()) };
  }
  throw new Error('unreachable: a batch has a last command');
}

// OT1: agentReport after a batch's commands, in the agent's tab like them (inRunTab, so a command you type waits). With
// no tab of its own (it was closed): no report, never the tab in front.
function tabReport(): Promise<string> {
  const tab = bridge?.tab ?? null;
  return tab === null ? Promise.resolve('') : inRunTab(tab, agentReport);
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
export let agentDownloads: RunDownloads | null = null;
// RP1: downloads counted by earlier agent turns, so agentCreated never goes back (the bridge's downloadsAt).
let agentDownloadsBefore = 0;
const agentCreated = () => agentDownloadsBefore + (agentDownloads?.created ?? 0);

export function endAgentTurn() {
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
  print(saidLine(line, nameFor), 'cmd'); // RL1: in plain words, named before it runs, while its number is still this read's
  // Like a command you type: closes an open ask first.
  closeAsk('Closed, nothing ran: the agent sent a command.');
  const id = nextCommand();
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

// True while a repeat's recipe runs: its back stays in its tab (agentCommand).
let repeating = false;

// RP1 2.5: repeat over the bridge (runRepeat). <step> is a bridge call ("Step N." starts each reply). Each recipe
// command goes through agentCommand with all of its checks, without a read: only the page report at the end is the
// agent's, so the change it gets is from the last page it saw.
async function bridgeRepeat(args: string[]): Promise<string> {
  const b = bridge;
  const d = agentDownloads; // agentRun made it for this command
  if (!b || !d) throw new Error('The MCP bridge is off.');
  const now = await where(b.sites);
  repeating = true;
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
  }).finally(() => (repeating = false));
  if (result === null) throw new Error('Stopped: the user ran another command. Ask them what to do.');
  return `${result}\n\n${await agentReport()}`;
}

// OT1: the tab an agent command goes to: the agent's own, kept whatever tab is in front. With none yet, only a command
// that reads the front tab or leaves it (picksTab) takes it, and keepTab makes it the agent's once the command is done.
async function agentTab(name: string): Promise<number> {
  const b = bridge;
  if (!b) throw new Error('The MCP bridge is off.');
  if (b.tab === null) {
    if (!picksTab(name)) throw new Error('No tab of yours yet: send read first, or goto.');
    return targetTabId();
  }
  if (await browser.tabs.get(b.tab).then(() => true, () => false)) return b.tab;
  b.tab = null;
  sign(ungroupAll); // OT2: tabs it worked in before stay open, out of the group
  throw new Error('Your tab was closed. Send read to work in the tab in front, or goto.');
}

// OT1: makes tab id the agent's. The log says so when it changes; the title is page text, so it's capped. OT2: it joins
// the Ichiro group; opened: the agent or its page opened it, so it leaves your group if Chrome put it there.
async function keepTab(id: number, opened: boolean) {
  const b = bridge;
  if (!b || b.tab === id) return;
  b.tab = id;
  sign(() => groupTab(id, opened));
  const { site, title } = await where(b.sites, id);
  print(`   The agent works in: ${title ? `${title.slice(0, 80)} (${site})` : site}`);
}

async function agentCommand(line: string, last: boolean): Promise<AgentReply> {
  const [name = '', ...args] = parseCommand(line);
  if (name === 'help') return { text: MCP_COMMANDS.map((n) => `${n} — ${n === 'look' ? LOOK_HELP : n === 'tip' ? TIP_HELP : commands[n]!.help}`).join('\n') };
  if (!MCP_COMMANDS.includes(name)) throw new Error(`Not a command you can use: ${name.slice(0, 50)}. Send help for the list.`);
  const sites = bridge?.sites ?? [];
  // #16, OT1: one command, one tab: the agent's own (agentTab). Its checks, action and read all go there, whatever tab
  // is in front. back may move it to the tab it followed this one from (#15), but not in a repeat's recipe. The pin
  // ends with the command (inRunTab).
  const picking = bridge?.tab === null; // OT4: no tab of its own yet, so a goto opens one
  let from = await agentTab(name);
  let own: number | undefined; // OT4: the tab this goto opened
  pinTab(from,name === 'back' && !repeating ? (bridge?.came.get(from) ?? null) : null);
  // Checked right before acting: a click may have left the Sites. back and goto (to
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
    if (await askResume(args, await inAgentTab())) return { text: 'The user pressed Resume. Report what the page shows now, not what you expect.' };
    throw new Error('The user pressed Stop. Stop and ask them what to do.');
  }
  const docBefore = await topDocument(from);
  // #8: a tab this command's page opens (a link with target=_blank, a ctrl+click) is followed: the next commands go to
  // it. Known by the tab the link was in, not openerTabId: Chrome names the front tab as the opener (OT1, seen live).
  // Source: https://developer.chrome.com/docs/extensions/reference/api/webNavigation#event-onCreatedNavigationTarget
  let opened: number | undefined;
  const onCreated = (d: { sourceTabId: number; tabId: number }) => {
    if (d.sourceTabId === from) opened = d.tabId;
  };
  browser.webNavigation.onCreatedNavigationTarget.addListener(onCreated);
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
        // OT4: with no tab of its own yet, the agent's goto opens one behind yours, only after every check above. Once:
        // an allowed retry goes to the same tab. from moves too, so a tab this page opens is followed from there.
        if (picking && own === undefined) pinTab((from = own = await openBehind()));
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
    // OT4: a goto still loading or failed leaves the agent in the tab it opened, so its next read goes there. A tab
    // gone meanwhile only loses the log line: the next command says it was closed.
    if (own !== undefined) await keepTab(own, true).catch(() => {});
    // allowOnce took the first try's stop-line or hand-over; one from the allowed try (or goto's site ask) ends here.
    if (err instanceof StopLine || err instanceof HandOver) throw new Error(`${err.message}. Not done: tell the user to do this step by hand.`);
    throw err;
  } finally {
    forAgent = false;
    skipRead = false;
    browser.webNavigation.onCreatedNavigationTarget.removeListener(onCreated);
    await detachAll(); // I1: the debugger is attached only while a command goes
  }
  // #14: once loaded, so the next read sees its page, not a blank tab.
  let followed = false;
  if (opened !== undefined && (await follow(opened, from))) {
    pinTab(opened); // the Sites check below is of the new tab
    bridge?.came.set(opened, from);
    followed = true;
  }
  await keepTab(await targetTabId(), followed || own !== undefined); // OT1: a tab it picked, followed or went back to is the agent's now
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
  if (output) show({ kind: 'line', className: 'reply', ...splitReply(output) }); // RL4: for the agent, so the panel keeps it in Details
  // A new document, not a new URL: Maps' tabs change the URL by script (pushState) on the same page. Unknown: stops.
  const docAfter = await topDocument(await targetTabId());
  const stop = followed ? 'it opened a new tab' : !docBefore || docBefore !== docAfter ? 'a new page loaded' : undefined;
  return { text: output || 'ok', image, ...(stop && { stop }) };
}
