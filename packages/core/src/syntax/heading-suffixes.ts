import type { JSONContent } from "@tiptap/core";
import type { PhrasingContent } from "mdast";

/*
 * Fumadocs heading suffixes — `## Title [#custom-id]`, `[!toc]`, `[toc]` —
 * gated by `SyntaxOptions.headingSuffixes` (default on). Both halves live
 * here: the file is dependency-free, so the parse and serialize chunks can
 * share it without folding into each other.
 */

/**
 * Extract trailing suffixes from a heading's last text node into `attrs`
 * (`anchor`, `toc`), trimming the suffix text away. Mutates both.
 */
export function extractHeadingSuffixes(content: JSONContent[], attrs: Record<string, unknown>) {
  const last = content[content.length - 1];
  if (last?.type !== "text" || last.marks) return;
  let text = last.text ?? "";
  const anchor = /\s*\[#([^\]]+?)\]\s*$/.exec(text);
  if (anchor) {
    attrs.anchor = anchor[1];
    text = text.slice(0, anchor.index);
  }
  if (text.includes("[!toc]")) {
    attrs.toc = "hide";
    text = text.replace("[!toc]", "");
  } else if (text.includes("[toc]")) {
    attrs.toc = "only";
    text = text.replace("[toc]", "");
  }
  text = text.replace(/\s+$/, "");
  if (text) content[content.length - 1] = { ...last, text };
  else if (attrs.anchor != null || attrs.toc != null) content.pop();
}

/** Append the serialized suffixes for a heading's attrs to its children. */
export function appendHeadingSuffixes(attrs: JSONContent["attrs"], children: PhrasingContent[]) {
  // suffix order matters on the fumadocs side: `[#id]` must come last
  let suffix = "";
  if (attrs?.toc === "hide") suffix += " [!toc]";
  else if (attrs?.toc === "only") suffix += " [toc]";
  if (attrs?.anchor) suffix += ` [#${String(attrs.anchor)}]`;
  if (!suffix) return;
  // raw, not text: the serializer would escape the brackets
  children.push({
    type: "raw",
    value: children.length > 0 ? suffix : suffix.trimStart(),
  } as unknown as PhrasingContent);
}
