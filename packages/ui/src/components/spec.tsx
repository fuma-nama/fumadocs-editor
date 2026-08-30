import type { ComponentSpec } from "@fumadocs-editor/core";
import type { FC, ReactNode } from "react";

export interface ComponentRenderProps {
  /** plain-string JSX attributes (e.g. Callout `type`) */
  props: Record<string, string>;
  /** the editable regions: render this where content should appear */
  children: ReactNode;
  /** update a string attribute in place (for controls the renderer owns) */
  setProp: (name: string, value: string) => void;
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
}
