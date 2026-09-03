import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { COMPONENT_NODE, INLINE_REGION_NODE } from "@fumadocs-editor/core";
import { crossesRegion, deleteAcrossRegions } from "./keymap";

/** transaction meta set when a leaf component is clicked: the bubble opens
 * that component's menu, since there is nothing in it to type into */
export const OPEN_COMPONENT_MENU = "fdeOpenComponentMenu";

/**
 * The component whose chrome a mouse event landed on. handleClickOn depends
 * on ProseMirror resolving the click to a position inside the component; on
 * fully non-editable chrome the hit test often lands in the gap outside it.
 * The node-view wrapper carries the component, so read it from the DOM.
 */
function componentAt(
  view: EditorView,
  target: EventTarget | null,
): { node: PMNode; pos: number } | null {
  const dom = (target as Element | null)?.closest?.("[data-component]");
  if (!dom || !view.dom.contains(dom)) return null;
  let inside: number;
  try {
    inside = view.posAtDOM(dom, 0);
  } catch {
    return null;
  }
  // posAtDOM of the wrapper resolves just inside the node
  const pos = inside - 1;
  const node = view.state.doc.nodeAt(pos);
  return node?.type.name === COMPONENT_NODE ? { node, pos } : null;
}

/*
 * Caret and selection policy: the caret rests in editable text, a component is
 * selected only by explicit gesture (Escape, Mod-A), and a selected node is
 * never destroyed by a stray keystroke.
 */
export const caretPolicy = Extension.create({
  name: "fdeCaretPolicy",

  // A doc that starts with an atom (frontmatter) makes ProseMirror's initial
  // selection a NodeSelection over it, so the first keystroke after focusing
  // would replace the whole block. Start on the first text position instead.
  // "mount" is the earliest synchronous point with a dispatchable view.
  onBeforeCreate() {
    this.editor.on("mount", ({ editor }) => {
      const selection = editor.state.selection;
      if (selection instanceof NodeSelection && selection.from === 0) {
        const text = Selection.findFrom(editor.state.doc.resolve(0), 1, true);
        if (text) editor.view.dispatch(editor.state.tr.setSelection(text));
      }
    });
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          // typing never replaces a selected component or atom; deleting or
          // Enter-to-drill-in stay explicit gestures
          handleTextInput(view, _from, _to, text) {
            const selection = view.state.selection;
            if (
              selection instanceof NodeSelection &&
              (selection.node.type.name === COMPONENT_NODE || selection.node.isAtom)
            ) {
              return true;
            }
            // type-over of a region-crossing selection: clear it in place
            // (never a structural replace), then type at the caret
            if (crossesRegion(view.state) && deleteAcrossRegions(editor)) {
              editor.view.dispatch(editor.state.tr.insertText(text).scrollIntoView());
              return true;
            }
            return false;
          },
          // same rule for paste: clear per-block, insert the plain text
          handlePaste(view, _event, slice) {
            if (!crossesRegion(view.state) || !deleteAcrossRegions(editor)) return false;
            const text = slice.content.textBetween(0, slice.content.size, "\n");
            if (text) editor.view.dispatch(editor.state.tr.insertText(text).scrollIntoView());
            return true;
          },
          // In a region, a double-click at or past the end of an inline
          // region's text selects the whole name: the default word selection
          // there has no word to grab and spans only structural tokens across
          // the region boundary, an invisible, non-empty selection. On a
          // component's chrome (its icon, rail, padding: anything outside a
          // region) it selects the component.
          handleDoubleClick(view, pos, event) {
            const target = event.target as Element | null;
            if (target?.closest?.("[data-region]")) {
              const $pos = view.state.doc.resolve(pos);
              for (let depth = $pos.depth; depth > 0; depth--) {
                if ($pos.node(depth).type.name !== INLINE_REGION_NODE) continue;
                const start = $pos.start(depth);
                const end = $pos.end(depth);
                if (start === end || $pos.pos < end) return false;
                view.dispatch(
                  view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)),
                );
                return true;
              }
              return false;
            }
            const hit = componentAt(view, target);
            if (!hit) return false;
            view.dispatch(
              view.state.tr.setSelection(NodeSelection.create(view.state.doc, hit.pos)),
            );
            return true;
          },
          // a click on a component's own chrome (padding, rails, icons) places
          // the caret in the nearest editable text instead of node-selecting
          // the whole component
          handleClickOn(view, pos, node, nodePos, _event, direct) {
            if (!direct || node.type.name !== COMPONENT_NODE) return false;
            // a leaf (GithubInfo, a dynamic TypeTable) has nothing to type
            // into: clicking it selects it and surfaces its menu instead
            if (node.childCount === 0) {
              view.dispatch(
                view.state.tr
                  .setSelection(NodeSelection.create(view.state.doc, nodePos))
                  .setMeta(OPEN_COMPONENT_MENU, true),
              );
              return true;
            }
            const end = nodePos + node.nodeSize;
            const inside = Math.min(Math.max(pos, nodePos + 1), end - 1);
            const $inside = view.state.doc.resolve(inside);
            let selection = Selection.findFrom($inside, 1, true);
            if (!selection || selection.from <= nodePos || selection.to >= end) {
              selection = Selection.findFrom($inside, -1, true);
            }
            if (!selection || selection.from <= nodePos || selection.to >= end) return false;
            view.dispatch(view.state.tr.setSelection(selection));
            return true;
          },
          // a click that died on a leaf's chrome still deserves its menu
          handleClick(view, _pos, event) {
            const hit = componentAt(view, event.target);
            if (!hit || hit.node.childCount > 0) return false;
            view.dispatch(
              view.state.tr
                .setSelection(NodeSelection.create(view.state.doc, hit.pos))
                .setMeta(OPEN_COMPONENT_MENU, true),
            );
            return true;
          },
        },
      }),
    ];
  },
});
