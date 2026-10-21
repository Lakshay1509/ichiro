# Phase 2 · B. The LLM adapter

Goal: one function, `decide()`, that sends a step to Claude or OpenAI and returns the same shape either way. Nothing outside `lib/llm/` knows which provider is in use.

**Before you start:** Section A done (settings, keys, SDK clients).

**Rules**
- Do steps in order. Don't start the next step until its "Done when" passes.
- `decide()` never throws. Every failure comes back as a value.
- Use the official SDKs and their error classes. Don't hand-roll HTTP calls or match on error message text.

**Files**
```
lib/llm/types.ts       ← shared shapes (step 4)
lib/llm/fake.ts        ← scripted fake provider (step 4)
lib/llm/anthropic.ts   ← step 5
lib/llm/openai.ts      ← step 6
lib/llm/index.ts       ← decide(): picks the provider from settings
```

## 4. The shared shapes

**What:** define exactly what goes into the AI and what comes out.

**How:**
```ts
type ToolDef = { name: string; description: string; input_schema: object };

type DecideRequest = {
  system: string;       // same text for the whole task
  message: string;      // this step's message (built in step 10)
  tools: ToolDef[];     // same list for the whole task
  signal: AbortSignal;  // the Stop button cancels the request
};

type Decision =
  | { kind: 'action'; tool: string; args: Record<string, unknown> }
  | { kind: 'no_action'; text: string }     // answered without calling a tool
  | { kind: 'refused'; reason: string }     // provider's safety system declined
  | { kind: 'stopped' }                     // user pressed Stop
  | { kind: 'error'; error: LlmError };

type LlmError = {
  type: 'auth' | 'no_credits' | 'rate_limit' | 'network' | 'server'
      | 'bad_request' | 'model_not_found' | 'cut_off';
  message: string;
};

type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; ms: number };

decide(req: DecideRequest): Promise<{ decision: Decision; usage: Usage }>
```
- Each step is **one fresh request** (system + tools + one message), not a growing conversation. Section D explains why. This keeps the adapter small: no translating each provider's conversation format.
- **Fake provider** (`fake.ts`): returns decisions from a scripted array, e.g. `[click 2, type 3 "lofi", done]`, with zero usage. Select it with a dev-only setting. Section D is built and tested with it, so loop bugs cost nothing.

**Done when:**
- Types compile.
- With the fake provider selected, calling `decide()` three times returns the three scripted decisions in order.

## 5. Claude implementation

**What:** `decide()` for Anthropic.

**How:**
```ts
const res = await client.beta.messages.create({
  model: settings.model,                         // e.g. 'claude-opus-5-5'
  max_tokens: 16000,
  system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
  tools: req.tools.map(t => ({ ...t, strict: true })),
  tool_choice: { type: 'auto', disable_parallel_tool_use: true },
  output_config: { effort: settings.effort },
  messages: [{ role: 'user', content: req.message }],
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
}, { signal: req.signal });
```
- **Caching:** `cache_control` on the system prompt caches tools + system prompt, which are identical every step, so later steps cost less. Check that `usage.cache_read_input_tokens` is above 0 from step 2 of a task onward. If it stays 0, either something in the system prompt or tools changes between steps, or they're shorter than the model's minimum cacheable size.
- **Server-side fallback** (`betas` + `fallbacks: 'default'`): if Claude's safety system declines, Anthropic retries on a fallback model automatically. Supported on Opus 5.5 and Sonnet 5.5. For Haiku 5.5, drop both fields and use `client.messages.create`. Needs a recent SDK version.
- **Don't send** `thinking` (current models think adaptively by default; effort controls how much), `temperature` (rejected on current models), or `tool_choice: 'any'` / `'tool'` (current models reject forced tool use). `auto` + the prompt rule "call exactly one tool" + step 11's nudge cover it.

**Reading the response. Check `stop_reason` first:**
- `'refusal'` → `refused`, reason from `res.stop_details?.explanation`.
- `'max_tokens'` → error `cut_off`.
- Otherwise find the content block with `type === 'tool_use'` → `action { tool: block.name, args: block.input }`.
  The response can start with `thinking` blocks. Always find blocks **by type**, never by position.
- No `tool_use` block → `no_action` with the text blocks joined.
- Usage: `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, plus measured time.

**Errors.** SDK classes, most specific first:

| Class | Becomes |
|---|---|
| `Anthropic.APIUserAbortError` | `stopped` (no error shown) |
| `Anthropic.AuthenticationError`, `PermissionDeniedError` | `auth` |
| `Anthropic.NotFoundError` | `model_not_found` |
| `Anthropic.RateLimitError` | `rate_limit` |
| `Anthropic.BadRequestError` | `bad_request` (our bug: log the full message) |
| `Anthropic.InternalServerError` | `server` (includes 529 "overloaded") |
| `Anthropic.APIConnectionError` | `network` |

The SDK already retries rate limits, server errors and network failures twice with backoff. Don't add your own retry loop on top.

**Done when:**
- A dev console command `llm "click the third element"` (with one inline test tool `click { index }`) prints `action click {"index":3}` plus a usage line, on both Opus 5.5 and Haiku 5.5.
- With a wrong key it prints an `auth` error.
- Pressing Stop during the call prints nothing alarming (`stopped`).

## 6. OpenAI implementation

**What:** `decide()` for OpenAI, using the Responses API.

**How:**
```ts
const res = await client.responses.create({
  model: settings.model,
  instructions: req.system,
  input: req.message,
  tools: req.tools.map(t => ({
    type: 'function', name: t.name, description: t.description,
    parameters: t.input_schema, strict: true,
  })),
  tool_choice: 'required',
  parallel_tool_calls: false,
  reasoning: { effort: settings.effort },   // reasoning models only
  store: false,
}, { signal: req.signal });
```
- `store: false`: OpenAI doesn't keep the request on their side. Page content can be personal.
- `tool_choice: 'required'` is allowed on OpenAI. Since `done` and `ask_user` are tools, there's always a valid choice.
- OpenAI caches automatically when the start of the prompt repeats (1024+ tokens). Same rule as Claude: instructions + tools identical every step.
- Send `reasoning` only for reasoning models. Keep a small list of model-ID prefixes for that.
  `shortcut: prefix list goes stale, upgrade by checking model capabilities if OpenAI exposes them`.

**Reading the response:**
- `res.status === 'incomplete'` → error `cut_off` (see `res.incomplete_details?.reason`).
- An output item with `type === 'function_call'` → `action { tool: item.name, args: JSON.parse(item.arguments) }`.
  `arguments` is a JSON **string**. Parse it inside try/catch; failure → `bad_request`.
- A `message` item whose content includes a `refusal` part → `refused`.
- Neither → `no_action` with `res.output_text`.
- Usage: `usage.input_tokens`, `usage.output_tokens`, `usage.input_tokens_details.cached_tokens`.

**Errors.** Same table with `OpenAI.*` classes, plus one special case: `OpenAI.RateLimitError` with `err.code === 'insufficient_quota'` → `no_credits` (no point retrying; the account needs credits).

**Done when:**
- The same `llm` test passes with OpenAI selected.
- Switching provider in Settings switches `decide()` with no other code change.
