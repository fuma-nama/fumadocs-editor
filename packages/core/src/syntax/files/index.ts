import type { ComponentSpec } from "../../components/spec";
import { emptyComponent } from "../../components/structure";

/*
 * fumadocs `remarkMdxFiles` fence: ```files tree listing. Split by pipeline:
 *
 *   index.ts     names, specs
 *   parse.ts     fence value → JSX-shaped tree (null: stays a code block)
 *   serialize.ts fence components → ```files code node
 *
 * Registering the three specs is the gate. No SyntaxOptions flag: the fence
 * is ordinary code-block syntax either way. UI: components/files-fence.tsx.
 *
 * Spec names are not valid JSX, so a fence re-emits fence syntax and
 * `<Files>` stays JSX. Separate specs (not the JSX ones) so fence rows
 * have no props: the format cannot carry attributes.
 */

export const FILES_FENCE_LANG = "files";

export const FENCE_FILES = "```files";
export const FENCE_FOLDER = "```folder";
export const FENCE_FILE = "```file";

const fenceFileSpec: ComponentSpec = {
  name: FENCE_FILE,
  label: "File",
  attributeRegions: [{ attribute: "name", region: "file-name", placeholder: "file name…" }],
  insert: (specs) => emptyComponent(fenceFileSpec, specs),
};

const fenceFolderSpec: ComponentSpec = {
  name: FENCE_FOLDER,
  label: "Folder",
  attributeRegions: [{ attribute: "name", region: "folder-name", placeholder: "folder name…" }],
  childComponent: [FENCE_FILE, FENCE_FOLDER],
  listLike: true,
  insert: (specs) => emptyComponent(fenceFolderSpec, specs),
};

/**
 * No root `insert`: new trees go through JSX `<Files>`. Row specs keep
 * theirs for the listLike keymap.
 */
const filesFenceSpec: ComponentSpec = {
  name: FENCE_FILES,
  label: "Files fence",
  childComponent: [FENCE_FILE, FENCE_FOLDER],
  listLike: true,
};

/** Register all three. Parser needs the full set. */
export const filesFenceSpecs: ComponentSpec[] = [filesFenceSpec, fenceFolderSpec, fenceFileSpec];
