import type { ComponentSpec } from "../../components/spec";

/*
 * The fumadocs `remarkMdxFiles` fence: a ```files code block whose value is a
 * `tree`-style listing, rendered as `<Files />` on the site. This folder is
 * the whole feature, split by pipeline slice like the other capsules:
 *
 *   index.ts     inert data (names, specs)
 *   parse.ts     fence value → JSX-shaped tree (or null: stays a code block)
 *   serialize.ts fence components → the ```files code node
 *
 * Registering the three specs is the gate — no SyntaxOptions flag, because
 * the fence is ordinary code-block syntax either way (nothing else changes
 * how it parses). The UI slice (components/files-fence.tsx) reuses the real
 * Files/Folder/File renderers.
 *
 * Provenance follows the directives pattern: the spec names are not valid
 * JSX names, so serialization branches on them and a fence-sourced tree can
 * only re-emit fence syntax while `<Files>` stays JSX. They are also
 * separate specs (not the JSX ones) so fence rows offer no props — the
 * fence format cannot carry attributes, and what cannot be written is not
 * editable.
 */

export const FILES_FENCE_LANG = "files";

export const FENCE_FILES = "```files";
export const FENCE_FOLDER = "```folder";
export const FENCE_FILE = "```file";

const entryInsert = (name: string, region: string) => () => ({
  type: "mdxComponent",
  attrs: { name, attributes: [{ type: "mdxJsxAttribute", name: "name", value: "" }] },
  content: [{ type: "mdxInlineRegion", attrs: { region } }],
});

const fenceFileSpec: ComponentSpec = {
  name: FENCE_FILE,
  title: "File",
  attributeRegions: [{ attribute: "name", region: "file-name", placeholder: "file name…" }],
  insert: entryInsert(FENCE_FILE, "file-name"),
};

const fenceFolderSpec: ComponentSpec = {
  name: FENCE_FOLDER,
  title: "Folder",
  attributeRegions: [{ attribute: "name", region: "folder-name", placeholder: "folder name…" }],
  childComponent: [FENCE_FILE, FENCE_FOLDER],
  listLike: true,
  insert: entryInsert(FENCE_FOLDER, "folder-name"),
};

/**
 * No root `insert`: fence trees enter documents by parsing (new trees are
 * authored through the richer JSX `<Files>` insert), so the slash menu stays
 * free of a near-duplicate entry. The row specs keep theirs — the listLike
 * keymap inserts siblings through them.
 */
const filesFenceSpec: ComponentSpec = {
  name: FENCE_FILES,
  title: "Files fence",
  childComponent: [FENCE_FILE, FENCE_FOLDER],
  listLike: true,
};

/** Register all three (the parser requires the full set) to turn ```files fences into editable trees. */
export const filesFenceSpecs: ComponentSpec[] = [filesFenceSpec, fenceFolderSpec, fenceFileSpec];
