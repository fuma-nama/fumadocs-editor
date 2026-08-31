import type { ContainerDirective } from "mdast-util-directive";
import type { MdxJsxAttribute, MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import { ADMONITION_TYPES, DIRECTIVE_ADMONITION } from ".";

// the dialect's parser dependencies, owned here; `parseMdx` enables them when
// `SyntaxOptions.directives` is on
export { directive } from "micromark-extension-directive";
export { directiveFromMarkdown } from "mdast-util-directive";

/** the `[label]` after a directive name, stored as a marked first paragraph */
function directiveLabel(node: ContainerDirective) {
  const head = node.children[0];
  return head?.type === "paragraph" && head.data?.directiveLabel ? head : undefined;
}

/**
 * A container directive the admonition dialect can edit structurally: a name
 * fumadocs knows, a plain-text label (the title region is plain text by
 * construction), no attribute colliding with the `type`/`title` storage slots
 * — and, recursively, the same for every nested container directive: a bailed
 * inner directive would ride verbatim, invisible to the outer fence sizing,
 * and its `:::` would close the re-emitted outer fence early.
 */
function admonitionConvertible(node: ContainerDirective): boolean {
  if (!(node.name in ADMONITION_TYPES)) return false;
  const attributes = node.attributes ?? {};
  if ("type" in attributes || "title" in attributes) return false;
  const label = directiveLabel(node);
  if (label && label.children.some((child) => child.type !== "text")) return false;
  return nestedDirectivesConvertible(node.children);
}

function nestedDirectivesConvertible(nodes: { type: string; children?: unknown[] }[]): boolean {
  for (const node of nodes) {
    if (node.type === "containerDirective") {
      if (!admonitionConvertible(node as ContainerDirective)) return false;
    } else if (node.children && !nestedDirectivesConvertible(node.children as typeof nodes)) {
      return false;
    }
  }
  return true;
}

/**
 * Reshape `:::type[Title]` as a JSX-attribute view of itself — the directive
 * name as `type`, the label as `title`, directive `{…}` attributes riding
 * along — so the generic component conversion builds the regions. Null when
 * the directive can't be edited structurally (kept verbatim in that case).
 */
export function admonitionAsJsx(node: ContainerDirective): MdxJsxFlowElement | null {
  if (!admonitionConvertible(node)) return null;
  const attributes: MdxJsxAttribute[] = [
    { type: "mdxJsxAttribute", name: "type", value: node.name },
  ];
  const label = directiveLabel(node);
  // convertibility guarantees a plain-text label
  const title = label
    ? label.children.map((child) => ("value" in child ? child.value : "")).join("")
    : "";
  if (title) attributes.push({ type: "mdxJsxAttribute", name: "title", value: title });
  for (const [name, value] of Object.entries(node.attributes ?? {})) {
    attributes.push({ type: "mdxJsxAttribute", name, value: value ?? null });
  }
  return {
    type: "mdxJsxFlowElement",
    name: DIRECTIVE_ADMONITION,
    attributes,
    children: label ? node.children.slice(1) : node.children,
  };
}
