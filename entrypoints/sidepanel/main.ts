// Side panel: a view of the background's engine (BG4). Draws its log and MCP word; sends what you type and press.
// Inter, shipped inside the extension (no font request leaves it). Source: https://www.npmjs.com/package/@fontsource-variable/inter
import '@fontsource-variable/inter/wght.css';
import './style.css';
import { PANEL_PORT, PING_MS, type FromPanel, type McpState, type ToPanel } from '@/lib/panel-port';
import { change, load } from './log';
import { welcome } from './onboarding';
import { slashMenu } from './slash-menu';

const form = document.querySelector('form')!;
const input = form.querySelector('input')!;

// The command box's bottom row ("MCP" + this word). starting: the local helper is connecting; on: it said ready.
// alwaysOn (BG5): "· always-on" shows while closing the panel leaves MCP on. auto: the hand at the left while asks answer themselves.
const mcpStatus = document.querySelector<HTMLElement>('#mcp')!;
function showMcp(state: McpState, alwaysOn: boolean, auto: boolean) {
  mcpStatus.dataset.state = state;
  mcpStatus.querySelector('.mcp-state')!.textContent = state;
  mcpStatus.querySelector<HTMLElement>('.mcp-always')!.hidden = !alwaysOn;
  mcpStatus.querySelector<HTMLElement>('.mcp-auto')!.hidden = !auto;
}

// The / menu reads this as you type; hello fills it with the background's commands.
const commands: Record<string, { help: string }> = {};
slashMenu(input, commands);

// One port per open panel: the background sends the log and the MCP word, the panel sends lines and presses.
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
const port = browser.runtime.connect({ name: PANEL_PORT });
const post = (msg: FromPanel) => port.postMessage(msg);

port.onMessage.addListener((msg: ToPanel) => {
  if (msg.type === 'hello') {
    Object.assign(commands, msg.commands);
    showMcp(msg.mcp, msg.alwaysOn, msg.auto);
    load(msg.log, post);
  } else if (msg.type === 'mcp') showMcp(msg.state, msg.alwaysOn, msg.auto);
  else change(msg);
});

// The welcome on every panel open until you press "I've connected" (no skip): it hides the log and the command box.
// The background saves that press (onboarded) and turns MCP on.
browser.storage.local.get('onboarded').then(({ onboarded }) => {
  if (onboarded === true) return;
  document.body.classList.add('welcoming');
  welcome(document.querySelector<HTMLElement>('#welcome')!, () => {
    post({ type: 'connected' });
    document.body.classList.remove('welcoming');
    input.focus();
  });
}, console.error);

// Keeps the background awake while this panel is open: Chrome stops an idle worker after 30 s, and since Chrome 114
// only a message sent over a port counts. Source: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
const ping = setInterval(() => post({ type: 'ping' }), PING_MS);

// The background stopped, or refused this panel. No reconnect: the log and the open ask live there.
port.onDisconnect.addListener(() => {
  clearInterval(ping);
  input.disabled = true; // a line typed now would go nowhere
  change({ type: 'leave' });
  change({ type: 'show', item: { id: -1, kind: 'line', text: "Lost the connection to the extension's background. Close and reopen the side panel.", className: 'error' } });
});

// Focus stays in the command box (autofocus), even with an ask already in the log: a reflex Enter never presses Allow.
// The background checks the line (the "/") and prints it.
form.addEventListener('submit', (event) => {
  event.preventDefault();
  post({ type: 'line', text: input.value });
  input.value = '';
});
