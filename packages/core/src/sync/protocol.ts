import type { ComponentSpec, SyntaxOptions } from "../components/spec";
import type { TreeCommand, WorkspaceTree } from "./tree";

/**
 * The sync protocol, spoken by every backend over any transport. Messages
 * are JSON objects whose byte fields are `Uint8Array`s; the websocket carries
 * a message with bytes as one binary frame (see `codec.ts`).
 *
 * - A connection starts with `hello`. Nothing else is handled before its
 *   answer, and an `error` answer is final: the server closes.
 * - A client message with an `id` gets exactly one server message with the
 *   same `id`: `hello` answers `hello`, `update` answers `subscribe` and
 *   `update`, or `error`. A message without an `id` is never answered; the
 *   server drops what it cannot apply.
 * - An `update` carries state: the whole tree, the whole file, or a Yjs
 *   diff for a doc. The answer to `subscribe` brings the client to the
 *   current state, the answer to `update` is the state after it (a file
 *   write that landed answers with its `version` only), and every other
 *   subscriber receives the change as an `update` without an `id`.
 *   Pushes for a resource never precede the answer to its `subscribe`.
 * - There is no resume. A closed connection forgets its subscriptions; the
 *   client says `hello` and subscribes again.
 */
export const PROTOCOL = 1;

/** where the vite plugin mounts the sync websocket */
export const SYNC_ENDPOINT = "/__fde_sync";

/** where the vite plugin mounts the media upload endpoint (POST) */
export const UPLOAD_ENDPOINT = "/__fde_upload";

/** where the vite plugin serves stored assets (`ASSET_ENDPOINT/<relative>`) */
export const ASSET_ENDPOINT = "/__fde_asset";

/** request header carrying the JSON-encoded auth payload on the HTTP media endpoints */
export const AUTH_HEADER = "x-fde-auth";

/** the authenticated identity a server scope may pin to a connection */
export interface SyncUser {
  name: string;
  color?: string;
}

interface TreeRef {
  resource: "tree";
}

interface FileRef {
  resource: "file";
  path: string;
}

interface DocRef {
  resource: "doc";
  path: string;
}

export type Resource = TreeRef | FileRef | DocRef;

interface DocJoin extends DocRef {
  /** Yjs state vector of the client's doc */
  vector: Uint8Array;
  /** the component specs the server parses and serializes with, data fields only */
  components: ComponentSpec[];
  syntax?: SyntaxOptions;
}

interface FileWrite extends FileRef {
  text: string;
  /** the version this text was edited from; `""` for a file that does not exist */
  base: string;
}

interface FileState extends FileRef {
  /** answering a write, the write lost a race: this is what the file holds */
  text: string;
  /** opaque; `""` when the file does not exist */
  version: string;
  /** set when answering `subscribe` */
  writable?: boolean;
}

interface FileSaved extends FileRef {
  version: string;
}

interface DocState extends DocRef {
  /** the file as the server's doc was seeded or last saved */
  text: string;
  /** changes when the server re-seeds the doc; a client holding another epoch must discard its doc */
  epoch: string;
  writable: boolean;
  /** the server doc's state vector: the client sends back what it is missing */
  vector: Uint8Array;
  /** what the client is missing */
  yjs: Uint8Array;
}

/** an edit or a presence change, relayed to every other subscriber */
interface DocChange extends DocRef {
  /** Yjs update */
  yjs?: Uint8Array;
  /** y-protocols awareness update */
  awareness?: Uint8Array;
}

export type ClientMessage =
  | { type: "hello"; id: number; protocol: typeof PROTOCOL; auth?: unknown }
  | ({ type: "subscribe"; id: number } & (TreeRef | FileRef | DocJoin))
  | ({ type: "unsubscribe" } & Resource)
  | ({ type: "update"; id: number } & ((TreeRef & { command: TreeCommand }) | FileWrite))
  | ({ type: "update"; id?: undefined } & DocChange);

export type ServerMessage =
  | { type: "hello"; id: number; user?: SyncUser }
  | { type: "error"; id: number; message: string }
  | ({ type: "update"; id?: number } & ((TreeRef & { tree: WorkspaceTree }) | FileState))
  | ({ type: "update"; id: number } & (FileSaved | DocState))
  | ({ type: "update"; id?: undefined } & DocChange);
