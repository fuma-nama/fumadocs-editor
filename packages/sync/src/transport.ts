export interface FileEntry {
  /** posix path relative to the sync root */
  path: string;
}

export interface FileState {
  text: string;
  /** content hash; the compare-and-swap token for writes */
  version: string;
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
  read(path: string): Promise<FileState>;
  write(path: string, text: string, baseVersion: string): Promise<WriteResult>;
  /** change notifications for one path; returns unsubscribe */
  watch(path: string, onChange: (state: FileState) => void): () => void;
}
