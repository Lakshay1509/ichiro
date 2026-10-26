<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="art/logo/svg/ichiro-horizontal-white.svg">
    <img src="art/logo/svg/ichiro-horizontal.svg" alt="Ichiro logo" width="300">
  </picture>
</p>

<h1 align="center">Open source browser MCP for Claude Code, Codex and any coding agent</h1>

## Install

You need Chrome 153+ and Node.js 22.18+ (see [Requirements](#requirements)).

1. **Install and build.** Clone this repository, then run:

   ```bash
   npm install
   npm run build
   ```

2. **Load it into Chrome.** Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `.output/chrome-mv3/`.

3. **Open the extension and follow its steps.** Click the Ichiro icon to open the side panel. The welcome walks you through connecting your coding agent.

## What it does

Ichiro is a free, open source Chrome extension and MCP server. It lets a coding agent such as Claude Code or Codex read web pages and act on them in your own browser, logged in as you. The agent gets one MCP tool, `browser`, and any agent that runs stdio MCP servers can use it.

The extension has no AI and needs no API key or account. Your agent decides what to do. Ichiro carries out each command, shows it in the side panel, and asks you before anything risky: paying, sending, signing in, or opening a site you haven't allowed.

## An open source alternative to Claude in Chrome

Claude in Chrome and the Codex Chrome extension are the official ways to give those agents a browser. Claude in Chrome needs a paid Claude plan, and each extension is built for its own maker's agents. Ichiro is free under the MIT license and works with any MCP agent, so you can change agents and keep the same browser setup.

Playwright MCP and Chrome DevTools MCP are open source too, and they suit testing and debugging your own app. Ichiro is built for everyday tasks on real sites. It runs in the Chrome you already use and asks you before the agent opens a new site, pays or sends a message. Sign-ins stay with you.

## Features

- The agent reads a page as a numbered list of things it can click or type into, then acts on those numbers.
- After each action the reply lists only what changed on the page, which keeps the agent's context small. Several commands can go in one call.
- Clicks and drags go through Chrome's DevTools Protocol, so pages see real mouse events. Pixel-based clicks and drags work on canvas apps like drawing tools and slide editors.
- `pick` lists every item built like one example, such as all the prices on a results page. `repeat` runs a finished item's steps on up to 30 more items after you approve the list once.
- PDFs are readable too, whether open in a tab or downloaded with your OK.
- Commands go to the agent's own tab, grouped under "Ichiro", so you can keep using another tab.
- Tips about a site ("the filters are under More") are saved by the agent and handed back on its next visit. You can delete any tip from the side panel.
- Always-on mode keeps the bridge running with the side panel closed and turns it back on when Chrome starts.

## How it works

```
coding agent ⇄ host/mcp.ts ⇄ local pipe + token ⇄ host/host.ts ⇄ extension ⇄ the page
   (stdio)       MCP server                         native host    background    content script
                                                                  + side panel
```

The agent starts `host/mcp.ts` as a stdio MCP server. Chrome starts `host/host.ts` through native messaging when the bridge is on. The two talk over a pipe with a random name, and every request must carry a token kept in a private file in your home folder. The extension runs each command in the agent's tab and sends back the result.

## Safety

The agent drives your real browser, with your logins, so Ichiro puts you in the loop:

- **Sites.** The agent works freely only on sites you have allowed. A new site asks you first, deep links to a new site are refused, and a page can't redirect the agent's goto to one. It can read another site's embedded frame on a page you allowed, but clicking, typing or selecting inside it asks you to add that site first.
- **Local dev servers.** The agent's goto needs `https://`, except on `localhost`, `127.0.0.1` and `[::1]`, where plain `http://` works too. Each port there is its own site (`localhost:3000`), so it asks you once per port.
- **Stop-lines.** Actions that pay, book, send, check out or enter personal data pause and ask you.
- **Hand-over.** Sign-in, password and card fields, and CAPTCHAs are always left to you. Do the step yourself and press Resume.
- **Downloads.** Each download waits for your yes.
- **Untrusted page text.** Everything read from a page reaches the agent marked as untrusted, and the tool tells the agent never to follow instructions found there.
- **Privacy.** Ichiro has no server. Page data goes only to the coding agent on your computer. See [PRIVACY.md](PRIVACY.md).

`/auto on` lets stop-lines, new sites, downloads and repeats go ahead without asking. It is off by default and isn't remembered. CAPTCHAs, password and card fields, and `pause` still wait for you.

Chrome warns about some permissions at install. `debugger` sends real mouse input, and Chrome shows its "debugging this browser" bar while a command runs. `downloads` lets Ichiro pause downloads until you allow them, and `tabGroups` makes the agent's tab group. Access to all sites is needed so the agent can read any page you allow.

## Requirements

- Chrome 153 or newer. The installer also registers other Chromium browsers: Chromium, Edge, Brave and Vivaldi everywhere, plus Opera, Arc, Island and Prisma Access Browser on Windows.
- Node.js 22.18 or newer (the MCP server and native host are TypeScript files that Node runs directly).
- A coding agent that supports MCP over stdio.

## Connect by hand

The welcome gives you a prompt that has your agent do this. To do it yourself instead:

1. Copy the extension ID from its card on `chrome://extensions`.

2. Register the native host. Run this once per computer, in your own terminal:

   ```bash
   npm run host:install -- <extension-id>
   ```

   On Windows, don't run it from inside a packaged app such as the Claude desktop app. Those apps hide registry writes from the browser, and the script refuses to run there.

3. Add the MCP server to your agent. For Claude Code:

   ```bash
   claude mcp add --transport stdio --scope user ichiro -- node /path/to/ichiro/host/mcp.ts
   ```

   For Codex:

   ```bash
   codex mcp add ichiro -- node /path/to/ichiro/host/mcp.ts
   ```

   Other agents, such as Cursor, VS Code or Gemini CLI: add a stdio server that runs `node /path/to/ichiro/host/mcp.ts`.

4. In the side panel, agree to what your agent will see, then press **I've connected**. Then ask your agent to do something in the browser.

## Usage

Your agent sends lists of commands to the `browser` tool:

```json
{ "commands": ["click 4", "type here \"hello\"", "key Enter"] }
```

It usually starts with `help` and `read`. Each reply begins with a step number, which `repeat` uses.

| Command | What it does |
| --- | --- |
| `read` | List what you can click or type into, numbered |
| `look` | `read` plus a screenshot with the numbers drawn on |
| `text` | The plain text on screen; `text all` for the whole page, `text page N` for a PDF |
| `find "text"` | Search the page's visible text and scroll to a match |
| `pick like <n>` | List everything built like element n |
| `click <n>` | Click an element, a label, or an `x,y` spot on the last screenshot |
| `hover <n>` | Move the mouse over an element |
| `type <n> "text"` | Type into a field; `type here` types where the cursor is |
| `select <n> "option"` | Choose an option in a dropdown |
| `scroll <direction>` | Scroll the page, or the box around an element |
| `drag x,y x,y …` | Press, move and release the mouse, for drawing apps |
| `paste <text>` | Paste text where focus is, without touching your clipboard |
| `key <Key>` | Press a key or shortcut, such as `ctrl+z` |
| `goto <url>` | Open a URL in the agent's tab |
| `back` | Go back one page |
| `repeat <step> on <numbers>` | Redo a finished item's steps on other items |
| `pause "reason"` | Hand the page to you |
| `tip "sentence"` | Save a note about this site for later runs |

You control Ichiro from the side panel with slash commands:

- `/mcp on` and `/mcp off` turn the bridge on or off. `/mcp on` also adds the current site to your allowed sites.
- `/sites` lists allowed sites, and `/tips` lists saved tips. Both have Delete buttons.
- `/always-on on|off` keeps the bridge running with the panel closed.
- `/update` gives you a prompt to paste into your coding agent after Ichiro updates. It brings your local copy up to date.
- `/auto on|off` skips the asks described under [Safety](#safety).
- `/overlay on|off` draws element numbers on every page the agent reads.
- `/stop` stops the agent's running command, and `/help` lists everything.

## Troubleshooting

**"The browser bridge is off."** Open the side panel and type `/mcp on`.

**The agent drives the wrong browser.** With Ichiro in more than one browser, the agent drives the one that ran `/mcp on` last.

**The bridge stopped working after you moved the folder.** An unpacked extension's ID comes from its folder path, so loading it from a new place gives it a new ID. Run `npm run host:install -- <new-id>` again.

## FAQ

### Is there an open source alternative to Claude in Chrome?

Yes. Ichiro is MIT-licensed and works with Claude Code, Codex and other MCP agents, so it isn't tied to one assistant or plan.

### How do I let Claude Code control my browser?

Follow [Install](#install). The welcome gives you a prompt that has Claude Code connect itself, or you can add the server yourself with `claude mcp add` (see [Connect by hand](#connect-by-hand)). Then ask Claude Code to do something on a web page. It calls the `browser` tool on its own.

### Does it work with Codex, Cursor or Gemini CLI?

Codex works with `codex mcp add`. Any other agent that runs stdio MCP servers should work with the same `node host/mcp.ts` command.

### Is Ichiro a Playwright MCP alternative?

For tasks in your own browser with your logins, yes. For end-to-end tests of your app in a clean browser, Playwright MCP is the better fit.

### Does it work in Edge, Brave or other Chromium browsers?

Yes, the installer registers them (see [Requirements](#requirements)). Most testing so far has been with Chrome and Edge on Windows.

### Where does my page data go?

Only to the coding agent on your computer. Ichiro has no server and no analytics. Your agent may send what it reads to its AI provider, under that provider's policy.

## Development

```bash
npm run dev         # development build with reload
npm run build       # production build in .output/chrome-mv3/
npm run typecheck   # TypeScript check
npm test            # unit tests (Node's built-in test runner)
npm run host:uninstall
```

```
entrypoints/        the extension (WXT builds each entry)
  background/       runs commands and talks to the native host
  sidepanel/        the panel: log, asks, slash commands
  offscreen/        hidden page that reads PDFs
  content.ts        runs inside web pages
host/               MCP server, native host and installer (Node)
lib/                shared code, one folder per area
  bridge/           MCP bridge, message format, install paths
  page/             element list, page text, frames, diffs, screenshots
  actions/          clicks, typing, keys, real mouse input
  tabs/             navigation, waiting for pages, the agent's tab group
  safety/           stop-lines, personal data, CAPTCHAs
  memory/           site tips, panel settings, repeat
  files/            PDFs and downloads
  panel/            side panel port and readable log
docs/               design notes
tools/test-site/    local site for live checks
art/                logo sources
```

Each test sits next to the file it checks, such as `lib/page/reader.test.ts`. Ichiro is built with [WXT](https://wxt.dev), TypeScript and Preact. The panel's look follows [docs/DESIGN.md](docs/DESIGN.md).

Most testing so far has been on Windows with Chrome and Edge. Keyboard shortcuts on macOS haven't been checked on a real Mac yet.

## Contributing

Issues and pull requests are welcome. Before you open a pull request, run `npm run typecheck` and `npm test`. Security guards (stop-lines, Sites, secret fields, the bridge token, untrusted page text) need tests in the same change that touches them.

## License

Ichiro is released under the [MIT License](LICENSE).
