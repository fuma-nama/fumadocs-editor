import type { WsTransport } from "@fumadocs-editor/core/sync";

type SyncModule = typeof import("@fumadocs-editor/core/sync");

let shared: WsTransport | undefined;

/** the sync code loads on first use, so pages without `sync` never download it */
export const loadSync = (): Promise<SyncModule> => import("@fumadocs-editor/core/sync");

/** one websocket to the dev server for every editor and tree on the page */
export const sharedTransport = (mod: SyncModule): WsTransport => (shared ??= mod.wsTransport());
