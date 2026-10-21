# Phase 1 · B. Talking to the page

Goal: the side panel can send a command to the open tab and get an answer back, and you have a console to type commands into. Every later step is tested through this console.

**Before you start:** Phase A done (extension loads, side panel opens).

**Rules**
- Do steps in order. Don't start the next step until its "Done when" passes.
- No AI/LLM calls anywhere in Phase 1.

**Files (suggested layout, WXT)**
```
entrypoints/
  sidepanel/index.html, main.ts   ← console UI + command handlers
  content.ts                      ← runs inside every web page
lib/
  messages.ts                     ← shared message types
```

## 4. Side panel ↔ page messaging

**What:** the panel asks the current tab "are you there?" and the page answers with its URL and title.

**How:**
- `entrypoints/content.ts`: `defineContentScript({ matches: ['<all_urls>'], main() { ... } })`. Inside, listen with `chrome.runtime.onMessage.addListener`. On `{ type: 'ping' }` reply `{ url: location.href, title: document.title }`.
- `lib/messages.ts`: one TypeScript union type for all messages (`ping` now; `read`, `click`, … added in later steps). Both sides import it.
- Side panel: get the tab with `chrome.tabs.query({ active: true, currentWindow: true })`, then `chrome.tabs.sendMessage(tab.id, { type: 'ping' })`.
- Handle two failure cases:
  1. **Restricted pages.** Extensions can't run on `chrome://`, `edge://`, `about:`, `view-source:`, other extensions' pages, the Chrome Web Store, or the built-in PDF viewer. Check the tab URL first and show "Can't run on this page".
  2. **Tabs opened before the extension was installed/reloaded** have no content script yet. If `sendMessage` fails with "Receiving end does not exist", inject it with `chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/content.js'] })` and retry once.
- Put this in one helper, `sendToTab(msg)`: restricted check → send → inject + retry on failure. Every later command uses it.

**Done when:**
- `ping` returns URL + title on 3 different sites.
- On `chrome://extensions` it shows "Can't run on this page" (no crash, no silent failure).
- A tab that was open before you reloaded the extension still answers (auto-inject works).

## 5. Debug console in the panel

**What:** a small terminal inside the side panel. Type a command, it runs, output appears. Later the AI agent will call these same commands.

**How:**
- Plain HTML + TypeScript. No UI framework needed for this dev tool.
- Layout: scrollable output area (monospace, keeps history) and one input line at the bottom. Enter runs the command.
- Parsing: first word = command, rest = arguments. Text in double quotes stays one argument: `type 3 "new york"` → `['type', '3', 'new york']`.
- Commands live in one object: `{ ping, echo, help, clear }`. Adding a command later = adding one entry.
- Built-in commands:
  - `help` — list commands, one line each.
  - `clear` — empty the output.
  - `echo` — print each argument on its own line (checks the parser).
- Unknown command → `Unknown command "x". Type help.`
- Errors (restricted page, no answer) print in red. Never swallow them.

**Done when:**
- `ping` prints URL and title.
- `help` lists all commands.
- `echo "a b" c` prints two lines: `a b` and `c`.
- `foo` prints the unknown-command message.
