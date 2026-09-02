import type { ComponentSpec } from "@fumadocs-editor/core";
import type { FC, ReactNode } from "react";

export interface ComponentRenderProps {
  /** plain-string JSX attributes (e.g. Callout `type`); expressions appear
   * as their source */
  props: Record<string, string>;
  /** static values of expression props (e.g. TypeTable `type`); a prop
   * missing here is dynamic and only editable as source */
  literals: Record<string, unknown>;
  /** the editable regions: render this where content should appear */
  children: ReactNode;
  /** update a string attribute in place (for controls the renderer owns) */
  setProp: (name: string, value: string) => void;
  /** rewrite an expression prop from a literal value (source is derived);
   * a no-op in the static paint */
  setLiteral: (name: string, value: unknown) => void;
  selected: boolean;
}

/**
 * UI-layer component spec: the structural {@link ComponentSpec} (content layer)
 * plus a node renderer that draws the real component chrome around its editable
 * regions.
 */
export interface UiComponentSpec extends ComponentSpec {
  render: FC<ComponentRenderProps>;
  /** small glyph shown in menus and the component's control bar */
  icon?: ReactNode;
  /** region holding a file path: with a FileProvider it autocompletes in place */
  filePathRegion?: string;
  /**
   * Class name for each editable region's element, by region name. Regions
   * render outside the renderer's tree, so this is how a component styles
   * them (its placeholder position follows `--fde-ph-x` / `--fde-ph-y`).
   */
  regions?: Record<string, string>;
}
