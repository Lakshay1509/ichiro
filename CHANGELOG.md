# Changelog

What changed in each Ichiro release, newest first. Each version is one git tag, one GitHub release and one zip, and the Chrome Web Store gets that same zip.

## Unreleased

### Added
- `select text "start" to "end"` selects a stretch of text by its first and last words, in a text box, an editable area or a code editor (Overleaf, Monaco), so your agent can replace part of a document with `paste` or `type here` without a screenshot. It replies with what it selected. When the words show up more than once, it lists them and asks for `n` instead of guessing. In a code editor it uses two real clicks: never on a link, button or label, and it asks you first where a click would (a checkout page, for example).
- Shorter page lists on dashboard apps (Supabase, Vercel, AWS): once your agent got a site's nav, sidebar or header in full, a later page list on that site says it in one line while it reads the same, like `Sidebar "Project menu": 14 elements ([6]–[19]), the same as you got before on this site — read all lists them`. Their numbers and labels still work, and `read all` lists everything. Your own `/read` in the side panel always lists everything.

### Fixed
- `click "text"` now finds words the page draws in several pieces, like a code editor's `limit 5` (one piece per word) or a menu's `Last 7 days`. Before, it said "Nothing called …" though the words were on screen.
- `read` gives each option of a custom dropdown its own number (time pickers, filters, menus built from plain boxes). Before, the whole menu was one element, so picking an option took a screenshot and a pixel click. Clicking an option still asks you first when the box around it says a risky word, like "Delete" or "Subscribe".
- `text all` reads all of a box that keeps only the lines near the screen, like a code editor (Overleaf), a chat or a long feed. It scrolls the box a screen at a time, joins what it read, puts the scroll back, and says so in the reply. Before, it got only the lines on screen. Also, a page that loads as you scroll is now read in order when you were scrolled down.

## 0.3.0 · 2026-11-02

### Changed
- The privacy policy now says that page content can include personal details, and that Ichiro counts the agent tab's open network requests and your tab switches on your computer only, never passing them on.
- When the side panel can't reach the browser helper (for example, you pressed "I've connected" before your agent finished), it now shows the connect prompt with a Copy button to paste into your coding agent, in place of a terminal command. It shows once, not again on every panel reopen.
- The connect prompt reuses a copy of Ichiro you already have (moving it to your extension's release tag) before it clones a new one.
- An ask (Add site, Allow once, Resume…) now shows in the side panel first. Your coding agent shows it as a dialog only if it's still unanswered after 10 seconds, so a quick answer in the panel leaves no dialog behind. An answer in either place lets the agent go on, and a dialog answer shows in the panel. The dialog's text is shorter. This changes `host/`: run `/update` so your local copy gets it, then restart your coding agent.

### Added
- The side panel tells you when an update is available, with a prompt to copy into your coding agent. It shows when Chrome has updated Ichiro but the helper on your computer is older, and, for copies loaded unpacked only, when GitHub has a newer release (checked at most once a day). The helper now says its version when it starts: this changes `host/`, and after this release the panel itself asks you to update it.
- A small "Star on GitHub" link above the command box while the side panel's log is empty. It goes away once the agent logs a step.

## 0.2.1 · 2026-10-26

### Changed
- The extension is now called "Ichiro: Open Source Browser MCP for Coding Agents" in Chrome and the Web Store, with the summary "Open source browser MCP for Claude Code, Codex and any coding agent. It works in your own Chrome and asks before risky steps." The welcome uses the same line as the README.
- `/update` and the welcome's connect prompt put your local copy (the MCP server and the browser helper) on the release tag of the extension you have, not the newest code on `main`, so the two always match. `/update` now stops before moving any changes or commits of your own, and no longer fails on a copy cloned at a tag.
- `/update` no longer rebuilds an unpacked Ichiro. To update one, unzip the new release's zip over the folder you loaded, reload it, then run `/update`.

## 0.2.0 · 2026-10-26

### Added
- `/update` in the side panel: a prompt to paste into your coding agent after Ichiro updates. It brings your local copy (the MCP server and the browser helper) up to date, and rebuilds it if you loaded Ichiro unpacked.

### Fixed
- `goto` opens `http://` pages on localhost, 127.0.0.1 and [::1], so the agent can check your own dev server. The MCP server's tool description says so: update your local copy to get it.

### Changed
- README: a 3-step Install section at the top, Codex setup, and an FAQ.

## 0.1.0 · 2026-10-24

First public release. See its [release notes](https://github.com/Lakshay1509/ichiro/releases/tag/v0.1.0).
