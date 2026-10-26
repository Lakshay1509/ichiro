// Checks safeUrl (only http(s) URLs pass) and arrived (goto's honest result). Run: npm test
import { arrived, back, follow, GOTO_LOOPBACK_RULE, GOTO_RULE, GOTO_RULES, gotoRules, guardedGoto, loaded, openBehind, pinTab, safeUrl, targetTabId } from './navigation.ts';

const allowed = ['https://en.wikipedia.org/wiki/Alan_Turing', 'http://localhost:3000/'];
const blocked = ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'file:///C:/x.html', 'chrome://settings', 'wikipedia.org', ''];

for (const url of allowed) {
  if (safeUrl(url) !== new URL(url).href) throw new Error(`safeUrl should allow ${url}`);
}
for (const url of blocked) {
  let threw = false;
  try { safeUrl(url); } catch { threw = true; }
  if (!threw) throw new Error(`safeUrl should block ${JSON.stringify(url)}`);
}

// arrived: "ok" only when the tab is on the page or a redirect of it; otherwise an error that says where it is.
const old = 'https://www.gesetze-im-internet.de/aufenthg_2004/__18g.html';
const want = 'https://www.gesetze-im-internet.de/aufenthg_2004/__18.html';
const throws = (f: () => unknown, has: string) => {
  try { f(); } catch (err) { if (String(err).includes(has)) return; throw new Error(`wrong error: ${err}`); }
  throw new Error(`should throw "${has}"`);
};
if (arrived(want, old, want) !== `ok — on ${want}`) throw new Error('arrived: on the page should be ok');
if (arrived(old, old, old) !== `ok — on ${old}`) throw new Error('arrived: goto to the same page (reload) should be ok');
if (!arrived(want, old, 'https://example.com/landing').includes('sent it on to https://example.com/landing')) throw new Error('arrived: a redirect should name where it landed');
throws(() => arrived(want, old, old), `did not navigate: the tab is still on ${old}`);
throws(() => arrived(want, old, old, want), 'still loading');

// #8, #14, #15: following a tab a link opened, and back from a tab with no earlier page. Stand-in for chrome.tabs:
// tab 2 (active) was opened by tab 1, same window; tab 3 is in another window.
type FakeTab = { id: number; windowId: number; status: string; pendingUrl?: string; openerTabId?: number; index?: number };
const tabs = new Map<number, FakeTab>([
  [1, { id: 1, windowId: 1, status: 'complete' }],
  [2, { id: 2, windowId: 1, status: 'complete', openerTabId: 1, index: 4 }],
  [3, { id: 3, windowId: 9, status: 'complete', openerTabId: 1 }],
]);
const activated: number[] = [];
const created: object[] = [];
let history = true; // the active tab has an earlier page
let active = 2;
Object.assign(globalThis, {
  browser: {
    tabs: {
      query: async () => [tabs.get(active)],
      get: async (id: number) => (tabs.has(id) ? { ...tabs.get(id), active: id === active } : Promise.reject(new Error(`No tab with id: ${id}.`))),
      update: async (id: number) => void activated.push(id),
      create: async (props: { windowId: number }) => {
        created.push(props);
        tabs.set(10, { id: 10, windowId: props.windowId, status: 'complete' });
        return { id: 10 };
      },
      goBack: async (id: number) => {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        if (!history) throw new Error('Cannot find a next page in history.');
      },
    },
  },
});
const rejects = async (p: Promise<unknown>, has: string) => {
  try { await p; } catch (err) { if (String(err).includes(has)) return; throw new Error(`wrong error: ${err}`); }
  throw new Error(`should throw "${has}"`);
};

// loaded: waits while the page hasn't committed; false once the tab is gone (a download closes its tab).
if (!(await loaded(2))) throw new Error('loaded: a complete tab');
if (await loaded(7)) throw new Error('loaded: a closed tab should be false');
tabs.set(4, { id: 4, windowId: 1, status: 'complete', pendingUrl: 'https://example.com/' });
setTimeout(() => tabs.set(4, { id: 4, windowId: 1, status: 'complete' }), 50);
const start = Date.now();
if (!(await loaded(4)) || Date.now() - start < 50) throw new Error('loaded: should wait for the pending page');

// follow: same window → followed, made active only if the tab it came from was (OT1); another window or closed → not
// followed, nothing activated.
active = 1;
if (!(await follow(2, 1)) || activated.join() !== '2') throw new Error('follow: same window');
if ((await follow(3, 1)) || (await follow(7, 1)) || activated.length !== 1) throw new Error('follow: other window or closed tab');
active = 2;
if (!(await follow(4, 1)) || activated.length !== 1) throw new Error('follow: from a tab behind yours, it stays behind');

// back: Chrome's own go back; with no earlier page, the tab that opened it (never Chrome's wrong "next page" words).
if ((await back()) !== 'ok — went back') throw new Error('back: with history');
history = false;
if ((await back()) !== 'ok — this tab had no earlier page, so went to the tab that opened it' || activated.at(-1) !== 1) throw new Error('back: to the opener');
active = 3;
await rejects(back(), 'in another window');
// A pinned tab never goes to Chrome's opener (OT1: that's the front tab, maybe yours), e.g. a repeat's recipe.
pinTab(2);
await rejects(back(), "Can't go back: this tab has no earlier page.");
pinTab(7); // any other error stays Chrome's
await rejects(back(), 'No tab with id: 7.');
pinTab(2, 9); // the tab it came from is gone
await rejects(back(), 'closed or in another window');
// OT1: the agent's tab goes back to the tab it came from: the pin moves there, and it stays behind your tab.
pinTab(2, 1);
const before = activated.length;
if ((await back()).includes('went to the tab that opened it') !== true || (await targetTabId()) !== 1 || activated.length !== before) throw new Error('back: the agent tab moves to where it came from, behind');
pinTab(null);

// OT4: the agent's first goto gets a blank tab right after the front one, in the background, with no opener.
active = 2;
if ((await openBehind()) !== 10) throw new Error('openBehind: returns the new tab');
if (JSON.stringify(created) !== JSON.stringify([{ url: 'about:blank', active: false, windowId: 1, index: 5 }])) throw new Error(`openBehind: created ${JSON.stringify(created)}`);

// Lead 2 (audit 2026-10-24): while the agent's goto loads, its tab can't load a page off the Sites, so a redirect on
// an allowed site can't carry page data to a site you never added. Session rules, this tab only, top pages only.
const rules = gotoRules(7, ['httpbin.org', 'shop.com']);
const rule = rules[0]!;
if (rules.length !== 1 || rule.id !== GOTO_RULE || rule.action.type !== 'block') throw new Error('gotoRules: one rule, and it blocks');
if (rule.condition.tabIds.join() !== '7' || rule.condition.resourceTypes.join() !== 'main_frame') throw new Error('gotoRules: this tab, top pages only');
if (rule.condition.excludedRequestDomains?.join() !== 'httpbin.org,shop.com') throw new Error('gotoRules: every site but the Sites');
// #7: a loopback Site is one port. It stays blocked by domain; a higher-priority allow rule lets exactly its http and
// https origins load (Chrome's request URLs drop a default port, like URL). No empty domain list: Chrome refuses it.
const [block, allow] = gotoRules(7, ['localhost:3000', 'shop.com', '127.0.0.1:80', '[::1]:443']);
if (block!.condition.excludedRequestDomains?.join() !== 'shop.com') throw new Error('gotoRules: loopback Sites stay blocked by domain');
if (allow?.id !== GOTO_LOOPBACK_RULE || allow.action.type !== 'allow' || allow.priority <= block!.priority) throw new Error('gotoRules: the loopback allow outranks the block');
if (allow.condition.tabIds.join() !== '7' || allow.condition.resourceTypes.join() !== 'main_frame') throw new Error('gotoRules: the allow is this tab, top pages only');
const pass = new RegExp(allow.condition.regexFilter!); // RE2's syntax here is a subset of JS's
for (const url of ['http://localhost:3000/', 'https://localhost:3000/a?b', 'http://127.0.0.1/', 'https://127.0.0.1:80/', 'https://[::1]/x', 'http://[::1]:443/']) if (!pass.test(url)) throw new Error(`gotoRules: should allow ${url}`);
for (const url of ['http://localhost:3001/', 'http://localhost:30000/', 'http://localhost/', 'http://127.0.0.1:8080/', 'http://127.0.0.10/', 'http://127x0x0x1/', 'https://[::1]:3000/', 'http://localhost.evil.example:3000/', 'https://evil.example/http://localhost:3000/']) {
  if (pass.test(url)) throw new Error(`gotoRules: should not allow ${url}`);
}
const local = gotoRules(7, ['localhost:3000']);
if (local.length !== 2 || 'excludedRequestDomains' in local[0]!.condition) throw new Error('gotoRules: only loopback Sites block every domain');
// The rules are on before the navigation starts and off after, even when the goto fails.
const dnr: string[] = [];
(globalThis as unknown as { browser: Record<string, unknown> }).browser.declarativeNetRequest = {
  updateSessionRules: async (o: { addRules?: { id: number }[]; removeRuleIds?: number[] }) => void dnr.push(o.addRules?.length ? `add ${o.addRules.map((r) => r.id).join()}` : `remove ${o.removeRuleIds?.join()}`),
};
await guardedGoto(7, ['shop.com'], async () => void dnr.push('goto'));
if (dnr.join() !== `add ${GOTO_RULE},goto,remove ${GOTO_RULES.join()}`) throw new Error(`guardedGoto order: ${dnr.join()}`);
dnr.length = 0;
await guardedGoto(7, ['localhost:3000'], async () => void dnr.push('goto'));
if (dnr.join('|') !== `add ${GOTO_RULE},${GOTO_LOOPBACK_RULE}|goto|remove ${GOTO_RULES.join()}`) throw new Error(`guardedGoto loopback: ${dnr.join('|')}`);
dnr.length = 0;
try { await guardedGoto(7, ['shop.com'], async () => { throw new Error('timeout'); }); } catch { /* the goto's own error */ }
if (dnr.at(-1) !== `remove ${GOTO_RULES.join()}`) throw new Error('guardedGoto must remove the rules after a failed goto');
