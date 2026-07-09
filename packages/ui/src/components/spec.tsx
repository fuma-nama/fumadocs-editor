import type { ComponentSpec } from '@fumadocs-editor/core';
import type { FC, ReactNode } from 'react';

export interface ComponentRenderProps {
  /** plain-string JSX attributes (e.g. Callout `type`) */
  props: Record<string, string>;
  /** the editable regions — render this where content should appear */
  children: ReactNode;
  selected: boolean;
}

/**
 * UI-layer component spec: the structural {@link ComponentSpec} (content layer)
 * plus a node renderer that draws the real component chrome around its editable
 * regions.
 */
export interface UiComponentSpec extends ComponentSpec {
  render: FC<ComponentRenderProps>;
  icon?: ReactNode;
}
