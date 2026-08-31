import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admonitionSpec, createSyntax, parseMdxToDoc, serializeDocToMdx } from "../src";

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

test("soft line wraps parse as spaces, not literal newlines", () => {
  // a "\n" left in a text node renders as a line break under pre-wrap, and
  // the editor's DOM read-back would then upgrade it to a hardBreak (`\`)
  const { doc, snapshot } = parseMdxToDoc("one line\nwrapped soft\n");
  const paragraph = doc.content!.find((node) => node.type === "paragraph")!;
  expect(paragraph.content).toEqual([{ type: "text", text: "one line wrapped soft" }]);
  // the untouched block still round-trips with its original wrap
  expect(serializeDocToMdx(doc, snapshot)).toBe("one line\nwrapped soft\n");
});

test("editing one block only rewrites that block", () => {
  const source = readFileSync(path.join(fixturesDir, "kitchen-sink.mdx"), "utf-8");
  const { doc, snapshot } = parseMdxToDoc(source);

  // simulate an edit on a clone: change the text of the first heading
  const edited = structuredClone(doc);
  const heading = edited.content!.find((node) => node.type === "heading")!;
  heading.content = [{ type: "text", text: "Edited heading" }];

  const output = serializeDocToMdx(edited, snapshot);
  expect(output).toContain("# Edited heading");
  // every other block is untouched
  for (const [index, block] of snapshot.blocks.entries()) {
    if (index === edited.content!.indexOf(heading)) continue;
    expect(output).toContain(block.source);
  }
});

// acceptance test: the whole fumadocs docs corpus must round-trip byte-identical
const corpus = path.resolve(dir, "../../../../fumadocs/apps/docs/content");

describe.skipIf(!existsSync(corpus))("fumadocs docs corpus", () => {
  const files = readdirSync(corpus, { recursive: true, encoding: "utf-8" })
    .filter((file) => file.endsWith(".mdx") || file.endsWith(".md"))
    .map((file) => path.join(corpus, file));

  // the directive dialect changes how `:`-shaped text parses, so the corpus
  // must hold with it on as well as off
  const syntaxes = [
    ["default", createSyntax()],
    ["directives", createSyntax([admonitionSpec])],
  ] as const;

  for (const [label, syntax] of syntaxes) {
    test(`zero-diff round trip over ${files.length} files (${label})`, () => {
      const failures: { file: string; error?: string }[] = [];

      for (const file of files) {
        const source = readFileSync(file, "utf-8");
        try {
          const { doc, snapshot } = parseMdxToDoc(source, syntax);
          if (serializeDocToMdx(doc, snapshot, syntax) !== source) {
            failures.push({ file: path.relative(corpus, file) });
          }
        } catch (error) {
          failures.push({ file: path.relative(corpus, file), error: String(error) });
        }
      }

      expect(failures).toEqual([]);
    });
  }
});
