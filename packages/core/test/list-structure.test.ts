import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { createSyntax, parseMdxToDoc, serializeDocToMdx } from "../src";

const syntax = createSyntax();

/** The document's node types, nested, without text: its structure. */
function structure(node: JSONContent): unknown {
  if (node.type === "text") return "text";
  return node.content ? { [node.type ?? "?"]: node.content.map(structure) } : node.type;
}

/** The structure of `source`, and of `source` after normalized serialization (as an edited block is written). */
function structures(source: string): { before: unknown; after: unknown } {
  const { doc } = parseMdxToDoc(source, syntax);
  const canonical = serializeDocToMdx(doc, undefined, syntax);
  return { before: structure(doc), after: structure(parseMdxToDoc(canonical, syntax).doc) };
}

describe("list structure under normalized serialization", () => {
  test("a paragraph after a nested list stays in its item", () => {
    const { before, after } = structures("1. Item\n\n   - a\n   - b\n\n   After the list.\n");
    expect(after).toEqual(before);
  });

  test("an item that starts with a nested list keeps the block after it", () => {
    const { before, after } = structures(
      "1. Item\n2. 1. first\n   2. second\n\n   After the list.\n",
    );
    expect(after).toEqual(before);
  });
});
