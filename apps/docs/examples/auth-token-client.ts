import { createSyncClient } from "@fumadocs-editor/core/sync";

declare function getAccessToken(): Promise<string>;

export const client = createSyncClient({ auth: () => getAccessToken() });
