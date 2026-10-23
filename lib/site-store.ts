// F10 site tips, saving: one chrome.storage.local key per site (site:<site> → SiteMemory), locked to the extension's
// own pages. The rules (checks, caps, what to remove) are in site-tips.ts. Design: harness/site-memory.md.
// Source: https://developer.chrome.com/docs/extensions/reference/api/storage/StorageArea
import { addTip, prune, type SiteMemory, type Tip } from './site-tips.ts';

const key = (site: string) => `site:${site}`;
const load = async (site: string) => (await browser.storage.local.get(key(site)))[key(site)] as SiteMemory | undefined;
// Every saved site, by storage key.
const stored = async () => Object.fromEntries(Object.entries(await browser.storage.local.get(null)).filter(([k]) => k.startsWith('site:'))) as Record<string, SiteMemory>;

// storage.local is open to content scripts by default, and ours run inside every page: only the panel and background
// may read it. Chrome keeps the level in the extension's prefs (survives restarts; Chromium storage_utils.cc), and
// pruneSites sets it again on every panel open and before every save, so no tip is ever written unlocked.
// Also used by panel-memory.ts before it saves.
export const lock =() => browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

// A run reading a site's tips: returns them and marks the site used now (call once per site per run).
export async function useSite(site: string, now: number): Promise<Tip[]> {
  const memory = await load(site);
  if (memory) await browser.storage.local.set({ [key(site)]: { ...memory, used: now } });
  return memory?.tips ?? [];
}

// Locks the store, then removes sites by prune's rules (180 days unused, then least used over 8 MB). The panel runs it
// when it opens.
export async function pruneSites(now: number): Promise<void> {
  await lock();
  const gone = prune(await stored(), now, await browser.storage.local.getBytesInUse(null));
  if (gone.length) await browser.storage.local.remove(gone);
}

// The tips list (/tips): every saved site, the most recently used first.
export async function listSites(): Promise<({ site: string } & SiteMemory)[]> {
  return Object.entries(await stored()).map(([k, m]) => ({ site: k.slice('site:'.length), ...m })).sort((a, b) => b.used - a.used);
}

// Deletes one tip by its text, so a button on an old list can't hit another tip. The site goes with its last tip.
export async function deleteTip(site: string, text: string): Promise<void> {
  const memory = await load(site);
  if (!memory) return;
  const tips = memory.tips.filter((t) => t.text !== text);
  if (tips.length) await browser.storage.local.set({ [key(site)]: { ...memory, tips } });
  else await browser.storage.local.remove(key(site));
}

export const deleteSite = (site: string) => browser.storage.local.remove(key(site));

// Saves one tip for site (the agent's tip, no ask): checked and capped by addTip, the site marked used. Chrome
// checks the quota before writing and this is one set() of one key, so a refused save leaves nothing half-written.
export async function saveTip(site: string, raw: string, now: number): Promise<{ tips: Tip[] } | { why: string }> {
  await pruneSites(now);
  const added = addTip((await load(site))?.tips ?? [], raw, site, now);
  if ('why' in added) return added;
  try {
    await browser.storage.local.set({ [key(site)]: { used: now, tips: added.tips } satisfies SiteMemory });
  } catch (err) {
    // Chromium's text: "QUOTA_BYTES quota exceeded" (settings_storage_quota_enforcer.cc).
    if (/quota exceeded/i.test(String((err as Error)?.message))) return { why: 'Memory full: delete some saved tips, then try again' };
    throw err;
  }
  return added;
}
