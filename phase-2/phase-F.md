# Phase 2 · F. The real test

Goal: measure the agent on the same 15 tasks from Phase 1, with **both** providers, then tune until it's good enough to build Phase 3 on.

**Before you start:** Sections A–E done.

**Rules**
- Use the separate Chrome profile (no saved passwords or payment methods, no important accounts).
- First run of each task: step mode **on**, to catch anything dangerous. Measured runs: step mode **off**, but watch, and press Stop if it heads somewhere wrong.
- The tasks stop before anything irreversible (checkout, sending, posting). Keep it that way.

**Files**
```
results-phase2.md   ← one row per task per provider, plus notes
```

## 17. Run all 15 tasks with both providers

**What:** an honest measurement of how well the agent works.

**How:**
1. Settings: Claude Opus 5.5 at effort `medium`. Then repeat everything with OpenAI's default model from step 3.
2. For each task in `tasks.md`: fresh tab, type the task exactly as written, let it run.
3. Record a row in `results-phase2.md`:

   | # | Provider | Pass/Fail | Steps | Tokens | Time | End reason | Cause |
   |---|----------|-----------|-------|--------|------|------------|-------|

4. Give every failure **one** cause (use the exported log from step 13 to see what the AI saw and decided):
   - **a. Eyes/hands:** the needed element wasn't in the list, or the action didn't work → a Phase 1 bug; fix it there.
   - **b. Prompt:** the AI misread a rule or the page format → step 9.
   - **c. Tool:** wrong arguments, or a confusing tool description → step 7.
   - **d. Loop:** stuck detection too strict or too loose, or history missing something → steps 10–12.
   - **e. Model:** the AI had good information and still chose badly → note it; compare other models/effort in step 18.
   - **f. Needs real input or vision:** fake events ignored, canvas, CSS-hover menus → add to the Phase 5 list.

**Done when:**
- The table has a row for every task with both providers.

## 18. Tune and re-run

**What:** fix the biggest causes, then measure again.

**How:**
- Fix one cause at a time. Re-run only the affected tasks after each fix.
- **Prompt changes:** one change per run, so you know which change helped.
- **Effort:** run the 15 tasks with Claude at `low` and compare pass rate, tokens and time against `medium`. Pick the default from the numbers, not by guess.
- **Cheaper models:** run the tasks once on Sonnet 5.5 and Haiku 5.5. Note where each breaks. This is data for pricing later; change the default only if the numbers say so.
- Finish with one full run of all 15 tasks on both providers, from scratch.

**Done when:**
- At least 11 of 15 tasks pass on **each** provider with the default settings. That's lower than Phase 1's 13/15 because the AI is less reliable than you by hand; Phase 4's planner aims to raise it.
- Every task ends with a clear reason (done, ask_user, stuck, step limit). None crash or hang.
- Average tokens and time per task, per provider, are written at the bottom of `results-phase2.md`.
- Remaining failures are listed with their cause, and every cause-f item is on the Phase 5 list.

**What you have at the end of Phase 2:** a working single-agent browser assistant on Claude and OpenAI, with a measured pass rate and cost per task. Phase 3 adds the security guard and Phase 4 adds the team.
