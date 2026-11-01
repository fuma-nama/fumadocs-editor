import { createSyncServer, type SyncStorage } from "@fumadocs-editor/core/node";

declare const db: {
  keys(prefix: string): Promise<string[]>;
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
};

const storage: SyncStorage = {
  name: "Docs",
  list: (dir) => db.keys(dir ? `${dir}/` : ""),
  read: (path) => db.get(path),
  write: (path, data) => db.set(path, data),
  delete: (path) => db.delete(path),
};

export const sync = createSyncServer({ storage });
