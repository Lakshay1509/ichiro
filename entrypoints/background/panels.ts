// BG4: the open side panels and the log they all show. The engine prints with these (they were log.tsx's): each change
// goes into the log kept here and, as the same op, to every open panel (lib/panel-port.ts).
import { apply, type Item, type Log, type LogOp, type McpState, type Step, type ToPanel } from '@/lib/panel-port';

type Port = Browser.runtime.Port;
// An item before show gives it its id.
type New<T> = T extends unknown ? Omit<T, 'id'> : never;

const panels = new Set<Port>();
const log: Log = { items: [], open: null };
let mcp: McpState = 'off';
let lastId = 0;

function post(msg: ToPanel) {
  for (const port of panels) {
    try {
      port.postMessage(msg);
    } catch {
      // A panel closing right now: its onDisconnect removes it. A print must never fail the command that printed.
    }
  }
}

function change(op: LogOp) {
  apply(log, op);
  post(op);
}

// A panel that connects gets everything so far, then every change. true: it's the only one open.
export function addPanel(port: Port, commands: Record<string, { help: string }>): boolean {
  port.postMessage({ type: 'hello', log, mcp, commands } satisfies ToPanel);
  panels.add(port);
  return panels.size === 1;
}

// true: that was the last open panel.
export const removePanel = (port: Port): boolean => panels.delete(port) && panels.size === 0;

export function print(text: string, className = '') {
  show({ kind: 'line', text, className });
}

// The command box's bottom row ("MCP" + this word). starting: the local helper is connecting; on: it said ready.
export function showMcp(state: McpState) {
  mcp = state;
  post({ type: 'mcp', state });
}

// Adds an item at the bottom (inside the open agent call, if any). Returns it with its id, for swap.
export function show(item: New<Item>): Item {
  const full = { ...item, id: ++lastId } as Item;
  change({ type: 'show', item: full });
  return full;
}

// Puts item where old is (an ask becomes what you chose). Nothing if /clear took old away.
export function swap(old: { id: number }, item: New<Item>) {
  change({ type: 'swap', id: old.id, item: { ...item, id: old.id } as Item });
}

export function clearLog() {
  change({ type: 'clear' });
}

// RL2: an agent call's block; what prints until it ends goes inside it.
export function openStep(title: string, raw: string[]): Step {
  const step: Step = { id: ++lastId, kind: 'step', title, raw, items: [] };
  change({ type: 'open', step });
  return step;
}

export function closeStep(step: Step, ended: 'Done' | 'Stopped') {
  change({ type: 'close', id: step.id, ended });
}

// Your own commands print outside the agent's block (its status still updates when it ends).
export function leaveStep() {
  change({ type: 'leave' });
}
