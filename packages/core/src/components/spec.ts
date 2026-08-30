import type { JSONContent } from "@tiptap/core";

/**
 * A non-region attribute, edited through the component's props panel rather
 * than as an inline editable region.
 */
export interface PropField {
  name: string;
  label?: string;
  type: "string" | "enum" | "boolean" | "number";
  /** for `type: 'enum'` */
  options?: string[];
  default?: string | number | boolean;
  /** placeholder text for `string` / `number` inputs in the attributes popover */
  placeholder?: string;
  /**
   * Edited in-place by the component's own renderer (e.g. the Callout type,
   * picked from its icon) rather than in the floating props panel. Keeps the
   * attribute documented here while hiding it from the generic panel.
   */
  inline?: boolean;
}

/** A JSX string attribute surfaced as an inline (plain-text) editable region. */
export interface AttributeRegion {
  attribute: string;
  region: string;
  placeholder?: string;
  label?: string;
}

/**
 * Structural description of an MDX component: how its attributes and children
 * map to editable regions and editable props. This is the *content-layer*
 * concern: no rendering. The UI layer extends this with a node renderer.
 */
export interface ComponentSpec {
  /** JSX tag name, e.g. "Callout" */
  name: string;
  /** human label for menus */
  title?: string;
  /** string attributes shown as inline editable regions (e.g. Callout title) */
  attributeRegions?: AttributeRegion[];
  /**
   * Element children become a single block editable region. `fromAttribute`
   * folds a string attribute that renders into the same visual slot as the
   * children (e.g. fumadocs `Card`'s `description`, shown right above the body)
   * into this region so it's edited as body text instead of a separate field;
   * on save the region serializes back as children.
   */
  childrenRegion?: { region: string; placeholder?: string; label?: string; fromAttribute?: string };
  /**
   * Repeated child elements become nested component instances (e.g. Cards →
   * Card). Pass an array to accept more than one child tag: e.g. Files accepts
   * both `File` and `Folder`. Mutually exclusive with `childrenRegion`.
   */
  childComponent?: string | string[];
  /**
   * Treat the children as an editable list: pressing Enter in a child's name
   * inserts a fresh sibling and Backspace in an empty child removes it (a file
   * tree). Off by default: grid/step containers (Cards, Steps, Accordions)
   * keep plain editing, where Enter moves between a component's own regions.
   */
  listLike?: boolean;
  /** non-region attributes, edited via the props panel */
  props?: PropField[];
  /** default document fragment inserted by the slash menu */
  insert?: () => JSONContent;
}

export type ComponentRegistry = Map<string, ComponentSpec>;

export function createRegistry(specs: ComponentSpec[] = []): ComponentRegistry {
  return new Map(specs.map((spec) => [spec.name, spec]));
}

/** The three shared node type names produced for registered components. */
export const COMPONENT_NODE = "mdxComponent";
export const INLINE_REGION_NODE = "mdxInlineRegion";
export const BLOCK_REGION_NODE = "mdxBlockRegion";
