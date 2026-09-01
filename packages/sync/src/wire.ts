import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

/**
 * Framing for collab messages: they ride the mirror websocket as *binary*
 * frames (the JSON mirror protocol stays on text frames), so the two
 * protocols share one connection, one reconnect path and one server. Each
 * frame is the document path followed by a y-websocket-style message
 * (sync = 0 / awareness = 1, then the y-protocols payload).
 *
 * This was weighed against mounting `y-websocket` alongside: its provider
 * would give every open document a second socket with its own reconnect
 * logic next to `wsTransport`'s, and its server half keeps a private
 * doc-per-room registry behind a persistence hook that has no notion of a
 * file changing on disk mid-session — the doc authority (parse → seed,
 * Y → MDX → disk, disk → merge → Y) would still be hand-written against an
 * API its own readme calls unsupported. Extending the existing socket with
 * y-protocols directly is less code overall and keeps one code path.
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
