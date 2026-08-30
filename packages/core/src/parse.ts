export { parseMdxToDoc } from "./document";
export type { DocSnapshot, ParsedDoc, SnapshotBlock } from "./document";
export { parseMdx } from "./mdast/parse";
export { blockToNode } from "./mdast/from-mdast";
export { createSyntax } from "./components/spec";
export type {
  ComponentSpec,
  Syntax,
  SyntaxOptions,
  PropField,
  AttributeRegion,
} from "./components/spec";
