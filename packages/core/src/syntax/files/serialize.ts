import type { JSONContent } from "@tiptap/core";
import type { Code } from "mdast";
import { FENCE_FILES, FENCE_FOLDER, FILES_FENCE_LANG } from ".";

/*
 * Serialized straight from the ProseMirror JSON (not through the generic
 * component conversion, which would recurse each row into its own code
 * node): a fence component can only ever re-emit ```files syntax. Called for
 * stray rows too: a folder/file dragged out of its tree emits a one-entry
 * fence rather than unparseable `<```file>` JSX.
 */

/** the row's name: its editable region text, or the stored attribute before a region exists */
function entryName(node: JSONContent): string {
  for (const child of node.content ?? []) {
    if (child.type === "mdxInlineRegion") {
      let text = "";
      for (const inline of child.content ?? []) text += inline.text ?? "";
      return text;
    }
  }
  const attrs = node.attrs?.attributes as { name?: string; value?: unknown }[] | undefined;
  const attr = attrs?.find((candidate) => candidate.name === "name");
  return typeof attr?.value === "string" ? attr.value : "";
}

function emitEntry(node: JSONContent, prefix: string, marker: string, lines: string[]) {
  // an empty name still emits its line: dropping it would also drop the
  // subtree's indentation. The markers-only line is skipped on re-parse, so
  // the row only survives a disk round trip once it is named.
  lines.push(prefix + marker + entryName(node));
  if (node.attrs?.name !== FENCE_FOLDER) return;
  const rows = (node.content ?? []).filter((child) => child.type === "mdxComponent");
  const childPrefix = marker === "" ? "" : prefix + (marker === "└── " ? "    " : "│   ");
  rows.forEach((row, index) => {
    emitEntry(row, childPrefix, index === rows.length - 1 ? "└── " : "├── ", lines);
  });
}

export function filesFenceToMdast(node: JSONContent): Code {
  const lines: string[] = [];
  if (node.attrs?.name === FENCE_FILES) {
    // multiple roots have no faithful fence form (fumadocs keeps only the
    // last): emitted as written, and the re-parse falls back to a code block
    for (const row of (node.content ?? []).filter((child) => child.type === "mdxComponent")) {
      emitEntry(row, "", "", lines);
    }
  } else {
    emitEntry(node, "", "", lines);
  }
  return { type: "code", lang: FILES_FENCE_LANG, meta: null, value: lines.join("\n") };
}
