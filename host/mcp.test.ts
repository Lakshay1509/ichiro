// Checks host/mcp.ts's dialogs with the real server, a fake side panel (the pipe) and a fake agent app (stdio). The
// panel asks alone first; a dialog shows only if the ask is still open after 10 s, and the first answer wins. ~11 s.
// Run: npm test
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostPaths } from '../lib/bridge/host-install.ts';
import { frame, readFrames } from '../lib/bridge/host-request.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const MCP = fileURLToPath(new URL('./mcp.ts', import.meta.url));
const ASK = { id: 1, text: 'Let the agent use x.com?\nThe agent wants to open x.com.', keep: 'Add site', stop: 'No' };
type Msg = Record<string, any>;
setTimeout(() => fail('timed out'), 30_000).unref();

const put = (s: Socket, m: object) => s.write(frame(m));
// The panel closes its ask (you answered there), then replies to the run.
const finish = (s: Socket, text: string) => {
  put(s, { type: 'ask', ask: null });
  s.end(frame({ type: 'output', text }));
};

// One tool call to its own server process. panel gets each pipe message; agent gets each message the agent app gets.
// Returns everything the agent app got, the tool call's result last.
async function call(panel: (s: Socket, m: Msg) => void, agent: (m: Msg, send: (m: Msg) => void) => void = () => {}): Promise<Msg[]> {
  const dir = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'ba-'));
  const env = { ...process.env, USERPROFILE: dir, HOME: dir };
  const file = hostPaths(process.platform, { ...env, SystemRoot: process.env.SystemRoot }).bridge;
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\ichiro-test-${randomUUID()}` : join(dir, 'b.sock');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ pipe, token: 'a'.repeat(64) }));
  const server = createServer((s) => {
    let buf: Buffer = Buffer.alloc(0);
    s.on('data', (chunk: Buffer) => {
      const { messages, rest } = readFrames(Buffer.concat([buf, chunk]));
      buf = rest;
      for (const m of messages) panel(s, JSON.parse(m));
    });
  });
  await new Promise<void>((done) => server.listen(pipe, done));
  const child = spawn(process.execPath, [MCP], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const send = (m: Msg) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const got: Msg[] = [];
  try {
    return await new Promise<Msg[]>((done) => {
      let out = '';
      child.stdout.on('data', (d: Buffer) => {
        out += d;
        for (let i = out.indexOf('\n'); i >= 0; i = out.indexOf('\n')) {
          const m = JSON.parse(out.slice(0, i));
          out = out.slice(i + 1);
          got.push(m);
          if (m.id === 2 && !m.method) return done(got); // the call's result, not a request of the server's own
          agent(m, send);
        }
      });
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: { form: {} } }, clientInfo: { name: 'test', version: '0' } } });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser', arguments: { commands: ['read'] } } });
    });
  } finally {
    child.kill();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const dialogOf = (got: Msg[]) => got.find((m) => m.method === 'elicitation/create');
const said = (got: Msg[], text: string) => JSON.stringify(got.at(-1)?.result ?? {}).includes(text);

let answered = false;
let shown: Socket | null = null;
const [quick, picked, cancelled] = await Promise.all([
  // You answer in the panel within 10 s: no dialog ever shows.
  call((s, m) => {
    if (m.type !== 'run') return;
    put(s, { type: 'ask', ask: ASK });
    setTimeout(() => finish(s, 'quick reply'), 300);
  }),
  // Still open after 10 s: a dialog shows. Your pick there (keep) reaches the panel as that ask's keep button.
  call(
    (s, m) => {
      if (m.type === 'run') put(s, { type: 'ask', ask: ASK });
      if (m.type !== 'answer') return;
      answered = m.id === ASK.id && m.keep === true;
      finish(s, 'picked reply');
    },
    (m, send) => {
      if (m.method === 'elicitation/create') send({ jsonrpc: '2.0', id: m.id, result: { action: 'accept', content: { choice: 'keep' } } });
    },
  ),
  // You answer in the panel while the dialog shows: its request is cancelled and the call ends.
  call(
    (s, m) => {
      if (m.type !== 'run') return;
      shown = s;
      put(s, { type: 'ask', ask: ASK });
    },
    (m) => {
      if (m.method === 'elicitation/create') finish(shown!, 'cancelled reply');
    },
  ),
]);

if (dialogOf(quick) || !said(quick, 'quick reply')) fail(`quick panel answer: ${JSON.stringify(quick)}`);
if (!dialogOf(picked) || !answered || !said(picked, 'picked reply')) fail(`pick in the dialog: ${JSON.stringify(picked)}`);
const asked = dialogOf(cancelled);
if (!asked || !cancelled.some((m) => m.method === 'notifications/cancelled' && m.params?.requestId === asked.id) || !said(cancelled, 'cancelled reply')) fail(`panel answer while the dialog shows: ${JSON.stringify(cancelled)}`);
