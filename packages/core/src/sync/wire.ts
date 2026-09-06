import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

/**
 * Collab messages as *binary* frames on the mirror websocket (JSON stays
 * on text): one connection, reconnect path, and server. Layout: document
 * path, then y-websocket-style (sync = 0 / awareness = 1 + y-protocols).
 *
 * A second `y-websocket` would add another socket/reconnect loop, and its
 * persistence hook has no notion of disk changing mid-session. The
 * authority (parse → seed, Y → MDX → disk, disk → merge → Y) would still
 * be hand-written against an unsupported API. One socket is less code.
 */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** start a frame; append the y-protocols payload with lib0 `encoding` */
export function collabFrame(path: string, kind: number): encoding.Encoder {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, path);
  encoding.writeVarUint(encoder, kind);
  return encoder;
}

export interface CollabFrame {
  path: string;
  kind: number;
  decoder: decoding.Decoder;
}

export function readCollabFrame(data: Uint8Array): CollabFrame {
  const decoder = decoding.createDecoder(data);
  const path = decoding.readVarString(decoder);
  const kind = decoding.readVarUint(decoder);
  return { path, kind, decoder };
}
