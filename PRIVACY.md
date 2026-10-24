# Ichiro privacy policy

Effective 24 October 2026.

**In short:** Ichiro has no server and sends nothing to us. It passes what your coding agent asks for to that agent, on your own computer, and only after you agree in the welcome screen.

## What Ichiro is

Ichiro is a Chrome extension that lets a coding agent you run (such as Claude Code or Codex) read and act on web pages in your browser. It has no AI of its own and no account.

## What data Ichiro handles

When your agent sends a command, Ichiro reads and passes back:

- **Page content:** text, links, buttons and form fields of the page the agent works on, including frames inside it. Field values are included, except in fields Ichiro recognizes as password, card or one-time-code fields, which are masked. The agent is never allowed to type into those fields.
- **Page addresses and titles** of the tabs the agent uses.
- **Screenshots**, only when the agent asks for one. Ichiro refuses one while a recognized password or card field is visible.
- **Files you allow:** during an agent's turn, Ichiro pauses each new download and asks you first. The agent can read the text of a PDF or text file only after you allow that download, and only if you turned on Chrome's "Allow access to file URLs" switch for Ichiro.
- **What the agent types or clicks:** the text it enters into page fields, and the results of its actions.

Ichiro reads pages only when your agent asks, and only on sites you allowed. A new site asks you first.

## Where the data goes

1. From the extension to a small helper program on your computer, through Chrome's native messaging.
2. From that helper, over a private local connection protected by a random token, to the MCP server your coding agent runs on your computer.
3. To your coding agent. **Your agent may send this data to its AI provider** (for example Anthropic or OpenAI) under that provider's own privacy policy. Ichiro does not control that step.

Ichiro has no server and no analytics. It doesn't sell data, show ads, or share data with anyone other than the coding agent you connect.

## What Ichiro stores, and where

Everything stays on your computer:

- **In Chrome's extension storage:**
  - your settings: whether the bridge is on, always-on, the overlay, and whether you finished the welcome
  - the list of sites you allowed
  - short site tips the agent saves for a site
  
  Tips that aren't used for 180 days are removed.
- **In memory only**, cleared when Chrome stops the extension's background: the log in the side panel and the recent steps used by `repeat`.
- **In the `.ichiro` folder in your home folder:**
  - the helper's launcher and its Chrome registration
  - a `bridge.json` file with the local connection's name and random token, deleted when the helper stops

## Your choices

- Type `/mcp off` in the side panel to stop the connection to your agent.
- Type `/sites` to see your allowed sites, and `/sites remove <site>` to remove one.
- Type `/tips` to see a site's saved tips and delete them.
- Remove the extension from `chrome://extensions` to delete its stored data. Run `npm run host:uninstall` in the Ichiro folder to remove the helper program.

## Chrome Web Store Limited Use

Ichiro's use of information received from Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use). Ichiro uses this data only to carry out the commands of the coding agent you connect. It transfers the data only to that agent, as described above.

## Changes

If this policy changes, the new version will be posted in this file with a new effective date. Ichiro will show any change in what data it shares before that change takes effect.

## Contact

Questions or concerns: open an issue at [github.com/Lakshay1509/ichiro/issues](https://github.com/Lakshay1509/ichiro/issues).
