import { createSyncClient } from "@fumadocs-editor/core/sync";

declare function getAccessToken(): Promise<string>;

export const client = createSyncClient({
  // called on every connection, so reconnects carry a fresh token
  auth: () => getAccessToken(),
});
