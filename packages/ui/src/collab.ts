import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import type { Extensions } from "@tiptap/core";
import type { SyntaxOptions } from "@fumadocs-editor/core/parse";
import { createCollabSession } from "@fumadocs-editor/sync/collab";
import type { CollabLink } from "./editor";
import type { UiComponentSpec } from "./components/spec";

export interface EditorCollab {
  /** Collaboration (Y binding + own-edits undo) and peer carets */
  extensions: Extensions;
  /** resolves once the server's document has landed in the Y.Doc */
  whenSynced: Promise<void>;
  destroy(): void;
}

/**
 * Everything collaborative lives behind this module's dynamic import: yjs,
 * the y binding and both TipTap extensions load only when an editor is
 * given a `collab` prop.
 */
export function startCollab(
  collab: CollabLink,
  components: UiComponentSpec[],
  syntax: SyntaxOptions | undefined,
  onReset: () => void,
): EditorCollab {
  const session = createCollabSession({
    transport: collab.transport,
    path: collab.path,
    components,
    syntax,
    onReset,
  });
  return {
    whenSynced: session.whenSynced,
    destroy: session.destroy,
    extensions: [
      Collaboration.configure({ document: session.doc }),
      CollaborationCaret.configure({
        provider: { awareness: session.awareness },
        user: collab.user,
      }),
    ],
  };
}
