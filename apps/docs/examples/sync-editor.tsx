import { useEffect, useRef, useState } from "react";
import { MdxEditor, fumadocsUiComponents, type MdxEditorRef } from "@fumadocs-editor/ui";
import {
  SYNC_ENDPOINT,
  createFileSession,
  wsTransport,
  type FileSession,
  type SessionStatus,
} from "@fumadocs-editor/sync";

const transport = wsTransport(`ws://${location.host}${SYNC_ENDPOINT}`);

export function SyncedEditor({ path }: { path: string }) {
  const editorRef = useRef<MdxEditorRef>(null);
  const sessionRef = useRef<FileSession | null>(null);
  const [initialText, setInitialText] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>("synced");

  useEffect(() => {
    let open = true;
    const session = createFileSession({
      transport,
      path,
      getText: () => editorRef.current?.getMarkdown() ?? "",
      applyRemote: async (text) => (await editorRef.current?.applyExternalMarkdown(text)) ?? [],
      resetToRemote: (text) => void editorRef.current?.setMarkdown(text),
      onStatus: (next) => {
        if (open) setStatus(next);
      },
    });
    sessionRef.current = session;
    void session.open().then((state) => {
      if (open) setInitialText(state.text);
    });
    return () => {
      open = false;
      void session.flush();
      session.close();
      sessionRef.current = null;
    };
  }, [path]);

  if (initialText == null) return null;
  return (
    <MdxEditor
      key={path}
      defaultValue={initialText}
      cacheKey={path}
      components={fumadocsUiComponents}
      onMarkdownChange={() => sessionRef.current?.changed()}
      ref={editorRef}
      sync={{
        status,
        onKeepMine: () => void sessionRef.current?.keepMine(),
        onTakeDisk: () => void sessionRef.current?.takeDisk(),
      }}
    />
  );
}
