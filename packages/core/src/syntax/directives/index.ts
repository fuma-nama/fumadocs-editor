import type { ComponentSpec } from "../../components/spec";

/*
 * The remark-directive dialect: `:::type[Title]` admonitions, gated by
 * `SyntaxOptions.directives`. This folder is the whole feature — each file is
 * one pipeline's slice, so no chunk imports another layer's dependencies:
 *
 *   index.ts     inert data (name, type map, spec) — importable from anywhere
 *   parse.ts     micromark/mdast extensions + directive → JSX-shape reshaping
 *   serialize.ts admonition → containerDirective + the toMarkdown handlers
 *
 * The UI renderer lives in `@fumadocs-editor/ui` (components/admonition.tsx),
 * mirroring the Callout per the renderer-separation decision.
 */

/**
 * Spec name of the `:::` directive admonition. Not a valid JSX name, so it can
 * never collide with a real component — and serialization branches on it, so a
 * directive-sourced admonition re-emits `:::` syntax, never JSX (and a
 * `<Callout>` never becomes a directive).
 */
export const DIRECTIVE_ADMONITION = ":::";

/**
 * Directive names fumadocs' `remarkDirectiveAdmonition` accepts, mapped to
 * the Callout type each renders as.
 */
export const ADMONITION_TYPES: Record<string, string> = {
  note: "info",
  tip: "info",
  info: "info",
  warn: "warning",
  warning: "warning",
  danger: "error",
  success: "success",
};

/**
 * The `:::type[Title]` admonition as an editable component: the directive name
 * is stored as the `type` attribute, the label as the `title` region. Register
 * it (UI layers add a renderer) to turn the dialect on.
 */
export const admonitionSpec: ComponentSpec = {
  name: DIRECTIVE_ADMONITION,
  label: "Admonition",
  attributeRegions: [{ attribute: "title", region: "title", placeholder: "Title…" }],
  childrenRegion: { region: "body", placeholder: "Write the admonition…" },
  props: [
    {
      name: "type",
      label: "Type",
      type: "enum",
      options: Object.keys(ADMONITION_TYPES),
      default: "note",
      inline: true,
    },
  ],
  insert: () => ({
    type: "mdxComponent",
    attrs: {
      name: DIRECTIVE_ADMONITION,
      attributes: [{ type: "mdxJsxAttribute", name: "type", value: "note" }],
    },
    content: [
      { type: "mdxInlineRegion", attrs: { region: "title" } },
      { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
    ],
  }),
};
