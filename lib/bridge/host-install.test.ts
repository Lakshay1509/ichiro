// Checks the launcher, manifest and paths host:install builds for each OS. Run: npm test
import { bridgeOff, HOST_NAME, hostPaths, launcher, manifest, originFor, updatePrompt } from './host-install.ts';

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

// Paths: user-level everywhere, host files in ~/.ichiro (never AppData); Windows registers each browser under HKCU only,
// with a full reg.exe path; macOS/Linux put a manifest in each browser's own folder.
const win = hostPaths('win32', { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\me' });
if (win.launcher !== 'C:\\Users\\me\\.ichiro\\host.bat') fail(`win launcher: ${win.launcher}`);
if (win.manifests.join() !== `C:\\Users\\me\\.ichiro\\${HOST_NAME}.json`) fail(`win manifests: ${win.manifests}`);
if (win.bridge !== 'C:\\Users\\me\\.ichiro\\bridge.json') fail(`win bridge: ${win.bridge}`);
const keys = win.reg?.keys ?? [];
for (const browser of ['Google\\Chrome', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser']) if (!keys.includes(`HKCU\\Software\\${browser}\\NativeMessagingHosts\\${HOST_NAME}`)) fail(`win reg misses ${browser}`);
if (win.reg?.exe !== 'C:\\Windows\\System32\\reg.exe' || keys.some((k) => !/^HKCU\\Software\\[^\\]+(\\[^\\]+)?\\NativeMessagingHosts\\/.test(k) || !k.endsWith(`\\${HOST_NAME}`))) fail(`win reg: ${JSON.stringify(win.reg)}`);
const mac = hostPaths('darwin', { HOME: '/Users/me' });
for (const browser of ['Google/Chrome', 'Microsoft Edge', 'BraveSoftware/Brave-Browser']) if (!mac.manifests.includes(`/Users/me/Library/Application Support/${browser}/NativeMessagingHosts/${HOST_NAME}.json`)) fail(`mac misses ${browser}`);
if (mac.reg || mac.launcher !== '/Users/me/.ichiro/host.sh') fail(`mac: ${JSON.stringify(mac)}`);
const linux = hostPaths('linux', { HOME: '/home/me' });
for (const browser of ['google-chrome', 'google-chrome-for-testing', 'microsoft-edge', 'chromium']) if (!linux.manifests.includes(`/home/me/.config/${browser}/NativeMessagingHosts/${HOST_NAME}.json`)) fail(`linux misses ${browser}`);
if (linux.launcher !== '/home/me/.ichiro/host.sh' || linux.bridge !== '/home/me/.ichiro/bridge.json') fail(`linux: ${JSON.stringify(linux)}`);
throws(() => hostPaths('win32', { SystemRoot: 'C:\\Windows' }), 'win32 without USERPROFILE');
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
const m = JSON.parse(manifest('/home/me/.ichiro/host.sh', ID));
const want = { name: HOST_NAME, description: 'Ichiro MCP bridge', path: '/home/me/.ichiro/host.sh', type: 'stdio', allowed_origins: [ORIGIN] };
if (JSON.stringify(m) !== JSON.stringify(want)) fail(`manifest: ${JSON.stringify(m)}`);

// The bridge's end: not set up yet (Chrome's two setup errors) says how, with this id, as a calm card; anything else
// stays a red error with Chrome's reason.
const setup = bridgeOff('Specified native messaging host not found.', ID);
if (setup.className !== 'stop' || !setup.text.startsWith('Set up MCP once') || !setup.text.includes(`npm run host:install -- ${ID}\n`)) fail(`not found: ${JSON.stringify(setup)}`);
if (bridgeOff('Access to the specified native messaging host is forbidden.', ID).className !== 'stop') fail('forbidden is setup too');
const crash = bridgeOff('Native host has exited.', ID);
if (crash.className !== 'error' || crash.text !== 'MCP bridge off: Native host has exited.') fail(`crash: ${JSON.stringify(crash)}`);
if (bridgeOff(undefined, ID).text !== 'MCP bridge off: the local helper stopped') fail('no reason');

// /update: this id, a pull that never discards your changes, a build only when loaded unpacked, and a reload to start
// the updated helper, never /mcp (its "on" trusts the current tab's site).
const store = updatePrompt(ID, false);
const dev = updatePrompt(ID, true);
if (!store.includes('git pull --ff-only') || !store.includes(`npm run host:install -- ${ID}\n`) || store.includes('npm run build') || !store.includes('turn Ichiro off and back on')) fail(`update (store): ${store}`);
if (!dev.includes('npm run build') || !dev.includes('reload icon')) fail(`update (unpacked): ${dev}`);
if ([store, dev].some((p) => /\/mcp (on|off)/.test(p))) fail('update prompt sends /mcp on|off');
