import { useState } from "react";
import { MdxEditor } from "@fumadocs-editor/ui";

export function ScopedEditor({ path }: { path: string }) {
  const [writable, setWritable] = useState(true);
  return (
    <MdxEditor
      sync={{
        path,
        onOpen: (result) => setWritable(result.writable),
      }}
      editable={writable}
    />
  );
}
