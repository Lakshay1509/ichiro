# Changelog

What changed in each Ichiro release, newest first. Each version is one git tag, one GitHub release and one zip, and the Chrome Web Store gets that same zip.

## Unreleased

## 0.2.0 · 2026-10-26

### Added
- `/update` in the side panel: a prompt to paste into your coding agent after Ichiro updates. It brings your local copy (the MCP server and the browser helper) up to date, and rebuilds it if you loaded Ichiro unpacked.

### Fixed
- `goto` opens `http://` pages on localhost, 127.0.0.1 and [::1], so the agent can check your own dev server. The MCP server's tool description says so: update your local copy to get it.

### Changed
- README: a 3-step Install section at the top, Codex setup, and an FAQ.

## 0.1.0 · 2026-10-24

First public release. See its [release notes](https://github.com/Lakshay1509/ichiro/releases/tag/v0.1.0).
