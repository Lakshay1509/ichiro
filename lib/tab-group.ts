// OT2: the agent's tab sits in a blue tab group named Ichiro, so you see at a glance which tab is the agent's. Only a
// sign: commands go by bridge.tab, never by which tabs are in the group.
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabGroups

const TITLE = 'Ichiro';
const NONE = -1; // tabGroups.TAB_GROUP_ID_NONE: the tab is in no group

// The Ichiro groups, in one window or in all. Matched by exact title in code: query's title is "a pattern", with no
// documented rules.
async function ichiroGroups(windowId?: number) {
  return (await browser.tabGroups.query(windowId === undefined ? {} : { windowId })).filter((g) => g.title === TITLE);
}

// Puts tab id in its window's Ichiro group, made if there's none. A tab in one of your groups stays there, unless the
// agent's page opened it (followed): Chrome puts a link tab next to the front tab, in your group if it has one.
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-group
export async function groupTab(id: number, followed: boolean): Promise<void> {
  const tab = await browser.tabs.get(id);
  const [group] = await ichiroGroups(tab.windowId);
  if (tab.groupId === group?.id || (tab.groupId !== NONE && !followed)) return;
  if (group) {
    await browser.tabs.group({ tabIds: id, groupId: group.id });
    return;
  }
  const made = await browser.tabs.group({ tabIds: id, createProperties: { windowId: tab.windowId } });
  await browser.tabGroups.update(made, { title: TITLE, color: 'blue' }); // DESIGN.md's one blue
}

// Takes every tab out of the Ichiro groups. An empty group closes by itself; the tabs stay open.
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-ungroup
export async function ungroupAll(): Promise<void> {
  for (const group of await ichiroGroups()) {
    const ids = (await browser.tabs.query({ groupId: group.id })).flatMap((t) => (t.id === undefined ? [] : [t.id]));
    if (ids.length) await browser.tabs.ungroup(ids as [number, ...number[]]);
  }
}
