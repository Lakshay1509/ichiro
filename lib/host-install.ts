// Builds what host:install writes per OS: the launcher Chrome starts, the host manifest, and where they go.
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
export const HOST_NAME = 'com.browser_agent.host';

export interface HostPaths {
  launcher: string;
  manifest: string;
  // The MCP bridge's pipe address and token (/mcp on), in your own folder: only you (and admins) can read it.
  bridge: string;
  // Windows only: Chrome finds the manifest through this registry key (current user, no admin).
  reg?: { exe: string; key: string };
}

export function hostPaths(platform: string, env: Record<string, string | undefined>): HostPaths {
  if (platform === 'win32') {
    const { SystemRoot, LOCALAPPDATA } = env;
    if (!SystemRoot || !LOCALAPPDATA) throw new Error('SystemRoot or LOCALAPPDATA is not set');
    const dir = `${LOCALAPPDATA}\\browser-agent`; // next to the key file (3.1a)
    return {
      launcher: `${dir}\\host.bat`,
      manifest: `${dir}\\${HOST_NAME}.json`,
      bridge: `${dir}\\bridge.json`,
      // Full path: a bare "reg" could resolve to a planted reg.exe in the working folder.
      reg: { exe: `${SystemRoot}\\System32\\reg.exe`, key: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}` },
    };
  }
  const { HOME } = env;
  if (!HOME) throw new Error('HOME is not set');
  const chromeDir =
    platform === 'darwin' ? `${HOME}/Library/Application Support/Google/Chrome` :
    platform === 'linux' ? `${HOME}/.config/google-chrome` :
    undefined;
  if (!chromeDir) throw new Error(`Unsupported OS: ${platform}. Supported: Windows, macOS, Linux.`);
  return { launcher: `${HOME}/.browser-agent/host.sh`, manifest: `${chromeDir}/NativeMessagingHosts/${HOST_NAME}.json`, bridge: `${HOME}/.browser-agent/bridge.json` };
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
  const m = { name: HOST_NAME, description: 'Browser Agent model helper', path: launcherPath, type: 'stdio', allowed_origins: [originFor(id)] };
  return `${JSON.stringify(m, null, 2)}\n`;
}
