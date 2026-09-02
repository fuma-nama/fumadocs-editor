import { MdxEditor } from "@fumadocs-editor/ui";

export function SyncedEditor({ path }: { path: string }) {
  return <MdxEditor sync={{ path }} />;
}
