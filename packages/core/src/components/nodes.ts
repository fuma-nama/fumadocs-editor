import { Node } from "@tiptap/core";
import type { MdxAttribute } from "../extensions/mdx-nodes";
import type { ComponentSpec } from "./spec";
import {
  BLOCK_REGION_NODE,
  COMPONENT_GROUP,
  INLINE_REGION_NODE,
  childNames,
  childOnly,
  componentRegions,
  componentTypeName,
} from "./structure";

/**
 * An inline, plain-text editable region backed by a JSX attribute. The backing
 * attribute is a plain string, so the region admits no marks, hard breaks or
 * inline atoms: that also keeps names/titles single-line by construction.
 */
export const MdxInlineRegion = Node.create({
  name: "mdxInlineRegion",
  content: "text*",
  marks: "",
  selectable: false,
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: "div[data-mdx-region-inline]" }],
  renderHTML: () => ["div", { "data-mdx-region-inline": "" }, 0],
});

/**
 * A block editable region backed by element children. Never empty: with a
 * required block ProseMirror refills a paragraph whenever the last one goes,
 * so the region always has a textblock to place the caret in.
 */
export const MdxBlockRegion = Node.create({
  name: "mdxBlockRegion",
  content: "block+",
  selectable: false,
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: "div[data-mdx-region-block]" }],
  renderHTML: () => ["div", { "data-mdx-region-block": "" }, 0],
});

/**
 * One node type per registered component: its regions in
 * {@link componentRegions} order followed by its child components. A spec
 * named in another spec's `childComponent` is not a block; it lives only
 * inside that parent.
 */
export function componentNodeTypes(specs: Iterable<ComponentSpec>): Node[] {
  const map = new Map<string, ComponentSpec>();
  for (const spec of specs) map.set(spec.name, spec);
  const nodes: Node[] = [];
  for (const spec of map.values()) {
    const content: string[] = [];
    for (const region of componentRegions(spec, map)) {
      content.push(region.kind === "inline" ? INLINE_REGION_NODE : BLOCK_REGION_NODE);
    }
    const children: string[] = [];
    for (const name of childNames(spec)) {
      const child = map.get(name);
      if (!child) throw new Error(`${spec.name} lists unregistered child component ${name}`);
      children.push(componentTypeName(child));
    }
    if (children.length === 1) content.push(`${children[0]}*`);
    else if (children.length > 1) content.push(`(${children.join(" | ")})*`);
    nodes.push(
      Node.create({
        name: componentTypeName(spec),
        group: childOnly(spec, map) ? COMPONENT_GROUP : `block ${COMPONENT_GROUP}`,
        content: content.join(" "),
        defining: true,
        isolating: true,
        selectable: true,
        addAttributes: () => ({ attributes: { default: [] as MdxAttribute[] } }),
        parseHTML: () => [{ tag: `div[data-mdx-component="${spec.name}"]` }],
        renderHTML: () => ["div", { "data-mdx-component": spec.name }, 0],
      }),
    );
  }
  return nodes;
}
