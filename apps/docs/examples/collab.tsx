import { createSyncClient } from "@fumadocs-editor/core/sync";
import { MdxEditor } from "@fumadocs-editor/ui";

declare const currentUser: { name: string };

const client = createSyncClient({
  collab: { user: { name: currentUser.name, color: "#7c3aed" } },
});

export function CollabEditor({ path }: { path: string }) {
  return <MdxEditor sync={{ client, path }} />;
}
