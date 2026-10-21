# Phase 1 · F. The real test

Goal: prove the "eyes and hands" are good enough for an AI, before writing any AI code. You play the AI: complete the 15 tasks from `tasks.md` using **only** the console and the `read` output.

**Before you start:** Phases A–E done.

**Rules**
- No AI/LLM calls anywhere in Phase 1.
- While deciding the next command, **don't look at the page**. Keep the overlay off. Decide only from the text output, because that's all the AI will get. Look at the page only afterwards, to check the result.
- Stop before anything irreversible (checkout, sending, posting, deleting). The tasks are written to end before that.

**Files**
```
results.md   ← one row per task, plus the Phase 5 list
```

## 19. Run all 15 tasks by hand

**What:** an honest measurement of how far the reader and actions get on real sites, then fixing what failed.

**How:**
1. Add a `stats` line to the `read` output if it's not there yet: element count, `~N tokens` (characters ÷ 4), and how long `read` took.
2. For each task in `tasks.md`, start from a fresh tab and work only through the console.
3. Record a row in `results.md`:

   | # | Site | Pass/Fail | Steps used | Largest read (~tokens) | What went wrong | Cause |
   |---|------|-----------|------------|------------------------|-----------------|-------|

4. Give every failure **one** cause:
   - **a. Missing:** the needed element wasn't in the list → fix steps 6/7/16/17.
   - **b. Unclear:** it was there but the name didn't say what it was → fix step 8.
   - **c. Action failed:** the command ran but the site didn't react → fix steps 12–14.
   - **d. Timing:** acted on an old view, or the read came too early → fix step 15.
   - **e. Needs real input:** the site ignores fake events, CSS-hover menus, native dialogs, canvas → don't fix now; move to the Phase 5 list.
5. Fix causes a–d one at a time. After each fix, re-run that task.
6. When all fixes are in, re-run **all 15** once from scratch to catch anything a fix broke.
7. At the bottom of `results.md`, write the **Phase 5 list**: every cause-e failure with site name and what happened.

**Done when:**
- At least 13 of 15 tasks pass in the final full run.
- A typical page's `read` is under ~3k tokens. Pages over that are written down with a note on what bloats them (ads, long lists, iframes).
- Every remaining failure is in `results.md` with a cause, and every cause-e item is on the Phase 5 list.

**What you have at the end of Phase 1:** an extension that can read and act on most sites, a measured pass rate, and a clear list of what still needs work. That's the base Phase 2 puts the AI on top of.
