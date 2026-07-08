import { Node } from '@tiptap/core';

/**
 * JSON-safe mirror of mdast-util-mdx-jsx attribute nodes (estree data stripped),
 * stored on PM node attrs so the doc stays serializable.
 */
export interface MdxJsxAttribute {
  type: 'mdxJsxAttribute';
  name: string;
  value: string | null | { type: 'mdxJsxAttributeValueExpression'; value: string };
}

export interface MdxJsxExpressionAttribute {
  type: 'mdxJsxExpressionAttribute';
  value: string;
}

export type MdxAttribute = MdxJsxAttribute | MdxJsxExpressionAttribute;

const jsxAttrs = {
  name: { default: null as string | null },
  attributes: { default: [] as MdxAttribute[] },
};

export const MdxJsxFlowElement = Node.create({
  name: 'mdxJsxFlowElement',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes: () => jsxAttrs,
  parseHTML: () => [{ tag: 'div[data-mdx-flow]' }],
  renderHTML({ node }) {
    return [
      'div',
      { 'data-mdx-flow': '', 'data-component': node.attrs.name ?? 'Fragment' },
      0,
    ];
  },
});

export const MdxJsxTextElement = Node.create({
  name: 'mdxJsxTextElement',
  group: 'inline',
  inline: true,
  content: 'inline*',
  addAttributes: () => jsxAttrs,
  parseHTML: () => [{ tag: 'span[data-mdx-inline]' }],
  renderHTML({ node }) {
    return [
      'span',
      { 'data-mdx-inline': '', 'data-component': node.attrs.name ?? 'Fragment' },
      0,
    ];
  },
});

function codeAtom(name: string, dataAttr: string) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes: () => ({ value: { default: '' } }),
    parseHTML: () => [{ tag: `pre[${dataAttr}]` }],
    renderHTML({ node }) {
      return ['pre', { [dataAttr]: '' }, ['code', {}, String(node.attrs.value)]];
    },
  });
}

/** an `{expression}` at block level, including MDX comments */
export const MdxFlowExpression = codeAtom('mdxFlowExpression', 'data-mdx-expression');

/** `import`/`export` statements */
export const MdxjsEsm = codeAtom('mdxjsEsm', 'data-mdx-esm');

/** YAML frontmatter */
export const Frontmatter = codeAtom('frontmatter', 'data-mdx-frontmatter');

/** Block-level source the converter doesn't model; preserved byte-for-byte. */
export const VerbatimBlock = codeAtom('verbatim', 'data-mdx-verbatim');

/** `{expression}` inside a paragraph */
export const MdxTextExpression = Node.create({
  name: 'mdxTextExpression',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ value: { default: '' } }),
  parseHTML: () => [{ tag: 'code[data-mdx-expression]' }],
  renderHTML({ node }) {
    return ['code', { 'data-mdx-expression': '' }, `{${String(node.attrs.value)}}`];
  },
});

/** Inline source the converter doesn't model (e.g. footnote references). */
export const VerbatimInline = Node.create({
  name: 'verbatimInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ value: { default: '' } }),
  parseHTML: () => [{ tag: 'code[data-mdx-verbatim]' }],
  renderHTML({ node }) {
    return ['code', { 'data-mdx-verbatim': '' }, String(node.attrs.value)];
  },
});

export const mdxNodes = [
  MdxJsxFlowElement,
  MdxJsxTextElement,
  MdxFlowExpression,
  MdxTextExpression,
  MdxjsEsm,
  Frontmatter,
  VerbatimBlock,
  VerbatimInline,
];
