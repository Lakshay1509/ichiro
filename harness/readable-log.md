# Readable log: a side panel you can follow

**Goal:** while a coding agent drives the browser, the side panel says what is happening in plain words you can read at a glance. Today each command prints raw (`agent> click 12`): numbers instead of names, command syntax, no grouping, no status.

- Do the **first unticked slice**. One at a time.
- Tick a box only when its **Done when** is verified (test, typecheck + build, and a live check you actually ran).
- Every guard a slice adds ships finished and tested in that slice (`CLAUDE.md` → Security).
- **No AI slop (developer, 2026-10-22):** no emojis, decorative icons, sparkle or purple styling, no chatty filler. Status is a plain word; color is only a second cue.

**Research (2026-10-22):**
- Plain words, not system calls: [Smashing, Designing For Agentic AI](https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/).
- Every step has a state (running, waiting, error, done); details hide behind a click: [Shape of AI, Stream of Thought](https://www.shapeof.ai/patterns/stream-of-thought).
- Steps grouped under one title you can collapse: [GitHub Actions log groups](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands), [AI Elements Chain of Thought](https://ai-sdk.dev/elements/components/chain-of-thought).
- A trail you can scroll back through: [Shape of AI, Footprints](https://www.shapeof.ai/patterns/footprints).

## Slices

- [ ] **RL0 · Preact draws the panel (developer, 2026-10-22).** The log above the command box is drawn by Preact components (`entrypoints/sidepanel/log.tsx`): lines, asks with their buttons, the tips list. Same look and behavior as before, nothing new. The command box stays plain HTML until a slice needs it.
  - Why Preact: ~3 KB, React-style components, plain TSX that TypeScript 7's `tsc` checks (Svelte and Vue templates need TS 7.1's API). Preact 11 (npm `latest` 11.0.1). JSX: tsconfig `jsx: react-jsx` + `jsxImportSource: preact`, which Vite 8's Oxc transformer reads too. Sources: [WXT frameworks](https://wxt.dev/guide/essentials/frontend-frameworks), [Preact + TypeScript](https://preactjs.com/guide/v10/typescript/), [Preact 11 upgrade guide](https://preactjs.com/guide/v11/upgrade-guide), [Vite JSX](https://vite.dev/guide/features#jsx).
  - Logic stays in `main.ts`; only the drawing moves.
  - Guard: page and agent text is shown as text (JSX escapes it, like `textContent` today), never through `dangerouslySetInnerHTML`. Asks keep focus in the command box.
  - Done when: typecheck + tests + build pass; live: plain lines, an error in red, a stop-line's Allow once / I'll do it, a pause's Resume, `/tips` with Delete, `/clear` all work as before.
- [x] **RL1 · names, not numbers.** An agent line shows the element's name: `click 12` → `click "Search"`. No name → the number stays.
  - Reuse: `elementWord` (`lib/parse-command.ts`) + `nameFor` (`lib/frames.ts`), the way `recordLine` (`lib/repeat.ts`) does for repeat. Take the name before the command runs: a read afterwards renumbers.
  - Where: `agentRun` in `entrypoints/sidepanel/main.ts` (`print(\`agent> ${line}\`)`).
  - Guard: a name is page text, and the page controls it. Shown in quotes, on one line, capped (~60 chars), through `textContent` only, so a page can't fake a panel line or a button.
  - Done when: a test for the line maker (named, unnamed, too long, line break in the name); typecheck + build pass; live: clicking a named button shows its name.
- [ ] **RL2 · one block per agent call, with a status word.** Each MCP call (`onBridge` → `agentBatch`) gets one block, headed `Step 3` and a status: `Running`, then `Done` or `Stopped`, and `Waiting for you` while an ask is open. Its commands are the lines inside.
  - The status word comes first and is real text (screen readers read it; the log is already `role="log"`). Color second: red for Stopped, as errors are today.
  - Where: `onBridge`, `agentBatch`, `askKeepGoing` / `askAllow` (Waiting for you), `print` (prints into the open block).
  - Guard: asks (Allow once, a new site, downloads) keep their buttons and focus rules unchanged: focus stays in the command box, so a reflex Enter can't press Allow.
  - Done when: any pure status logic in `lib/` has a test; typecheck + build pass; live: a 3-command batch shows one block going Running → Done; a stop-line shows Waiting for you, then Done or Stopped.
- [ ] **RL3 · the raw commands behind a click.** In each block, the exact commands as the agent sent them go in a `<details>` (the browser's built-in show/hide), closed by default. A long line (a `paste` of JSON, up to 20,000 chars) shows its first ~100 chars in the block; the full text only inside.
  - Where: the RL2 block.
  - Done when: a test for the cut; typecheck + build pass; live: a paste batch shows one short line, and opening it shows the full command.
- [ ] **RL4 · the result, not the page dump (developer, 2026-10-22).** An agent command's reply shows only its result: its first paragraph (`ok — real click`, a batch's numbered results), or its first line when it has no blank line (`read` → its URL line). The rest, the page as the agent got it, goes in a closed "What the agent got". A stopped call's error the same way, without the `Step N.` the block already shows.
  - Where: `agentCommand`'s `print(output)` and `onBridge`'s error print (`main.ts`), the line item in `log.tsx`, `splitReply` in `lib/readable-log.ts`.
  - Done when: a test for `splitReply` (one line, a page after a blank line, `read`'s list with no blank line, a batch's results); typecheck + build pass; live: a click shows one line, and "What the agent got" opens to the page.

## Log

- 2026-10-22: research done, tracker written. Next: RL1.
- 2026-10-22: developer chose Preact for a component UI; RL0 added ahead of RL1. Next: RL0.
- 2026-10-22: RL0 built: `entrypoints/sidepanel/log.tsx` draws the log; typecheck + build pass (panel script 495 → 508 kB). Tests not run: no `lib/` code changed. **Open:** live check. RL1–RL3 handed to a background agent.
- 2026-10-22: RL1 built: `namedLine` (`lib/readable-log.ts`, reuses `elementWord` + `oneLine`), used at `agentRun`'s `agent>` line. `lib/readable-log.test.ts`, typecheck and build pass. Live check open.
- 2026-10-22: RL2 built: `openStep` / `closeStep` / `leaveStep` and a `Step` block in `log.tsx`, status word from `stepStatus` (`lib/readable-log.ts`), opened in `onBridge` after `checkCommands`; your typed commands print outside it. Test, typecheck and build pass. Live check open.
- 2026-10-22: RL3 built: each block ends in a closed `<details>` "Commands as sent"; `namedLine` became `shownLine`, which also cuts the shown line to one line of 100. Test, typecheck and build pass. Live check open.
- 2026-10-22: RL1–RL3 live (Wikipedia, 3 calls): names and blocks showed, but each reply printed the whole page into the panel. RL4 added and built: `splitReply` + test, typecheck and build pass. Live check open.
- 2026-10-22: live after RL4 (Wikipedia, 3 calls, screenshot): blocks show short results, "What the agent got" and "Commands as sent" closed. RL1 ticked (named clicks showed). Still open: RL0 `/tips` + `/clear`, RL2 Waiting for you, RL3 long paste, RL4 opening "What the agent got".
- 2026-10-22: panel restyled to `DESIGN.md` (developer chose plain CSS + Inter over Tailwind): `entrypoints/sidepanel/style.css`, Inter bundled by `@fontsource-variable/inter` (no font request leaves the extension). Calls are white cards with a status pill; asks are one amber card whose buttons look alike (no nudge toward Allow); empty log says what to type. Typecheck, test and build pass; checked in a static preview, not yet in Chrome.
- 2026-10-22: slop audit (design-taste-frontend app rules + ui-ux-pro-max), 7 changes: no gradient fade, no shadows at rest, your commands back as left `> /cmd` lines (the panel is not a chat), status pills lose the pulsing dot, no "Nothing here yet.", Running pill text #005bab (was 4.1:1), 16px margins. Kept on purpose: mono commands, no h1 (Chrome's header names the panel), "Step N" (repeat uses it), DESIGN.md hairlines.
- 2026-10-22: MCP state moved out of the log (developer): the command box's bottom row (`#mcp` inside the form, one card with the field; `showMcp` in `main.ts`) says MCP off / starting / on with Lucide's plug or unplug icon (ISC). Gone from the log: "Remembered from last time…" and "MCP bridge on…". Still in the log: `/mcp on`'s reply with its Sites, and every bridge error. Typecheck and build pass; three states checked in headless Edge, not yet in Chrome.
