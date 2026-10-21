// Builds the OS keystore command that sets, reads or clears the API key. The key is never an argument.
export type KeyAction = 'set' | 'get' | 'clear';

export interface KeyCommand {
  file: string;
  args: string[];
  // The child's whole environment. Unset = inherit ours.
  env?: Record<string, string | undefined>;
}

const SERVICE = 'browser-agent';
const ACCOUNT = 'anthropic';
const LABEL = 'Browser Agent API key';

// Windows: DPAPI, current user only. ConvertFrom-SecureString with no key uses DPAPI.
// Source: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/convertfrom-securestring
// The file path goes in through an env var, so no path is ever spliced into the script.
const WINDOWS_SCRIPTS: Record<KeyAction, string> = {
  set:
    "$ErrorActionPreference = 'Stop'; $k = Read-Host -AsSecureString -Prompt 'Anthropic API key'; " +
    "if ($k.Length -eq 0) { throw 'No key entered' }; " +
    'New-Item -ItemType Directory -Force -Path (Split-Path $env:BA_KEY_FILE) | Out-Null; ' +
    'ConvertFrom-SecureString $k | Set-Content -NoNewline -LiteralPath $env:BA_KEY_FILE',
  // NetworkCredential(String, SecureString) turns the SecureString back into text (.NET Framework 4.0+).
  // Source: https://learn.microsoft.com/en-us/dotnet/api/system.net.networkcredential.-ctor
  get:
    "$ErrorActionPreference = 'Stop'; " +
    '$k = (Get-Content -Raw -LiteralPath $env:BA_KEY_FILE).Trim() | ConvertTo-SecureString; ' +
    "[Console]::Out.Write([Net.NetworkCredential]::new('', $k).Password)",
  clear: "$ErrorActionPreference = 'Stop'; Remove-Item -LiteralPath $env:BA_KEY_FILE",
};

// macOS Keychain. `-w` last makes `security` prompt for the key itself.
// Source: https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/security.c
const MAC_ARGS: Record<KeyAction, string[]> = {
  set: ['add-generic-password', '-U', '-a', ACCOUNT, '-s', SERVICE, '-l', LABEL, '-w'],
  get: ['find-generic-password', '-a', ACCOUNT, '-s', SERVICE, '-w'],
  clear: ['delete-generic-password', '-a', ACCOUNT, '-s', SERVICE],
};

// Linux Secret Service (GNOME Keyring, KWallet). `store` prompts on a terminal.
// Source: https://man.archlinux.org/man/secret-tool.1.en
const LINUX_ARGS: Record<KeyAction, string[]> = {
  set: ['store', `--label=${LABEL}`, 'service', SERVICE, 'account', ACCOUNT],
  get: ['lookup', 'service', SERVICE, 'account', ACCOUNT],
  clear: ['clear', 'service', SERVICE, 'account', ACCOUNT],
};

export function keyCommand(action: KeyAction, platform: string, env: Record<string, string | undefined>): KeyCommand {
  if (platform === 'win32') {
    const { SystemRoot, LOCALAPPDATA } = env;
    if (!SystemRoot || !LOCALAPPDATA) throw new Error('SystemRoot or LOCALAPPDATA is not set');
    return {
      // Full path: a bare name could resolve to a powershell.exe planted in the working directory.
      file: `${SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      // set needs a console for the hidden prompt, so only get and clear are non-interactive.
      args: ['-NoProfile', ...(action === 'set' ? [] : ['-NonInteractive']), '-Command', WINDOWS_SCRIPTS[action]],
      // Drop PSModulePath: from a PowerShell 7 terminal it points 5.1 at 7's Security module, which won't load.
      env: {
        ...Object.fromEntries(Object.entries(env).filter(([k]) => k.toUpperCase() !== 'PSMODULEPATH')),
        BA_KEY_FILE: `${LOCALAPPDATA}\\browser-agent\\anthropic.key`,
      },
    };
  }
  if (platform === 'darwin') return { file: '/usr/bin/security', args: MAC_ARGS[action] };
  if (platform === 'linux') return { file: 'secret-tool', args: LINUX_ARGS[action] };
  throw new Error(`Unsupported OS: ${platform}. Supported: Windows, macOS, Linux.`);
}

// Cleans what the keystore printed. Errors never include the value, so a key can't leak into a log.
export function checkKey(raw: string): string {
  const key = raw.trim();
  if (!key) throw new Error('The stored key is empty. Run: npm run key:set');
  // Visible ASCII only: anything else would break, or smuggle extra lines into, the request header.
  if (!/^[\x21-\x7e]+$/.test(key)) throw new Error('The stored key has spaces or odd characters. Run: npm run key:set');
  return key;
}
