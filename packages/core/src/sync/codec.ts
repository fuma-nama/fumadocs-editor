const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * How a protocol message travels over the websocket: JSON text, or one binary
 * frame when a field holds bytes. The frame is a big-endian `u32` header
 * length, the JSON header with those fields listed under `$bytes` as
 * `[field, length]`, then the bytes in that order.
 */
export function encodeMessage(message: object): string | Uint8Array<ArrayBuffer> {
  const header: Record<string, unknown> = {};
  const bytes: [string, Uint8Array][] = [];
  let size = 0;
  for (const [key, value] of Object.entries(message)) {
    if (!(value instanceof Uint8Array)) header[key] = value;
    else if (bytes.push([key, value])) size += value.length;
  }
  if (bytes.length === 0) return JSON.stringify(message);
  const lengths: [string, number][] = [];
  for (const [key, value] of bytes) lengths.push([key, value.length]);
  header.$bytes = lengths;
  const head = encoder.encode(JSON.stringify(header));
  const frame = new Uint8Array(4 + head.length + size);
  new DataView(frame.buffer).setUint32(0, head.length);
  frame.set(head, 4);
  let offset = 4 + head.length;
  for (const [, value] of bytes) {
    frame.set(value, offset);
    offset += value.length;
  }
  return frame;
}

/** throws on anything {@link encodeMessage} did not produce */
export function decodeMessage(data: string | Uint8Array): Record<string, unknown> {
  if (typeof data === "string") return JSON.parse(data);
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
  const message = JSON.parse(decoder.decode(data.subarray(4, 4 + length)));
  let offset = 4 + length;
  for (const [key, size] of message.$bytes) {
    if (typeof key !== "string" || typeof size !== "number" || offset + size > data.length) {
      throw new Error("malformed frame");
    }
    message[key] = data.subarray(offset, (offset += size));
  }
  delete message.$bytes;
  return message;
}
