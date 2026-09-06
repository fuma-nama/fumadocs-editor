import type { JSONContent } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import type { MdxAttribute } from "../extensions/mdx-nodes";
import type { ComponentSpec } from "./spec";

/** The two region node type names shared by every component. */
export const INLINE_REGION_NODE = "mdxInlineRegion";
export const BLOCK_REGION_NODE = "mdxBlockRegion";

/** Schema group every component node type belongs to. */
export const COMPONENT_GROUP = "component";

/** Whether a node type is a registered component. */
export function isComponent(type: NodeType): boolean {
  return type.isInGroup(COMPONENT_GROUP);
}

/**
 * Node type name of a spec. Content expressions only admit `\w` names, so
 * every other character (the fence and directive specs) becomes `_`.
 */
export function componentTypeName(spec: ComponentSpec): string {
  return spec.name.replace(/\W/g, "_");
}

export function childNames(spec: ComponentSpec): string[] {
  if (spec.childComponent == null) return [];
  return Array.isArray(spec.childComponent) ? spec.childComponent : [spec.childComponent];
}

/** whether some spec lists `spec` as a child: such a component lives only inside its parent */
export function childOnly(spec: ComponentSpec, specs: ReadonlyMap<string, ComponentSpec>): boolean {
  for (const parent of specs.values()) {
    if (childNames(parent).includes(spec.name)) return true;
  }
  return false;
}

/** One editable region of a component, identified by its index in the node's content. */
export interface ComponentRegion {
  region: string;
  kind: "inline" | "block";
  placeholder?: string;
  label?: string;
  /** the JSX string attribute this inline region edits */
  attribute?: string;
  /** the parent's items attribute this label region is derived from */
  derived?: string;
  /** a string attribute folded into this block region on parse */
  fromAttribute?: string;
}

/**
 * The regions of a component in schema order: the label region a parent's
 * `itemsAttribute` derives, then `attributeRegions`, `contentRegion` and
 * `childrenRegion`. Child components follow the regions in the node.
 */
export function componentRegions(
  spec: ComponentSpec,
  specs: ReadonlyMap<string, ComponentSpec>,
): ComponentRegion[] {
  const out: ComponentRegion[] = [];
  for (const parent of specs.values()) {
    if (parent.itemsAttribute && childNames(parent).includes(spec.name)) {
      const { attribute, childRegion, placeholder } = parent.itemsAttribute;
      out.push({ region: childRegion, kind: "inline", placeholder, derived: attribute });
      break;
    }
  }
  for (const region of spec.attributeRegions ?? []) out.push({ ...region, kind: "inline" });
  if (spec.contentRegion) out.push({ ...spec.contentRegion, kind: "inline" });
  if (spec.childrenRegion) out.push({ ...spec.childrenRegion, kind: "block" });
  return out;
}

/** A fresh component node: empty regions (block regions hold one paragraph), no children. */
export function emptyComponent(
  spec: ComponentSpec,
  specs: ReadonlyMap<string, ComponentSpec>,
  attributes: MdxAttribute[] = [],
): JSONContent {
  const content: JSONContent[] = [];
  for (const region of componentRegions(spec, specs)) {
    content.push(
      region.kind === "inline"
        ? { type: INLINE_REGION_NODE }
        : { type: BLOCK_REGION_NODE, content: [{ type: "paragraph" }] },
    );
  }
  return { type: componentTypeName(spec), attrs: { attributes }, content };
}
