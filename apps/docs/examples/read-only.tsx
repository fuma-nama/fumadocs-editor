import { useEffect, useState } from "react";
import { MdxEditor, fumadocsUiComponents } from "@fumadocs-editor/ui";
import type { SyncTransport } from "@fumadocs-editor/sync";

export function ScopedEditor({ transport, path }: { transport: SyncTransport; path: string }) {
  const [doc, setDoc] = useState<{ text: string; writable: boolean } | null>(null);

  useEffect(() => {
    let open = true;
    void transport.read(path).then((state) => {
      // `writable` is data from the server's scope — wiring it into
      // `editable` is the consumer's decision, made right here
      if (open) setDoc({ text: state.text, writable: state.writable ?? true });
    });
    return () => {
      open = false;
    };
  }, [transport, path]);

  if (!doc) return null;
  return (
    <MdxEditor
      key={path}
      defaultValue={doc.text}
      components={fumadocsUiComponents}
      editable={doc.writable}
    />
  );
}
