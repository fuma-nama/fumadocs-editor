export { editorExtensions, CodeBlockMdx, HeadingMdx, LinkMdx, TableMdx } from "./extensions/kit";
export {
  mdxNodes,
  MdxJsxFlowElement,
  MdxJsxTextElement,
  MdxFlowExpression,
  MdxTextExpression,
  MdxjsEsm,
  Frontmatter,
  VerbatimBlock,
  VerbatimInline,
} from "./extensions/mdx-nodes";
export type {
  MdxAttribute,
  MdxJsxAttribute,
  MdxJsxExpressionAttribute,
} from "./extensions/mdx-nodes";
export {
  mdxComponentNodes,
  MdxComponent,
  MdxInlineRegion,
  MdxBlockRegion,
} from "./components/nodes";
export { mathNodes, MathInline, MathBlock } from "./syntax/math/nodes";
export { MATH_INLINE_NODE, MATH_BLOCK_NODE } from "./syntax/math";
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
