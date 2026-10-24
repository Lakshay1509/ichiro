// Checks OT2's Ichiro tab group: the agent's tab joins it, your groups stay yours (but a tab the agent followed moves),
// and ungroupAll empties only Ichiro groups. Run: npm test
import { groupTab, ungroupAll } from './tab-group.ts';

// Stand-in for chrome.tabs and chrome.tabGroups. Window 1: tab 1 ungrouped; tabs 2 and 3 in your group "Work".
type FakeTab = { id: number; windowId: number; groupId: number };
type FakeGroup = { id: number; windowId: number; title?: string; color?: string };
const tabs = new Map<number, FakeTab>([
  [1, { id: 1, windowId: 1, groupId: -1 }],
  [2, { id: 2, windowId: 1, groupId: 50 }],
  [3, { id: 3, windowId: 1, groupId: 50 }],
]);
let groups: FakeGroup[] = [{ id: 50, windowId: 1, title: 'Work', color: 'red' }];
Object.assign(globalThis, {
  browser: {
    tabs: {
      get: async (id: number) => ({ ...tabs.get(id)! }),
      query: async ({ groupId }: { groupId: number }) => [...tabs.values()].filter((t) => t.groupId === groupId),
      group: async ({ tabIds, groupId, createProperties }: { tabIds: number; groupId?: number; createProperties?: { windowId: number } }) => {
        const id = groupId ?? 60 + groups.length;
        if (groupId === undefined) groups.push({ id, windowId: createProperties!.windowId });
        tabs.get(tabIds)!.groupId = id;
        return id;
      },
      ungroup: async (ids: number[]) => {
        for (const id of ids) tabs.get(id)!.groupId = -1;
        groups = groups.filter((g) => [...tabs.values()].some((t) => t.groupId === g.id)); // an empty group closes
      },
    },
    tabGroups: {
      query: async ({ windowId }: { windowId?: number }) => groups.filter((g) => windowId === undefined || g.windowId === windowId),
      update: async (id: number, props: Partial<FakeGroup>) => Object.assign(groups.find((g) => g.id === id)!, props),
    },
  },
});
const ichiro = () => groups.filter((g) => g.title === 'Ichiro');

// The agent picks ungrouped tab 1: a new blue Ichiro group.
await groupTab(1, false);
const [made] = ichiro();
if (ichiro().length !== 1 || made!.color !== 'blue' || tabs.get(1)!.groupId !== made!.id) throw new Error('groupTab: an ungrouped tab should get a blue Ichiro group');

// The agent picks tab 2 in your group: it stays there.
await groupTab(2, false);
if (tabs.get(2)!.groupId !== 50) throw new Error('groupTab: a tab in your group should stay there');

// The agent's page opened tab 3, and Chrome put it in your group: it joins the same Ichiro group, no second one.
await groupTab(3, true);
if (tabs.get(3)!.groupId !== made!.id || ichiro().length !== 1) throw new Error('groupTab: a followed tab should join the Ichiro group');

// Again: nothing changes.
await groupTab(3, true);
if (tabs.get(3)!.groupId !== made!.id || ichiro().length !== 1) throw new Error('groupTab: a tab already in the Ichiro group stays');

// ungroupAll: the Ichiro group is gone, its tabs ungrouped; your group keeps tab 2.
await ungroupAll();
if (ichiro().length || tabs.get(1)!.groupId !== -1 || tabs.get(3)!.groupId !== -1) throw new Error('ungroupAll: the Ichiro group should be gone');
if (tabs.get(2)!.groupId !== 50 || !groups.some((g) => g.id === 50)) throw new Error('ungroupAll: your group should stay');
