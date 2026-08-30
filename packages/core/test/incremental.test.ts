import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSchema } from "@tiptap/core";
import {
  createIncrementalSerializer,
  editorExtensions,
  parseMdxToDoc,
  serializeDocToMdx,
} from "../src";

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(dir, "fixtures", "kitchen-sink.mdx"), "utf-8");

const schema = getSchema(editorExtensions());

test("incremental serializer round-trips a PM doc byte-for-byte", () => {
  const { doc, snapshot } = parseMdxToDoc(source);
  const serialize = createIncrementalSerializer();
  expect(serialize(schema.nodeFromJSON(doc), snapshot)).toBe(source);
});

test("cached blocks stay correct across successive edits", () => {
  const { doc, snapshot } = parseMdxToDoc(source);
  const serialize = createIncrementalSerializer();

  let pmDoc = schema.nodeFromJSON(doc);
  expect(serialize(pmDoc, snapshot)).toBe(source);

  // replace one top-level block; every other child keeps node identity,
  // exercising the per-node cache on the second run
  const index = doc.content!.findIndex((node) => node.type === "heading");
  const edited = schema.nodeFromJSON({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: "Edited heading" }],
  });
  pmDoc = pmDoc.copy(pmDoc.content.replaceChild(index, edited));

  const output = serialize(pmDoc, snapshot);
  expect(output).toContain("# Edited heading");
  // matches the from-scratch serializer exactly
  expect(output).toBe(serializeDocToMdx(pmDoc.toJSON(), snapshot));
  // untouched blocks still come from their original source
  for (const [i, block] of snapshot.blocks.entries()) {
    if (i === index) continue;
    expect(output).toContain(block.source);
  }
});
