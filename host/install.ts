// Registers the host with Chrome for this user (no admin), or removes it. Run: npm run host:install -- <extension-id> | npm run host:uninstall
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostPaths, launcher, manifest } from '../lib/host-install.ts';

function reg(exe: string, args: string[]) {
  // No shell: arguments reach reg.exe as-is.
  return spawnSync(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
}

function install(id: string) {
  const paths = hostPaths(process.platform, process.env);
  const script = fileURLToPath(new URL('./host.ts', import.meta.url));
  const launcherText = launcher(process.platform, id, process.execPath, script); // validates the ID first
  for (const [file, text, mode] of [[paths.launcher, launcherText, 0o755], [paths.manifest, manifest(paths.launcher, id), 0o644]] as const) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { mode });
  }
  if (paths.reg) {
    // The key's default value is the manifest's full path.
    const r = reg(paths.reg.exe, ['add', paths.reg.key, '/ve', '/t', 'REG_SZ', '/d', paths.manifest, '/f']);
    if (r.status !== 0) throw new Error(`reg add failed: ${r.stderr?.toString().trim() || r.error?.message}`);
  }
  console.log(`Installed for chrome-extension://${id}/\n  launcher: ${paths.launcher}\n  manifest: ${paths.manifest}`);
  console.log('Next: reload the extension in chrome://extensions, open the side panel, type: model');
}

function uninstall() {
  const paths = hostPaths(process.platform, process.env);
  if (paths.reg) reg(paths.reg.exe, ['delete', paths.reg.key, '/f']); // fails only if it was never registered
  for (const file of [paths.manifest, paths.launcher]) rmSync(file, { force: true });
  console.log('Removed the host registration, manifest and launcher.');
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
