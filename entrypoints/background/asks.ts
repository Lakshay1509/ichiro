// BG4: the one open ask (Allow once, Keep going, a new site, a download…) and the command count that makes old asks stale.
import type { BridgeAnswer } from '@/lib/bridge';
import { StopLine } from '@/lib/messages';
import { pressed } from '@/lib/panel-port';
import { stopLineAsk } from '@/lib/stop-lines';
import { detachAll } from '@/lib/real-input';
import { askAgent } from './bridge';
import { autoMode, print, show, swap } from './panels';

// The open choice: a stop-line's Allow once / I'll do it, or a run's pause. Valid only until another command starts:
// a new read renumbers elements, and an old Allow must never land on a different element.
// The log shows its button labels; buttons are their handlers, in the same order (a panel's press names one by index).
let pendingAsk: { id: number; buttons: (() => void)[] } | null = null;
export let lastCommand = 0; // counts started commands, so a late stop-line can tell another one ran meanwhile
let onAskClosed: (() => void) | null = null; // a paused run waiting on the open ask: closing it any other way ends that run

// A command starts, yours or the agent's: an ask from before it is stale from now on.
export const nextCommand = () => ++lastCommand;

// BG6: the toolbar icon says an ask is waiting, so one isn't missed with the panel closed (clicking the icon opens the
// panel). Only this fixed word, never page or agent text.
// Source: https://developer.chrome.com/docs/extensions/reference/api/action#method-setBadgeText
const badge = (text: '' | 'Ask') => void browser.action.setBadgeText({ text }).catch(console.error);

// Worker start: no ask yet, so no badge (one left by a stopped worker has nothing behind it). The color is the log's
// "Waiting for you" (style.css --warn).
export function startBadge() {
  badge('');
  browser.action.setBadgeBackgroundColor({ color: '#8a4b00' }).catch(console.error);
  browser.action.setBadgeTextColor({ color: '#ffffff' }).catch(console.error);
}

// note: what you chose, in place of the buttons ('answer': the panel shows it at the ask card's foot). '': the buttons
// just go (a line right after already says it).
export function closeAsk(note: string) {
  if (!pendingAsk) return;
  swap(pendingAsk, note ? { kind: 'line', text: note, className: 'answer' } : null);
  pendingAsk = null;
  badge('');
  askAgent(null);
  onAskClosed?.();
  onAskClosed = null;
}

// Shows the keep and stop buttons in every open panel (and, BG7, the agent app's dialog). Only a press of one
// (pressAsk) or your answer in that dialog (answerAsk) runs its handler, never a typed line or agent text.
function openAsk(text: string, buttons: [{ label: string; onClick: () => void }, { label: string; onClick: () => void }]) {
  const { id } = show({ kind: 'ask', buttons: buttons.map((b) => b.label) });
  pendingAsk = { id, buttons: buttons.map((b) => b.onClick) };
  badge('Ask');
  askAgent({ id, text, keep: buttons[0].label, stop: buttons[1].label });
}

// A button pressed in a panel. A press for an ask that's closed or replaced does nothing (pressed).
export const pressAsk = (press: { id: number; button: number }) => pressed(pendingAsk, press)?.();

// BG7: your answer in the agent app's dialog presses keep or stop, like a press here. One for an ask that's closed or
// replaced does nothing (pressed), so the first answer wins.
export function answerAsk(a: BridgeAnswer) {
  const press = pressed(pendingAsk, { id: a.id, button: a.keep ? 0 : 1 });
  if (!press) return;
  press();
  print('Answered in the agent app.');
}

// Asks you mid-command (4.1 pause, 4.3 stop-lines, a new site, a download): the keep button goes on; the other button,
// or any command you start, resolves false (a command also bumps lastCommand, so the caller can tell "I'll do it" from
// being stopped). Focus stays in the command box, so a reflex Enter can never press Allow.
// message: its first line is the ask's headline, ours and never page text (the panel shows it bold); the rest is detail.
export function askKeepGoing(message: string, keepLabel = 'Keep going', stopLabel = 'Stop', stopNote = stopLabel === 'Stop' ? 'Stopped.' : `You chose ${stopLabel}.`): Promise<boolean> {
  print(message, 'stop');
  return new Promise((resolve) => {
    onAskClosed = () => resolve(false);
    openAsk(message, [
      {
        label: keepLabel,
        // A promise settles once: Keep going's true wins over the false that closeAsk sends right after.
        onClick: () => {
          resolve(true);
          closeAsk(`You chose ${keepLabel}.`);
        },
      },
      { label: stopLabel, onClick: () => closeAsk(stopNote) },
    ]);
  });
}

// /auto on: a yes/no ask (stop-line, new site, download, repeat) presses its keep button itself; the log still
// shows it. Resume asks never come here: a pause, a CAPTCHA or a password field needs your hands, not a yes.
export function askOrAuto(message: string, keepLabel: string, stopLabel: string, stopNote?: string): Promise<boolean> {
  if (!autoMode) return askKeepGoing(message, keepLabel, stopLabel, stopNote);
  print(`${message}\nAuto mode chose ${keepLabel}.`, 'stop');
  return Promise.resolve(true);
}

// 4.1 pause "reason": hands the page to you. The agent wrote the reason after reading the page, so it's shown quoted,
// one line, capped, like its other words. where: which tab, for the agent's pause (OT3): " in the agent's tab (…)".
export function askResume(args: string[], where = ''): Promise<boolean> {
  const why = args.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200) || '(no reason given)';
  return askKeepGoing(`Paused${where}\nThe agent says: "${why}"\nDo what's needed on the page, then press Resume.`, 'Resume');
}

type Run = (allow: boolean) => string | void | Promise<string | void>;

// Runs a command and prints the result. A stop-line asks instead of failing: Allow once re-runs it one time with allow.
export async function runAndPrint(run: Run, allow = false) {
  const id = ++lastCommand;
  try {
    const result = await run(allow);
    if (result) print(result);
  } catch (err) {
    if (!(err instanceof StopLine)) return print(err instanceof Error ? err.message : String(err), 'error');
    // /auto on: Allow once without asking. Awaited, so the finally below detaches only after the allowed run.
    if (autoMode && !allow) {
      print(`${stopLineAsk(err.message)}\nAuto mode chose Allow once.`, 'stop');
      return await runAndPrint(run, true);
    }
    askAllow(err, run, id);
  } finally {
    await detachAll(); // I1: the debugger is attached only while a command or run goes
  }
}

// Shows a stop-line with Allow once / I'll do it. id: the command that hit it; stale if another one started since.
function askAllow(err: StopLine, run: Run, id: number) {
  const message = stopLineAsk(err.message);
  print(message, 'stop');
  if (id !== lastCommand) return print('Another command ran meanwhile. Run this one again to choose.', 'error');
  // Focus stays in the command box, so a reflex Enter can never press Allow.
  openAsk(message, [
    {
      label: 'Allow once',
      onClick: () => {
        closeAsk('Allowed once.');
        void runAndPrint(run, true);
      },
    },
    { label: "I'll do it", onClick: () => closeAsk('Cancelled. This step is yours: do it by hand on the page.') },
  ]);
}
