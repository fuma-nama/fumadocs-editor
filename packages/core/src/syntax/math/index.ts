/*
 * The remark-math dialect: `$…$` / `$$…$$` TeX math, gated by
 * `SyntaxOptions.math`. This folder is the whole feature — each file is one
 * pipeline's slice, so no chunk imports another layer's dependencies:
 *
 *   index.ts     inert data (node type names) — importable from anywhere
 *   nodes.ts     the ProseMirror node types (extensions chunk)
 *   parse.ts     micromark/mdast extensions + math → PM node reshaping
 *   serialize.ts PM → mdast math nodes + the toMarkdown handlers
 *
 * The UI slice (KaTeX preview node views) lives in `@fumadocs-editor/ui`
 * (components/math.tsx), with KaTeX itself in a lazy chunk fetched on the
 * first math node actually rendered.
 */

/** Inline `$x$` math. Editable source with a rendered preview in the UI. */
export const MATH_INLINE_NODE = "mathInline";

/** Block `$$ … $$` math. */
export const MATH_BLOCK_NODE = "mathBlock";
