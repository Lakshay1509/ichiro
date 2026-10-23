// Checks host/host.ts's bridge file: on exit it's deleted only while it still names that host's pipe. Run: npm test
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostPaths } from './host-install.ts';
import { frame, readFrames } from './host-request.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
const HOST = fileURLToPath(new URL('../host/host.ts', import.meta.url));

// Starts the bridge as Chrome would, runs meanwhile(file), then closes stdin like Chrome's disconnect.
// Returns the bridge file's text after the host exited ('' if deleted).
async function hostRun(meanwhile: (file: string) => void): Promise<string> {
  // /tmp off Windows: macOS's long tmpdir() pushes the Unix socket path past its 104-character limit.
  const dir = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'ba-'));
  try {
    // Set on process.env itself (a copy loses Windows' case-blind SystemRoot); node --test runs each file in its own process.
    Object.assign(process.env, { USERPROFILE: dir, HOME: dir, BA_ORIGIN: ORIGIN });
    const file = hostPaths(process.platform, process.env).bridge;
    const host = spawn(process.execPath, [HOST, ORIGIN], { stdio: ['pipe', 'pipe', 'inherit'] });
    const exited = new Promise((done) => host.on('exit', done));
    await new Promise<void>((ready, refuse) => {
      let buf: Buffer = Buffer.alloc(0);
      host.on('exit', (code) => refuse(new Error(`host exited (${code}) before ready`)));
      host.stdout.on('data', (chunk: Buffer) => {
        const { messages, rest } = readFrames(Buffer.concat([buf, chunk]));
        buf = rest;
        if (messages.some((m) => JSON.parse(m).type === 'ready')) ready();
      });
      host.stdin.write(frame({ type: 'bridge' }));
    });
    const { pipe, token } = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof pipe !== 'string' || !/^[0-9a-f]{64}$/.test(token)) fail(`bridge file: ${readFileSync(file, 'utf8')}`);
    meanwhile(file);
    host.stdin.end();
    await exited;
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Its own file: deleted, so the agent hears "bridge is off" instead of dialling a dead pipe.
const own = await hostRun(() => {});
if (own) fail(`own bridge file should be deleted, got ${own}`);

// Another browser's /mcp on rewrote it meanwhile: that browser's bridge stays.
const other = JSON.stringify({ pipe: 'other-browser', token: 'b'.repeat(64) });
const kept = await hostRun((file) => writeFileSync(file, other));
if (kept !== other) fail(`another browser's bridge file should stay, got ${kept || '(deleted)'}`);
