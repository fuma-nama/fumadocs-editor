export { editorExtensions } from "./extensions/kit";
export type { MdxAttribute } from "./extensions/mdx-nodes";
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
