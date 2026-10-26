// BG4: the /commands (yours and, through MCP_COMMANDS, the agent's) and a line typed in a panel.
import { siteToAdd } from '@/lib/agent-prompt';
import { fileName } from '@/lib/files/downloads';
import { clickTextIn, frameFor, numberFor, pickInFrames, readAll, sendToAllFrames, setOverlayOn, textAll, textFrame } from '@/lib/page/frames';
import { parseKey } from '@/lib/actions/keys';
import { back, goto, targetTabId } from '@/lib/tabs/navigation';
import { readPdf, readTextFile } from '@/lib/files/offscreen';
import { recall } from '@/lib/memory/panel-memory';
import { capText, textArgs } from '@/lib/page/page-text';
import { parseCommand, restOf } from '@/lib/parse-command';
import { pdfFind, pdfText } from '@/lib/files/pdf-text';
import { pickArgs } from '@/lib/page/pick';
import { MAX_POINTS, mouseFlags, parsePoint, type Point } from '@/lib/actions/real-input';
import { MAX_REPEAT_ITEMS } from '@/lib/memory/repeat';
import { downloadArgs, fileKind, fileUrl, MAX_TEXT_FILE, newestReadable } from '@/lib/files/run-files';
import { searchUrl } from '@/lib/tabs/search';
import { sendToTab } from '@/lib/tabs/send-to-tab';
import { settleAfter } from '@/lib/tabs/settle';
import { listSites } from '@/lib/memory/site-store';
import { updatePrompt } from '@/lib/bridge/host-install';
import { askResume, closeAsk, nextCommand, runAndPrint } from './asks';
import { agentDownloads, agentPage, bridge, endAgentTurn, forAgent, runEnded, running, save, skipRead, startBridge, stopBridge } from './bridge';
import { checkText, realKey, realMouse, realPoints, typeHere, typingFrame } from './input';
import { clearLog, leaveStep, print, show, showAlwaysOn, showAuto } from './panels';

// allow: run past a stop-line. Only the Allow once button passes true, never a typed command.
// line: the whole command line as typed, for commands that take the rest of it as is (paste, type here).
type Command = { help: string; run: (args: string[], allow: boolean, line?: string) => string | void | Promise<string | void> };

// Runs one command line, yours or the agent's. Quoted element words are looked up as labels here, where the quotes are
// still known (click "19"). R1: click "text" that names no element clicks the shown page text reading exactly that.
export function runLine(command: Command, line: string, allow: boolean) {
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

// The element a command targets: a number (4) or a label from the last read ("Search"). Never guesses between two.
export function target(arg: string | undefined, usage: string): number {
  if (!arg) throw new Error(`Usage: ${usage}`);
  // Plain digits are a number. Quoted labels, even all digits ("19"), were already looked up by parseCommand.
  if (!/^\d+$/.test(arg)) return numberFor(arg);
  const n = Number(arg);
  if (n < 1) throw new Error(`Usage: ${usage}`);
  return n;
}

// Act, wait for the page to settle, then show the new state: the same loop the AI agent will use.
async function act(action: () => Promise<string>): Promise<string> {
  const result = await settleAfter(action);
  if (skipRead) return result;
  const page = await readAll(!forAgent).catch((err: Error) => `(read failed: ${err.message})`);
  return `${result}\n\n${forAgent ? agentPage(page) : page}`;
}

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
    throw new Error(`Can't read ${name}: Chrome's "Allow access to file URLs" is off for this extension. Ask the user to turn it on (chrome://extensions → Ichiro → Details), then try again`);
  }
  const url = fileUrl(item.filename);
  if (kind === 'pdf') return `Download ${name}:\n${pdfText(await readPdf(url), from)}`;
  // Through the hidden page: a service worker can't fetch file:// URLs.
  return `Download ${name}:\n${capText(await readTextFile(url))}`;
}

// All console commands. To add one, add an entry here.
export const commands: Record<string, Command> = {
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
    help: 'tips — the tips saved for each site, with Delete buttons. The MCP agent saves them as it learns a site, and reads a site\'s tips only while it works there',
    run: async () => {
      const sites = await listSites();
      if (!sites.length) return 'No saved tips yet. The MCP agent saves one with tip when it learns how a site works.';
      for (const { site, tips } of sites) show({ kind: 'tips', site, tips: tips.map((t) => t.text) });
      return `${sites.length} site(s) with saved tips.`;
    },
  },
  mcp: {
    help: "mcp on [sites…] | off — let a coding agent (Claude Code, Codex…) drive this browser. Any other site than its Sites asks you first. mcp on adds this tab's site to the saved Sites; mcp on <sites> sets exactly those. With the extension in two browsers, the agent drives the one that ran mcp on last. On/off and Sites are remembered when you close the panel. Its commands show here; stop-lines ask you first (Allow once, or do it yourself and press Resume)",
    run: async ([on, ...named]) => {
      if (on === 'off') {
        await save({ mcpOn: false }); // also after a crash, so the next panel open doesn't turn it back on
        return stopBridge() ? 'MCP bridge off.' : 'MCP bridge is already off.';
      }
      if (on !== 'on') throw new Error('Usage: mcp on [sites…] | mcp off');
      // No sites named: the saved Sites plus this tab's, if it shows a web page (each new site asks you).
      const sites = named.length
        ? named.map((s) => siteToAdd(`https://${s}/`, []))
        : [...new Set([...(await recall()).mcpSites, siteToAdd((await browser.tabs.get(await targetTabId())).url, [])])].filter(Boolean);
      if (sites.some((s) => !s)) throw new Error('Usage: mcp on [amazon.in wikipedia.org…] (site names)');
      await save({ mcpOn: true, mcpSites: sites });
      // A call is running here, so this browser is the one being driven, and a restart would drop it: Sites only.
      if (bridge && running) {
        bridge.sites = sites;
        return `MCP bridge Sites: ${sites.join(', ') || 'none yet'}.`;
      }
      // Otherwise restart, so the agent comes back here if another browser's /mcp on took it (one bridge file, last wins).
      stopBridge();
      return startBridge(sites);
    },
  },
  // BG5. Not in MCP_COMMANDS: only you can keep the bridge on past the panel.
  'always-on': {
    help: 'always-on on|off — keep MCP on when you close the side panel, and turn it back on when Chrome starts (remembered; on for a new install). An ask from the agent then waits until you open the panel',
    run: async ([on]) => {
      if (on !== 'on' && on !== 'off') throw new Error('Usage: always-on on|off');
      showAlwaysOn(on === 'on');
      await save({ alwaysOn: on === 'on' });
      return on === 'on'
        ? 'Always-on: MCP stays on when you close the side panel, and comes back on when Chrome starts.'
        : 'Always-on off: closing the side panel stops MCP.';
    },
  },
  // Not in MCP_COMMANDS: only you see or change what the agent may use. Delete buttons send "sites remove <site>". The
  // live list changes too, not just the saved one, so a removed site asks again from the agent's next command.
  sites: {
    help: "sites [remove <site>] — the bridge's Sites (trusted: the agent works on them without asking you), with Delete buttons",
    run: async ([verb, site, ...rest]) => {
      const sites = bridge?.sites ?? (await recall()).mcpSites;
      if (verb === undefined) {
        if (!sites.length) return "No trusted sites yet. /mcp on adds this tab's site; any other site asks you first.";
        show({ kind: 'sites', sites: [...sites] }); // a copy: the live list grows when you add a site
        return;
      }
      if (verb !== 'remove' || !site || rest.length) throw new Error('Usage: sites | sites remove <site>');
      if (!sites.includes(site)) return `${site} isn't on the trusted sites.`;
      const left = sites.filter((s) => s !== site);
      if (bridge) bridge.sites = left;
      await save({ mcpSites: left });
      return `Removed ${site}. The agent has to ask you before using it again.`;
    },
  },
  // Not in MCP_COMMANDS: a prompt only you paste into your agent, so its local copy of Ichiro catches up after an update.
  update: {
    help: 'update — a prompt to paste into your coding agent after Ichiro updates: it updates the local copy behind its MCP server (and builds it, if you loaded Ichiro unpacked)',
    run: async () => {
      // installType "development": loaded unpacked. getSelf needs no "management" permission.
      // Source: https://developer.chrome.com/docs/extensions/reference/api/management#method-getSelf
      const { installType } = await browser.management.getSelf();
      show({ kind: 'prompt', text: updatePrompt(browser.runtime.id, installType === 'development') });
    },
  },
  // Not in MCP_COMMANDS: only you can turn your asks off. Never saved, so it can't stay on by accident.
  auto: {
    help: 'auto on|off — on: stop-lines, new sites, downloads and repeats go ahead without asking you (off by default, not remembered). CAPTCHAs, password and card fields, and pause still wait for you',
    run: ([on]) => {
      if (on !== 'on' && on !== 'off') throw new Error('Usage: auto on|off');
      showAuto(on === 'on');
      return on === 'on'
        ? 'Auto mode on: stop-lines, new sites, downloads and repeats go ahead without asking you. The log still shows each one.'
        : 'Auto mode off: those ask you again.';
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

// A line you typed in a panel's command box (its form submit before BG4). A port message is input: every check runs here.
export async function typed(text: string) {
  const line = text.trim();
  if (!line) return;
  leaveStep();
  print(`> ${line}`, 'mine');
  // Only /commands: a sentence never runs one by accident, and nothing else runs at all.
  if (!line.startsWith('/')) return print('Commands start with /. Type /help for the list.', 'error');
  closeAsk('Closed, nothing ran: you moved on.');
  // Stop the agent's command and wait until it has: it finishes in its own tab and unpins, so what you type goes to
  // the tab you're looking at.
  nextCommand();
  await runEnded;
  endAgentTurn(); // what you do from here is yours, downloads included

  const [name = ''] = parseCommand(line.slice(1));
  // hasOwn so names like "toString" don't match built-in object methods.
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command) return print(`Unknown command "/${name}". Type /help.`, 'error');

  // Re-parsed inside, so a quoted label that matches nothing prints as an error like any other.
  await runAndPrint((allow) => runLine(command, line.slice(1), allow));
}
