import { describe, expect, test } from "vitest";
import { getSchema, type JSONContent } from "@tiptap/core";
import {
  createIncrementalSerializer,
  createSyntax,
  editorExtensions,
  parseMdxToDoc,
  serializeDocToMdx,
} from "../src";

const syntax = createSyntax();
const schema = getSchema(editorExtensions());

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

/** replace the first text node equal to `from` (in place) */
function retext(node: JSONContent, from: string, to: string): boolean {
  if (node.type === "text" && node.text === from) {
    node.text = to;
    return true;
  }
  return (node.content ?? []).some((child) => retext(child, from, to));
}

/**
 * `source` with one text edited, serialized against its snapshot as the editor
 * does: the edited block goes through the live schema (attrs it does not
 * declare are dropped) and is written normalized
 */
function edit(source: string, from: string, to: string): string {
  const parsed = parseMdxToDoc(source, syntax);
  // the snapshot shares the parsed nodes: edit a copy
  const doc = structuredClone(parsed.doc);
  if (!retext(doc, from, to)) throw new Error(`text not found: ${from}`);
  return createIncrementalSerializer(syntax)(schema.nodeFromJSON(doc), parsed.snapshot);
}

describe("loose lists", () => {
  test("an edited loose ordered list stays loose", () => {
    const source =
      "1. First item.\n\n   More about the first.\n\n2. Second item.\n\n   Second paragraph.\n";
    expect(edit(source, "First item.", "First item!")).toBe(
      "1. First item!\n\n   More about the first.\n\n2. Second item.\n\n   Second paragraph.\n",
    );
  });

  test("an edited loose bullet list stays loose", () => {
    expect(edit("- a\n\n- b\n\n- c\n", "b", "B")).toBe("- a\n\n- B\n\n- c\n");
  });

  test("an edited loose task list stays loose", () => {
    expect(edit("- [ ] a\n\n- [x] b\n", "a", "A")).toBe("- [ ] A\n\n- [x] b\n");
  });

  test("items keep their own spread apart from the list's", () => {
    // the list is tight; only the first item has a blank line between its blocks
    expect(edit("- a\n\n  - x\n- b\n- c\n", "c", "C")).toBe("- a\n\n  - x\n- b\n- C\n");
  });

  test("a loose list nested in a tight one stays loose", () => {
    expect(edit("- a\n  - x\n\n  - y\n- b\n", "b", "B")).toBe("- a\n  - x\n\n  - y\n- B\n");
  });

  test("an edited tight list stays tight", () => {
    expect(edit("1. a\n2. b\n   - x\n   - y\n", "a", "A")).toBe("1. A\n2. b\n   - x\n   - y\n");
  });

  test("a list made in the editor is tight", () => {
    const list = schema.nodes.bulletList.create(null, [
      schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text("a"))),
      schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text("b"))),
    ]);
    expect(serializeDocToMdx(schema.nodes.doc.create(null, list).toJSON())).toBe("- a\n- b\n");
  });

  test("an untouched list keeps its source, mixed gaps included", () => {
    const source = "Intro.\n\n- a\n- b\n\n- c\n\n1. one\n\n   more\n2. two\n";
    const { doc, snapshot } = parseMdxToDoc(source, syntax);
    expect(createIncrementalSerializer(syntax)(schema.nodeFromJSON(doc), snapshot)).toBe(source);
    expect(edit(source, "Intro.", "Intro!")).toBe(source.replace("Intro.", "Intro!"));
  });
});
