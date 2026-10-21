// Checks the launcher, manifest and paths host:install builds for each OS. Run: npm test
import { HOST_NAME, hostPaths, launcher, manifest, originFor } from './host-install.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const throws = (f: () => unknown, what: string) => {
  try {
    f();
  } catch {
    return;
  }
  fail(`${what} should throw`);
};
const ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${ID}/`;

// Paths: user-level everywhere; Windows registers under HKCU with a full reg.exe path.
const win = hostPaths('win32', { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' });
if (win.launcher !== 'C:\\Users\\me\\AppData\\Local\\browser-agent\\host.bat') fail(`win launcher: ${win.launcher}`);
if (win.manifest !== `C:\\Users\\me\\AppData\\Local\\browser-agent\\${HOST_NAME}.json`) fail(`win manifest: ${win.manifest}`);
if (win.bridge !== 'C:\\Users\\me\\AppData\\Local\\browser-agent\\bridge.json') fail(`win bridge: ${win.bridge}`);
if (win.reg?.exe !== 'C:\\Windows\\System32\\reg.exe' || win.reg.key !== `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`) fail(`win reg: ${JSON.stringify(win.reg)}`);
const mac = hostPaths('darwin', { HOME: '/Users/me' });
if (mac.manifest !== `/Users/me/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json` || mac.reg) fail(`mac: ${JSON.stringify(mac)}`);
const linux = hostPaths('linux', { HOME: '/home/me' });
if (linux.manifest !== `/home/me/.config/google-chrome/NativeMessagingHosts/${HOST_NAME}.json` || linux.launcher !== '/home/me/.browser-agent/host.sh' || linux.bridge !== '/home/me/.browser-agent/bridge.json') fail(`linux: ${JSON.stringify(linux)}`);
throws(() => hostPaths('win32', { SystemRoot: 'C:\\Windows' }), 'win32 without LOCALAPPDATA');
throws(() => hostPaths('linux', {}), 'linux without HOME');
throws(() => hostPaths('freebsd', { HOME: '/home/me' }), 'unknown OS');

// Host name follows Chrome's rule: lowercase letters, digits, _ and single dots, no dot at either end.
if (!/^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(HOST_NAME)) fail(`bad host name ${HOST_NAME}`);

// ID: exactly 32 letters a–p; anything else (wildcards, other letters, a whole origin) is refused.
if (originFor(ID) !== ORIGIN) fail('origin');
for (const bad of ['', '*', ID.slice(1), `${ID}a`, ID.replace('a', 'z'), ID.toUpperCase(), ORIGIN]) throws(() => originFor(bad), `ID ${JSON.stringify(bad)}`);

// Launchers: exact Node + script, BA_ORIGIN set, Chrome's arguments passed on; Windows echoes nothing to stdout.
const bat = launcher('win32', ID, 'C:\\Program Files\\nodejs\\node.exe', 'C:\\repo\\host\\host.ts');
if (bat !== `@echo off\r\nset "BA_ORIGIN=${ORIGIN}"\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\repo\\host\\host.ts" %*\r\n`) fail(`bat: ${bat}`);
const sh = launcher('linux', ID, '/usr/bin/node', '/home/me/repo/host/host.ts');
if (sh !== `#!/bin/sh\nexport BA_ORIGIN='${ORIGIN}'\nexec '/usr/bin/node' '/home/me/repo/host/host.ts' "$@"\n`) fail(`sh: ${sh}`);
for (const p of ['C:\\100%\\node.exe', 'C:\\a"b\\node.exe', "/home/o'neil/node", '/a\nb/node']) throws(() => launcher('win32', ID, p, '/x/host.ts'), `path ${JSON.stringify(p)}`);
throws(() => launcher('linux', 'not-an-id', '/usr/bin/node', '/x/host.ts'), 'launcher with bad ID');

// Manifest: Chrome's fields, absolute launcher path, exactly one allowed origin.
const m = JSON.parse(manifest('/home/me/.browser-agent/host.sh', ID));
const want = { name: HOST_NAME, description: 'Browser Agent model helper', path: '/home/me/.browser-agent/host.sh', type: 'stdio', allowed_origins: [ORIGIN] };
if (JSON.stringify(m) !== JSON.stringify(want)) fail(`manifest: ${JSON.stringify(m)}`);
