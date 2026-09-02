import { useState } from "react";
import { MdxEditor } from "@fumadocs-editor/ui";

export function ScopedEditor({ path }: { path: string }) {
  const [writable, setWritable] = useState(true);
  return (
    <MdxEditor
      sync={{
        path,
        // `writable` is data from the server's scope — wiring it into
        // `editable` is the consumer's decision, made right here
        onOpen: (result) => setWritable(result.writable ?? true),
      }}
      editable={writable}
    />
  );
}
