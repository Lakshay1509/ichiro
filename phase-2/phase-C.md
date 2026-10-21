# Phase 2 · C. Tools (what the agent can do)

Goal: describe the Phase 1 commands as tools the AI can call, and run its calls through **exactly the same code** the console uses. No second implementation of click, type, and so on.

**Before you start:** Section B done (`decide()` works for both providers).

**Rules**
- Do steps in order. Don't start the next step until its "Done when" passes.
- Tool calls from the AI are untrusted input. Validate every one before running it.

**Files**
```
lib/agent/tools.ts     ← tool definitions (step 7)
lib/agent/runTool.ts   ← runs a tool call (step 8)
```

## 7. Tool definitions

**What:** one tool per action, each with a clear description and a strict schema.

**How:**
- One JSON schema per tool, shared by both providers. The adapter wraps it in each provider's format.
- Two rules so the same schema works in **both** Claude's and OpenAI's strict mode:
  - every object has `additionalProperties: false`
  - every property is in `required`, with no optional fields. Where there's an option, make it a separate tool or a required boolean.
- Don't rely on `minimum` / `maximum` / `maxLength` in schemas. Check limits in step 8 instead.
- **Every tool has a required `note`** (string): one short sentence on what the agent learned from the last step and why it's doing this. It becomes the progress text in the UI and the memory in the history (step 10). Putting it inside the tool call makes it work the same on both providers.
- The tools:

  | Tool | Args (besides `note`) | Runs (Phase 1) |
  |---|---|---|
  | `click` | `index: integer` | `click <n>` |
  | `type` | `index: integer`, `text: string`, `press_enter: boolean` | `type <n> "text"` (+ `enter`) |
  | `select` | `index: integer`, `option: string` | `select <n> "option"` |
  | `hover` | `index: integer` | `hover <n>` |
  | `scroll_page` | `direction: "up" \| "down"` | `scroll up/down` |
  | `scroll_element` | `index: integer`, `direction: "up" \| "down"` | `scroll up/down <n>` |
  | `key` | `key: enum` (Enter, Escape, Tab, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Backspace) | `key <Key>` |
  | `goto` | `url: string` | `goto <url>` |
  | `back` | – | `back` |
  | `wait` | `seconds: integer` | wait, then settle |
  | `ask_user` | `question: string` | pause and ask the user |
  | `done` | `success: boolean`, `answer: string` | end the task |

- Descriptions: short, and say **when** to use the tool. Examples:
  - `click`: "Click an element by its number from the current page list."
  - `goto`: "Open a URL. Use only when you know the exact address; prefer clicking links."
  - `wait`: "Wait when the page is still loading or about to change."
  - `ask_user`: "Ask the user a question and wait for the answer. Use when the task is unclear, or before anything that spends money, sends, posts, deletes or submits personal data."
  - `done`: "Finish the task. `answer` = what the user needs to know: the result, or why it couldn't be done."
- Build the array once at module load, in a fixed order, and never change it during a task (caching depends on it).
- `type` always uses fast typing.
  `shortcut: no slow-typing option for the agent, add a slow flag if step 17 shows autocomplete fields failing`.
- Dev console: `tools` prints each tool's name and description.

**Done when:**
- `tools` lists 12 tools.
- One `llm` call per provider with the **real** tool list gets no 400 error. That proves both strict modes accept every schema.

## 8. Tool runner

**What:** take the AI's tool call, check it, run the matching Phase 1 command, and return a short text result.

**How:**
- `runTool(tabId, tool, args) → { ok: boolean; text: string; ended?: 'done' | 'ask_user' }`
- **Validate first:**
  - tool name is one of the 12 → else `error: Unknown tool "x"`
  - `index` is an integer present in the latest `read` → else `error: Element [n] not found — use a number from the current list`
  - `text` at most 2000 characters, `seconds` 1–10, `answer` / `question` / `note` non-empty
  - `url` is `http:` or `https:` only
- Then call **the same functions the console commands call**. If something works in the console, it works for the agent.
- **Phase 2 safety minimum** (the full guard comes in Phase 3):
  - Refuse `type` into password and card fields (the reader already flags them): `Blocked: sensitive field. Use ask_user so the user fills it in.`
  - A `click` on a link that would open a new tab opens its URL in the **current** tab instead (http/https only).
    `shortcut: single tab only, Phase 5 adds multi-tab`.
- Result text is short and factual:
  - `ok`
  - `ok — page changed to youtube.com/watch?v=…`
  - `error: Element [7] is covered by dialog "Before you continue"`
  
  The new page itself is **not** in the result. The next step's `read` has it.
- `done` and `ask_user` don't touch the page; they return `ended` so the loop knows what to do.
- Never throws. Any exception becomes `{ ok: false, text: 'error: <message>' }`.
- Dev console: `tool <name> <json>` runs a tool call exactly as the agent would. Everything after the name is raw JSON, not split on quotes. Example: `tool click {"index":4,"note":"test"}`.

**Done when:**
- Valid calls behave exactly like the matching console commands.
- Each invalid call returns a clear error and changes nothing on the page: a bad index, an unknown tool, `goto javascript:alert(1)`, typing into a password field.
- A link with `target="_blank"` opens in the same tab.
