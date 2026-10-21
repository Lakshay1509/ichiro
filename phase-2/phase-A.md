# Phase 2 · A. Settings and API keys

Goal of Phase 2: put **one AI agent** on top of Phase 1. You type a task in the side panel ("find a 10-minute Python tutorial on YouTube and play it") and the agent completes it by itself, using the Phase 1 commands as its tools, with Claude or OpenAI. No planner and no security guard yet (Phases 3–4).

| Section | Steps | What |
|---|---|---|
| A | 1–3 | Settings, API keys, model choice |
| B | 4–6 | The LLM adapter (one function, both providers) |
| C | 7–8 | Tools: what the agent is allowed to do |
| D | 9–13 | The agent loop |
| E | 14–16 | The agent screen in the side panel |
| F | 17–18 | The real test: 15 tasks, both providers |

**Before you start:** Phase 1 done: at least 13/15 tasks pass by hand (see Phase 1 `results.md`).

**Rules**
- Do steps in order. Don't start the next step until its "Done when" passes.
- Test in a **separate Chrome profile**: no saved passwords or payment methods, no important accounts logged in. Until Phase 3 nothing stops the agent from clicking the wrong thing.
- API keys leave the browser only to go to the provider they belong to. Never log them, never put them in URLs, never show them in full after saving.
- Every AI request costs money. While building the loop, use the fake provider from step 4.

**Files**
```
lib/settings.ts        ← load/save settings (step 1)
lib/llm/clients.ts     ← SDK clients (step 2)
entrypoints/sidepanel/ ← settings screen
```

## 1. Settings screen + key storage

**What:** a screen where the user picks Claude or OpenAI and pastes their API key.

**How:**
- One settings object:
  ```ts
  type Settings = {
    provider: 'anthropic' | 'openai';
    keys: { anthropic?: string; openai?: string };
    model: string;
    effort: 'low' | 'medium' | 'high';
    maxSteps: number;    // default 25
    stepMode: boolean;   // default true during Phase 2 (approve each action)
  };
  ```
- Save with `chrome.storage.local`. **Not** `chrome.storage.sync`: that copies data to the user's Google account.
- A "Don't remember my key" checkbox stores the key in `chrome.storage.session` instead, which is wiped when the browser closes.
- The key field is `type="password"`. After saving, show only the end: `sk-ant-…a1b2`. Add a "Remove key" button.
- Light format check, a warning only: Anthropic keys start with `sk-ant-`, OpenAI keys with `sk-`.
- `lib/settings.ts` exports `getSettings()` and `saveSettings(partial)`. All other code reads settings through these two.
- Show one line in the UI: "Your key is stored only in this browser and sent only to Anthropic / OpenAI."

**Done when:**
- Save, close the panel, reopen: settings are still there.
- With "Don't remember my key", restart the browser: the key is gone, other settings stay.
- After saving, the full key never appears anywhere in the UI.
- `chrome.storage.sync.get()` in the side panel's DevTools console returns `{}`.

## 2. Test connection

**What:** a "Test" button that tells the user immediately whether their key works.

**How:**
- Install the official SDKs: `npm i @anthropic-ai/sdk openai`.
- `lib/llm/clients.ts`:
  ```ts
  new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  ```
  The SDKs warn about keys in browsers because a *website* would leak its key to every visitor. Here the key belongs to the user and stays on their own machine, so the flag is correct.
- "Test" calls the provider's model list (`client.models.list()` on both SDKs) and shows:
  - success → "Connected ✓"
  - 401 → "Key not valid"
  - 403 → "This key has no access"
  - OpenAI 429 with `code: 'insufficient_quota'` → "No credits on this OpenAI account"
  - network error → "Can't reach Anthropic / OpenAI — check your internet"
- Error messages never include the key.

**Done when:**
- A valid key shows "Connected ✓" for each provider.
- A wrong key shows "Key not valid".
- With Wi-Fi off, the network message appears.

## 3. Model and effort picker

**What:** choose which model runs the agent and how hard it thinks.

**How:**
- A short list of models per provider, filtered to the ones the step 2 call returned for this key:
  - Claude: `claude-opus-5-5` (default), `claude-sonnet-5-5`, `claude-haiku-5-5`.
  - OpenAI: check OpenAI's docs at build time for their current tool-capable models and list 2–3.
  - Adding a model later is a one-line change.
- Effort: `low` / `medium` / `high`, default `medium`. Claude receives it as `output_config.effort`, OpenAI as `reasoning.effort` (reasoning models only, see step 6). Step 18 measures low against medium.
- Max steps (default 25) and step mode (default on) also live on this screen.

**Done when:**
- The model list shows only models this key can use.
- Choices persist after closing and reopening the panel.
