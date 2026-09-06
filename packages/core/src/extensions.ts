/**
 * The TipTap layer, for hosts that build their own editor on the schema:
 * the extension kit, the base nodes it lets you replace with node-view
 * versions (`componentNodes`, `mathNodes`), and the schema helpers a keymap
 * or node view needs.
 */
export { editorExtensions } from "./extensions/kit";
export type { EditorExtensionsOptions } from "./extensions/kit";
export type { MdxAttribute } from "./extensions/mdx-nodes";
export { MdxInlineRegion, MdxBlockRegion, componentNodeTypes } from "./components/nodes";
export {
  INLINE_REGION_NODE,
  BLOCK_REGION_NODE,
  isComponent,
  componentTypeName,
  componentRegions,
  emptyComponent,
} from "./components/structure";
export type { ComponentRegion } from "./components/structure";
export { MathInline, MathBlock } from "./syntax/math/nodes";
export { MATH_INLINE_NODE, MATH_BLOCK_NODE } from "./syntax/math";
export { createSyntax } from "./components/spec";
export type {
  ComponentSpec,
  Syntax,
  SyntaxOptions,
  PropField,
  AttributeRegion,
} from "./components/spec";
