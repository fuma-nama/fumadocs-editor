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
 * A read reply: the file state plus scope-derived data. Data only — the
 * client never acts on it; consumers wire it into their own props.
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
 * A place markdown files live, addressed by root-relative posix paths. The
 * dev-server transport speaks this over a websocket; other backends (a real
 * filesystem handle, a database) only need these four calls.
 */
export interface SyncTransport {
  /** every file path in the workspace (filtered to what this connection may read) */
  list(): Promise<string[]>;
  read(path: string): Promise<ReadResult>;
  write(path: string, text: string, baseVersion: string): Promise<WriteResult>;
  /** change notifications for one path; returns unsubscribe */
  watch(path: string, onChange: (state: FileState) => void): () => void;
  /**
   * Connection state changes, firing immediately with the current state;
   * returns unsubscribe. Optional: a backend that cannot go offline (an
   * in-memory store) simply omits it.
   */
  onStatus?(listener: (status: ConnectionStatus) => void): () => void;
}

/** websocket close code for a rejected hello — denied is not offline */
export const CLOSE_DENIED = 4403;

/** request header carrying the JSON-encoded auth payload on the HTTP media endpoints */
export const AUTH_HEADER = "x-fde-auth";

/** where the vite plugin mounts the sync websocket */
export const SYNC_ENDPOINT = "/__fde_sync";

/** where the vite plugin mounts the media upload endpoint (POST) */
export const UPLOAD_ENDPOINT = "/__fde_upload";

/** where the vite plugin serves stored assets (`ASSET_ENDPOINT/<relative>`) */
export const ASSET_ENDPOINT = "/__fde_asset";
