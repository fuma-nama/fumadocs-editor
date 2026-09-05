import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import type { Extensions } from "@tiptap/core";
import type { SyntaxOptions } from "@fumadocs-editor/core/parse";
import { createCollabSession } from "@fumadocs-editor/sync/collab";
import type { CollabLink } from "./editor";
import type { UiComponentSpec } from "./components/spec";
import * as stylex from "@stylexjs/stylex";
import { content } from "./styles/content";

export interface EditorCollab {
  extensions: Extensions;
  whenSynced: Promise<void>;
  destroy(): void;
}

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
        render(user) {
          const caret = document.createElement("span");
          caret.className = stylex.props(content.caret).className!;
          caret.style.borderColor = user.color;
          const label = document.createElement("div");
          label.className = stylex.props(content.caretLabel).className!;
          label.style.backgroundColor = user.color;
          label.textContent = user.name;
          caret.append(label);
          return caret;
        },
        selectionRender: (user) => ({
          class: stylex.props(content.caretSelection).className!,
          style: `background-color: ${user.color}70`,
        }),
      }),
    ],
  };
}
