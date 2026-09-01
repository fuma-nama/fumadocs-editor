import { useEffect, useMemo, useState } from "react";
import { MdxEditor, fumadocsUiComponents } from "@fumadocs-editor/ui";
import { SYNC_ENDPOINT, wsTransport } from "@fumadocs-editor/sync";

const transport = wsTransport(`ws://${location.host}${SYNC_ENDPOINT}`);

export function CollabEditor({
  path,
  user,
}: {
  path: string;
  user: { name: string; color: string };
}) {
  const [initialText, setInitialText] = useState<string | null>(null);

  useEffect(() => {
    let open = true;
    void transport.read(path).then((state) => {
      if (open) setInitialText(state.text);
    });
    return () => {
      open = false;
    };
  }, [path]);

  const collab = useMemo(() => ({ transport, path, user }), [path, user]);

  if (initialText == null) return null;
  return (
    <MdxEditor
      key={path}
      defaultValue={initialText}
      components={fumadocsUiComponents}
      collab={collab}
    />
  );
}
