import { useEffect, useRef } from "react";
import { MdxEditor, type MdxEditorRef } from "@fumadocs-editor/ui";
import { createFileSession, type FileSession, type SyncClient } from "@fumadocs-editor/core/sync";

// the same wiring `sync` does for you, on a client of your own
export function CustomSession({ client, path }: { client: SyncClient; path: string }) {
  const editorRef = useRef<MdxEditorRef>(null);
  const sessionRef = useRef<FileSession>(null);

  useEffect(() => {
    const session = createFileSession({
      client,
      path,
      document: editorRef.current!,
      onStatus: (status) => console.log(status),
    });
    sessionRef.current = session;
    void session.open();
    return () => session.close();
  }, [client, path]);

  return <MdxEditor ref={editorRef} onChange={() => sessionRef.current?.changed()} />;
}
