# MCP context: why a slide deck ate 1M tokens

Research on 2026-10-20: the real run (Claude Code + our MCP tool, Opus 5.5, Google Slides, a 10-slide deck) plus web research. **Options 1–3 built 2026-10-20** (tests, typecheck, build pass). Not yet re-run live: re-run the same deck and compare with 405 commands / 953k.

## The short version

- Only the **MCP path** blows up. The panel's own loop rebuilds its context each step, so it keeps one page, not all of them.
- **~80% of the context was page replies.** Every action sends back the whole page list, and 81% of each reply is the same as the reply before.
- Claude Code keeps every tool result. In this run nothing was ever cleared: context only grew, 73k → 953k, no compaction.
- **Fix:** an action's reply says only what changed, then several commands per call. Replayed: **953k → ~250k**.

## Measured (transcript `20bdf667…`, 2026-10-20)

- **405 browser commands in 170 model calls, 25 min**, about 5 of 10 slides done. The model already sent ~2–3 commands per call.
- Context at the end: **953k**. Where it went (measured from the growth between calls):
  - **Page replies: ~750k (~80%).** 1.54M chars at **~2 chars per token** (numbers, brackets and quotes tokenize badly). Avg reply 3.8k chars ≈ 1.9k tokens.
  - **Screenshots: ~74k (~8%).** 46 `look`s at ~1.6k tokens each.
  - **Start: ~73k (~8%).** System prompt, tool list, the task.
  - **The model's own writing: ~62k (~7%)**, thinking included.
- **Snowball:** every model call re-reads the whole conversation. Across the run that's **59M tokens read**, ~350k per call on average. That's the slowness.
- **81%** of each reply's characters repeat the reply before it.
- `key ctrl+b` returned the full page (~1.9k tokens) to say "pressed ctrl+b".
- 51% of commands (205) needed no fresh element number: keys, typing into the focused box, x,y clicks, drags.
- One bullet took ~6 commands: double-click, Home, shift+End, Delete, type, ctrl+End.
- Noise: the theme editor's hidden previews ("● First level ○ Second level…", 5 times) were in every reply.
- Our own estimate is 2× too low: the reply footer said "~917 tokens" for a reply that cost ~1.9k (it assumes ~4 chars per token).

## Live result after options 1–3 (transcript `a23e9309…`, 3 slides)

- **3 slides, 23 min, 180 model calls, 651 commands in 182 calls (3.6 per call). Context at the end: 371k.**
- **Per command: ~2.2k → ~0.46k tokens (4.7× less).** Action replies: 661k for 5 slides → 37k for 3.
- **Per slide: only ~1.5–1.8× less, and not faster.** The replay assumed the agent would act the same. It didn't:
  - **Screenshots: 95k (biggest pile).** 58 `look`s for 3 slides; the old run had 46 for 5.
  - **`read` added to batches: 61k.** 122 of 182 calls ended in `read` or `look`. Short replies made the agent check more.
  - **Errors 20% (old run 8%), each one a retry call.**
    - **15 "Element [N] not found": our bug, not the agent's.** It used numbers it had seen earlier, and they were right: the report after the failure listed them (`click 91` closed a panel, then `[73] "Change background"` came back). But elements are looked up in the **last read** (`frameFor` in `lib/page/frames.ts`, `getElement` in `lib/page/reader.ts`), and a batch doesn't read between commands. So anything an earlier command in the batch opened or brought back can't be found.
    - **12 "the page moved"** on x,y clicks on the slide canvas. The agent suspected the guard misfires on Slides' canvas. Not checked yet.
  - Model's writing 52k, start 70k, `look` text 39k.
- **10 slides at this rate ≈ 1.07M: still doesn't fit.** Next (round 2): in a batch, a number missing from the last read triggers a quiet re-read (not sent) and one retry; the description stops the extra read/look; a cheaper look screenshot; check the "page moved" guard on canvas.

## Second live run: Excalidraw diagram (transcript `b16e36bc…`, 2026-10-20)

- **Whole diagram done: 9 min, 38 model calls, 238 commands in 44 calls (5.4 per call). Context at the end: 171k** (70k of it is the start).
- Page text only **~20k**: change-only replies work well here.
- **Screenshots ~44k, the biggest piece** (27 `look`s). On a canvas site the drawing isn't in the page list, so `look` is the only way to see it: these are needed, not a habit.
- Model's writing 32k (26k thinking). Errors 11% (5): only one "not found" (the batch bug).
- Not finished: the `.excalidraw` save, and the PNG save isn't confirmed. Chrome's own Save window is outside the page, so the agent paused for the user.
- **Takeaway:** Slides is the worst case (big toolbar, panels that come and go). On a canvas site the fixes hold, and cheaper screenshots are the next lever.

## Bug fixes after the live runs (2026-10-20)

Built; tests, typecheck and build pass. Not yet re-run live. Compare with the Slides run: **20% errors, 15 "not found", 12 "page moved"**.

1. **"Element [N] not found" in a batch.** Cause: lookups know only the last read, and a batch reads only at its end (seen: `click 91` closed a panel, `[73]` came back, `click 73` failed). Fix: on "not found", one quiet re-read (refreshes the lookups, not sent: `bridge.page` stays the agent's last list), then the command runs once more with all its checks (`retryUnlisted`, `lib/bridge/bridge.ts`; used for every bridge command). "Changed" and reused numbers stay refused.
2. **"Stopped … (the page moved)" on clicks that landed.** Two causes:
   - **Why it said "Stopped" though Slides took the click:** the guard's listener was added at click time. Listeners on one target run in the order added, so Slides' own window listener (added at page load) saw the press before the guard stopped it. Fix: the content script now starts at `document_start` and adds the guard's listener once, before any page script (`watchMouse`), like Playwright. A stop now really stops. On a tab open before the extension loaded the script comes late: then the reply says **"Maybe done: … reload the tab"**, never "Stopped".
   - **Why it fires on Slides at all:** the press lands on a different node than the one checked. Only on Slides x,y clicks (12 of ~20, always on the same spots: empty placeholders), never on Excalidraw (60+ point actions), and not tied to the debugging bar coming or going. The only input between check and press is our own mouse move to the point, so most likely Slides changes its page under the mouse on hover. Fix (developer said yes to the trade-off): x,y clicks and drags move the mouse to the press point first, wait a frame, check again, then press (`realPoints`). The press must still land on exactly what that second check passed. Trade-off: if hovering opens something right under the point (a hover menu), the click goes to it; stop-lines still apply. Element clicks (`click N`) are unchanged (strict).
3. **`click <n> shift` dropped the Shift** (draw.io run: Shift+click a library shape to replace the selected one). Cause: `click.run` read the flags only on the x,y path. Fix: `click <n|"label">` now takes `double` and `shift|ctrl|alt|meta` like x,y (same `clickAtPoint`); unknown words after `click N` are now a usage error, not ignored. When there's no real mouse for the element (in a frame, or the bar was cancelled), the script click refuses the flags (`checkScriptClick`) instead of dropping them. Not yet re-run live.
   - **Still open: `click 7` on draw.io's sidebar "Text" item did nothing, `click x,y` on the same spot worked.** Not a DOM-click fallback: `click N` on the top page always uses the real mouse; script clicks happen only in frames or with no debugger, and the text route is only `click "words"` that names no element. Suspect (unverified): `realMouse` checks the point *before* attaching, and MCP re-attaches every command, so Chrome's debugging bar arrives after the check and the press fires at once. `realPoints` instead attaches first, waits for the layout, moves, checks again, then presses. Needs a live repro before changing strict element clicks.
4. **Stop-lines refused instead of asking (2026-10-21).** Live: BookMyShow "Book tickets" through the bridge printed "Stop-line … Needs your ok. Not done: tell the user to do this step by hand" with **no buttons**, so the developer was never asked. Cause: `agentCommand` turned every `StopLine` into an error, against plan.md's rule ("a stop-line pauses and asks; it doesn't refuse"); goal runs already asked. The word list was fine (`stopWord("Book tickets")` = "book"; test added). Fix: `allowOnce` (`lib/bridge/bridge.ts`, tested): a stop-line asks **Allow once / I'll do it**; Allow once runs the same command again with `allow` (its downloads count as allowed, like a goal run); I'll do it tells the agent to wait for you. Hand-overs (secret fields, CAPTCHAs) still never ask. `/mcp` help and the MCP tool description updated. **Live check passed (2026-10-21):** bridge `click 57` on BookMyShow's Ramayana "Book tickets" → the panel asked Allow once / I'll do it; Allow once → the click ran and the language/format picker opened.
   - **Then: "I'll do it" ended the agent's task (2026-10-21).** Live (Build 1 run 1): the reply said "the user chose to do this step by hand", so the agent stopped. Developer: it should go on after you do the step. Fix (`allowOnce`, tested), like a goal run: I'll do it → "do it on the page, then press Resume"; after Resume the reply says "the user did this step themselves… Don't redo it: read the page… go on with your task". Hand-overs (secret field, CAPTCHA) now do the same (Resume, then go on) instead of ending the task. Stop → "Stopped: the user pressed Stop". `/mcp` help and the tool description updated. **Live check passed (2026-10-21):** bridge `click 57` "Book tickets" → developer picked I'll do it, clicked it on the page, pressed Resume → the reply said "The user did this step themselves… go on with your task"; the next `read` showed the language/format picker their click opened.
   - **Then: agents said "Book tickets didn't ask" (2026-10-21).** In both Build 1 runs the developer clicked Allow once, but the reply was the plain click result, so the agents reported the stop-line as missing. Fix: after Allow once the reply starts with "The user allowed this step once:" (`allowOnce`, test updated). Not yet seen live.

## Root cause in our code

- `act()` (`entrypoints/sidepanel/main.ts:718`) adds a full `readAll()` to every action. Right for the panel's loop (it keeps only the latest page), wrong for MCP (the client keeps them all).
- Numbers never move between reads (`lib/page/numbers.ts`) and stale ones are refused, so an agent can keep using numbers from older replies. That makes "send only what changed" safe.

## What other browser agents do

- **Anthropic's browser use tool:** actions return a short acknowledgment ("Clicked element ref_2."). Several actions per turn, stop at the first failure, one observation at the end. Read the tree before a screenshot. `filter: "interactive"`, `ref` to read one subtree, 50k-char cap.
- **Chrome DevTools MCP:** click, fill, press_key and drag take `includeSnapshot`, **default false**. `fill_form` fills many fields in one call. `take_snapshot` can save to a file instead.
- **Playwright MCP:** `--snapshot-mode full|none`. `browser_snapshot` can save to a file. Its CLI keeps snapshots on disk; Microsoft's figure was ~114k vs ~27k tokens per task. Later re-tests say the gap closed once MCP stopped streaming snapshots into the chat. The cause named everywhere: old snapshots pile up and are never cleared.
- **browser-use:** `max_actions_per_step` (default 5, e.g. 4 form fields in one step), `max_history_items`, `use_vision: "auto"`, `flash_mode`.
- **Stagehand:** one `observe()` plans several actions that then run with no model call. Cached actions replay at zero tokens.
- **Vercel agent-browser:** compact snapshot with short refs, ~200–400 tokens per page (vendor figure).
- **Anthropic, "Writing tools for agents":** return high-signal info only, offer a concise/detailed choice. Claude Code caps a tool reply at 25k tokens.
- **Anthropic, "Code execution with MCP":** keep in-between results out of the context (150k → 2k tokens in their example).

## Our options, biggest first

Estimates are a **replay of the real run**: the same 405 commands, each reply re-sized as the fix would make it.

1. **Replies say what changed, not the whole page.** After an action, and for `look`'s text (its picture stays): the action line + the change (new elements with their numbers, changed states, URL or title change, or "nothing changed"). The full list only for `read` and on a new page (path change, not just `#slide=`). Reuse `pageChange` (`lib/page/page-diff.ts`). Still inside `<page_content>`. **953k → ~300k.** Size S–M.
2. **Several commands per call, one change report at the end.** The model already sends ~2–3 commands per call; today each gets its own reply. **~300k → ~250k.** Size M.
3. **Tool-description tips, so fewer commands.** Put the whole text of a box in one `type` (new lines make bullets) instead of editing bullet by bullet; `read` before `look`. Can't be replayed (it changes what the agent does). Size XS.

**All together: the same 5 slides 953k → ~250k (~4× less).** Re-read across the run 59M → ~26M, so each call reads ~150k instead of ~350k. The whole 10-slide deck: ~1.9M (can't fit) → **~430k**.

What's left at ~250k is about even: start ~73k, screenshots ~74k, the model's writing ~62k, page text ~40k.

Not worth it (replayed): dropping repeated text lines in a reply, ~1%. Smaller screenshots: 8%. Clearing old results is the client's job, not ours (`/compact` is the user's tool).

## Sources

- [Anthropic: browser use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool) · [Vision: image token cost](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Anthropic: Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Chrome DevTools MCP tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md) · [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [Checkly: MCP vs CLI token efficiency](https://www.checklyhq.com/blog/mcp-vs-cli-token-efficiency/) · [TestDino: Playwright CLI vs MCP](https://testdino.com/blog/playwright-cli-vs-mcp/) · [TinyFish: snapshots pile up](https://current.tinyfish.ai/tinyfish/issue/latest/foundations/article/24492)
- [browser-use agent parameters](https://docs.browser-use.com/customize/agent/all-parameters) · [Stagehand speed optimization](https://docs.stagehand.dev/v3/best-practices/speed-optimization) · [agent-browser context efficiency](https://paddo.dev/blog/agent-browser-context-efficiency/)
