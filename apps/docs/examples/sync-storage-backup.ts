import { fsStorage, type SyncStorage } from "@fumadocs-editor/core/node";

declare const backup: { put(path: string, data: Uint8Array): Promise<void> };

const disk = fsStorage("content/docs");

// every write also goes to a backup
export const storage: SyncStorage = {
  ...disk,
  async write(path, data) {
    await disk.write(path, data);
    await backup.put(path, data);
  },
};
