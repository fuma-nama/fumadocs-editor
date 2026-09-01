import { SYNC_ENDPOINT, wsTransport } from "@fumadocs-editor/sync";

declare function getAccessToken(): Promise<string>;

export const transport = wsTransport(`wss://${location.host}${SYNC_ENDPOINT}`, {
  // called on every connection attempt, so reconnects carry a fresh token
  auth: () => getAccessToken(),
});
