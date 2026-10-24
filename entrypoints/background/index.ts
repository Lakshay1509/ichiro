// Background worker: makes the toolbar icon open the side panel, and runs the command engine (BG4) for every open panel.
// WXT imports this file in Node at build time, so every listener is added inside main, none at a module's top level.
// Source: https://wxt.dev/guide/essentials/entrypoints.html
import { sendToAllFrames, setOverlayOn } from '@/lib/page/frames';
import { INSTALL_DEFAULTS, recall, remember } from '@/lib/memory/panel-memory';
import { isFromPanel, isPanelSender, PANEL_PORT } from '@/lib/panel/panel-port';
import { pruneSites } from '@/lib/memory/site-store';
import { closeAsk, nextCommand, pressAsk, startBadge } from './asks';
import { bridge, endAgentTurn, runEnded, save, startBridge, stopBridge } from './bridge';
import { commands, typed } from './commands';
import { watchTabSwitches } from './input';
import { addPanel, alwaysOn, print, removePanel, showAlwaysOn } from './panels';

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  startBadge();
  watchTabSwitches();
  browser.runtime.onConnect.addListener(onConnect);
  browser.runtime.onStartup.addListener(chromeStarted);
  browser.runtime.onInstalled.addListener(installed);
});

// A fresh install starts with INSTALL_DEFAULTS: MCP and always-on on. Not on an update, or an unpacked extension's
// reload ("update" too), so your own choices stay. The first panel open then turns MCP on.
// Source: https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onInstalled
function installed({ reason }: { reason: string }) {
  if (reason !== 'install') return;
  remember(INSTALL_DEFAULTS).catch((err: Error) => print(`Couldn't save the first settings: ${err.message}`, 'error'));
}

// BG5: Chrome started (not on an extension reload). With always-on, MCP comes back on if it was on, with no panel open.
// Source: https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onStartup
function chromeStarted() {
  recall().then(({ mcpOn, mcpSites, alwaysOn }) => {
    showAlwaysOn(alwaysOn);
    if (alwaysOn && mcpOn && !bridge) startBridge(mcpSites);
  }).catch((err: Error) => print(`Couldn't read saved settings: ${err.message}`, 'error'));
}

// A panel connects. Only this extension's own side panel page (isPanelSender): anything else is cut off unheard.
function onConnect(port: Browser.runtime.Port) {
  if (port.name !== PANEL_PORT || !isPanelSender(port.sender ?? {}, browser.runtime.id, browser.runtime.getURL('/sidepanel.html'))) {
    port.disconnect();
    return;
  }
  const first = addPanel(port, Object.fromEntries(Object.entries(commands).map(([name, c]) => [name, { help: c.help }])));
  port.onMessage.addListener((msg: unknown) => {
    if (!isFromPanel(msg)) return; // a port message is input: only the exact shapes count
    if (msg.type === 'press') pressAsk(msg);
    else if (msg.type === 'line') void typed(msg.text);
    else if (msg.type === 'connected') connected().catch((err: Error) => print(`Couldn't turn MCP on: ${err.message}`, 'error'));
    // ping: nothing to do; it only keeps this worker up while the panel is open (PING_MS)
  });
  port.onDisconnect.addListener(() => {
    if (removePanel(port)) void lastPanelClosed();
  });
  if (first) firstPanelOpened();
}

// The welcome's "I've connected": the panel opens on its log from now on, and MCP turns on if it isn't running (the
// agent may have just set up the local helper). Like a panel opening, it keeps the saved Sites.
async function connected() {
  await save({ onboarded: true, mcpOn: true });
  if (!bridge) startBridge((await recall()).mcpSites);
}

// What the panel did each time it opened, before BG4.
function firstPanelOpened() {
  // F10: saved site tips unused for 180 days (or the least used, over 8 MB) are removed each time the panel opens.
  pruneSites(Date.now()).catch((err: Error) => print(`Couldn't tidy saved site tips: ${err.message}`, 'error'));

  // Turns back on what you left on (panel-memory.ts): the MCP bridge with its saved Sites, and the overlay.
  recall().then(async ({ mcpOn, mcpSites, overlayOn, alwaysOn }) => {
    showAlwaysOn(alwaysOn);
    if (mcpOn && !bridge) startBridge(mcpSites); // the line under the command box shows it, not the log
    // A tab with no page to draw on (chrome://, the Web Store) just stays as it is; the next /overlay on draws it.
    if (!overlayOn) return;
    setOverlayOn(true);
    await sendToAllFrames({ type: 'overlay', on: true }).catch(() => {});
  }).catch((err: Error) => print(`Couldn't read saved settings: ${err.message}`, 'error'));
}

// As before BG4, closing the panel ends everything: the bridge stops (still saved on, so the next panel open turns it
// back on), and the agent's command stops the way a typed command stops it. The log stays for the next panel.
// BG5: with always-on, nothing stops; an open ask waits for the next panel.
async function lastPanelClosed() {
  if (alwaysOn) return;
  stopBridge();
  closeAsk('Closed, nothing ran: the panel was closed.');
  nextCommand();
  await runEnded; // its last downloads are still watched (paused) until it has fully stopped
  endAgentTurn();
}
