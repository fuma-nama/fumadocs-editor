import { createSyncClient, type SyncClient } from "../../src/sync/client";
import type { ReadResult, WriteResult } from "../../src/sync/transport";
import { wsTransport } from "../../src/sync/ws";

export const connect = (url: string, auth?: () => unknown): SyncClient =>
  createSyncClient({ transport: wsTransport(url), auth });

export const list = (client: SyncClient) => client.request<string[]>({ type: "list" });
export const read = (client: SyncClient, path: string) =>
  client.request<ReadResult>({ type: "read", path });
export const write = (client: SyncClient, path: string, text: string, baseVersion: string) =>
  client.request<WriteResult>({ type: "write", path, text, baseVersion });
