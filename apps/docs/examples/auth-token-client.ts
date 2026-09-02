import { wsTransport } from "@fumadocs-editor/sync";

declare function getAccessToken(): Promise<string>;

export const transport = wsTransport({
  // called on every connection attempt, so reconnects carry a fresh token
  auth: () => getAccessToken(),
});
