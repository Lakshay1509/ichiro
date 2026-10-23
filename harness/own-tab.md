# The agent's own tab: it works in one tab while you use another

**Goal:** you work in tab A while the agent works in tab B, and A stays on screen. Today the agent has no tab of its own: each command goes to the **front tab** of the window you last used (`targetTabId`, `lib/navigation.ts`), and stays there only while that one command runs.

**The gap this closes (found 2026-10-23):**
- Switch tabs between two agent calls, and the agent's next command lands on **your** tab, if its site is on the bridge's Sites. A batch stops on a tab switch (`batchRun`, `entrypoints/background/bridge.ts`); separate calls don't.
- A stopped batch's page report (`agentReport`) and the saved tips (`bridgeTips`) run after that one command ends, so they read the front tab, not the agent's.

- Do the **first unticked slice**. One at a time.
- Tick a box only when its **Done when** is verified (test, typecheck + build, and a live check you actually ran).
- Every guard a slice adds ships finished and tested in that slice (`CLAUDE.md` → Security). Sites, stop-lines, secret fields, asks and CAPTCHA holds stay as they are: they check the agent's tab, the way they check the front tab today.
- **No AI slop:** log lines and the group's name in plain words.

**Chosen (developer, 2026-10-23):**
- **A tab group named Ichiro** marks the agent's tab, like Claude in Chrome (OT2).
- **A fresh `goto` opens a new tab in the background** (OT4), so the agent never replaces your page.

**Proposed (2026-10-23, developer to confirm):**
- **One agent tab per agent session.** Set once and kept: every agent command goes there, whatever tab is in front. Your `/commands` still go to the front tab, and don't change the agent's tab.
- **Only looking or going picks a tab.** With no agent tab yet, `read`, `look` and `text` take the front tab, so "look at this page" still works; `goto` opens a new one (OT4). Any other command is refused until then: it would act on a page the agent never saw.
- **Never steal your screen.** A tab the agent's page opens comes forward only if the agent's tab was the one showing in its window.
- **`look` needs the tab on screen.** Chrome doesn't draw hidden tabs, so there's no picture then, and the reply says so. Your fix: put the agent's tab in its own window, side by side.
- **Not doing:**
  - Flashing the agent's tab forward for a picture: it steals your screen, and your keys would land in its tab.
  - Debugger screenshots of hidden tabs: they hang (Claude in Chrome's open bug, below).
  - Several agent tabs at once.

**Research (2026-10-23):**
- Hidden tabs aren't drawn. `captureVisibleTab` shoots only the front tab ([tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)). `Page.captureScreenshot` on a hidden tab waits for a frame that never comes ([Claude in Chrome issue 78533](https://claudeissues.com/issue/78533-claude-in-chrome-page-capturescreenshot-times-out-30s-on-any-tab-whose-visibilit)).
- Timers in hidden tabs run at most once a second; chained ones once a minute after 5 minutes hidden ([Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/)).
  - `waitForQuiet` (`lib/settle.ts`) uses a 500 ms timer, so a step may take ~1 s longer.
  - Its timers aren't chained (a MutationObserver restarts them), so the once-a-minute rule shouldn't apply. Check live.
- Already fine in hidden tabs: `drawForShot` caps its two-frame wait at 150 ms (`lib/overlay.ts`); `moveFocus` sends focus events itself when the page has no focus (`lib/actions.ts`).
- Tab groups:
  - `tabs.group({ tabIds, createProperties: { windowId } })` makes a group and returns its id; `tabs.ungroup` removes tabs, and an empty group closes by itself. Chrome 88+ ([tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)).
  - Naming and coloring it is `tabGroups.update(groupId, { title, color })`; colors are a fixed list (grey, blue, red, …). Needs the **`tabGroups` permission**, Chrome 89+ ([tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)).
  - That permission **adds an install warning**: "View and manage your tab groups" ([permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list)). Unpacked: reload the extension. A store install would be turned off until the user accepts it.
- Others:
  - Claude in Chrome keeps working when you switch tabs, in its own tab group ([help](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)).
  - Comet's Background Assistants run while you work ([TechCrunch](https://techcrunch.com/2025/10/02/perplexitys-comet-ai-browser-now-free-max-users-get-new-background-assistant/)).
  - Gemini's auto browse keeps your tab in view from the side panel ([Google help](https://support.google.com/gemini/answer/16821166)).
- Not checked yet (OT1's live check):
  - Real clicks and typing (`chrome.debugger`) in a hidden tab.
  - Whether Chrome's debugging bar shows on your tab while the agent's tab is attached. It changes your page's height.

## Slices

- [x] **OT1 · the agent keeps its tab.** `bridge.tab`: the agent's tab id, `null` until picked.
  - **Pick:** an agent command with no agent tab. `read`, `look`, `text` and `goto` take the front tab, as today (`goto` until OT4). Not `find`: it scrolls your page. `help` needs no tab. Anything else is refused: `No tab of yours yet: send read first, or goto.` The rule is a pure function in `lib/bridge.ts`, tested in `lib/bridge.test.ts`.
  - **Keep:** every later agent command goes to `bridge.tab` (`inRunTab` in `agentRun`). So do `agentReport` and `bridgeTips`.
  - **Move:** a tab the page opened (#8, `follow`) and back to the opener (#15) set `bridge.tab`. `bringForward` (`lib/navigation.ts`) brings it forward only if the agent's tab was the active one in its window.
  - **Forget:** on `/mcp on` (a new bridge), a new agent session (`onBridge`'s session reset), and the tab closing. A command for a closed tab gets: `Your tab was closed. Send read to work in the tab in front, or goto.` The next command then picks as above.
  - **Drop** the batch stop "another tab came forward" (`batchRun`): your tab switches no longer move the agent. `tabSwitches` stays for the screenshot guard.
  - **Log:** one line when the agent's tab is set or moves: `The agent works in: <title> (<site>)`. The title is page text: capped.
  - Done when: `lib/bridge.test.ts` (+the pick rule) passes; typecheck + build pass; live:
    1. The agent reads tab B. You switch to tab A (on a Site too).
    2. The agent's `click`, `type` and `scroll` land in B; A doesn't change; the replies read B.
    3. A target=_blank link in B opens C behind A; the agent goes on in C.
    4. Close C: the agent's next command gets "Your tab was closed"; its `read` then takes the front tab.
    5. Note whether Chrome's debugging bar shows on A, and how long a step takes in hidden B.
  - If real clicks or typing don't land in a hidden tab: stop and tell the developer. Element clicks fall back to script clicks, but clicks at points (canvas) need the real mouse.
- [ ] **OT2 · the agent's tab sits in a group named Ichiro (developer, 2026-10-23).** You see at a glance which tab is the agent's, like Claude in Chrome.
  - **Group:** when OT1 picks or moves the agent's tab, it goes into a group titled `Ichiro`, color `blue` (DESIGN.md's one blue). One group per window; a tab the agent moves to joins the same group.
  - **Ungroup:** when OT1 forgets the tab (`/mcp off`, `/mcp on`, a new agent session), its tabs leave the group, so the group closes. When the bridge starts, an `Ichiro` group left from before (the worker restarted) is ungrouped the same way.
  - **Your groups stay yours:** a tab already in one of your groups isn't moved; the log line still names it.
  - Guard: **the group is only a sign.** Commands go by `bridge.tab`, never by which tabs are in the group, so dragging a tab in or out changes nothing the agent can reach.
  - Adds `tabGroups` to `permissions` in `wxt.config.ts`, with its source comment and the warning it adds ("View and manage your tab groups").
  - A tab the agent follows from its hidden tab lands next to **your** tab, in your tab's group if it has one: Chrome places link tabs by the front tab (OT1 live). Move it into the `Ichiro` group.
  - Not in this slice: dragging a tab into the group to hand it to the agent (Claude in Chrome does this). Ask the developer if wanted.
  - Done when: typecheck + build pass (plus a test if any logic lands in `lib/`); live:
    1. The agent reads tab B → B is in a blue `Ichiro` group.
    2. A link opens C → C joins the group.
    3. `/mcp off` → the group is gone; the tabs stay open.
    4. A tab in your own group: the agent picks it → it stays in your group.
- [ ] **OT3 · clear replies when the agent's tab is hidden.**
  - `OFF_SCREEN` (`lib/screenshot.ts`): `the agent's tab isn't on screen (the user is in another tab). Read the page as text, or ask the user to show that tab: in its own window, side by side, it stays on screen.`
  - Asks that need you in the agent's tab (a CAPTCHA's Resume, `pause`, a stop-line's "I'll do it") name it: `In the agent's tab (<site>): …`.
  - Done when: `lib/screenshot.test.ts` passes; typecheck + build pass; live: you on tab A, the agent sends `look` → the new reply plus the page as text; the agent's tab in its own window, side by side → `look` gets a picture; the agent sends `pause` → the ask names its tab.
- [ ] **OT4 · a fresh `goto` opens a tab of its own (developer, 2026-10-23).** With no agent tab, `goto <url>` opens a new tab next to the front one, in the background, and picks it (and OT2 groups it). Your page stays as it was. With an agent tab, `goto` navigates it, as today.
  - The Sites check and a new site's ask come first, unchanged, before any tab opens.
  - Check the docs for `tabs.create` (`active: false`, `index`, `openerTabId`) before writing it.
  - Done when: a test if logic lands in `lib/`; typecheck + build pass; live: a new agent session, you on tab A, the agent's first call is `goto https://en.wikipedia.org/` → a new tab opens behind A in the `Ichiro` group, A stays on screen, and the reply reads Wikipedia.

## Log

- 2026-10-23: tracker written. The developer asked whether the agent can work in tab B while tab A stays on screen. Checked the code (commands follow the front tab), Chrome's limits (no pictures or canvas drawing in hidden tabs) and other agents. Developer: plan it, no code yet.
- 2026-10-23: developer asked for a tab group like Claude in Chrome's: OT2. Checked: naming the group needs the `tabGroups` permission, which adds an install warning.
- 2026-10-23: developer chose OT4: with no agent tab, `goto` opens a new tab in the background (today it navigates the front tab). Next: OT1.
- 2026-10-23: OT1 built. `bridge.tab` (`entrypoints/background/bridge.ts`): `agentTab` picks or refuses (`picksTab` in `lib/bridge.ts`: read, look, text, goto; not find, which scrolls), `keepTab` makes the tab a command ended in the agent's and logs it, a closed tab is forgotten with its reply. Forgotten on a new bridge or a new agent session. `tabReport` and `bridgeTips` read the agent's tab, never the front one; with no tab, no report. The batch no longer stops on your tab switch. `lib/navigation.ts`: `bringForward` brings a tab forward only if the one it came from was in front; the agent's `back` (a movable pin) moves its tab to the opener; a repeat's recipe still stays. `lib/bridge.test.ts` (+pick rule), `lib/navigation.test.ts` (+follow behind, +back moves the pin), typecheck and build pass. **Open:** live check.
- 2026-10-23: OT1 live, first run (agent over MCP, you on another tab): `scroll down` with no tab → "No tab of yours yet"; `read` picked www.wikipedia.org; in the hidden tab `type 11 "Alan Turing" enter` searched, a real click opened "Turing machine", `scroll down` scrolled, and each reply read that tab. Found: a ctrl+click in the hidden tab opened "Computer" but the agent didn't follow it. Chrome names the **front tab** (yours) as a link tab's opener ("The current active index is our opener": [tab_strip_model.cc](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/ui/tabs/tab_strip_model.cc)). So `back`'s jump to the opener (#15) could also land the agent in your tab. Fixed: a followed tab is known by `webNavigation.onCreatedNavigationTarget`'s `sourceTabId`; the agent's `back` goes only to the tab it followed from (`bridge.came`), never Chrome's opener; a repeat's recipe goes nowhere (its message is now the plain "no earlier page"). `lib/navigation.test.ts` updated, typecheck and build pass. Also seen: `type n "…"` then a separate `key Enter` hits the page, not the box (type leaves the field); `type n "…" enter` is the way, as before. **Open:** rerun steps 3–5.
- 2026-10-23: OT1 live, rerun after the fix (you on amazon.in, the agent on Turing machine): `click 14 ctrl` → "it opened a new tab, now the current one: …/Computer", your tab stayed in front; `scroll down` scrolled the hidden Computer tab; `back` → "went to the tab that opened it", back on Turing machine, not your tab. You closed both: `scroll down` → "Your tab was closed…"; `read` then took your front tab (amazon.in, a Site), reading only. No debugging bar showed on your tab. Each step came back in a few seconds (not timed). Not tried: a target=_blank link (Chrome may bring that tab forward by itself). Ticked. Next: OT2.
