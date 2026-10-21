// Sets, checks and clears the API key in the OS keystore; readKey() hands it to the host. Run: npm run key:set | key:check | key:clear
import { spawn } from 'node:child_process';
import { checkKey, keyCommand, type KeyAction } from '../lib/keystore.ts';

function start(action: KeyAction, interactive: boolean) {
  const { file, args, env } = keyCommand(action, process.platform, process.env);
  // No shell: arguments go to the tool as-is. windowsHide only for the background read (Read-Host needs the console).
  // Source: https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processspawncommand-args-options
  const child = spawn(file, args, {
    env: env ?? process.env,
    stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    windowsHide: !interactive,
  });
  const done = new Promise<number | null>((resolve, reject) => {
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(e.code === 'ENOENT' ? new Error(`${file} not found.${file === 'secret-tool' ? ' Install libsecret-tools.' : ''}`) : e),
    );
    child.on('close', resolve);
  });
  return { child, done };
}

// The key travels only through this pipe and stays in memory. Never log the return value.
export async function readKey(): Promise<string> {
  const { child, done } = start('get', false);
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout?.on('data', (c: Buffer) => out.push(c));
  child.stderr?.on('data', (c: Buffer) => err.push(c));
  if ((await done) !== 0) throw new Error(`No key found. Run: npm run key:set\n${Buffer.concat(err).toString().trim()}`);
  return checkKey(Buffer.concat(out).toString());
}

async function main(action: string | undefined) {
  if (action === 'set' || action === 'clear') {
    // The OS tool prompts and prints its own errors.
    if ((await start(action, true).done) !== 0) return void (process.exitCode = 1);
    if (action === 'clear') return console.log('Key removed.');
  } else if (action !== 'check') {
    console.error('Usage: node host/key.ts set | check | clear');
    return void (process.exitCode = 1);
  }
  const key = await readKey();
  // Length and the public prefix only, never the key.
  const prefix = key.startsWith('sk-ant-') ? 'starts with sk-ant-' : 'WARNING: does not start with sk-ant-, is this an Anthropic key?';
  console.log(`Key found: ${key.length} characters, ${prefix}`);
}

if (import.meta.main) {
  main(process.argv[2]).catch((e: Error) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
