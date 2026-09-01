export { editorExtensions } from "./extensions/kit";
export type { MdxAttribute } from "./extensions/mdx-nodes";
export { parseMdxToDoc } from "./document";
export type { DocSnapshot, ParsedDoc, SnapshotBlock } from "./document";
export { serializeDocToMdx } from "./serialize";
export { createIncrementalSerializer } from "./incremental";
export {
  createSyntax,
  COMPONENT_NODE,
  INLINE_REGION_NODE,
  BLOCK_REGION_NODE,
} from "./components/spec";
export type {
  ComponentSpec,
  Syntax,
  SyntaxOptions,
  PropField,
  AttributeRegion,
} from "./components/spec";
export { admonitionSpec, ADMONITION_TYPES, DIRECTIVE_ADMONITION } from "./syntax/directives";
export { filesFenceSpecs, FENCE_FILES, FENCE_FOLDER, FENCE_FILE } from "./syntax/files";
export { MdxComponent, MdxInlineRegion, MdxBlockRegion } from "./components/nodes";
