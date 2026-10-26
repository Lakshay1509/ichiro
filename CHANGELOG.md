# Changelog

What changed in each Ichiro release, newest first. Each version is one git tag, one GitHub release and one zip, and the Chrome Web Store gets that same zip.

## Unreleased

### Changed
- The privacy policy now says that page content can include personal details, and that Ichiro counts the agent tab's open network requests and your tab switches on your computer only, never passing them on.

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
