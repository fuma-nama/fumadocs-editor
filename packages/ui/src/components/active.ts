import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  JSX_FLOW_ELEMENT,
  JSX_TAG_MARK,
  MATH_BLOCK_NODE,
  MATH_INLINE_NODE,
} from "@fumadocs-editor/core/extensions";

const SOURCE_NODES = new Set([MATH_INLINE_NODE, MATH_BLOCK_NODE, JSX_FLOW_ELEMENT]);

/**
 * `data-active` on every ancestor whose source shows only while the caret is
 * inside: math nodes, JSX elements and textblocks holding inline tags.
 */
export const activeSource = Extension.create({
  name: "fdeActiveSource",
  addProseMirrorPlugins() {
    const tag = this.editor.schema.marks[JSX_TAG_MARK];
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { $from } = state.selection;
            const active: Decoration[] = [];
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (
                SOURCE_NODES.has(node.type.name) ||
                (node.isTextblock && node.rangeHasMark(0, node.content.size, tag))
              ) {
                const pos = $from.before(depth);
                active.push(Decoration.node(pos, pos + node.nodeSize, { "data-active": "" }));
              }
            }
            return active.length === 0
              ? DecorationSet.empty
              : DecorationSet.create(state.doc, active);
          },
        },
      }),
    ];
  },
});
