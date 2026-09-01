import type { JSONContent } from "@tiptap/core";
import type { Math } from "mdast-util-math";
import { MATH_BLOCK_NODE, MATH_INLINE_NODE } from ".";

// the dialect's parser dependencies, owned here; `parseMdx` enables them when
// `SyntaxOptions.math` is on
export { math } from "micromark-extension-math";
export { mathFromMarkdown } from "mdast-util-math";

/**
 * An inline math node from its TeX value and original source text. Soft line
 * wraps in the value fold to spaces (they are whitespace, and a `\n` left in
 * a PM text node would be upgraded to a hard break by DOM read-back); the
 * source's dollar-sign count is kept so `$$x$$` re-emits as written.
 */
export function inlineMathToNode(value: string, source: string): JSONContent {
  const text = value.replace(/ *\n */g, " ");
  return {
    type: MATH_INLINE_NODE,
    attrs: { delimiter: /^\$+/.exec(source)?.[0].length ?? 1 },
    content: text ? [{ type: "text", text }] : undefined,
  };
}

/** A block math node; multi-line TeX stays one text node, like a code block. */
export function mathToNode(node: Math): JSONContent {
  return {
    type: MATH_BLOCK_NODE,
    attrs: { meta: node.meta ?? null },
    content: node.value ? [{ type: "text", text: node.value }] : undefined,
  };
}
