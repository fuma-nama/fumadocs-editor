"use client";
import { Megaphone } from "lucide-react";
import { ADMONITION_TYPES, admonitionSpec as base } from "@fumadocs-editor/core";
import { CalloutBox, calloutRegions, type CalloutTypeItem } from "./fumadocs-ui";
import type { ComponentRenderProps, UiComponentSpec } from "./spec";

const ADMONITION_ITEMS: CalloutTypeItem[] = Object.entries(ADMONITION_TYPES).map(
  ([value, visual]) => ({ value, label: value[0].toUpperCase() + value.slice(1), visual }),
);

function Admonition({ props, children, setProp }: ComponentRenderProps) {
  const type = props.type ?? "note";
  return (
    <CalloutBox
      value={type}
      visual={ADMONITION_TYPES[type] ?? "info"}
      items={ADMONITION_ITEMS}
      onChange={(value) => setProp("type", value)}
    >
      {children}
    </CalloutBox>
  );
}

/**
 * Deliberately not part of `fumadocsUiComponents`: registering it is what
 * turns the directive dialect on (see `SyntaxOptions.directives`).
 */
export const admonitionSpec: UiComponentSpec = {
  ...base,
  icon: <Megaphone size={13} />,
  regions: calloutRegions,
  render: Admonition,
};
