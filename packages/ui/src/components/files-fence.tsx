"use client";
import { filesFenceSpecs as base } from "@fumadocs-editor/core";
import { fileSpec, filesSpec, folderSpec } from "./fumadocs-ui";
import type { UiComponentSpec } from "./spec";

/*
 * UI slice of the ```files fence syntax (core/src/syntax/files): the same
 * tree chrome as the JSX Files components — identical renderers, region
 * names and CSS — under the fence spec names, so provenance survives while
 * the editing experience is one and the same.
 */

const renderers = [filesSpec, folderSpec, fileSpec];

/**
 * Register all three (spread into `components`) to make ```files fences
 * editable trees; the fence re-emits fence syntax, never JSX.
 */
export const filesFenceSpecs: UiComponentSpec[] = base.map((spec, index) => ({
  ...spec,
  icon: renderers[index].icon,
  render: renderers[index].render,
}));
