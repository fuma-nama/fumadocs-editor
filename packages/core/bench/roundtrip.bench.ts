import { bench, describe } from "vitest";
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
const single = readFileSync(path.join(dir, "../test/fixtures/kitchen-sink.mdx"), "utf-8");
// ~20× corpus; repeated copies drop ESM lines so imports aren't declared twice
const body = single
  .split("\n")
  .filter((line) => !line.startsWith("import ") && !line.startsWith("export "))
  .join("\n");
const corpus = [single, ...Array(19).fill(body)].join("\n");

const { doc, snapshot } = parseMdxToDoc(corpus);
const schema = getSchema(editorExtensions());
const pmDoc = schema.nodeFromJSON(doc);

const warm = createIncrementalSerializer();
warm(pmDoc, snapshot);

// each iteration needs a block the cache has never seen; structural sharing
// keeps these cheap (every other child is the same node)
const dirtyDocs = Array.from({ length: 10_000 }, (_, i) =>
  pmDoc.copy(
    pmDoc.content.replaceChild(
      1,
      schema.nodeFromJSON({
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: `Edited ${i}` }],
      }),
    ),
  ),
);
let dirtyIndex = 0;

describe("20x kitchen-sink corpus", () => {
  bench("parse", () => {
    parseMdxToDoc(corpus);
  });

  bench("full serialize", () => {
    serializeDocToMdx(pmDoc.toJSON(), snapshot);
  });

  bench("incremental serialize, warm", () => {
    warm(pmDoc, snapshot);
  });

  bench("incremental serialize, one dirty block", () => {
    warm(dirtyDocs[dirtyIndex++ % dirtyDocs.length], snapshot);
  });
});
