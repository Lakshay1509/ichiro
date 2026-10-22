// Checks the host's framing: whole messages out of chunks, the 1 MB cap both ways. Run: npm test
import { frame, MAX_FRAME, readFrames } from './host-request.ts';

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
const big = readFrames(frame({ type: 'output', text: 'a'.repeat(MAX_FRAME) }));
if (!big.messages[0]?.includes('Reply too big')) fail('oversized reply should become an error');
