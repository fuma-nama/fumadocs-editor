import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { mdxjs } from "micromark-extension-mdxjs";
import { gfm } from "micromark-extension-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { directive, directiveFromMarkdown } from "../syntax/directives/parse";

/**
 * Parse MDX source into mdast with MDX, GFM and YAML frontmatter syntax;
 * `directives` adds the remark-directive dialect.
 */
export function parseMdx(source: string, directives = false): Root {
  const extensions = [mdxjs(), gfm(), frontmatter(["yaml"])];
  const mdastExtensions = [mdxFromMarkdown(), gfmFromMarkdown(), frontmatterFromMarkdown(["yaml"])];
  if (directives) {
    extensions.push(directive());
    mdastExtensions.push(directiveFromMarkdown());
  }
  return fromMarkdown(source, { extensions, mdastExtensions });
}
