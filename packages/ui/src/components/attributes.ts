import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { MdxAttribute } from "@fumadocs-editor/core";

/**
 * Write a component's attributes without losing a NodeSelection on it:
 * `setNodeMarkup` fully replaces a CHILDLESS node (there is no gap to
 * preserve), which degrades the NodeSelection to a text selection. The
 * panel anchored to it would unmount after the first keystroke.
 */
export function setComponentAttributes(
  editor: Editor,
  pos: number,
  attributes: MdxAttribute[],
): void {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, attributes });
  if (state.selection instanceof NodeSelection && state.selection.from === pos) {
    tr.setSelection(NodeSelection.create(tr.doc, pos));
  }
  editor.view.dispatch(tr);
}

export function updateAtomAttributes(
  editor: Editor,
  type: string,
  attrs: Record<string, unknown>,
): void {
  const selection = editor.state.selection;
  const chain = editor.chain().updateAttributes(type, attrs);
  if (selection instanceof NodeSelection) {
    chain.command(({ tr }) => {
      const at = tr.mapping.map(selection.from, -1);
      if (tr.doc.nodeAt(at)) tr.setSelection(NodeSelection.create(tr.doc, at));
      return true;
    });
  }
  chain.run();
}
