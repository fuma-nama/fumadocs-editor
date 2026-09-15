import { useEffect, useRef, useState } from "react";
import { MdxEditor, type MdxEditorRef } from "@fumadocs-editor/ui";
import type { DocumentStatus, SyncClient, SyncDocument } from "@fumadocs-editor/core/sync";

export function CustomDocument({ client, path }: { client: SyncClient; path: string }) {
  const editorRef = useRef<MdxEditorRef>(null);
  const documentRef = useRef<SyncDocument>(null);
  const [status, setStatus] = useState<DocumentStatus>("synced");

  useEffect(() => {
    const editor = editorRef.current!;
    const doc = client.open(path, { editor });
    documentRef.current = doc;
    doc.opened.then(({ text }) => editor.setMarkdown(text), console.error);
    const stop = doc.subscribe(() => setStatus(doc.status()));
    return () => {
      stop();
      doc.close();
    };
  }, [client, path]);

  return (
    <>
      <p>{status}</p>
      <MdxEditor ref={editorRef} onChange={() => documentRef.current?.changed()} />
    </>
  );
}
