# Browser Agent

A Chrome extension that reads any web page and acts on it. Phase 1 = typed commands only, no AI yet.

- Plan: `phase-A.md` … `phase-F.md` (A–E done; current: F, the 15-task test run). Test tasks: `tasks.md`. Results: `results.md`.
- After F: the harness (AI loop + stop-lines, replay, proof of done, pause/resume). Plan and progress: `harness/plan.md`. Do its first unticked task.
- Site tips, repeat and saved recipes (agent works faster on sites it has seen): build tracker `harness/remember-and-repeat.md`; tick its slices there, not in the docs it points to.
- **For now, `harness/why-it-loops.md` comes first** (developer, 2026-10-14): fixes that make the agent smarter. Do its first unticked fix; `plan.md` waits until the developer says the agent is smart enough.
- Stack: WXT 0.21 + TypeScript 7, Chrome side panel (Chrome 153+: `chrome.publicSuffix` for Sites).

## Commands

- Build: `npm run build` → output in `.output/chrome-mv3/`
- Type check: `npm run typecheck`
- Tests: `npm test` (Node's built-in runner; files are `lib/*.test.ts`, plain `throw` on failure)
- Load in Chrome: `chrome://extensions` → Developer mode on → **Load unpacked** → pick `.output/chrome-mv3/`. After each build, hit the reload icon on the extension card.
- MCP (any coding agent drives the browser): side panel `/mcp on` (a new site asks you: Add site / No), then register once: `claude mcp add --transport stdio --scope user browser-agent -- node <repo>/host/mcp.ts`. Path: agent ⇄ `host/mcp.ts` ⇄ random pipe + token (`bridge.json` next to the launcher) ⇄ `host/host.ts` ⇄ panel. Rules: `lib/bridge.ts`.
- Code lives in `entrypoints/` (each file there becomes part of the extension). Shared code lives in `lib/`. Manifest settings live in `wxt.config.ts`.

## Who you're talking to

Every explanation (chat replies, code comments, docs) must be easy to follow:

- **Lead with the answer.** First line = what happened or what to do. Details after.
- **Short chunks.** Max ~3 sentences per paragraph. Bullets and numbered steps over prose.
- **One thing at a time.** One task, one step, one question. Don't stack five decisions in one reply.
- **Make the next action obvious.** End with a bold "Next:" line saying exactly what to do or run.
- **Bold the key word**, not whole sentences. No walls of text, no long tables when a list works.
- **Say where you are.** When starting work, name the step (e.g. "Phase A · step 2").
- **Explain jargon in one line** the first time it appears.
- **Code:** small files, obvious names. Each file starts with a one-line comment saying what it's for.

## Use the skills

- **At the start of every task, load the `using-agent-skills` skill** (`.claude/skills/using-agent-skills/SKILL.md`). Use its decision tree to pick the right skill(s) for the task, then load and follow them. Also load the ponytail skill before writing any code.
- Usual picks here: `source-driven-development` (any WXT/Chrome API code), `incremental-implementation` (building a step), `debugging-and-error-recovery` (something broke).
- Tell the developer which skill(s) you're using, in one line.

## Don't trust your training data

APIs for WXT, Chrome extensions (Manifest V3), and libraries change often. Your memory may be outdated.

- **Search the web before writing code that uses any library or Chrome API**, even small things (a config key, a CLI flag, a permission name).
- Prefer official docs: wxt.dev, developer.chrome.com/docs/extensions, the library's GitHub.
- When you use something you looked up, give the source link in your reply.
- If docs and memory disagree, docs win. If you couldn't verify something, say so.

## Boundaries

- Never go past the cart (Amazon) or search results (Booking). No checkouts, payments, or logins on real sites.
- Ask before adding a dependency.

## Security: no lazy parts

Even in dev, we act on the **real web** with a **real API key**. So dev gets the same security as a product.

- **No "fine for dev" shortcuts.** Never skip validation, guards or key protection because it's only dev.
- **No open ends.** A security guard (stop-lines, judge, secret fields, key storage, untrusted page text) is finished and tested in the task that adds it. No security TODOs, no `shortcut:` comments on security code.
- **Found a gap you can't close in this task?** Stop and tell the developer. Don't leave it for later silently.
