// Remembers the panel's switches when you close and reopen it: the MCP bridge (on/off and its Sites), the overlay, and
// always-on (BG5: MCP stays on with the panel closed). chrome.storage.local (kept until the extension is removed),
// locked to the extension's own pages like the site tips.
// Source: https://developer.chrome.com/docs/extensions/reference/api/storage/StorageArea
import { siteToAdd } from './agent-prompt.ts';
import { lock } from './site-store.ts';

export type Remembered = { mcpOn: boolean; mcpSites: string[]; overlayOn: boolean; alwaysOn: boolean };

// What was saved. Storage is a trust boundary for the bridge's Sites: a site comes back only if it is exactly what
// mcp on would make of it, so a bad or odd value is dropped, never widened into a site you didn't add.
export async function recall(): Promise<Remembered> {
  const got = await browser.storage.local.get(['mcpOn', 'mcpSites', 'overlayOn', 'alwaysOn']);
  const sites: unknown[] = Array.isArray(got.mcpSites) ? got.mcpSites : [];
  const mcpSites = sites.filter((s): s is string => typeof s === 'string' && s !== '' && siteToAdd(`https://${s}/`, []) === s);
  return { mcpOn: got.mcpOn === true, mcpSites: [...new Set(mcpSites)], overlayOn: got.overlayOn === true, alwaysOn: got.alwaysOn === true };
}

// Saves only what you pass. Locks first, so nothing lands where a content script could read or change it.
export async function remember(change: Partial<Remembered>): Promise<void> {
  await lock();
  await browser.storage.local.set(change);
}
