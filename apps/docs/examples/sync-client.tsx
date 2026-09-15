import { createSyncClient, wsTransport } from "@fumadocs-editor/core/sync";
import { MdxEditor } from "@fumadocs-editor/ui";

const client = createSyncClient({
  transport: wsTransport("ws://localhost:3100/sync"),
});

export function Editor({ path }: { path: string }) {
  return <MdxEditor sync={{ client, path }} />;
}
