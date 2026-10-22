# MCP in the background: works with the side panel closed

**Goal:** a coding agent can drive the browser while the side panel is closed. Today the bridge and all the command code live in the panel page (`entrypoints/sidepanel/main.ts`), so closing the panel ends the bridge.

- Do the **first unticked slice**. One at a time.
- Tick a box only when its **Done when** is verified (test, typecheck + build, and a live check you actually ran).
- Every guard a slice adds ships finished and tested in that slice (`CLAUDE.md` → Security). Guards that move (Sites, stop-lines, secret fields, asks, the bridge token) move unchanged, with their tests.
- **No AI slop:** the badge and the setting use plain words.

**Chosen (developer, 2026-10-22):**
- **Engine to the background.** The command code moves into the background worker (the extension's always-there script with no page). The panel only shows the log and asks, and sends your `/commands`.
- **Asks never leave the panel.** If the panel is closed, the ask waits and the toolbar icon shows a badge. No notifications.
- **A setting, `/always-on on|off`**, keeps MCP on when the panel is closed. It's remembered like `/mcp on|off` and is off by default, so nothing changes until you turn it on.
- **Answer an ask in either place (BG7):** the side panel's buttons, or a dialog in the agent app (Claude Code). The first answer wins, and the other place closes.
- **PDFs:** a hidden extension page reads them. **Screenshots:** a clearer reply when the tab is off screen.

**Research (2026-10-22):**
- The background worker stays alive while the native messaging port is open (Chrome 105+) and while a debugger session is attached (Chrome 118+). If the host dies, the port closes and the worker may stop: [service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
- The side panel opens only on a user action, so an ask can't open it for you: [sidePanel.open](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
- Hidden page = an "offscreen document". Only one can be open at a time, it gets only `chrome.runtime`, it needs the `offscreen` permission and a reason (`WORKERS`: pdf.js starts a worker), and it has no time limit (unlike audio pages). `offscreen.hasDocument()` is Chrome 150+: [offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen).
- Screenshots: Chrome only captures what it draws. Today's "is it drawn" check is the panel's own `document.visibilityState` (`screenshot` in `main.ts`), and the background has no page to ask.
- Not read yet (check in the slice that uses it): `action.setBadgeText` (BG6), `runtime.onStartup` (BG5), the `sender` of `runtime.onConnect` (BG4), WXT folder entrypoints (BG2, BG4).

## Slices

- [x] **BG1 · a clearer off-screen reply.** `OFF_SCREEN` (`lib/screenshot.ts`) tells the agent what to do. The agent sees: `no screenshot: the run's tab isn't on screen. Ask the user to keep it the front tab in a Chrome window that isn't minimized, or read the page as text.`
  - It goes only in that reply, not in the tool description, so the agent hears it only when it happens (`harness/mcp-context.md`).
  - Done when: `lib/screenshot.test.ts` passes; typecheck + build pass; live: minimize Chrome, the agent sends `look`, and it gets the new text.
- [x] **BG2 · a hidden page reads PDFs.** pdf.js can't run in the background worker as it does today: a service worker can't start its own worker, and `import()` isn't allowed there.
  - **Try first (~10 min):** pdf.js's built-in fallback (import its worker file directly, so it runs without starting a worker) inside the background worker. If it reads a PDF, use it and skip the hidden page and the new permission.
  - Otherwise: an unlisted page (`entrypoints/offscreen.html`), created on first use with reason `WORKERS`. `readPdf(url)` (`lib/pdf.ts`) asks it over `runtime` messaging. The panel uses it the same way until BG4.
  - Adds `offscreen` to `permissions` in `wxt.config.ts`, with its source comment. Check whether it adds an install warning.
  - Guard: the hidden page answers only messages from this extension (`sender.id`) and only the one "read this PDF" message. Its text is page text (untrusted), as today.
  - Check: `text download` reads `file://` PDFs. Confirm the hidden page can fetch them when "Allow access to file URLs" is on.
  - Done when: `lib/pdf-text.test.ts` passes; typecheck + build pass; live: `/text` on a PDF tab and the agent's `text download` on a downloaded PDF both read.
- [x] **BG3 · screenshots check the tab, not the panel.** In `screenshot` (`main.ts`), "is it drawn" comes from the tab's own page: the content script reports `document.visibilityState`. It runs apart from the page's scripts, so the page can't fake it. The window is the tab's `windowId`, not the panel's.
  - No answer from the page (Chrome's PDF viewer, a page still loading): fall back to the window being focused and not minimized.
  - Side effect: a tab in a different window from the panel can now be shot.
  - Guard: `takeShot`'s checks (Sites, checkout pages, secret fields, a tab switch during the picture) stay unchanged.
  - Done when: `lib/screenshot.test.ts` passes; typecheck + build pass; live: Chrome beside another app (not focused) → `look` works; Chrome minimized → the BG1 reply.
- [ ] **BG4 · the engine moves to the background.** Everything in `main.ts` except drawing (`log.tsx`, `slash-menu.ts`, the command box) moves into `entrypoints/background/`, split into small files. Behavior stays as today: the bridge still stops when the last panel closes.
  - Panel ⇄ background: one `runtime.connect({ name: 'panel' })` port per open panel. The background sends log items (`show`, `swap`, steps, `clearLog`, the MCP state). The panel sends a typed line or a button press (ask id + which button).
  - The background keeps the recent log (capped) and the open ask, and sends them to each panel that connects. Two windows with panels both show it.
  - Check: `text download` reads text files with `fetch(file://…)` in `readDownload` (`main.ts`). Unverified whether a background worker may fetch `file://`. If it can't, send that read through the hidden page too (BG2's `lib/offscreen.ts`, same sender guard).
  - The agent's tab: `targetTabId` takes the active tab of the "current window". In the background that means the last focused Chrome window; today it's the panel's window. The tab is pinned after the first command, as today.
  - Guard (new): the background accepts a `panel` port only from this extension's own side panel page (`sender.id` is ours, `sender.url` is the panel page, no `sender.tab`, since content scripts run in tabs). This is a pure check in `lib/` with a test. A page that took over the content script must not be able to type commands or press Allow.
  - Guard (moved): typed lines must start with `/`, checked again in the background, because a port message is input. A button press for an ask that is closed or replaced does nothing (today's `pendingAsk` + `lastCommand`).
  - Guard (moved): when the panel opens with an ask waiting, focus stays in the command box, so a reflex Enter can't press Allow.
  - Done when: typecheck + all tests pass; build passes; live, with the panel open: a typed `/read`, `/mcp on`, an agent batch, a stop-line's Allow once, a new site's Add site, `look`, a PDF, `/tips`, `/clear`. Closing every panel stops the bridge, as today.
  - Biggest slice: a few commits.
- [ ] **BG5 · the setting: `/always-on on|off` (developer, 2026-10-22).** Saved like `/mcp on|off`: in `Remembered` (`lib/panel-memory.ts`, `browser.storage.local`), so it survives closing the panel and restarting Chrome. Off by default. It shows in the `/` menu with a one-line help, like the other commands.
  - On: closing the last panel leaves the bridge on. When Chrome starts (`runtime.onStartup`), it turns back on if MCP was on.
  - Off: as today.
  - The command box's bottom row says which, in plain words.
  - Host crash with the panel closed: no reconnect loop (a crashing host would loop). The bridge goes off; the error waits in the log, and the next panel open turns it back on, as today.
  - Until BG6, an ask with the panel closed waits unseen until you open the panel. That's safe (it still needs your click) but easy to miss, so don't use `/always-on on` for real runs before BG6.
  - Done when: a test for the saved setting in `lib/panel-memory.test.ts` (missing or bad value → off); typecheck + build pass; live: `/always-on on`, close the panel, the agent reads a page on a Site and gets the reply; restart Chrome, the agent's next call works without opening the panel, and reopening the panel shows always-on still on; `/always-on off`, close the panel, the bridge stops.
- [ ] **BG6 · asks wait with a badge.** An ask while no panel is open puts a badge on the toolbar icon (`action.setBadgeText`), a plain word like `Ask`. It clears when the ask closes. Clicking the icon opens the panel (already set: `openPanelOnActionClick`) with the ask in the log.
  - The agent's wait note (`WAITING` in `host/late-reply.ts`) adds: if the side panel is closed, ask the user to click the Browser Agent icon.
  - Guard: the badge only says an ask is waiting, never page or agent text.
  - Done when: typecheck + build pass (plus a test if any badge logic lands in `lib/`); live: `/always-on on`, panel closed, the agent goes to a new site → badge; click the icon → Add site / No; Add site → the agent's next call gets the reply, and the badge is gone.
- [ ] **BG7 · answer an ask in the agent app or the panel (developer, 2026-10-22).** Today an agent's ask (Add site, Allow once, Resume, a download, a tip's Save, repeat's list) waits for a click in the side panel. Now it also opens a dialog in the agent app (Claude Code), and either place answers it.
  - Doesn't depend on BG3–BG6, so it can be built at any point.
  - How: MCP **elicitation**, where the MCP server asks the user through the agent app. Claude Code shows a dialog and passes back the user's answer; the model never sees or answers it. Sources: [Claude Code, Respond to MCP elicitation requests](https://code.claude.com/docs/en/mcp#respond-to-mcp-elicitation-requests), [MCP elicitation](https://modelcontextprotocol.io/docs/learn/client-concepts#elicitation). The SDK we use (`@modelcontextprotocol/server` 2.3.1) can send it.
  - Path: panel `askKeepGoing` → native port → `host/host.ts` → the run's pipe → `host/mcp.ts` opens the dialog. The answer goes back the same way and presses the matching panel button.
  - The dialog shows the panel's question and its two button labels. Its Decline = the panel's stop button. Closing the dialog without answering leaves the panel's ask open.
  - **First answer wins.** An answer in the panel cancels the dialog; an answer in the dialog closes the panel's ask, with a line saying where it was answered ("Added in the agent app.").
  - An agent app without elicitation (check `getClientCapabilities()`): panel only, as today.
  - Guard: an answer always comes from a person, in the panel or the app's dialog. **Never** a command or tool argument the agent sends, since a tricked agent would approve its own stop-lines.
  - Guard: an answer message has a strict shape (ask id + keep or stop). It counts only on the run's own token-checked connection, for the ask that is open right now. Anything else is dropped. Tested in `lib/`.
  - Guard: the dialog shows agent and page text (a tip, a pause reason) as quoted text, capped like the panel does.
  - Note for you: Claude Code's `Elicitation` hook can auto-answer dialogs ([hooks](https://code.claude.com/docs/en/hooks#elicitation)). Don't set one for browser-agent, or stop-lines would pass without you.
  - Check before building:
    - Does Claude Code's ~60 s limit per call pause while a dialog is open? Its docs only say such a call isn't moved to the background. If it pauses, the 50 s "still waiting" reply (`host/late-reply.ts`) should wait while a dialog is open.
    - Does the dialog close when the server cancels it?
    - Does the Claude desktop app show the dialog?
  - Done when: a test for the answer check; typecheck + build pass; live: the agent goes to a new site → a dialog in Claude Code and the ask in the panel; Add site in Claude Code → the panel's ask closes, and the agent goes on; again, No in the panel → the dialog closes and the agent gets "Refused".

## Log

- 2026-10-22: tracker written from the developer's choices (engine to the background, badge for asks, keep setting off by default, hidden page for PDFs, clearer off-screen reply). Next: BG1.
- 2026-10-22: BG1 built: new `OFF_SCREEN` text (`lib/screenshot.ts`); only the agent's `look` reply uses it. `lib/screenshot.test.ts`, typecheck and build pass. **Open:** live check (minimize Chrome, agent sends `look`).
- 2026-10-22: BG1 live: Chrome minimized on wikipedia.org, `look` replied with the new text and the page as text. Ticked. Next: BG2.
- 2026-10-22: developer named the setting `/always-on on|off`, remembered like `/mcp on|off` (was `/mcp keep on|off`). BG5 and BG6 updated.
- 2026-10-22: BG2 built with the hidden page. "Try first" skipped: pdf.js's fallback would run in the background (pdf.worker.mjs sets `globalThis.pdfjsWorker`, pdf.mjs then skips `new Worker` and `import()`), but whether a background worker may fetch `file://` is unverified, and `text download` needs it; the hidden page works either way. `entrypoints/offscreen/` answers `read-pdf` only for `fromOwnPage` senders; `lib/offscreen.ts` opens it and keeps the per-URL cache; `lib/pdf.ts` now only parses. Panel script 508 → 76 kB (pdf.js moved out). `lib/offscreen.test.ts`, `lib/pdf-text.test.ts`, typecheck and build pass. **Open:** live check.
- 2026-10-22: BG2 live (agent over MCP): w3.org's dummy.pdf tab → `text` and `find "Dummy"` read it; Wikipedia's Alan_Turing.pdf (2.7 MB, download allowed in the panel) → `text download` read 42 pages from `file://`, so the hidden page can fetch downloads. Ticked. Next: BG3.
- 2026-10-22: BG3 built: the content script's `ping` now says `visible` (`document.visibilityState`); `isDrawn` (`lib/screenshot.ts`) takes it, or with no answer the window (focused, not minimized); `screenshot` (`main.ts`) no longer looks at the panel. `lib/screenshot.test.ts` (+6 cases), typecheck and build pass. **Open:** live check.
- 2026-10-22: BG3 live (agent over MCP, wikipedia.org): Chrome beside the Claude app, not focused → `look` got a 417×1019 screenshot with numbers; Chrome minimized → the BG1 reply plus the page as text. Not tried: the PDF-viewer fallback (window focused, not minimized). Ticked. Next: BG4.
- 2026-10-22: developer asked to answer asks in the agent app or the panel; BG7 added (MCP elicitation; Claude Code shows it as a dialog only the user answers).
