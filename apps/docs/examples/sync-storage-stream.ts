import { createSyncServer, type SyncStorage } from "@fumadocs-editor/core/node";

declare const bucket: {
  list(prefix: string): Promise<string[]>;
  // a missing object resolves to undefined
  stream(key: string): Promise<AsyncIterable<Uint8Array> | undefined>;
  put(key: string, body: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
};

const storage: SyncStorage = {
  name: "Docs",
  list: (dir) => bucket.list(dir ? `${dir}/` : ""),
  read: (path) => bucket.stream(path),
  write: (path, data) => bucket.put(path, data),
  delete: (path) => bucket.remove(path),
};

export const sync = createSyncServer({ storage });
