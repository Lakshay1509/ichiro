# Token cost: research + options

Web research on 2026-10-13: how other browser agents keep runs cheap, and what that means for ours. **Not scheduled yet:** `plan.md`'s order still rules.

## The short version

- **Our steps are already lean** (~4.6k tokens). The cost comes from the **model**, not from bloat.
- **Biggest lever by far:** a cheap model (Haiku 5.5) runs the steps, Sonnet only writes the plan. Laptop run: ~$0.24 → ~$0.02 (estimate). Needs a test: cost per *finished* task, not per step.
- **Then:** prompt caching (~25% off on Sonnet), lower effort, smaller page lists. Replay (Phase 6) for repeated tasks.

## Where our tokens go (laptop run, 2026-10-13)

- **Run:** 20 steps, 93,394 tokens in, 5,203 out, on Sonnet 5.5 ($2 in / $10 out per million). Plan call: 783 in, 462 out.
- **Cost:** ~$0.19 input + ~$0.05 output + ~$0.01 plan ≈ **$0.24**. Input is ~78% of it.
- **Per step:** 3.3k–5.6k tokens in, growing as history grows.
  - Fixed part (rules ~1.1k + goal, plan, checklist ~0.7k): ~1.8k, about 40%. Measured from `buildAsk` with laptop-sized text.
  - Page list: ~1.5–2.5k, about 40%.
  - History + memory + notes: the rest, growing ~100–150 per step.
- **Input : output** ≈ 18 : 1. Manus reports ~100 : 1 for theirs.

## What the others do (one line each)

- **Manus:** KV-cache hit rate is "the single most important metric": cached input is 10× cheaper. Keep the prefix stable, keep context append-only, no timestamps up front.
- **Nanobrowser (Chrome extension, like us):** planner, navigator and validator can each use a different model: a strong one for planning, a cheap one for the many navigation steps.
- **browser-use:** cloud price per step ranges from $0.002 (its own small model) to $0.05 (Sonnet 4.5). Settings: `flash_mode` (memory only: no evaluation, next goal or thinking), `max_history_items`, `use_vision` (screenshots off), a separate cheaper `page_extraction_llm`.
- **Stagehand:** caches resolved actions and replays them with **zero model calls** (`cacheDir`); reports ~30% lower cost on repeat workflows. Advises cheap models for simple calls and a per-call override for hard ones.
- **Page size:** vendors claim 66–71% fewer tokens than Playwright's ARIA snapshots (Opera, ZeroDOM), or 1–3k per page vs ~10k (agent-browser). FocusAgent: a small model picks the relevant lines first, >50% smaller pages, same success. Vendor numbers are unverified.
- **AgentOccam:** often cited, but its full setup used *more* tokens per step than the baseline. Not a cost fix.

## Our options, biggest first

1. **Haiku 5.5 for steps, Sonnet for the plan.** (Done 2026-10-13: laptop task $0.24 → ~$0.027, headphones ~$0.013.) Haiku is $0.10 in / $0.50 out: 20× cheaper. Same laptop run ≈ $0.012 for the steps + ~$0.006 for the Sonnet plan ≈ **$0.02**. Supports our JSON reply format (structured outputs list includes `claude-haiku-5-5`). The host already allows it (it's the judge model). **Risk:** more steps or more failures; measure on the 5 goals we already ran. Small change.
2. **Prompt caching (3.8a).** Fixed ~1.8k per step cached at 10% → ~$0.06 off the Sonnet run (~25%). (Earlier estimate of 4 cents used an older, smaller prompt.) Minimum cacheable prefix is 512 tokens on Sonnet 5.5 and Haiku 5.5. Caches are per model. On Haiku the saving is tiny in dollars. Size M (host change).
3. **Effort.** Sonnet 5.5 thinks by default at effort `high`; output is ~22% of the bill. Try `low` or `medium` (the host refuses `effort` today, so it needs an exact allowed value). Haiku 5.5 defaults to `medium`. Small.
4. **Smaller page lists.** ~40% of each step. Options: collapse repeated labels, cap the list, or a cheap model picks relevant lines (FocusAgent). Measure a few real pages first; ours is already a compact numbered list.
5. **Replay (Phase 6).** A repeated task costs ~0. Already planned.

Not worth it now: shorter history (small share), AgentOccam-style pruning (no net saving).

## Open questions

- Does Haiku finish the 5 known goals? Same steps? Compare cost per finished task.
- If Haiku fails some steps: switch to Sonnet for the rest of that run (like browser-use's `fallback_llm`), or only for the plan?

## Sources

- [Manus: Context engineering lessons](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [browser-use agent parameters](https://docs.browser-use.com/customize/agent/all-parameters) · [Browser Use Cloud pricing](https://docs.browser-use.com/cloud/pricing)
- [Stagehand caching](https://docs.stagehand.dev/v3/best-practices/caching) · [Browserbase: caching changelog](https://browserbase.com/changelog/stagehand-caching) · [Stagehand cost optimization](https://docs.stagehand.dev/v4/best-practices/cost-optimization)
- [Nanobrowser overview (third-party)](https://www.sourcepulse.org/projects/1827754)
- [Opera: token-efficient snapshots](https://www.opera.com/ai/articles/how-does-opera-browser-cli-reduce-tokens) · [ZeroDOM](https://mcpservers.org/servers/zerodom-vexralabs-com-docs) · [agent-browser](https://www.producthunt.com/products/agent-browser-2)
- [FocusAgent](https://arxiv.org/html/2510.03204v1) · [AgentOccam](https://arxiv.org/html/2410.13825)
- [Claude structured outputs (supported models)](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) · Prices, thinking defaults and caching minimums: bundled Claude API reference (cached 2026-10-06)
