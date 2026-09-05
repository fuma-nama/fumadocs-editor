"use client";
import { filesFenceSpecs as base } from "@fumadocs-editor/core";
import { fileSpec, filesSpec, folderSpec } from "./fumadocs-ui";
import type { UiComponentSpec } from "./spec";

const renderers = [filesSpec, folderSpec, fileSpec];

/**
 * Register all three (spread into `components`) to make ```files fences
 * editable trees; the fence re-emits fence syntax, never JSX.
 */
export const filesFenceSpecs: UiComponentSpec[] = base.map((spec, index) => ({
  ...spec,
  icon: renderers[index].icon,
  regions: renderers[index].regions,
  render: renderers[index].render,
}));
