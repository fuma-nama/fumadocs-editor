import { Node } from "@tiptap/core";
import { MATH_BLOCK_NODE, MATH_INLINE_NODE } from ".";

/*
 * Inert node definitions, registered unconditionally: the schema stays stable
 * whether or not the dialect is on (the gate lives in SyntaxOptions, at
 * parse/serialize). Not @tiptap/extension-mathematics: it models math as
 * click-to-edit atoms (no in-place source editing) and imports KaTeX
 * statically, which would fold it into the editor-runtime chunk instead of a
 * fetched-on-first-use one.
 */

/**
 * Inline `$x$` math. The TeX source is the editable text content;
 * `delimiter` remembers how many dollar signs the source used (`$$x$$`
 * inline is also valid) so serialization is byte-stable.
 */
export const MathInline = Node.create({
  name: MATH_INLINE_NODE,
  group: "inline",
  inline: true,
  content: "text*",
  marks: "",
  defining: true,
  addAttributes: () => ({ delimiter: { default: 1 } }),
  parseHTML: () => [{ tag: "span[data-math-inline]" }],
  renderHTML() {
    return ["span", { "data-math-inline": "" }, 0];
  },
});

/** Block `$$ … $$` math; `meta` is the text after the opening fence. */
export const MathBlock = Node.create({
  name: MATH_BLOCK_NODE,
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  addAttributes: () => ({ meta: { default: null } }),
  parseHTML: () => [{ tag: "pre[data-math-block]", preserveWhitespace: "full" }],
  renderHTML() {
    return ["pre", { "data-math-block": "" }, ["code", {}, 0]];
  },
});

export const mathNodes = [MathInline, MathBlock];
