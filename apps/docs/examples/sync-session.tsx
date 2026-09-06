import { useEffect, useRef } from "react";
import { MdxEditor, type MdxEditorRef } from "@fumadocs-editor/ui";
import {
  createFileSession,
  type FileSession,
  type SyncTransport,
} from "@fumadocs-editor/core/sync";

// the same wiring `sync` does for you, on a transport of your own
export function CustomSession({ transport, path }: { transport: SyncTransport; path: string }) {
  const editorRef = useRef<MdxEditorRef>(null);
  const sessionRef = useRef<FileSession>(null);

  useEffect(() => {
    const session = createFileSession({
      transport,
      path,
      document: editorRef.current!,
      onStatus: (status) => console.log(status),
    });
    sessionRef.current = session;
    void session.open();
    return () => session.close();
  }, [transport, path]);

  return <MdxEditor ref={editorRef} onChange={() => sessionRef.current?.changed()} />;
}
