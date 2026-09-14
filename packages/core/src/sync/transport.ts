export interface FileState {
  text: string;
  /** content hash; the compare-and-swap token for writes */
  version: string;
}

/** the authenticated identity a server scope may pin to a connection */
export interface SyncUser {
  name: string;
  color?: string;
}

/**
 * A read reply: file state plus scope-derived data. The client never acts
 * on it; consumers wire it into their own props.
 */
export interface ReadResult extends FileState {
  user?: SyncUser;
  /** whether this connection may write the path; absent when the backend has no notion of scope */
  writable?: boolean;
}

export type WriteResult =
  | { ok: true; version: string }
  /** the write lost a race: here is what the file holds now */
  | { ok: false; current: FileState };

/** "denied" is terminal: the server rejected the credentials, no retry loop runs */
export type ConnectionStatus = "online" | "offline" | "denied";

/**
 * A channel to the sync server: text frames carry the JSON protocol,
 * binary frames collab. It only moves messages; `createSyncClient` speaks
 * the protocol on top. The websocket is one implementation; a
 * `MessagePort`, a worker or an in-memory pair need the same four calls.
 */
export interface SyncTransport {
  /** dropped while the channel is down */
  send(data: string | Uint8Array): void;
  onMessage(listener: (data: string | Uint8Array) => void): () => void;
  /**
   * Connectivity, firing immediately with the current state; returns
   * unsubscribe. Optional: a channel that cannot drop omits it.
   */
  onStatus?(listener: (online: boolean) => void): () => void;
  close(): void;
}

/** request header carrying the JSON-encoded auth payload on the HTTP media endpoints */
export const AUTH_HEADER = "x-fde-auth";

/** where the vite plugin mounts the sync websocket */
export const SYNC_ENDPOINT = "/__fde_sync";

/** where the vite plugin mounts the media upload endpoint (POST) */
export const UPLOAD_ENDPOINT = "/__fde_upload";

/** where the vite plugin serves stored assets (`ASSET_ENDPOINT/<relative>`) */
export const ASSET_ENDPOINT = "/__fde_asset";
