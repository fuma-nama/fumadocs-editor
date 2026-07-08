import type { Root, RootContent } from 'mdast';
import { toMarkdown, type Options } from 'mdast-util-to-markdown';
import { mdxToMarkdown } from 'mdast-util-mdx';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { frontmatterToMarkdown } from 'mdast-util-frontmatter';

/** Custom mdast node emitted for PM verbatim nodes: serialized as-is, no escaping. */
export interface RawNode {
  type: 'raw';
  value: string;
}

const raw = (node: RawNode) => node.value;
raw.peek = (node: RawNode) => node.value.charAt(0) || ' ';

export const stringifyOptions: Options = {
  extensions: [mdxToMarkdown(), gfmToMarkdown(), frontmatterToMarkdown(['yaml'])],
  // 'raw' is our own mdast extension, unknown to the Handlers map
  handlers: { raw } as unknown as Options['handlers'],
  bullet: '-',
  rule: '-',
  emphasis: '*',
  strong: '*',
  fences: true,
};

export function stringifyRoot(root: Root): string {
  return toMarkdown(root, stringifyOptions);
}

/** Stringify a single top-level block, without the trailing newline. */
export function stringifyBlock(block: RootContent): string {
  return stringifyRoot({ type: 'root', children: [block] }).replace(/\n$/, '');
}
