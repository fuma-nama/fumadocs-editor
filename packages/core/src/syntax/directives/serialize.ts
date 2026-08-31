import type { BlockContent, DefinitionContent } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import type { MdxJsxAttribute, MdxJsxExpressionAttribute } from "mdast-util-mdx-jsx";
import { directiveToMarkdown } from "mdast-util-directive";

const extension = directiveToMarkdown();

/**
 * Always registered in `stringifyOptions` so an admonition node emits `:::`
 * even outside the dialect (e.g. inserted while the flag is off).
 */
export const directiveHandlers = extension.handlers;

/**
 * Joined only when the dialect is on: text that would re-parse as a directive
 * (`:word` in phrasing, `::` at a line start) must be escaped then; without
 * the dialect, those escapes would be noise in everyone else's output.
 */
export const directiveUnsafe = extension.unsafe;

/**
 * An admonition re-emits `:::` directive syntax, never JSX: the directive name
 * comes back out of the `type` attribute, the title becomes the `[label]`
 * paragraph, remaining string attributes become directive `{…}` attributes.
 */
export function admonitionToMdast(
  attributes: (MdxJsxAttribute | MdxJsxExpressionAttribute)[],
  children: (BlockContent | DefinitionContent)[],
): ContainerDirective {
  let name = "note";
  let title = "";
  const directiveAttributes: Record<string, string | null> = {};
  for (const attr of attributes) {
    if (attr.type !== "mdxJsxAttribute") continue;
    const value = attr.value;
    if (value != null && typeof value !== "string") continue;
    if (attr.name === "type") name = value ?? name;
    else if (attr.name === "title") title = value ?? "";
    else directiveAttributes[attr.name] = value ?? null;
  }
  // an empty paragraph (a freshly inserted or emptied body region) has no
  // markdown form; keeping it would emit a stray blank line inside the fences
  children = children.filter((child) => child.type !== "paragraph" || child.children.length > 0);
  if (title) {
    children = [
      {
        type: "paragraph",
        data: { directiveLabel: true },
        children: [{ type: "text", value: title }],
      },
      ...children,
    ];
  }
  return { type: "containerDirective", name, attributes: directiveAttributes, children };
}
