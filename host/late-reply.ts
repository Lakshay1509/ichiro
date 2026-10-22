// Keeps each MCP tool call under the agent's time limit: a panel reply that takes longer (the panel is asking the user)
// becomes "still waiting", and that late reply goes to the agent's next call instead of being lost (cloud-run2.md bug 2).
import type { BridgeReply } from '../lib/bridge.ts';

// Claude Code gave up after 60 s in cloud run 2, and progress notifications don't extend its per-call limit
// (https://code.claude.com/docs/en/mcp), so we answer first. 50 s leaves time for the answer to get there.
export const WAIT_MS = 50_000;

const WAITING = "No reply from the side panel after 50 s: it's likely asking the user (a stop-line, Add site, Resume) or still running. Nothing is lost: send read after they answer, and that call gets this reply first.";
const STILL = 'Not run: the side panel still hasn\'t replied to your earlier call (likely waiting for the user). Send read again after they answer.';
const LATE = 'Not run: first, the reply to your earlier call, which came after that call stopped waiting. Read it, then send these commands again if you still need them.';

// The reply, or null after ms. The race keeps a handler on p, so a later rejection isn't unhandled.
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<null>((done) => { timer = setTimeout(done, ms, null); })]).finally(() => clearTimeout(timer));
}

// Wraps run. While an earlier run's reply is owed, new commands don't run: the user's answer may have changed the
// page, so the agent must see that reply first. note: ours (trusted); reply: the panel's, '' note when it's the call's own.
export function lateReplies(run: (commands: string[]) => Promise<BridgeReply>, wait = WAIT_MS) {
  let owed: Promise<BridgeReply> | null = null; // a run whose call already returned without its reply
  return async (commands: string[]): Promise<{ note: string; reply?: BridgeReply }> => {
    const late = owed !== null;
    const mine = owed ?? run(commands);
    owed = mine;
    const reply = await within(mine, wait).catch((e: Error) => {
      if (owed === mine) owed = null;
      throw late ? new Error(`${LATE}\n${e.message}`) : e;
    });
    if (!reply) return { note: late ? STILL : WAITING };
    if (owed === mine) owed = null;
    return { note: late ? LATE : '', reply };
  };
}
