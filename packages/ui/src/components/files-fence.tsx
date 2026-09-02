"use client";
import { filesFenceSpecs as base } from "@fumadocs-editor/core";
import { fileSpec, filesSpec, folderSpec } from "./fumadocs-ui";
import type { UiComponentSpec } from "./spec";

/*
 * UI slice of the ```files fence syntax (core/src/syntax/files): same
 * tree chrome as the JSX Files components (renderers, region names, CSS)
 * under the fence spec names, so provenance survives and editing matches.
 */

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
