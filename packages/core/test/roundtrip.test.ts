import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMdxToDoc, serializeDocToMdx } from "../src";

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(dir, "fixtures");

const fixtures = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".mdx") || file.endsWith(".md"))
  .map((file) => [file, readFileSync(path.join(fixturesDir, file), "utf-8")] as const);

describe("fixtures", () => {
  for (const [name, source] of fixtures) {
    test(`zero-diff round trip: ${name}`, () => {
      const { doc, snapshot } = parseMdxToDoc(source);
      expect(serializeDocToMdx(doc, snapshot)).toBe(source);
    });

    test(`normalized serialization is idempotent: ${name}`, () => {
      const { doc } = parseMdxToDoc(source);
      const normalized = serializeDocToMdx(doc);
      const reparsed = parseMdxToDoc(normalized);
      expect(serializeDocToMdx(reparsed.doc)).toBe(normalized);
    });
  }
});

test("editing one block only rewrites that block", () => {
  const source = readFileSync(path.join(fixturesDir, "kitchen-sink.mdx"), "utf-8");
  const { doc, snapshot } = parseMdxToDoc(source);

  // simulate an edit: change the text of the first heading
  const heading = doc.content!.find((node) => node.type === "heading")!;
  heading.content = [{ type: "text", text: "Edited heading" }];

  const output = serializeDocToMdx(doc, snapshot);
  expect(output).toContain("# Edited heading");
  // every other block is untouched
  for (const [index, block] of snapshot.blocks.entries()) {
    if (index === doc.content!.indexOf(heading)) continue;
    expect(output).toContain(block.source);
  }
});

// acceptance test: the whole fumadocs docs corpus must round-trip byte-identical
const corpus = path.resolve(dir, "../../../../fumadocs/apps/docs/content");

describe.skipIf(!existsSync(corpus))("fumadocs docs corpus", () => {
  const files = readdirSync(corpus, { recursive: true, encoding: "utf-8" })
    .filter((file) => file.endsWith(".mdx") || file.endsWith(".md"))
    .map((file) => path.join(corpus, file));

  test(`zero-diff round trip over ${files.length} files`, () => {
    const failures: { file: string; error?: string }[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      try {
        const { doc, snapshot } = parseMdxToDoc(source);
        if (serializeDocToMdx(doc, snapshot) !== source) {
          failures.push({ file: path.relative(corpus, file) });
        }
      } catch (error) {
        failures.push({ file: path.relative(corpus, file), error: String(error) });
      }
    }

    expect(failures).toEqual([]);
  });
});
