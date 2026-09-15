import { MdxEditor } from "@fumadocs-editor/ui";

export function SplitEditor({ path }: { path: string }) {
  return (
    <MdxEditor.Root sync={{ path }}>
      <MdxEditor.Status />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <MdxEditor.Visual />
        <MdxEditor.Source />
      </div>
    </MdxEditor.Root>
  );
}
