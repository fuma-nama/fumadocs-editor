export interface FileEntry {
  /** posix path relative to the sync root */
  path: string;
}

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
export interface OpenState extends FileState {
  user?: SyncUser;
  /** whether this connection may write the path; absent when the backend has no notion of scope */
  writable?: boolean;
}

export type WriteResult =
  | { ok: true; version: string }
  /** the write lost a race: here is what the file holds now */
  | { ok: false; current: FileState };

/**
 * A place markdown files live. The dev-server transport speaks this over a
 * websocket; other backends (a real filesystem handle, a database) only
 * need these four calls.
 */
export interface SyncTransport {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<OpenState>;
  write(path: string, text: string, baseVersion: string): Promise<WriteResult>;
  /** change notifications for one path; returns unsubscribe */
  watch(path: string, onChange: (state: FileState) => void): () => void;
}

/** websocket close code for a rejected hello — denied is not offline */
export const CLOSE_DENIED = 4403;

/** request header carrying the JSON-encoded auth payload on the HTTP media endpoints */
export const AUTH_HEADER = "x-fde-auth";
