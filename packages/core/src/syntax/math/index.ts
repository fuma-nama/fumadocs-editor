/*
 * remark-math: `$…$` / `$$…$$`, gated by `SyntaxOptions.math`.
 *
 *   index.ts     node type names
 *   nodes.ts     ProseMirror node types (extensions chunk)
 *   parse.ts     micromark/mdast + math → PM
 *   serialize.ts PM → mdast math + toMarkdown handlers
 *
 * UI: `@fumadocs-editor/ui` components/math.tsx. KaTeX is a lazy chunk.
 */

/** Inline `$x$` math. Editable source with a rendered preview in the UI. */
export const MATH_INLINE_NODE = "mathInline";

/** Block `$$ … $$` math. */
export const MATH_BLOCK_NODE = "mathBlock";
