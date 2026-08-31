export { parseMdxToDoc } from "./document";
export type { DocSnapshot, ParsedDoc, SnapshotBlock } from "./document";
export { parseMdx } from "./mdast/parse";
export { blockToNode } from "./mdast/from-mdast";
export { createSyntax } from "./components/spec";
export { admonitionSpec, ADMONITION_TYPES, DIRECTIVE_ADMONITION } from "./syntax/directives";
export type {
  ComponentSpec,
  Syntax,
  SyntaxOptions,
  PropField,
  AttributeRegion,
} from "./components/spec";
