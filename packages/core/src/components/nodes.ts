import { Node } from '@tiptap/core';
import type { MdxAttribute } from '../extensions/mdx-nodes';

/**
 * A registered MDX component instance. Holds the original JSX attributes
 * (so props round-trip losslessly) and, as children, the editable regions
 * (inline/block regions and nested component instances).
 */
export const MdxComponent = Node.create({
  name: 'mdxComponent',
  group: 'block',
  content: '(mdxInlineRegion | mdxBlockRegion | mdxComponent)*',
  defining: true,
  isolating: true,
  selectable: true,
  addAttributes: () => ({
    name: { default: null as string | null },
    attributes: { default: [] as MdxAttribute[] },
  }),
  parseHTML: () => [{ tag: 'div[data-mdx-component]' }],
  renderHTML({ node }) {
    return [
      'div',
      { 'data-mdx-component': '', 'data-component': node.attrs.name ?? 'Component' },
      0,
    ];
  },
});

/**
 * An inline, plain-text editable region backed by a JSX attribute. The backing
 * attribute is a plain string, so the region admits no marks, hard breaks or
 * inline atoms — that also keeps names/titles single-line by construction.
 */
export const MdxInlineRegion = Node.create({
  name: 'mdxInlineRegion',
  content: 'text*',
  marks: '',
  selectable: false,
  defining: true,
  addAttributes: () => ({ region: { default: null as string | null } }),
  parseHTML: () => [{ tag: 'div[data-mdx-region-inline]' }],
  renderHTML({ node }) {
    return ['div', { 'data-mdx-region-inline': '', 'data-region': node.attrs.region ?? '' }, 0];
  },
});

/** A block editable region backed by element children. */
export const MdxBlockRegion = Node.create({
  name: 'mdxBlockRegion',
  content: 'block*',
  selectable: false,
  defining: true,
  addAttributes: () => ({ region: { default: null as string | null } }),
  parseHTML: () => [{ tag: 'div[data-mdx-region-block]' }],
  renderHTML({ node }) {
    return ['div', { 'data-mdx-region-block': '', 'data-region': node.attrs.region ?? '' }, 0];
  },
});

export const mdxComponentNodes = [MdxComponent, MdxInlineRegion, MdxBlockRegion];
