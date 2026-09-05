import type { Editor } from "@tiptap/core";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { COMPONENT_NODE, type MdxAttribute } from "@fumadocs-editor/core";

/**
 * The component that is node-selected or contains the caret. Panels render
 * from this snapshot. `attributes` must be part of it, or `useEditorState`
 * won't re-render on attribute edits and React resets the controlled
 * inputs' caret on every keystroke.
 */
export function activeComponent(
  state: EditorState,
): { pos: number; name: string; attributes: MdxAttribute[] } | null {
  const selection = state.selection;
  if (selection instanceof NodeSelection) {
    const node = selection.node;
    if (node.type.name !== COMPONENT_NODE) return null;
    return {
      pos: selection.from,
      name: node.attrs.name as string,
      attributes: node.attrs.attributes as MdxAttribute[],
    };
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === COMPONENT_NODE) {
      return {
        pos: $from.before(depth),
        name: node.attrs.name as string,
        attributes: node.attrs.attributes as MdxAttribute[],
      };
    }
  }
  return null;
}

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
