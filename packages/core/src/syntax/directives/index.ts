import type { ComponentSpec } from "../../components/spec";
import { emptyComponent } from "../../components/structure";

/*
 * remark-directive: `:::type[Title]` admonitions, gated by
 * `SyntaxOptions.directives`. One file per pipeline slice:
 *
 *   index.ts     name, type map, spec
 *   parse.ts     micromark/mdast + directive → JSX shape
 *   serialize.ts admonition → containerDirective + toMarkdown handlers
 *
 * UI renderer: `@fumadocs-editor/ui` components/admonition.tsx
 */

/**
 * Spec name of the `:::` directive admonition. Not a valid JSX name, so
 * serialization can branch: a directive re-emits `:::`, a `<Callout>`
 * stays JSX.
 */
export const DIRECTIVE_ADMONITION = ":::";

/** remarkDirectiveAdmonition names → Callout type */
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
 * `:::type[Title]` as an editable component: directive name in `type`,
 * label in the `title` region. Register it to turn the dialect on.
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
  insert: (specs) =>
    emptyComponent(admonitionSpec, specs, [
      { type: "mdxJsxAttribute", name: "type", value: "note" },
    ]),
};
