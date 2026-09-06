import type { JSONContent } from "@tiptap/core";
import { DIRECTIVE_ADMONITION } from "../syntax/directives";

/**
 * A non-region attribute, edited in the props panel.
 */
export interface PropField {
  name: string;
  label?: string;
  type: "string" | "enum" | "boolean" | "number" | "expression";
  /** for `type: 'enum'` */
  options?: string[];
  default?: string | number | boolean;
  /** `string` / `number` placeholder in the attributes popover */
  placeholder?: string;
  /**
   * Edited by the component's renderer (e.g. Callout type from its icon),
   * not the floating props panel. Still documented here, hidden from the
   * generic panel.
   */
  inline?: boolean;
}

/** JSX string attribute as an inline (plain-text) region. */
export interface AttributeRegion {
  /** the JSX attribute holding the text, e.g. Callout's `title` */
  attribute: string;
  /** region identifier, unique within the component */
  region: string;
  placeholder?: string;
  label?: string;
}

/**
 * How an MDX component's attributes and children map to regions and props.
 * Content layer only: no rendering. UI extends this with a node renderer.
 *
 * No regions = leaf (e.g. GithubInfo): props only.
 */
export interface ComponentSpec {
  /** JSX tag name, e.g. "Callout" */
  name: string;
  /** human-readable name shown in menus; defaults to `name` */
  label?: string;
  /** string attributes shown as inline editable regions (e.g. Callout title) */
  attributeRegions?: AttributeRegion[];
  /**
   * Element *text content* as an inline region, e.g. fumadocs
   * `<include>./path.mdx</include>`. Mutually exclusive with
   * `childrenRegion` / `childComponent`.
   */
  contentRegion?: { region: string; placeholder?: string; label?: string };
  /**
   * Children as one block region. `fromAttribute` folds a string attribute
   * that renders in the same slot (e.g. Card `description`) into this
   * region. On save the region serializes as children.
   */
  childrenRegion?: { region: string; placeholder?: string; label?: string; fromAttribute?: string };
  /**
   * Repeated child elements as nested instances (Cards → Card). Array to
   * accept more than one tag (Files: `File` and `Folder`). Mutually
   * exclusive with `childrenRegion`.
   */
  childComponent?: string | string[];
  /**
   * Children as an editable list: Enter in a child's name inserts a sibling,
   * Backspace in an empty child removes it. Off by default (Cards, Steps,
   * Accordions keep region-to-region Enter).
   */
  listLike?: boolean;
  /**
   * Parent attribute derived from children: string-array expression edited
   * as an inline region on each child, rebuilt on save (Tabs `items`).
   * Requires `childComponent`.
   */
  itemsAttribute?: { attribute: string; childRegion: string; placeholder?: string };
  /** non-region attributes, edited via the props panel */
  props?: PropField[];
  /** slash-menu default fragment; build it with `emptyComponent` */
  insert?: (specs: ReadonlyMap<string, ComponentSpec>) => JSONContent;
}

/**
 * Parse-level feature switches. Unknown constructs still round-trip
 * byte-for-byte. Disabling a feature only stops it being structurally
 * editable.
 */
export interface SyntaxOptions {
  /**
   * Parse fumadocs heading suffixes (`## Title [#custom-id]`, `[!toc]`,
   * `[toc]`) as heading attributes, not literal text. Default true.
   */
  headingSuffixes?: boolean;
  /**
   * remark-directive: `:::type[Title]` as editable components
   * (`syntax/directives`). Off by default; changes how `:`-directive-shaped
   * text parses. Unknown directives stay verbatim. Defaults true when the
   * admonition spec is registered.
   */
  directives?: boolean;
  /**
   * remark-math: `$x$` / `$$…$$` as editable nodes (`syntax/math`). Off by
   * default; changes how `$`-delimited text parses.
   */
  math?: boolean;
}

/**
 * Registered MDX components plus parse-level switches. Drives parse,
 * serialize, and (with renderers) the UI.
 */
export interface Syntax {
  components: Map<string, ComponentSpec>;
  options: SyntaxOptions;
}

/**
 * Build the {@link Syntax} used to parse and serialize. Registering the
 * admonition spec defaults `directives` on.
 */
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

/**
 * Data half of a spec: what parse/serialize consult. Sent to the collab
 * server. Editor fields (`insert`, UI renderers) stay off the wire. Keep
 * in step with {@link ComponentSpec}.
 */
export function componentSpecData(spec: ComponentSpec): ComponentSpec {
  const {
    name,
    label,
    attributeRegions,
    contentRegion,
    childrenRegion,
    childComponent,
    listLike,
    itemsAttribute,
    props,
  } = spec;
  return {
    name,
    label,
    attributeRegions,
    contentRegion,
    childrenRegion,
    childComponent,
    listLike,
    itemsAttribute,
    props,
  };
}
