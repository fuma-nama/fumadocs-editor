import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JSONContent } from "@tiptap/core";
import { createSyntax, parseMdxToDoc, serializeDocToMdx } from "../src";

const syntax = createSyntax([], { math: true });

// not in the shared fixtures loop: TeX like `{\frac …}` is invalid MDX when
// the dialect is off (braces parse as expressions), so this file only exists
// with `math: true`
const fixture = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/dialects/math.mdx"),
  "utf-8",
);

function inlineMaths(doc: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "mathInline") out.push(node);
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return out;
}

describe("dialect off (default)", () => {
  test("dollars stay plain text", () => {
    const { doc } = parseMdxToDoc("Cost is $5 and $6, and $E = mc^2$.\n");
    expect(inlineMaths(doc)).toEqual([]);
    expect((doc.content ?? []).some((node) => node.type === "mathBlock")).toBe(false);
  });

  test("output is byte-stable (no math escapes)", () => {
    const source = "Cost is $5 and $6.\n";
    const { doc } = parseMdxToDoc(source);
    expect(serializeDocToMdx(doc)).toBe(source);
  });
});

describe("dialect on", () => {
  test("fixture round-trips byte-identical", () => {
    const { doc, snapshot } = parseMdxToDoc(fixture, syntax);
    expect(serializeDocToMdx(doc, snapshot, syntax)).toBe(fixture);
  });

  test("normalized serialization is idempotent", () => {
    const { doc } = parseMdxToDoc(fixture, syntax);
    const normalized = serializeDocToMdx(doc, undefined, syntax);
    const reparsed = parseMdxToDoc(normalized, syntax);
    expect(serializeDocToMdx(reparsed.doc, undefined, syntax)).toBe(normalized);
  });

  test("inline math keeps its delimiter width on re-emit", () => {
    const { doc } = parseMdxToDoc("One $x$ and two $$y$$ dollars.\n", syntax);
    const [single, double] = inlineMaths(doc);
    expect(single.attrs?.delimiter).toBe(1);
    expect(double.attrs?.delimiter).toBe(2);
    expect(serializeDocToMdx(doc, undefined, syntax)).toBe("One $x$ and two $$y$$ dollars.\n");
  });

  test("soft line wraps inside inline math fold to spaces", () => {
    const { doc } = parseMdxToDoc("Wrapped $a +\nb$ math.\n", syntax);
    const [node] = inlineMaths(doc);
    expect(node.content).toEqual([{ type: "text", text: "a + b" }]);
  });

  test("block math keeps value and meta", () => {
    const { doc } = parseMdxToDoc("$$asciimath\nx < y\n$$\n", syntax);
    const block = doc.content!.find((node) => node.type === "mathBlock")!;
    expect(block.attrs?.meta).toBe("asciimath");
    expect(block.content).toEqual([{ type: "text", text: "x < y" }]);
    expect(serializeDocToMdx(doc, undefined, syntax)).toBe("$$asciimath\nx < y\n$$\n");
  });

  test("a dollar-run inside the value grows the emitted delimiters", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mathInline",
              attrs: { delimiter: 1 },
              content: [{ type: "text", text: "a $ b" }],
            },
          ],
        },
      ],
    };
    const out = serializeDocToMdx(doc, undefined, syntax);
    expect(out).toBe("$$a $ b$$\n");
    const reparsed = parseMdxToDoc(out, syntax);
    expect(inlineMaths(reparsed.doc)[0].content).toEqual([{ type: "text", text: "a $ b" }]);
  });

  test("an emptied inline math vanishes from the output", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before " },
            { type: "mathInline", attrs: { delimiter: 1 } },
            { type: "text", text: "after" },
          ],
        },
      ],
    };
    expect(serializeDocToMdx(doc, undefined, syntax)).toBe("before after\n");
  });

  test("prose dollars escape so they re-parse as text", () => {
    const { doc } = parseMdxToDoc("A lone dollar sign $ stays plain text.\n", syntax);
    const normalized = serializeDocToMdx(doc, undefined, syntax);
    expect(normalized).toBe("A lone dollar sign \\$ stays plain text.\n");
    const reparsed = parseMdxToDoc(normalized, syntax);
    expect(inlineMaths(reparsed.doc)).toEqual([]);
    expect(serializeDocToMdx(reparsed.doc, undefined, syntax)).toBe(normalized);
  });

  test("a fresh empty math block normalizes to its own re-parse", () => {
    const doc: JSONContent = { type: "doc", content: [{ type: "mathBlock" }] };
    const out = serializeDocToMdx(doc, undefined, syntax);
    expect(out).toBe("$$\n$$\n");
    const reparsed = parseMdxToDoc(out, syntax);
    expect(serializeDocToMdx(reparsed.doc, undefined, syntax)).toBe(out);
  });
});
