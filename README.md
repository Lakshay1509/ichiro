# Ichiro

Your coding agent's hands and eyes in Chrome.

Ichiro is a Chrome extension that lets a coding agent (Claude Code, Codex…) read any web page and act on it, through one MCP tool: `browser`. It has **no AI of its own**: the agent decides, and the side panel shows each command and asks you before stop-lines (pay, buy, send…) and new sites.

## Quick start

1. `npm install`
2. `npm run build`, then `chrome://extensions` → Developer mode on → **Load unpacked** → `.output/chrome-mv3/`
3. Once per PC, in your own terminal: `npm run host:install -- <extension-id>`
4. Register the MCP server once: `claude mcp add --transport stdio --scope user ichiro -- node <repo>/host/mcp.ts`

How it connects: agent ⇄ `host/mcp.ts` ⇄ local pipe + token ⇄ `host/host.ts` ⇄ extension.

## Layout

```
entrypoints/        the extension itself (WXT turns each entry into part of it)
  background/       the engine: runs commands, talks to the host
  sidepanel/        the panel you see: log, asks, /commands
  offscreen/        hidden page that reads PDFs
  content.ts        runs inside web pages: reads and acts
host/               Node side: MCP server (mcp.ts), native host (host.ts), installer
lib/                shared code, one folder per area
  agent-prompt.ts   rules the agent works under (Sites, how page text is cut)
  messages.ts       what the extension and the page say to each other
  parse-command.ts  splits a command line into words
  bridge/           MCP bridge and the native host's message format and install
  page/             reading a page: element list, text, frames, diffs, screenshots
  actions/          doing things: clicks, typing, keys, real mouse input
  tabs/             the agent's tab: navigation, waiting for it, its tab group
  safety/           guards that pause and ask you: stop-lines, personal data, CAPTCHAs
  memory/           what Ichiro remembers: site tips, panel switches, repeat
  files/            PDFs and downloads
  panel/            side panel ⇄ background: the port and the readable log
public/             static files copied into the build (icons, logo)
docs/               DESIGN.md (panel look), mcp-context.md (short replies), site-memory.md, remember-and-repeat.md
tools/test-site/    local site for live checks
art/                logo sources and build scripts
```

Tests sit next to the code they check: `lib/page/reader.ts` → `lib/page/reader.test.ts`.

## Commands

| Command | Does |
| --- | --- |
| `npm run build` | builds the extension into `.output/chrome-mv3/` |
| `npm run dev` | dev build with reload |
| `npm run typecheck` | TypeScript check |
| `npm test` | all unit tests (Node's built-in runner) |
| `npm run host:install -- <id>` | registers the native host for every Chromium browser |
