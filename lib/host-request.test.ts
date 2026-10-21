// Checks the host's framing, the strict ask check, the fixed API request and the trimmed reply. Run: npm test
import { apiRequest, checkAsk, frame, JUDGE, MAX_FRAME, MAX_TOKENS, PLANNER, readFrames, toReply } from './host-request.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const throws = (f: () => unknown, what: string) => {
  try {
    f();
  } catch {
    return;
  }
  fail(`${what} should throw`);
};
const framed = (o: unknown) => {
  const body = Buffer.from(JSON.stringify(o));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
};

// Frames: two in one chunk; one split mid-header and mid-body across three chunks.
const two = readFrames(Buffer.concat([framed({ a: 1 }), framed({ b: 2 })]));
if (two.messages.join() !== '{"a":1},{"b":2}' || two.rest.length) fail(`two frames: ${JSON.stringify(two)}`);
const whole = framed({ hello: 'wörld' });
let r = readFrames(whole.subarray(0, 2));
if (r.messages.length || r.rest.length !== 2) fail('split header should wait');
r = readFrames(Buffer.concat([r.rest, whole.subarray(2, 9)]));
if (r.messages.length) fail('split body should wait');
r = readFrames(Buffer.concat([r.rest, whole.subarray(9)]));
if (r.messages[0] !== '{"hello":"wörld"}' || r.rest.length) fail(`split frame: ${JSON.stringify(r)}`);
// Too big: refused from the 4-byte header alone, before any body arrives.
const huge = Buffer.alloc(4);
huge.writeUInt32LE(MAX_FRAME + 1);
throws(() => readFrames(huge), 'over-1MB frame');

// frame() round-trips, and swaps a reply too big for Chrome for an error.
const back = readFrames(frame({ type: 'error', error: 'x' })).messages[0];
if (back !== '{"type":"error","error":"x"}') fail(`frame round trip: ${back}`);
const big = readFrames(frame({ type: 'answer', text: 'a'.repeat(MAX_FRAME), stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
if (!big.messages[0]?.includes('Reply too big')) fail('oversized reply should become an error');

// A valid ask comes back as a fresh object with only the API fields.
const ok = { type: 'ask', model: JUDGE, system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100 };
const ask = checkAsk(JSON.stringify(ok));
if (JSON.stringify(ask) !== JSON.stringify({ model: JUDGE, max_tokens: 100, system: 'Be brief.', messages: ok.messages })) fail(`valid ask: ${JSON.stringify(ask)}`);
if ('system' in checkAsk(JSON.stringify({ ...ok, system: undefined }))) fail('system is optional');
// A reply schema passes through as {format: {type, schema}} and nothing more.
const schema = { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false };
const shaped = checkAsk(JSON.stringify({ ...ok, output_config: { format: { type: 'json_schema', schema } } }));
if (JSON.stringify(shaped.output_config) !== JSON.stringify({ format: { type: 'json_schema', schema } })) fail(`output_config: ${JSON.stringify(shaped)}`);
// F1a: the step's screenshot, then text, passes through unchanged.
const jpeg = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' } };
const text = { type: 'text', text: 'Hi' };
const pictured = { ...ok, messages: [{ role: 'user', content: [jpeg, text] }] };
if (JSON.stringify(checkAsk(JSON.stringify(pictured)).messages) !== JSON.stringify(pictured.messages)) fail('text + one image should pass');
const png = { type: 'image', source: { ...jpeg.source, media_type: 'image/png' } };
checkAsk(JSON.stringify({ ...ok, messages: [{ role: 'user', content: [png] }] }));

// Every rejection: nothing here may reach the API.
const bad: Record<string, unknown> = {
  'not JSON': '{',
  'array': [],
  'other type': { ...ok, type: 'fetch' },
  'unknown field stream': { ...ok, stream: true },
  'unknown field tools': { ...ok, tools: [] },
  'unknown field url': { ...ok, url: 'https://evil.example' },
  'model off list': { ...ok, model: 'claude-fable-5-1' },
  'max_tokens 0': { ...ok, max_tokens: 0 },
  'max_tokens over cap': { ...ok, max_tokens: MAX_TOKENS + 1 },
  'max_tokens fraction': { ...ok, max_tokens: 1.5 },
  'max_tokens text': { ...ok, max_tokens: '100' },
  'system not text': { ...ok, system: [{ type: 'text', text: 'x' }] },
  'no messages': { ...ok, messages: [] },
  'messages not list': { ...ok, messages: 'Hi' },
  'extra key in message': { ...ok, messages: [{ role: 'user', content: 'Hi', cache_control: {} }] },
  'system role': { ...ok, messages: [{ role: 'system', content: 'Hi' }] },
  'image without source': { ...ok, messages: [{ role: 'user', content: [{ type: 'image' }] }] },
  'empty block list': { ...ok, messages: [{ role: 'user', content: [] }] },
  'content number': { ...ok, messages: [{ role: 'user', content: 1 }] },
  'two images': { ...ok, messages: [{ role: 'user', content: [jpeg, jpeg, text] }] },
  'two images, two messages': { ...ok, messages: [{ role: 'user', content: [jpeg] }, { role: 'assistant', content: 'ok' }, { role: 'user', content: [jpeg] }] },
  'image from assistant': { ...ok, messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: [jpeg] }] },
  'gif': { ...ok, messages: [{ role: 'user', content: [{ ...jpeg, source: { ...jpeg.source, media_type: 'image/gif' } }] }] },
  'url source': { ...ok, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://evil.example/a.jpg' } }] }] },
  'file source': { ...ok, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'file', file_id: 'file_1' } }] }] },
  'url next to base64': { ...ok, messages: [{ role: 'user', content: [{ ...jpeg, source: { ...jpeg.source, url: 'https://evil.example' } }] }] },
  'not base64': { ...ok, messages: [{ role: 'user', content: [{ ...jpeg, source: { ...jpeg.source, data: 'ab$d' } }] }] },
  'base64 bad length': { ...ok, messages: [{ role: 'user', content: [{ ...jpeg, source: { ...jpeg.source, data: 'abcde' } }] }] },
  'empty image data': { ...ok, messages: [{ role: 'user', content: [{ ...jpeg, source: { ...jpeg.source, data: '' } }] }] },
  'extra key in image block': { ...ok, messages: [{ role: 'user', content: [{ ...jpeg, cache_control: { type: 'ephemeral' } }] }] },
  'extra key in text block': { ...ok, messages: [{ role: 'user', content: [{ ...text, citations: [] }] }] },
  'text block not text': { ...ok, messages: [{ role: 'user', content: [{ type: 'text', text: 1 }] }] },
  'document block': { ...ok, messages: [{ role: 'user', content: [{ type: 'document', source: jpeg.source }] }] },
  'tool_result block': { ...ok, messages: [{ role: 'user', content: [{ type: 'tool_result', content: [jpeg] }] }] },
  'output_config effort': { ...ok, output_config: { effort: 'max' } },
  'output_config extra key': { ...ok, output_config: { format: { type: 'json_schema', schema }, effort: 'max' } },
  'output_config not object': { ...ok, output_config: 'json' },
  'format other type': { ...ok, output_config: { format: { type: 'text', schema } } },
  'format extra key': { ...ok, output_config: { format: { type: 'json_schema', schema, url: 'https://evil.example' } } },
  'schema not object': { ...ok, output_config: { format: { type: 'json_schema', schema: [] } } },
};
for (const [what, v] of Object.entries(bad)) throws(() => checkAsk(typeof v === 'string' ? v : JSON.stringify(v)), what);

// The request: fixed method and headers, key only in x-api-key, no redirects, fallback for the planner only.
const KEY = 'sk-ant-test-key';
const judge = apiRequest(ask, KEY);
const h = judge.headers as Record<string, string>;
if (judge.method !== 'POST' || judge.redirect !== 'error') fail(`judge request: ${judge.method} ${judge.redirect}`);
if (h['x-api-key'] !== KEY || h['anthropic-version'] !== '2023-06-01' || 'anthropic-beta' in h) fail(`judge headers: ${Object.keys(h)}`);
if (String(judge.body).includes(KEY) || 'fallbacks' in JSON.parse(String(judge.body))) fail('judge body');
const planner = apiRequest({ ...ask, model: PLANNER }, KEY);
const ph = planner.headers as Record<string, string>;
if (ph['anthropic-beta'] !== 'server-side-fallback-2026-07-01' || JSON.parse(String(planner.body)).fallbacks !== 'default') fail('planner fallback');

// Reply: text blocks joined, other blocks and extra usage dropped; errors give status + type only.
const answer = toReply(200, {
  content: [{ type: 'thinking', thinking: 'secret plan' }, { type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 9 },
  id: 'msg_1',
});
if (JSON.stringify(answer) !== '{"type":"answer","text":"Hello","stop_reason":"end_turn","usage":{"input_tokens":5,"output_tokens":2}}') fail(`answer: ${JSON.stringify(answer)}`);
const limited = toReply(429, { type: 'error', error: { type: 'rate_limit_error', message: 'details with x-api-key' } });
if (limited.type !== 'error' || limited.error !== 'HTTP 429 rate_limit_error') fail(`429: ${JSON.stringify(limited)}`);
if (JSON.stringify(toReply(502, null)) !== '{"type":"error","error":"HTTP 502 unknown_error"}') fail('502 without JSON');
if (JSON.stringify(toReply(200, { nope: 1 })) !== '{"type":"error","error":"Unexpected API reply"}') fail('odd 200');
