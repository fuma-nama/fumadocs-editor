export { editorExtensions, CodeBlockMdx, LinkMdx, TableMdx } from "./extensions/kit";
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
