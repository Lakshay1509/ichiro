// The native messaging host: Chrome starts it for the side panel's /mcp on; it bridges a coding agent's commands from
// a local pipe to the panel. stdout belongs to Chrome's message channel, so logs go to stderr only, and never the token.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { dirname } from 'node:path';
import { checkReply, checkRun, isBridgeStart, type BridgeReply } from '../lib/bridge.ts';
import { hostPaths } from '../lib/host-install.ts';
import { frame, readFrames } from '../lib/host-request.ts';

const send = (message: object) => process.stdout.write(frame(message));
// Exit only after the error has reached Chrome.
const fail = (error: string) => process.stdout.write(frame({ type: 'error', error }), () => process.exit(1));

// Chrome passes the caller's origin first; the launcher (3.1c) sets BA_ORIGIN to ours.
// Any local program can fake this argument, so it only catches misconfiguration. Chrome's allowed_origins is the real lock.
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
if (!process.env.BA_ORIGIN || process.argv[2] !== process.env.BA_ORIGIN) {
  console.error(`Refused: caller ${process.argv[2] ?? '(none)'} is not BA_ORIGIN.`);
  process.exit(1);
}

let bridging = false; // set by the first message, which must start the bridge; then fixed for this process

function handle(text: string) {
  if (bridging) return panelReply(text);
  if (!isStart(text)) return fail('The first message must be {"type":"bridge"}');
  startBridge();
}

const isStart = (text: string) => {
  try {
    return isBridgeStart(text);
  } catch {
    return false; // not JSON
  }
};

// --- The MCP bridge (/mcp on). The pipe's name is random and written, with a fresh token, to a file only you can
// read; host/mcp.ts reads it to connect. Each connection carries one run (1–10 command lines); runs reach the panel one at a time.
let waiting: ((reply: BridgeReply) => void) | null = null; // the agent waiting on the panel's reply
let line: Promise<unknown> = Promise.resolve();

function startBridge() {
  bridging = true;
  const token = randomBytes(32).toString('hex');
  const file = hostPaths(process.platform, process.env).bridge;
  // Windows pipes vanish with the process. A Unix socket is a file: removed on exit.
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\browser-agent-${randomUUID()}` : `${dirname(file)}/bridge-${randomUUID()}.sock`;
  if (process.platform !== 'win32') process.on('exit', () => rmSync(pipe, { force: true }));
  const server = createServer((socket) => serve(socket, token));
  server.on('error', (e) => fail(`MCP bridge: ${e.message}`));
  server.listen(pipe, () => {
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, JSON.stringify({ pipe, token }), { mode: 0o600 });
    } catch (e) {
      return fail(`MCP bridge: can't write ${file}: ${(e as Error).message}`);
    }
    send({ type: 'ready' });
  });
}

function serve(socket: Socket, token: string) {
  let buf: Buffer = Buffer.alloc(0);
  const reply = (r: BridgeReply) => socket.end(frame(r));
  socket.on('error', () => {}); // the agent left; its reply is dropped
  socket.on('data', (chunk: Buffer) => {
    let messages: string[];
    try {
      ({ messages, rest: buf } = readFrames(Buffer.concat([buf, chunk])));
    } catch (e) {
      return reply({ type: 'error', error: (e as Error).message });
    }
    if (messages[0] === undefined) return;
    socket.removeAllListeners('data'); // one run per connection
    let commands: string[];
    try {
      commands = checkRun(messages[0], token);
    } catch (e) {
      console.error('MCP bridge refused a pipe message:', (e as Error).message);
      return reply({ type: 'error', error: (e as Error).message });
    }
    line = line.then(() => new Promise<void>((done) => {
      waiting = (r) => {
        waiting = null;
        reply(r);
        done();
      };
      send({ type: 'run', commands });
    }));
  });
}

function panelReply(text: string) {
  let r: BridgeReply;
  try {
    r = checkReply(text);
  } catch (e) {
    return fail(`MCP bridge: ${(e as Error).message}`);
  }
  if (!waiting) return console.error('MCP bridge: dropped a reply nobody asked for');
  waiting(r);
}

let buf: Buffer = Buffer.alloc(0);
let queue: Promise<unknown> = Promise.resolve();
process.stdin.on('data', (chunk: Buffer) => {
  let messages: string[];
  try {
    ({ messages, rest: buf } = readFrames(Buffer.concat([buf, chunk])));
  } catch (e) {
    return fail((e as Error).message); // can't find the next message boundary, so stop
  }
  // One at a time, so replies come back in the order the asks were sent.
  for (const m of messages) queue = queue.then(() => handle(m));
});
process.stdin.on('end', () => process.exit(0)); // Chrome closed the port
