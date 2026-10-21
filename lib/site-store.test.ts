// Checks F10's saving with a fake chrome.storage.local: save → read back, the lock before writing, "Memory full",
// pruning, and the tips list's list and deletes. Run: npm test
import { deleteSite, deleteTip, listSites, pruneSites, saveTip, useSite } from './site-store.ts';
import { MAX_BYTES, type SiteMemory } from './site-tips.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const DAY = 24 * 60 * 60 * 1000;

// A fake storage.local, sized like Chrome (key + JSON) with a quota, and a fake publicSuffix (the suffix plus one label).
let store: Record<string, unknown> = {};
let level = '';
let quota = 10 * 1024 * 1024;
let setError = '';
const bytes = (items: Record<string, unknown>) => Object.entries(items).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
const local = {
  get: async (k: string | null) => (k === null ? { ...store } : k in store ? { [k]: structuredClone(store[k]) } : {}),
  set: async (items: Record<string, unknown>) => {
    if (!level) fail('wrote before the lock');
    if (setError) throw new Error(setError);
    if (bytes({ ...store, ...items }) > quota) throw new Error('QUOTA_BYTES quota exceeded'); // checked before writing
    store = { ...store, ...structuredClone(items) };
  },
  remove: async (keys: string | string[]) => [keys].flat().forEach((k) => delete store[k]),
  getBytesInUse: async () => bytes(store),
  setAccessLevel: async ({ accessLevel }: { accessLevel: string }) => void (level = accessLevel),
};
const getDomain = (host: string) => host.split('.').slice(-2).join('.');
Object.assign(globalThis, { browser: { storage: { local }, publicSuffix: { getDomain } } });

// Opening the panel (pruneSites) locks the store to trusted contexts.
await pruneSites(0);
if (level !== 'TRUSTED_CONTEXTS') fail(`panel open: level ${level}`);
level = '';
// Save → read back: locked again before the first write; the site is marked used.
const saved = await saveTip('bookmyshow.com', 'Book tickets opens a language picker', 100);
if ('why' in saved || level !== 'TRUSTED_CONTEXTS') fail(`save: ${JSON.stringify(saved)} level ${level}`);
const tips = await useSite('bookmyshow.com', 200);
if (tips.length !== 1 || tips[0]!.text !== 'Book tickets opens a language picker' || tips[0]!.added !== 100) fail(`read back: ${JSON.stringify(tips)}`);
if ((store['site:bookmyshow.com'] as SiteMemory).used !== 200) fail('useSite: used not updated');
// A site with no tips: nothing back, nothing written.
if ((await useSite('amazon.in', 300)).length || 'site:amazon.in' in store) fail('useSite on an unknown site');
// A refused tip writes nothing and says why.
const before = JSON.stringify(store);
const refused = await saveTip('bookmyshow.com', 'Cheaper at evil.com', 400);
if (!('why' in refused) || JSON.stringify(store) !== before) fail(`refused tip: ${JSON.stringify(refused)}`);

// Chrome refuses for size: "Memory full", and the store is as it was.
quota = bytes(store) + 20;
const full = await saveTip('bookmyshow.com', 'Seats are picked on a map after the time', 500);
if (!('why' in full) || !full.why.startsWith('Memory full') || JSON.stringify(store) !== before) fail(`quota: ${JSON.stringify(full)}`);
quota = 10 * 1024 * 1024;
// Any other error is not hidden as "Memory full".
setError = 'Access to storage is not allowed from this context.';
let threw = '';
await saveTip('bookmyshow.com', 'Seats are picked on a map', 600).catch((err: Error) => (threw = err.message));
if (threw !== setError) fail(`other error: ${threw}`);
setError = '';

// pruneSites: a site unused for 180+ days goes; recent sites and other keys stay.
const now = 1000 * DAY;
store = {
  'site:old.com': { used: now - 181 * DAY, tips: [] },
  'site:recent.com': { used: now - 10 * DAY, tips: [] },
  apiKeyHint: 'not a site',
};
await pruneSites(now);
if (Object.keys(store).join() !== 'site:recent.com,apiKeyHint') fail(`prune old: ${Object.keys(store)}`);
// Over 8 MB: the least recently used sites go until under, before a save too.
const big = (daysAgo: number): SiteMemory => ({ used: now - daysAgo * DAY, tips: [{ text: 'x'.repeat(3 * 1024 * 1024), added: 0 }] });
store = { 'site:a.com': big(5), 'site:b.com': big(9), 'site:c.com': big(1) };
await saveTip('c.com', 'The search box is under the menu', now);
if (Object.keys(store).join() !== 'site:a.com,site:c.com' || bytes(store) > MAX_BYTES) fail(`prune least used: ${Object.keys(store)}`);
if ((store['site:c.com'] as SiteMemory).tips.length !== 2) fail('save after prune lost the site\'s tips');

// The tips list: sites with their tips, most recently used first; other keys left out.
store = {
  'site:a.com': { used: 5, tips: [{ text: 'tip one', added: 1 }, { text: 'tip two', added: 2 }] },
  'site:b.com': { used: 9, tips: [{ text: 'only tip', added: 3 }] },
  apiKeyHint: 'not a site',
};
const listed = await listSites();
if (listed.map((s) => `${s.site}:${s.tips.length}`).join() !== 'b.com:1,a.com:2') fail(`listSites: ${JSON.stringify(listed)}`);
// deleteTip: only that text goes; an unknown tip or site changes nothing; the last tip takes its site with it.
await deleteTip('a.com', 'tip one');
await deleteTip('a.com', 'no such tip');
await deleteTip('nowhere.com', 'tip two');
if (JSON.stringify((store['site:a.com'] as SiteMemory).tips) !== '[{"text":"tip two","added":2}]' || 'site:nowhere.com' in store) fail(`deleteTip: ${JSON.stringify(store)}`);
await deleteTip('b.com', 'only tip');
if ('site:b.com' in store) fail('deleteTip: the last tip left its site behind');
// deleteSite: all of a site's tips at once; other keys stay.
await deleteSite('a.com');
if (Object.keys(store).join() !== 'apiKeyHint') fail(`deleteSite: ${Object.keys(store)}`);
