# Repeat tasks: do one, repeat the rest

Research for "download assignment 1–10" (developer, 2026-10-19). Built as RP1: `remember-and-repeat.md` Build 2.

> **Since 2026-10-22 (pure MCP):** `repeat` runs only through the MCP bridge; the panel's AI loop is gone. "The AI" below is now the coding agent.

**Answer:** let the AI do **item 1** normally. Then **code** finds the other items (everything built like item 1) and **replays item 1's commands** on each, with **zero AI calls**. The AI steps back in only when an item doesn't go like item 1. Every serious agent that "learns once" works this way.

We already have most of the parts:

- `pick like <n>` (F3c) already **sees the pattern**: it finds every element built like one example.
- Several commands per step (F9) already runs a list of commands safely, one by one.
- Phase 6 in `plan.md` (recipes, labels not numbers, self-heal) is the same idea, saved for later runs.

What's missing: a way to say "now do what I just did, for each of these".

---

## Why today's agent is slow at it

- **One AI step per click.** Each assignment is about 3–4 steps (open it, click Download, go back). 10 items ≈ 30–40 steps = the whole 40-step budget.
- **It re-thinks every item.** Item 7 costs the same as item 1, though nothing new is learned.
- **10 download asks.** D2 pauses every download and asks you, one by one.

## Three shapes of "repeat" (any site)

1. **All on one page:** a list of 10 links, each one downloads. → `pick like` finds them; only the clicks repeat.
2. **Each needs a trip:** open Assignment 1 → click Download → back. → the whole trip repeats.
3. **Same task next week:** "download assignment 11". → a saved recipe (Phase 6), not this note's first fix.

**Not a shape: guessing URLs.** Assignment pages are usually IDs (`/assignments/48213`), not 1, 2, 3. Counting in the URL would break our "never make up deep URLs" rule. Items come only from links on the page.

---

## What others do (researched 2026-10-19)

**The pattern:** show it once → turn it into steps with a slot for what changes → replay with no AI → check each run → fall back to the AI on a miss.

### Programming by demonstration (one example → a loop)

- **Helena / Rousillon** (Chasins, Berkeley): you do the **first row**; it writes the loop for the rest. Its key part is a **list finder** that spots the page's table or list ([Helena](https://github.com/schasins/helena); Rousillon is UIST 2018, paper not opened here).
- **WebRobot** (PLDI 2022): watches a couple of iterations, **guesses** the loop, then **checks** the guess against what you did ("speculate and validate") ([paper](https://arxiv.org/abs/2203.09993)).

### Record once, replay free

- **browser-use workflow-use:** record once → a `.workflow.json` with **variables**; replays with no AI; on a failed step it falls back to the full agent ([repo](https://github.com/browser-use/workflow-use)). Still "very early" per its README.
- **Stagehand caching:** a cached `act()` replays with no AI; if the element is gone, it calls the AI again ([docs](https://docs.stagehand.dev/v4/best-practices/caching)).
- **Claude in Chrome shortcuts:** record a workflow once, rerun it with `/` ([help](https://support.claude.com/en/articles/12012173-getting-started-with-claude-in-chrome)).
- **Project Mariner "teach and repeat":** show a task once, it repeats similar ones later ([DeepMind](https://deepmind.google/technologies/project-mariner/)). Project discontinued in 2026.
- **AgentRR** (2025): record → summarize into steps at a few levels of detail → replay, with a **check function** for each recipe as the safety anchor ([paper](https://arxiv.org/abs/2505.17716)).

### Learned skills (research agents)

- **Agent Workflow Memory:** pulls reusable routines out of past runs, with the changing values swapped for slots. **+24.6% / +51.1%** relative success on Mind2Web / WebArena, fewer steps ([paper](https://arxiv.org/abs/2409.07429)).
- **SkillWeaver:** the agent turns practiced tasks into reusable functions; +31.8% on WebArena ([paper](https://arxiv.org/abs/2504.07079)).
- **WALT:** turns a site's own search / filter / sort into tools; 52.9% on VisualWebArena ([paper](https://arxiv.org/abs/2510.01524)).

### Loops as a block

- **Skyvern ForLoop:** runs its inner blocks once per item of a list, with the current item as a value ([guide](https://www.skyvern.com/blog/new-feature-natural-language-loo/)).

**Not copying:** agents that write and run their own code (SkillWeaver's Playwright functions). Running AI-written code in your browser is a security hole we don't need.

---

## Proposed fixes (wait for the developer)

### RP1 Repeat what worked (in one run, nothing saved)

Build progress: `remember-and-repeat.md` (tick slices there). RP1 is its Build 2.

- [ ] New AI command: **`repeat <step> on <numbers>`**, e.g. `repeat 5 on 15-23`.
  - `<step>`: the step where item 1 started. Its commands up to the last step are the **recipe** (1–8 commands, F9's limit).
  - `<numbers>`: the other items, as numbered in the page list now (usually from a `pick like` just before). Ranges allowed. 1–30 items.
  - The model picks the numbers, so it handles "only 1–10", reversed lists, and skipping ones already done.
- **How it finds the pattern:**
  - The **model** spots that the goal is a repeat (prompt rule below).
  - **Code** checks each item is **built like** item 1's element: same tag path + attributes alike, F3c's matcher (`similarity` in `lib/pick.ts`). Not alike → refused. This keeps a loop on "the same kind of thing".
- **How it replays:**
  - The recipe is stored **by label**, not number (Phase 6.1's rule: record the label of each element acted on).
  - For each item: the first command's target becomes that item; the rest run by label as recorded. Numbers change after every page load; labels mostly don't.
  - **Zero AI calls** while it goes. The whole repeat is 1 step in the history: `repeat: 9 / 9 done, 9 files downloaded`.
- **How it checks each item** (AgentRR's check, simple form): item k must go like item 1. Same commands succeed, same number of downloads finish.
  - Miss → stop and hand back: `Repeat stopped at "Assignment 6": nothing called "Download". Done: 2–5. Left: 6–10.`
  - The model fixes item 6 by hand, then may send `repeat` again for the rest. That's the self-heal, without new code.
- **Prompt rule:** "When the goal asks for the same thing for many items, do the first one fully. Then pick like it, and repeat its steps on the rest."

#### Security (all of it ships in RP1)

- **You approve the list once:** "Repeat steps 5–7 on 9 items from **coursesite.edu**: Assignment 2, …, Assignment 10. Up to 9 downloads." **Repeat** / **No**.
- **Every replayed command still goes through `runLine`:** stop-lines, Sites, hand-overs, CAPTCHA pauses. A stop-line still asks you each time; **I'll do it** stops the repeat.
- **Items come only from the current page list** and must be built like item 1. The page can't add items.
- **Caps:** 30 items, 8 commands per recipe.
- **Item names are page text:** quoted and cut, in the panel and in `<steps>` (untrusted, defused), as today.
- **v1 only clicks the item.** It never types page text into a field. (Typing a slot is Phase 6.3.)

> ⚠️ **One rule changes, your call:** D2 says "every download asks first". RP1's single approval would cover the named downloads (max one batch = item 1's downloads × items). Any other download still pauses and asks. If you'd rather keep D2 strict, RP1 still saves the AI steps, just not the 10 clicks.

- **Done when:** tests (pure): parse `repeat` (step exists, numbers in list, ranges, refuse 0 and 31+); recipe from steps by label; first-target swap; the per-item check; stop at the first miss with the done / left lists. Live: a local test page with 10 assignment links, each opening a page with a Download button: all 10 with **one approval** and **≤ 8 AI steps**.
- Files: `lib/agent-prompt.ts` + test, new `lib/repeat.ts` + test, `entrypoints/sidepanel/main.ts`, `lib/downloads.ts` · Size: M

### RP2 Remember it for next time

- [ ] This is `plan.md` Phase 6 (6.1 save, 6.2 replay, 6.3 slots, 6.5 suggest) plus F10 site tips. RP1's recorder **is** 6.1's recorder, so RP1 is Phase 6's first slice.
- Decide after RP1 works.
- Where to save and how to guard it: `site-memory.md` (2026-10-20).

---

## Open questions (checked in the live run)

- **Chrome's "download multiple files" prompt:** Chrome asks before a site downloads several files ([guide](https://www.howtogeek.com/428416/how-to-enabledisable-multiple-file-downloads-in-chrome/)). Not verified whether it fires for our clicks (I1's real clicks count as yours). If it does, you click Allow once per site.
- **Lists past page 1:** if assignments 8–10 are on page 2, the model clicks Next and sends `repeat` again. No new code.
- **Rough saving:** 10 trips ≈ 30–40 AI steps today vs ≈ 6 with RP1 (item 1 + pick like + repeat). An estimate, not measured.
