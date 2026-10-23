// BG4: what the side panel and the background engine say over their port, the log both keep, and the port's guards.
// Each open panel has one runtime.connect({ name: PANEL_PORT }). Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging

export const PANEL_PORT = 'panel';
// The log's top-level entries kept (an agent call's block counts as one). Older ones drop off the top.
export const MAX_LOG = 300;
// A panel pings this often, so the background worker stays up while a panel is open: Chrome stops a worker after 30 s
// with no events, and since Chrome 114 an open port alone doesn't count, only a message sent over it.
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
export const PING_MS = 20_000;

// RL2: one agent call, its lines inside. raw: its commands as sent (RL3). ended: set once the call has replied.
export type Step = { id: number; kind: 'step'; title: string; raw: string[]; items: Item[]; ended?: 'Done' | 'Stopped' };
// One thing in the log. Its text is often page or agent text: the panel shows it as text, never as HTML.
// An ask's buttons are labels only: a click goes back as { type: 'press', id, button } (the label's index).
export type Item =
  | { id: number; kind: 'line'; text: string; className?: string; more?: string } // more: behind a click (RL4)
  | { id: number; kind: 'ask'; buttons: string[] }
  | { id: number; kind: 'tips'; site: string; tips: string[] }
  | Step;

export type Log = { items: Item[]; open: number | null }; // open: the step new items go into
export type McpState = 'off' | 'starting' | 'on';

// Background → panel: a change to the log (both sides apply it), the MCP word, or everything at once when a panel connects.
export type LogOp =
  | { type: 'show'; item: Item } // at the bottom, inside the open step if any
  | { type: 'swap'; id: number; item: Item | null } // an ask becomes what you chose, or goes (null); nothing if /clear took it away
  | { type: 'clear' }
  | { type: 'open'; step: Step } // an agent call's block: what shows until it closes goes inside
  | { type: 'close'; id: number; ended: 'Done' | 'Stopped' }
  | { type: 'leave' }; // your own commands show outside the agent's block
// alwaysOn (BG5): the bridge stays on when the last panel closes.
export type ToPanel =
  | LogOp
  | { type: 'mcp'; state: McpState; alwaysOn: boolean }
  | { type: 'hello'; log: Log; mcp: McpState; alwaysOn: boolean; commands: Record<string, { help: string }> };

// Panel → background: a line you typed, a button you pressed, or the keep-alive ping.
export type FromPanel = { type: 'line'; text: string } | { type: 'press'; id: number; button: number } | { type: 'ping' };

const stepOf = (log: Log, id: number | null) => log.items.find((i): i is Step => i.kind === 'step' && i.id === id);

// Changes log as op says. The background and every panel run the same ops, so they hold the same log.
export function apply(log: Log, op: LogOp): void {
  if (op.type === 'clear') {
    log.items = [];
    log.open = null;
  } else if (op.type === 'leave') {
    log.open = null;
  } else if (op.type === 'show' || op.type === 'open') {
    if (op.type === 'open') log.open = null; // a call never nests in another
    const item = op.type === 'open' ? op.step : op.item;
    const into = stepOf(log, log.open);
    if (into) into.items.push(item);
    else log.items.push(item);
    if (log.items.length > MAX_LOG) log.items.splice(0, log.items.length - MAX_LOG);
    if (op.type === 'open') log.open = op.step.id;
  } else if (op.type === 'swap') {
    for (const list of [log.items, ...log.items.flatMap((i) => (i.kind === 'step' ? [i.items] : []))]) {
      const i = list.findIndex((it) => it.id === op.id);
      if (i < 0) continue;
      if (op.item) list[i] = op.item;
      else list.splice(i, 1);
      return;
    }
  } else {
    const step = stepOf(log, op.id);
    if (step) step.ended = op.ended;
    if (log.open === op.id) log.open = null;
  }
}

// Only this extension's own side panel: our id, exactly the panel page's URL, and no tab. Content scripts carry our id
// too but run in tabs (a page can drive one), and our panel page opened in a tab has one. Chrome fills in sender, so a
// page can't fake it. Source: https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender
export function isPanelSender(sender: { id?: string; tab?: unknown; url?: string }, id: string, panelUrl: string): boolean {
  return sender.id === id && sender.tab === undefined && sender.url === panelUrl;
}

const isIndex = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;

// A port message is input: only these exact shapes count, anything else is dropped.
export function isFromPanel(msg: unknown): msg is FromPanel {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m.type === 'line') return typeof m.text === 'string';
  if (m.type === 'press') return isIndex(m.id) && isIndex(m.button);
  return m.type === 'ping';
}

// The open ask's button a press means. A press for an ask that is closed or replaced means nothing, so an old Allow
// can never land on a newer ask.
export const pressed = <T>(open: { id: number; buttons: T[] } | null, press: { id: number; button: number }): T | undefined =>
  open?.id === press.id ? open.buttons[press.button] : undefined;
