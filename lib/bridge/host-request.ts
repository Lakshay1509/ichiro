// The host's framing: splits and builds Chrome's native-messaging messages, plus the shape checks for untrusted JSON.

// Chrome frames each message as a 4-byte length (native byte order) + UTF-8 JSON. It sends at most 64 MiB to a host
// and accepts at most 1 MB back; we cap both ways at 1 MB.
// Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
export const MAX_FRAME = 1024 * 1024;

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
