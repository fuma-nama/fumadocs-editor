import { useState } from "react";
import { FileTree, MdxEditor, useWorkspace } from "@fumadocs-editor/ui";

export function Workspace() {
  const [path, setPath] = useState("index.mdx");
  const { tree, run } = useWorkspace();
  return (
    <div style={{ display: "flex", gap: 16 }}>
      {tree && <FileTree tree={tree} run={run} active={path} onSelect={setPath} />}
      <MdxEditor sync={{ path }} />
    </div>
  );
}
