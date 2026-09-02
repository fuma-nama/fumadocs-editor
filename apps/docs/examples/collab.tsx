import { MdxEditor } from "@fumadocs-editor/ui";

export function CollabEditor({ path, name }: { path: string; name: string }) {
  return <MdxEditor sync={{ path, collab: { user: { name, color: "#7c3aed" } } }} />;
}
