# Chrome Web Store form: paste-ready draft

Text for each tab of the developer dashboard (chrome.google.com/webstore/devconsole). Fill it by hand: Chrome lets no extension, Ichiro included, run on Web Store pages.

Package: `.output/ichiro-0.1.0-chrome.zip` (built 2026-10-26 from c4e1bd2).

## Package tab

Upload the zip above. Nothing else to fill.

## Store listing tab

**Description** (plain text, paste as is):

```
Ichiro lets a coding agent you run on your own computer, such as Claude Code or Codex, read web pages and act on them in your Chrome.

It has no AI of its own and needs no API key or account. Your agent decides what to do. Ichiro carries out each command, shows it in the side panel, and asks you before anything risky.

What it does
• Reads a page as a numbered list of things to click or type into, and reports only what changed after each action.
• Clicks, types, scrolls, drags and presses keys, including on canvas apps like drawing tools and slide editors.
• Lists every item built like one example (all the prices on a results page) and repeats a finished task on up to 30 more items after you approve the list once.
• Reads PDFs, open in a tab or downloaded with your OK.
• Works in its own tab group, so you can keep using your other tabs.

You stay in control
• Sites: the agent works only on sites you allow. A new site asks you first.
• Stop-lines: paying, booking, sending, checking out or entering personal data pause and ask you.
• Sign-in, password and card fields, and CAPTCHAs are always left to you.
• Each download waits for your yes.
• Page text reaches the agent marked as untrusted.

Privacy
Ichiro has no server and no analytics. Page data goes only to the coding agent on your computer, through a local helper protected by a random token. Your agent may send it to its AI provider under that provider's own policy.

Setup
Ichiro needs a small local helper and MCP server from its open-source repository: https://github.com/Lakshay1509/ichiro. You need Node.js 22.18 or newer and a coding agent that supports MCP. The README walks you through it.

Permissions
Chrome warns about some permissions at install. "Debugger" sends real mouse and keyboard input; Chrome shows its "debugging this browser" bar while a command runs. "Manage your downloads" lets Ichiro hold each download until you allow it. Access to all sites lets the agent read the pages you allow.
```

- **Category:** Developer Tools
- **Language:** English
- **Store icon (128×128):** `art/logo/icons/icon-128.png`
- **Screenshots (1280×800, at least 1):** none yet. You need to take one, e.g. a page with the Ichiro side panel open and a few command lines in it.
- **Promo tiles, video:** optional, skip for now.
- **Homepage URL:** `https://github.com/Lakshay1509/ichiro`
- **Support URL:** `https://github.com/Lakshay1509/ichiro/issues`
- **Mature content:** off

## Privacy practices tab

**Single purpose:**

```
Ichiro lets a coding agent the user runs on their own computer read and act on web pages in Chrome, through a local MCP bridge, with the user approving risky steps in the side panel.
```

**Permission justifications** (one box each):

- **sidePanel:** `The side panel is Ichiro's only interface. It shows each command the agent runs, asks the user at stop-lines and new sites, and takes the user's commands (turn the bridge on or off, manage allowed sites and saved tips).`
- **tabs:** `To send each agent command to the right tab, open the agent's tab, and read that tab's address and title, so the agent knows where it is and Ichiro can check the site against the user's allowed sites.`
- **scripting:** `To inject Ichiro's own packaged content script into tabs that were already open before the extension loaded, so the agent can read and act on them. Only the bundled file is injected.`
- **storage:** `Stores, on the user's computer only: settings (bridge on or off, always-on, overlay, welcome finished), the list of sites the user allowed, and short tips saved for a site. Session storage keeps frame details for the current session.`
- **webNavigation:** `Lists a tab's frames (iframes), so the agent can read embedded content and Ichiro can check each frame's site before acting inside it.`
- **webRequest:** `Observes, without blocking or changing anything, which requests a page still has open, so Ichiro waits until the page has finished loading before reporting what changed.`
- **nativeMessaging:** `Connects to Ichiro's local helper program, which the user installs, to receive commands from the user's coding agent and return the results. It is the extension's only channel to the agent.`
- **publicSuffix:** `Turns a page address into its site (in.bookmyshow.com becomes bookmyshow.com), so the user's allowed-sites list works per site.`
- **downloads:** `While the agent works, holds each new download until the user allows it, and tells the agent which file an allowed download saved, so it can read an allowed PDF or text file.`
- **debugger:** `Sends real mouse and keyboard input (the Input domain of the DevTools Protocol) to the agent's tab, only while a command runs, so clicks, drags and shortcuts work on pages and canvas apps that ignore synthetic events. Chrome shows its "debugging this browser" bar while attached.`
- **offscreen:** `Runs the bundled pdf.js in a hidden offscreen document to extract text from PDFs the agent reads (open in a tab, or a download the user allowed).`
- **tabGroups:** `Puts the agent's tabs in a tab group named "Ichiro", so the user can see which tabs the agent is using.`
- **declarativeNetRequestWithHostAccess:** `While the agent opens a page, a session rule stops that tab from being redirected to a site the user has not allowed. The rule is removed when the load ends.`
- **Host permission (<all_urls>):** `The agent must be able to read and act on whichever sites the user chooses, which are only known at run time. Ichiro still acts only on sites the user allowed and asks before each new one.`

**Remote code:** No, I am not using remote code. (Every script, including pdf.js and its worker, ships in the package.)

**Data usage, what is collected** (check these against the live tab; the docs show the list only as an image):

- [x] Website content: page text, links, form fields, screenshots the agent asks for
- [x] Web history: addresses and titles of the tabs the agent uses
- [ ] The rest. Page content can include personal details or messages; tick **Personally identifiable information** and **Personal communications** too if a reviewer asks.

**Certifications:** tick all three (no selling or transfer, no unrelated use, no creditworthiness use).

**Privacy policy URL:** `https://github.com/Lakshay1509/ichiro/blob/main/PRIVACY.md`

## Distribution tab

Visibility and regions are your call. Free, no payments.

## Test instructions tab

No username or password. **Additional instructions:**

```
Ichiro has no account. It is driven by a coding agent over MCP, so testing needs Node.js 22.18+ and an MCP agent such as Claude Code.

1. Install Ichiro and copy its extension ID from chrome://extensions.
2. git clone https://github.com/Lakshay1509/ichiro, then run npm install inside it.
3. In a terminal: npm run host:install -- <extension-id>
4. Register the MCP server: claude mcp add --transport stdio --scope user ichiro -- node <path-to-clone>/host/mcp.ts
5. Open the Ichiro side panel and finish the welcome (agree, then "I've connected").
6. Ask the agent: "Use the browser tool to open https://en.wikipedia.org/ and read the page." The panel asks to add the site: click Add site. Each command then shows in the panel.

Without an agent, the side panel still opens and shows the welcome and /help.
```
