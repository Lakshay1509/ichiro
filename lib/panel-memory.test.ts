// Checks the panel's remembered switches with a fake chrome.storage.local: defaults, save → read back, the lock
// before writing, and bad saved values dropped. Run: npm test
import { recall, remember } from './panel-memory.ts';

const fail = (what: string): never => {
  throw new Error(what);
};

// A fake storage.local and a fake publicSuffix (the suffix plus one label).
let store: Record<string, unknown> = {};
let level = '';
const local = {
  get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
  set: async (items: Record<string, unknown>) => {
    if (!level) fail('wrote before the lock');
    store = { ...store, ...structuredClone(items) };
  },
  setAccessLevel: async ({ accessLevel }: { accessLevel: string }) => void (level = accessLevel),
};
const getDomain = (host: string) => host.split('.').slice(-2).join('.');
Object.assign(globalThis, { browser: { storage: { local }, publicSuffix: { getDomain } } });

// Nothing saved yet: all off, no Sites.
if (JSON.stringify(await recall()) !== '{"mcpOn":false,"mcpSites":[],"overlayOn":false,"alwaysOn":false}') fail(`defaults: ${JSON.stringify(await recall())}`);

// Save → read back, locked to trusted contexts before the first write. A partial save keeps the rest.
await remember({ mcpOn: true, mcpSites: ['amazon.in', 'wikipedia.org'] });
if (level !== 'TRUSTED_CONTEXTS') fail(`lock: ${level}`);
await remember({ overlayOn: true });
await remember({ alwaysOn: true });
const back = await recall();
if (!back.mcpOn || !back.overlayOn || !back.alwaysOn || back.mcpSites.join() !== 'amazon.in,wikipedia.org') fail(`read back: ${JSON.stringify(back)}`);
await remember({ alwaysOn: false });
if ((await recall()).alwaysOn) fail('always-on turned off again');

// Bad saved values: anything not exactly a site is dropped (never turned into one), duplicates once, non-true is off.
// BG5: always-on that isn't exactly true is off, so the bridge never outlives the panel by accident.
store = { mcpOn: 'yes', overlayOn: 1, alwaysOn: 'true', mcpSites: ['amazon.in', 'evil.com/path', 'https://evil.com', 'www.evil.com', 5, '', 'amazon.in'] };
const bad = await recall();
if (bad.mcpOn || bad.overlayOn || bad.alwaysOn || bad.mcpSites.join() !== 'amazon.in') fail(`bad values: ${JSON.stringify(bad)}`);
for (const alwaysOn of [1, 'on', {}, null]) {
  store = { alwaysOn };
  if ((await recall()).alwaysOn) fail(`always-on saved as ${JSON.stringify(alwaysOn)}`);
}
store = { mcpSites: 'amazon.in' };
if ((await recall()).mcpSites.length) fail('Sites saved as a string, not a list');

console.log('panel-memory: ok');
