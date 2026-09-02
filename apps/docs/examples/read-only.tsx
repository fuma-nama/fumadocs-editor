import { useState } from "react";
import { MdxEditor } from "@fumadocs-editor/ui";

export function ScopedEditor({ path }: { path: string }) {
  const [writable, setWritable] = useState(true);
  return (
    <MdxEditor
      sync={{
        path,
        // `writable` comes from the server's scope. Wire it into `editable` here.
        onOpen: (result) => setWritable(result.writable ?? true),
      }}
      editable={writable}
    />
  );
}
