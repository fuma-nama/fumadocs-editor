import type { SyncClient } from "@fumadocs-editor/core/sync";

type SyncModule = typeof import("@fumadocs-editor/core/sync");

let shared: SyncClient | undefined;

/** the sync code loads on first use, so pages without `sync` never download it */
export const loadSync = (): Promise<SyncModule> => import("@fumadocs-editor/core/sync");

/** one connection to the dev server for every editor and tree on the page */
export const sharedClient = (mod: SyncModule): SyncClient => (shared ??= mod.createSyncClient());
