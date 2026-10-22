# Long tasks: research + backlog

> **History (2026-10-22):** written for the panel's AI loop, which was removed: the extension is now pure MCP. Don't build from this doc.

Ideas for tasks longer than ~30 steps, from web research on 2026-10-13. **Not scheduled yet:** `plan.md`'s order still rules. When you pick a task up, move it into `plan.md`.

## The short version

- **Main gap:** no checklist that code tracks. Agents that finish long tasks split the goal into sub-goals, tick them off, check each one, and re-plan when stuck.
- **Ours today:** the plan's Approach is a guess the AI never reports against. Its memory is 1–3 sentences (500 chars), rewritten every step.
- **Fix:** the four tasks below (L1–L4). 3.6 (step budget) stays, with three tweaks.

## What we already do right (keep it)

- **Fresh ask each step**, not a growing chat. No context overflow, so Claude's compaction / context editing features don't apply to us.
- **Errors go back to the model.** Manus calls this key to recovery ("keep the wrong stuff in").
- **3.7a–c:** memory + next_goal, "what changed", loop guard.
- **Phase 6 (learn once, replay):** Agent Workflow Memory reports +24.6% / +51.1% relative success from reusing past routines.

## What the research says (one line each)

- **Anthropic (long-running harness):** a JSON feature list written up front. The agent may only flip pass/fail, never edit the list (JSON because models rewrite Markdown more). Test before marking done. One feature at a time.
- **Manus:** a `todo.md` rewritten as it works, so the plan sits at the end of the context where attention is strongest (~50 tool calls per task). Files as memory: drop page content, keep the URL.
- **Manus caveat (third-party write-up):** about a third of actions went to updating `todo.md`. So ticking must not be its own action.
- **Skyvern:** planner → one sub-task at a time → validator. Their WebVoyager score: 45% → 68.7% (planner) → 85.85% (validator). The validator was added because the agent believed "add to cart" worked when it didn't.
- **"Why do web agents fail?" (ACL 2026):** one round of re-planning, using what the agent learned while exploring, clearly improves success. Execution, not planning, is the main bottleneck.
- **WebChoreArena:** memory-heavy, multi-page tasks. Most models score under 10% on the cross-site ones.
- **browser-use:** `max_history_items` keeps only the last N steps in the prompt.

## The 30-step cap and 3.6

- **Was:** `MAX_STEPS = 30`, and at 30 the run died. Replaced by 3.6's step budget on 2026-10-13 (code done, live check open).
- **3.6 is still right.** Every agent keeps a hard step cap (browser-use's default is 100). Budget = **cost** guard; checklist = **progress** guard. Different jobs.
- **Three tweaks when we build 3.6:**
  1. **Budget from items.** With L1, the default is items × ~4 steps + room for retries. You can still edit it. (Open question below: does code or the planner set it?)
  2. **The +N steps pause shows progress:** `8 / 10 items done · 40 steps · 120k tokens`. You extend with facts, not a guess.
  3. **Cap the history before budgets grow.** Every step re-sends every past step, so a run's cost grows with steps². Before allowing 150 steps: last ~20 steps in full, older ones folded into `✓ items 1–6` (needs L1).

## Tasks

- **L1 Checklist** → moved to `plan.md` (2026-10-13; code done, live check open). G1 (2026-10-19): the checklist is now the agent's own live plan, sent in its step reply.
- [ ] **L2 Check each item.** A tick must be earned, like Phase 5's `done`, but per item.
  - A new tick carries `"proof"`: short text that shows on the page when the item is done (e.g. "Customer reviews"). Code checks it with Phase 5.1's `check` (text on screen). Not found → tick refused, and the model is told why.
  - A skip ("filter unavailable") uses proof `skip: <why>`. Code can't check a skip, so the panel shows skips with their own mark.
  - **Deterministic:** no extra model call, and no new model sees page text. Skyvern uses a model as validator; try text first and upgrade only if it misses real failures.
  - Depends on: L1, Phase 5.1.
  - **Done when:** tests: proof on the page → tick accepted; proof missing → refused; a skip shows as a skip. Live: on Amazon results, a tick for "sorted by rating" passes only after the sort really happened.
  - Files: `lib/agent-prompt.ts` + test, `entrypoints/sidepanel/main.ts` · Size: S
- [ ] **L3 Re-plan when stuck.** One fresh plan for the rest of the task, instead of only Keep going / Stop. **Replaced by G1** (`why-it-loops.md`, 2026-10-19): the agent sends a new plan itself, and the loop guard's rethink asks for one. Not built.
  - **Trigger:** the loop guard's pause (3.7c), or one item active for more than ~8 steps.
  - **Button:** the pause gets a third choice, **Re-plan**. Your click, never the model's.
  - **Ask:** the planner gets the goal, the checklist with ticks, the latest memory and notes (untrusted), and the current page (untrusted). It rewrites only the **unticked** items.
  - **Locked by code:** Done when, Sites and Limits are copied from the approved plan; ticked items stay. A re-plan that changes them is refused.
  - **You approve it** like 3.4 (Edit / Run): the plan counts as your instruction, and page text could slip into it.
  - At most 2 re-plans per run (the paper's gain came from one round).
  - Depends on: L1.
  - **Done when:** tests: locked parts can't change; ticked items are kept; a third re-plan is refused. Live: a goal whose Approach can't work on the site (a filter that doesn't exist) → loop guard pauses → Re-plan → it finishes another way.
  - Files: `lib/agent-prompt.ts` + test, `entrypoints/sidepanel/main.ts` · Size: M
- **L4 Notes** → moved to `plan.md` (2026-10-13; code done, live check open).

## Suggested order

1. **3.7 check** (current task in `plan.md`). It shows how much of this the laptop task still needs.
2. **L1** → **3.6** with the three tweaks → **L4** → **L3** → **L2** (after Phase 5.1).

### Checkpoint

After L1 + 3.6 + L4: rerun the laptop task (`harness/laptop-task.md`). All 15 items, no loop over 8 steps, and the progress line matches what happened. Show the developer before going on.

## Risks

- **Wrong ticks:** the model claims an item is done when it isn't. L2 checks it; until then, Phase 5 checks only at the end.
- **Weak proof:** the model picks its own proof text, so it could pick text that's always there. The panel shows the proof, so you can judge it.
- **Tick overhead:** solved by making ticks a reply field, never their own step.
- **Re-plan drift:** Done when / Sites / Limits are locked by code, every re-plan needs your OK, and there are at most 2 per run.
- **Page text in notes:** treated as untrusted, defused and capped.
- **Bigger budgets, bigger bills:** 3.8b's token ceiling plus the history cap.

## Open questions

- **Approach cap** is 10 lines, but the laptop task has 15 numbered items. Raise it to 15, or let the planner merge items?
- ~~**Who sets the budget:**~~ Decided 2026-10-13: code (items × 4 + 10), editable in the plan box. 3.6 and its three tweaks are in `plan.md` (code done).
- **L2 validator:** is text-on-page enough, or do we need a small model? A model validator would see page text, so it can be fooled. It would only approve ticks, never actions.

## Sources

- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Manus: Context engineering lessons](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [Planning-with-files (Manus todo.md overhead, third-party)](https://tessl.io/registry/jbvc/planning-with-files/files/reference.md)
- [Skyvern 2.0 eval write-up](https://www.skyvern.com/blog/skyvern-2-0-state-of-the-art-web-navigation-with-85-8-on-webvoyager-eval/) · [Skyvern docs](https://www.skyvern.com/docs/getting-started/introduction)
- [Why Do LLM-based Web Agents Fail? A Hierarchical Planning Perspective](https://arxiv.org/html/2603.14248)
- [WebChoreArena](https://www.emergentmind.com/papers/2506.01952)
- [Agent Workflow Memory (ICML 2025)](https://proceedings.mlr.press/v267/wang25bx.html)
- [browser-use agent parameters](https://docs.browser-use.com/customize/agent/all-parameters)
- [Claude context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- [Anthropic context engineering (summary)](https://www.beri.net/learning/anthropic-effective-context-engineering-agents)
