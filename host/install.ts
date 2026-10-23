// Registers the host with every Chromium browser for this user (no admin), or removes it. Run: npm run host:install -- <extension-id> | npm run host:uninstall
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostPaths, launcher, manifest } from '../lib/host-install.ts';
import { appDataRedirected } from '../lib/packaged-app.ts';

function reg(exe: string, args: string[]) {
  // No shell: arguments reach reg.exe as-is.
  return spawnSync(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
}

// Refuse rather than "succeed" where no browser could see the result.
function checkTerminal() {
  const { LOCALAPPDATA } = process.env;
  if (process.platform === 'win32' && LOCALAPPDATA && appDataRedirected(LOCALAPPDATA, `ichiro-probe-${randomUUID()}`)) {
    throw new Error("This terminal runs inside a packaged app (like the Claude desktop app). Windows keeps that app's registry writes private, so no browser would find the host. Run this in your own terminal instead: Windows Terminal, PowerShell or Command Prompt.");
  }
}

function write(file: string, text: string, mode: number) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, { mode });
}

function install(id: string) {
  const paths = hostPaths(process.platform, process.env);
  const script = fileURLToPath(new URL('./host.ts', import.meta.url));
  const launcherText = launcher(process.platform, id, process.execPath, script); // validates the ID first
  checkTerminal();
  write(paths.launcher, launcherText, 0o755);
  for (const file of paths.manifests) write(file, manifest(paths.launcher, id), 0o644);
  if (paths.reg) {
    const [file] = paths.manifests as [string]; // Windows: one manifest, which every browser's key points to
    for (const key of paths.reg.keys) {
      // The key's default value is the manifest's full path.
      const r = reg(paths.reg.exe, ['add', key, '/ve', '/t', 'REG_SZ', '/d', file, '/f']);
      if (r.status !== 0) throw new Error(`reg add ${key} failed: ${r.stderr?.toString().trim() || r.error?.message}`);
    }
  }
  console.log(`Installed for chrome-extension://${id}/ in ${paths.reg?.keys.length ?? paths.manifests.length} browsers' places\n  launcher: ${paths.launcher}`);
  console.log("Next: reload the extension on your browser's extensions page, open the side panel, type: /mcp on");
}

function uninstall() {
  checkTerminal();
  const paths = hostPaths(process.platform, process.env);
  if (paths.reg) for (const key of paths.reg.keys) reg(paths.reg.exe, ['delete', key, '/f']); // fails only where it was never registered
  for (const file of [...paths.manifests, paths.launcher]) rmSync(file, { force: true });
  console.log('Removed the host registrations, manifests and launcher.');
}

try {
  const [action, id] = process.argv.slice(2);
  if (action === 'install') install(id ?? '');
  else if (action === 'uninstall') uninstall();
  else throw new Error('Usage: node host/install.ts install <extension-id> | uninstall');
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
