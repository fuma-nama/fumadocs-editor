import { useEffect, useRef } from "react";
import { MdxEditor, type MdxEditorRef } from "@fumadocs-editor/ui";
import { createFileSession, type SyncTransport } from "@fumadocs-editor/sync";

// the same wiring `sync` does for you, on a transport of your own
export function CustomSession({ transport, path }: { transport: SyncTransport; path: string }) {
  const editorRef = useRef<MdxEditorRef>(null);

  useEffect(() => {
    const session = createFileSession({
      transport,
      path,
      document: editorRef.current!,
      onStatus: (status) => console.log(status),
    });
    void session.open();
    return () => session.close();
  }, [transport, path]);

  return <MdxEditor ref={editorRef} />;
}
