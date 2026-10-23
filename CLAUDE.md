# Ichiro

A Chrome extension that lets a coding agent (Claude Code, Codex…) read any web page and act on it, through one MCP tool: `browser`.

- **Pure MCP** (developer, 2026-10-22): the extension has **no API key and no AI of its own**. The coding agent is the brain. The side panel shows its commands, asks you at stop-lines and new sites, and takes `/commands` from you (plain text is refused).
- Work trackers: `harness/remember-and-repeat.md` (site tips, repeat, saved recipes: faster on sites it has seen; tick slices there, not in the docs it points to), `harness/write.md` (draw and design on canvas sites), `harness/readable-log.md` (a side panel log in plain words) and `harness/background-mcp.md` (MCP keeps working with the side panel closed). Do the first unticked slice of the one the developer names; if they haven't said, ask.
- MCP design notes: `harness/mcp-context.md` (why replies say only what changed, batches).
- **History, don't build from it:** the removed AI loop (`harness/plan.md`, `harness/why-it-loops.md`, `harness/long-tasks.md`, `harness/token-cost.md`, `phase-2/`) and Phase 1's typed-command plan (`phase-A.md` … `phase-F.md`, `tasks.md`, `results.md`).
- Stack: WXT 0.21 + TypeScript 7, Chrome side panel (Chrome 153+: `chrome.publicSuffix` for Sites).
- **Side panel UI:** read `DESIGN.md` (Notion style) before writing any. Use its calm base (off-white, dark text, one blue); skip the sticker colors, since the panel has no decoration.
- **Brand:** Ichiro (renamed from Browser Agent on 2026-10-23). Logo files and rules: `art/logo/GUIDE.md`.

## Commands

- Build: `npm run build` → output in `.output/chrome-mv3/`
- Type check: `npm run typecheck`
- Tests: `npm test` (Node's built-in runner; files are `lib/*.test.ts`, plain `throw` on failure)
- Load in Chrome: `chrome://extensions` → Developer mode on → **Load unpacked** → pick `.output/chrome-mv3/`. After each build, hit the reload icon on the extension card.
- Native host, once per PC: `npm run host:install -- <extension-id>` in **your own terminal** (on Windows, not inside the Claude desktop app: it hides its registry writes, and the script refuses). Registers every Chromium browser (Chrome, Edge, Brave, Vivaldi, Opera, Arc…); files in `~/.ichiro`. Rules: `lib/host-install.ts`.
- MCP (any coding agent drives the browser): side panel `/mcp on` (a new site asks you: Add site / No), then register once: `claude mcp add --transport stdio --scope user ichiro -- node <repo>/host/mcp.ts`. Path: agent ⇄ `host/mcp.ts` ⇄ random pipe + token (`bridge.json` next to the launcher) ⇄ `host/host.ts` ⇄ panel. Rules: `lib/bridge.ts`.
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

Even in dev, an agent acts on the **real web** in your **real Chrome**, with your logins. So dev gets the same security as a product.

- **No "fine for dev" shortcuts.** Never skip validation, guards or the bridge's token check because it's only dev.
- **No open ends.** A security guard (stop-lines, Sites, secret fields, the bridge token, untrusted page text) is finished and tested in the task that adds it. No security TODOs, no `shortcut:` comments on security code.
- **Found a gap you can't close in this task?** Stop and tell the developer. Don't leave it for later silently.
