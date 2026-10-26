// Builds what host:install writes per OS: the launcher a browser starts, the host manifests, and where they go.
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
// No Node imports here: the extension's background imports HOST_NAME from this file.
export const HOST_NAME = 'com.ichiro.host';

// The log line when the bridge ends. Before host:install ran for this extension's id, Chrome says "Specified native
// messaging host not found." (or "Access to the specified native messaging host is forbidden." for another id): a
// first-time setup, so it says how, as a calm card with a headline (className stop), not a red error.
export function bridgeOff(reason: string | undefined, id: string): { text: string; className: 'stop' | 'error' } {
  if (/native messaging host (not found|is forbidden)/.test(reason ?? '')) {
    return { text: `Set up MCP once on this computer\nIn your own terminal (not one inside the Claude app), in the Ichiro folder, run:\nnpm run host:install -- ${id}\nThen close and reopen this side panel.`, className: 'stop' };
  }
  return { text: `MCP bridge off: ${reason ?? 'the local helper stopped'}`, className: 'error' };
}

// /update: what you paste into your coding agent after Ichiro updates. It moves the local copy behind its MCP server (and
// the helper Chrome starts from it) to the release tag of the extension you have, so the two always match.
// The restart is off and on, never /mcp on: that also trusts the current tab's site.
export function updatePrompt(id: string, version: string): string {
  const steps = [
    'Find the Ichiro folder: your "ichiro" MCP server runs node <that folder>/host/mcp.ts (in Claude Code: claude mcp get ichiro).',
    "In it, if git status shows changes, or git log --branches --not --remotes shows commits that aren't on GitHub, stop and tell me: don't move or discard my work.",
    `Run git fetch --tags, then git checkout v${version}, then npm install. If there's no tag v${version}, stop and tell me.`,
    `If that changed host/install.ts or lib/bridge/host-install.ts, register the browser helper again: npm run host:install -- ${id}\n   If it refuses because it runs inside the Claude desktop app on Windows, ask me to run that one command in my own terminal.`,
    'Ask me to turn Ichiro off and back on in chrome://extensions and open its side panel: that starts the updated helper.',
    'Tell me when it\'s done, and whether I need to restart you so the updated "browser" tool loads.',
  ];
  return `Make the local copy behind your "ichiro" MCP server match my Ichiro extension, version ${version}.\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

// Where each Chromium browser looks for native hosts, so /mcp on works in any of them, not only Chrome.
// Windows registry (HKCU\Software\…): Chrome, Chromium, Edge, Brave, Vivaldi as KeePassXC's installer registers them; Opera,
// Arc, Island, Prisma as Anthropic's Claude installer does. Edge also falls back to Chrome's key.
// Sources: https://github.com/keepassxreboot/keepassxc/blob/develop/src/browser/NativeMessageInstaller.cpp
// https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging
const WIN_BROWSERS = ['Google\\Chrome', 'Chromium', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser', 'Vivaldi', 'Opera Software\\Opera Stable', 'ArcBrowser\\Arc', 'Island\\Island', 'Palo Alto Networks\\PrismaAccessBrowser'];
// macOS (~/Library/Application Support/…) and Linux (~/.config/…): each browser reads only its own folder, same sources.
// Opera and Arc aren't here: their macOS/Linux folders aren't verified. Chrome for Testing (Linux) is in for cloud test runs: normal Chrome dropped --load-extension in v137.
const MAC_BROWSERS = ['Google/Chrome', 'Chromium', 'Microsoft Edge', 'BraveSoftware/Brave-Browser', 'Vivaldi'];
const LINUX_BROWSERS = ['google-chrome', 'google-chrome-for-testing', 'chromium', 'microsoft-edge', 'BraveSoftware/Brave-Browser', 'vivaldi'];

export interface HostPaths {
  launcher: string;
  // Windows: one file that every browser's registry key points to. macOS/Linux: a copy in each browser's folder.
  manifests: string[];
  // The MCP bridge's pipe address and token (/mcp on), in your own folder: only you (and admins) can read it.
  bridge: string;
  // Windows only: each browser finds the manifest through its registry key (current user, no admin).
  reg?: { exe: string; keys: string[] };
}

export function hostPaths(platform: string, env: Record<string, string | undefined>): HostPaths {
  if (platform === 'win32') {
    const { SystemRoot, USERPROFILE } = env;
    if (!SystemRoot || !USERPROFILE) throw new Error('SystemRoot or USERPROFILE is not set');
    // Not AppData: Windows hides AppData files written from inside a packaged app (like the Claude desktop app) from
    // every other app, browsers included. Source: https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization
    const dir = `${USERPROFILE}\\.ichiro`;
    return {
      launcher: `${dir}\\host.bat`,
      manifests: [`${dir}\\${HOST_NAME}.json`],
      bridge: `${dir}\\bridge.json`,
      // Full path: a bare "reg" could resolve to a planted reg.exe in the working folder.
      reg: { exe: `${SystemRoot}\\System32\\reg.exe`, keys: WIN_BROWSERS.map((b) => `HKCU\\Software\\${b}\\NativeMessagingHosts\\${HOST_NAME}`) },
    };
  }
  const { HOME } = env;
  if (!HOME) throw new Error('HOME is not set');
  const base = platform === 'darwin' ? `${HOME}/Library/Application Support` : platform === 'linux' ? `${HOME}/.config` : undefined;
  if (!base) throw new Error(`Unsupported OS: ${platform}. Supported: Windows, macOS, Linux.`);
  const browsers = platform === 'darwin' ? MAC_BROWSERS : LINUX_BROWSERS;
  return { launcher: `${HOME}/.ichiro/host.sh`, manifests: browsers.map((b) => `${base}/${b}/NativeMessagingHosts/${HOST_NAME}.json`), bridge: `${HOME}/.ichiro/bridge.json` };
}

// Chrome IDs are 32 letters a–p (hex digits 0–f shifted to letters).
// Source: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/Xwcs6XH_1_U
export function originFor(id: string): string {
  if (!/^[a-p]{32}$/.test(id)) throw new Error('Extension ID must be the 32 letters (a–p) shown in chrome://extensions');
  return `chrome-extension://${id}/`;
}

// The launcher runs the host with this exact Node and sets BA_ORIGIN, the caller host.ts accepts.
// Windows: @echo off keeps stdout clean (it is Chrome's message channel).
export function launcher(platform: string, id: string, node: string, script: string): string {
  const origin = originFor(id);
  // Quotes, % (batch variables) and line breaks would break out of the quoted paths below.
  for (const p of [node, script]) if (/["'%\r\n]/.test(p)) throw new Error(`Path has a quote, % or line break: ${p}`);
  if (platform === 'win32') return `@echo off\r\nset "BA_ORIGIN=${origin}"\r\n"${node}" "${script}" %*\r\n`;
  return `#!/bin/sh\nexport BA_ORIGIN='${origin}'\nexec '${node}' '${script}' "$@"\n`;
}

// allowed_origins is the real lock: Chrome starts the host only for this exact ID (no wildcards allowed).
export function manifest(launcherPath: string, id: string): string {
  const m = { name: HOST_NAME, description: 'Ichiro MCP bridge', path: launcherPath, type: 'stdio', allowed_origins: [originFor(id)] };
  return `${JSON.stringify(m, null, 2)}\n`;
}
