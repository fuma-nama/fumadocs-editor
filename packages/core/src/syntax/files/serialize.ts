import type { JSONContent } from "@tiptap/core";
import type { Code } from "mdast";
import { FILES_FENCE_LANG } from ".";

/*
 * Serialized straight from the ProseMirror JSON (not through the generic
 * component conversion, which would recurse each row into its own code
 * node): a fence component can only ever re-emit ```files syntax.
 */

/** a row's name region, then its child rows */
function emitEntry(row: JSONContent, prefix: string, marker: string, lines: string[]) {
  const [region, ...rows] = row.content ?? [];
  let name = "";
  for (const inline of region?.content ?? []) name += inline.text ?? "";
  // an empty name still emits its line: dropping it would also drop the
  // subtree's indentation. The markers-only line is skipped on re-parse, so
  // the row only survives a disk round trip once it is named.
  lines.push(prefix + marker + name);
  const childPrefix = marker === "" ? "" : prefix + (marker === "└── " ? "    " : "│   ");
  rows.forEach((child, index) => {
    emitEntry(child, childPrefix, index === rows.length - 1 ? "└── " : "├── ", lines);
  });
}

export function filesFenceToMdast(node: JSONContent): Code {
  const lines: string[] = [];
  // multiple roots have no faithful fence form (fumadocs keeps only the
  // last): emitted as written, and the re-parse falls back to a code block
  for (const row of node.content ?? []) emitEntry(row, "", "", lines);
  return { type: "code", lang: FILES_FENCE_LANG, meta: null, value: lines.join("\n") };
}
