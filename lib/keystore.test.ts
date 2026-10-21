// Checks the keystore command for each OS and the stored-key check. Run: npm test
import { checkKey, keyCommand, type KeyAction } from './keystore.ts';

const winEnv = { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', Path: 'C:\\bin', PSMODULEPATH: 'C:\\ps7' };
const actions: KeyAction[] = ['set', 'get', 'clear'];

// Windows: full PowerShell path, key file under LOCALAPPDATA, only set may prompt.
for (const action of actions) {
  const cmd = keyCommand(action, 'win32', winEnv);
  if (cmd.file !== 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe') throw new Error(`win32 ${action}: file = ${cmd.file}`);
  if (cmd.env?.BA_KEY_FILE !== 'C:\\Users\\me\\AppData\\Local\\browser-agent\\anthropic.key') throw new Error(`win32 ${action}: BA_KEY_FILE = ${cmd.env?.BA_KEY_FILE}`);
  if (cmd.args.includes('-NonInteractive') !== (action !== 'set')) throw new Error(`win32 ${action}: wrong -NonInteractive`);
  if (cmd.args.some((a) => a.includes('Users\\me'))) throw new Error(`win32 ${action}: path spliced into the script`);
  // PowerShell 7's PSModulePath breaks 5.1's Security module; the rest of the env is kept.
  if (Object.keys(cmd.env ?? {}).some((k) => k.toUpperCase() === 'PSMODULEPATH')) throw new Error(`win32 ${action}: PSModulePath passed on`);
  if (cmd.env?.Path !== 'C:\\bin') throw new Error(`win32 ${action}: env not inherited`);
}
if (!keyCommand('set', 'win32', winEnv).args.join(' ').includes('ConvertFrom-SecureString $k |')) throw new Error('win32 set: must use DPAPI (no -Key)');

// macOS: Keychain via /usr/bin/security; set ends with -w so it prompts.
const macSet = keyCommand('set', 'darwin', {});
if (macSet.file !== '/usr/bin/security' || macSet.args.at(-1) !== '-w') throw new Error(`darwin set: ${JSON.stringify(macSet)}`);
const macGet = keyCommand('get', 'darwin', {}).args;
if (macGet[0] !== 'find-generic-password' || macGet.at(-1) !== '-w') throw new Error(`darwin get: ${macGet}`);
if (keyCommand('clear', 'darwin', {}).args[0] !== 'delete-generic-password') throw new Error('darwin clear');

// Linux: secret-tool store / lookup / clear with the same attributes.
const want = { set: 'store', get: 'lookup', clear: 'clear' };
for (const action of actions) {
  const cmd = keyCommand(action, 'linux', {});
  if (cmd.file !== 'secret-tool' || cmd.args[0] !== want[action]) throw new Error(`linux ${action}: ${JSON.stringify(cmd)}`);
  if (cmd.args.slice(-4).join(' ') !== 'service browser-agent account anthropic') throw new Error(`linux ${action}: attributes ${cmd.args}`);
}

// Missing env or an unknown OS fails loudly instead of falling back to a plain file.
const throws = (f: () => unknown, what: string) => {
  try {
    f();
  } catch {
    return;
  }
  throw new Error(`${what} should throw`);
};
throws(() => keyCommand('get', 'win32', { SystemRoot: 'C:\\Windows' }), 'win32 without LOCALAPPDATA');
throws(() => keyCommand('get', 'freebsd', {}), 'unknown OS');

// checkKey: trims the newline tools add; rejects empty or odd values without echoing them.
if (checkKey('sk-ant-abc123\r\n') !== 'sk-ant-abc123') throw new Error('checkKey should trim');
for (const bad of ['', '  \n', 'sk-ant-secret value', 'sk-ant-\u0000x', 'sk-ant-ü']) {
  try {
    checkKey(bad);
  } catch (e) {
    if (bad.trim() && (e as Error).message.includes(bad.trim())) throw new Error('checkKey error echoed the key');
    continue;
  }
  throw new Error(`checkKey(${JSON.stringify(bad)}) should throw`);
}
