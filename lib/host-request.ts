// The host's rules: splits Chrome's framed messages, accepts only a strict "ask", builds the one fixed API request, trims the reply.

// Chrome frames each message as a 4-byte length (native byte order) + UTF-8 JSON. It sends at most 64 MiB to a host
// and accepts at most 1 MB back; we cap both ways at 1 MB.
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
export const MAX_FRAME = 1024 * 1024;

// Planner (writes the plan), executor (picks each step's command) and judge. Source for the IDs: Claude API model list
// (claude-api skill, cached 2026-10-06). The executor runs every step, so it's most of the bill: Haiku 5.5 is 20×
// cheaper than Sonnet 5.5 ($0.10 / $0.50 vs $2 / $10 per million tokens; harness/token-cost.md).
export const PLANNER = 'claude-sonnet-5-5';
export const EXECUTOR = 'claude-haiku-5-5';
export const JUDGE = 'claude-haiku-5-5';
const MODELS = new Set([PLANNER, EXECUTOR, JUDGE]);
export const MAX_TOKENS = 16000; // per call; thinking tokens count toward it

export type Role = 'user' | 'assistant';
// Structured outputs: the API makes the reply match this JSON schema (prose, stray tags or an empty reply can't happen).
// Source: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
export interface OutputConfig {
  format: { type: 'json_schema'; schema: Record<string, unknown> };
}
// A message's content is text, or blocks: text plus the step's one screenshot (F1a), image first.
// Source: https://platform.claude.com/docs/en/build-with-claude/vision
export type ImageType = 'image/jpeg' | 'image/png';
export type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageType; data: string } };
export interface Ask {
  model: string;
  max_tokens: number;
  system?: string;
  messages: { role: Role; content: string | Block[] }[];
  output_config?: OutputConfig;
}
// An ask as the panel builds it, before a screenshot is added: text messages only.
export type TextAsk = Ask & { messages: { role: Role; content: string }[] };
export type Reply =
  | { type: 'answer'; text: string; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; error: string };

// Splits bytes into whole messages and keeps the unfinished tail. A too-big length throws before its body is read.
// Little-endian: every CPU desktop Chrome runs on (x86-64, arm64) is.
export function readFrames(buf: Buffer): { messages: string[]; rest: Buffer } {
  const messages: string[] = [];
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (len > MAX_FRAME) throw new Error(`Message too big: over ${MAX_FRAME} bytes`);
    if (buf.length < 4 + len) break;
    messages.push(buf.subarray(4, 4 + len).toString('utf8'));
    buf = buf.subarray(4 + len);
  }
  return { messages, rest: buf };
}

export function frame(reply: object): Buffer {
  const body = Buffer.from(JSON.stringify(reply));
  if (body.length > MAX_FRAME) return frame({ type: 'error', error: 'Reply too big for Chrome (1 MB max)' });
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

// Untrusted input: anything not exactly an ask is refused. Returns a fresh object, so no extra field can reach the API.
export function checkAsk(text: string): Ask {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    throw new Error('Not JSON');
  }
  if (!isObject(m) || m.type !== 'ask') throw new Error('Only {"type":"ask"} is accepted');
  if (!onlyKeys(m, ['type', 'model', 'system', 'messages', 'max_tokens', 'output_config'])) throw new Error('Unknown field in ask');
  const { model, system, messages, max_tokens, output_config } = m;
  if (typeof model !== 'string' || !MODELS.has(model)) throw new Error('Model not on the allowlist');
  if (typeof max_tokens !== 'number' || !Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > MAX_TOKENS) {
    throw new Error(`max_tokens must be 1–${MAX_TOKENS}`);
  }
  if (system !== undefined && typeof system !== 'string') throw new Error('system must be text');
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('messages must be a non-empty list');
  const clean = messages.map((x) => {
    if (!isObject(x) || !onlyKeys(x, ['role', 'content'])) throw new Error('Each message is {role, content} only');
    if (x.role !== 'user' && x.role !== 'assistant') throw new Error('role must be user or assistant');
    const role = x.role as Role;
    if (typeof x.content === 'string') return { role, content: x.content };
    if (!Array.isArray(x.content) || x.content.length === 0) throw new Error('content must be text or a non-empty block list');
    return { role, content: x.content.map((b) => checkBlock(b, role)) };
  });
  // One screenshot per ask: only the current screen is sent, so old pictures never pile up (cost and size).
  if (clean.flatMap((m) => (typeof m.content === 'string' ? [] : m.content)).filter((b) => b.type === 'image').length > 1) {
    throw new Error('At most one image per ask');
  }
  return { model, max_tokens, ...(system === undefined ? {} : { system }), messages: clean, ...(output_config === undefined ? {} : { output_config: checkOutputConfig(output_config) }) };
}

const IMAGE_TYPES: string[] = ['image/jpeg', 'image/png'] satisfies ImageType[];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// A text block, or a base64 JPEG/PNG from the user. No url or file sources: the API would fetch those for us.
function checkBlock(b: unknown, role: Role): Block {
  if (isObject(b) && b.type === 'text' && onlyKeys(b, ['type', 'text']) && typeof b.text === 'string') return { type: 'text', text: b.text };
  if (isObject(b) && b.type === 'image' && role === 'user' && onlyKeys(b, ['type', 'source']) && isObject(b.source)) {
    const { type, media_type, data } = b.source;
    if (onlyKeys(b.source, ['type', 'media_type', 'data']) && type === 'base64' && typeof media_type === 'string' &&
      IMAGE_TYPES.includes(media_type) && typeof data === 'string' && data.length % 4 === 0 && BASE64.test(data)) {
      return { type: 'image', source: { type: 'base64', media_type: media_type as ImageType, data } };
    }
  }
  throw new Error('A block is {type: "text", text} or a user\'s {type: "image", source: {type: "base64", media_type: JPEG or PNG, data}} only');
}

// Only a JSON schema for the reply. Other output_config keys (effort, task budgets…) change cost, so they're refused.
// The schema only shapes the answer text; it can't change where the request goes or what it carries.
function checkOutputConfig(o: unknown): OutputConfig {
  if (!isObject(o) || !onlyKeys(o, ['format']) || !isObject(o.format)) throw new Error('output_config must be {format} only');
  const { format } = o;
  if (!onlyKeys(format, ['type', 'schema']) || format.type !== 'json_schema' || !isObject(format.schema)) {
    throw new Error('output_config.format must be {type: "json_schema", schema: {…}}');
  }
  return { format: { type: 'json_schema', schema: format.schema } };
}

// The only request the host ever makes. The key goes in one header; redirects fail instead of carrying it elsewhere.
// Headers + fallback: Claude API raw-HTTP reference (claude-api skill) · errors: https://platform.claude.com/docs/en/api/errors
// redirect: https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#redirect
export function apiRequest(ask: Ask, key: string): RequestInit {
  // The planner can hand a refused request to another model instead of stopping. Haiku has no fallback.
  const fallback = ask.model === PLANNER;
  return {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    },
    body: JSON.stringify(fallback ? { ...ask, fallbacks: 'default' } : ask),
  };
}

// Answer text + token counts only. Errors carry status and API error type, never headers or the API's message.
export function toReply(status: number, json: unknown): Reply {
  const j = isObject(json) ? json : {};
  if (status < 200 || status > 299) {
    const type = isObject(j.error) && typeof j.error.type === 'string' ? j.error.type : 'unknown_error';
    return { type: 'error', error: `HTTP ${status} ${type}` };
  }
  const { content, usage, stop_reason } = j;
  if (!Array.isArray(content) || !isObject(usage) || typeof stop_reason !== 'string') {
    return { type: 'error', error: 'Unexpected API reply' };
  }
  const text = content.map((b) => (isObject(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('');
  return {
    type: 'answer',
    text,
    stop_reason,
    usage: { input_tokens: Number(usage.input_tokens) || 0, output_tokens: Number(usage.output_tokens) || 0 },
  };
}
