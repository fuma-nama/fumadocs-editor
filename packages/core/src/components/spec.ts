import type { JSONContent } from "@tiptap/core";
import { DIRECTIVE_ADMONITION } from "../syntax/directives";

/**
 * A non-region attribute, edited through the component's props panel rather
 * than as an inline editable region.
 */
export interface PropField {
  name: string;
  label?: string;
  type: "string" | "enum" | "boolean" | "number" | "expression";
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
 *
 * A spec with no regions at all is a leaf component (e.g. GithubInfo): it has
 * no editable content, only props.
 */
export interface ComponentSpec {
  /** JSX tag name, e.g. "Callout" */
  name: string;
  /** human label for menus */
  title?: string;
  /** string attributes shown as inline editable regions (e.g. Callout title) */
  attributeRegions?: AttributeRegion[];
  /**
   * The element's *text content* edited as an inline region — for elements
   * whose payload is their text child, like fumadocs `<include>./path.mdx</include>`.
   * Mutually exclusive with `childrenRegion` / `childComponent`.
   */
  contentRegion?: { region: string; placeholder?: string; label?: string };
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
  /**
   * A parent attribute that is derived data: a string-array expression whose
   * entries are edited as an inline region injected into each child, and
   * rebuilt on save from those regions (fumadocs `Tabs`' `items` holds the
   * labels of its `Tab` children). Requires `childComponent`.
   */
  itemsAttribute?: { attribute: string; childRegion: string; placeholder?: string };
  /** non-region attributes, edited via the props panel */
  props?: PropField[];
  /** default document fragment inserted by the slash menu */
  insert?: () => JSONContent;
}

/**
 * Parse-level feature switches. Everything the syntax does not understand
 * still round-trips byte-for-byte through the verbatim safety net — disabling
 * a feature only means its construct stops being structurally editable.
 */
export interface SyntaxOptions {
  /**
   * Parse fumadocs heading suffixes — `## Title [#custom-id]`, `[!toc]`,
   * `[toc]` — into heading attributes instead of literal text. Default true.
   */
  headingSuffixes?: boolean;
  /**
   * Parse the remark-directive dialect, making `:::type[Title]` admonitions
   * editable components (the `syntax/directives` capsule). Off by default —
   * it is a dialect: enabling it changes how any `:`-directive-shaped text
   * parses (directives the editor doesn't model ride the verbatim fallback).
   * Defaults to true when the admonition spec is registered.
   */
  directives?: boolean;
  /**
   * Parse the remark-math dialect, making `$x$` / `$$…$$` TeX math editable
   * nodes (the `syntax/math` capsule). Off by default — it is a dialect:
   * enabling it changes how any `$`-delimited text parses.
   */
  math?: boolean;
}

/**
 * Everything the editor understands: the registered MDX components plus the
 * parse-level feature switches. One `Syntax` drives parsing, serialization
 * and (with renderers layered on top) the UI.
 */
export interface Syntax {
  components: Map<string, ComponentSpec>;
  options: SyntaxOptions;
}

export function createSyntax(
  components: ComponentSpec[] = [],
  options: SyntaxOptions = {},
): Syntax {
  const map = new Map(components.map((spec) => [spec.name, spec]));
  return {
    components: map,
    options: { ...options, directives: options.directives ?? map.has(DIRECTIVE_ADMONITION) },
  };
}

/** The three shared node type names produced for registered components. */
export const COMPONENT_NODE = "mdxComponent";
export const INLINE_REGION_NODE = "mdxInlineRegion";
export const BLOCK_REGION_NODE = "mdxBlockRegion";
