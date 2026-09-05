import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JSONContent } from "@tiptap/core";
import {
  componentTypeName,
  createSyntax,
  filesFenceSpecs,
  parseMdxToDoc,
  serializeDocToMdx,
  type ComponentSpec,
} from "../src";

const [FILES, FOLDER, FILE] = filesFenceSpecs.map(componentTypeName);

const jsxFilesSpecs: ComponentSpec[] = [
  { name: "Files", childComponent: ["File", "Folder"], listLike: true },
  {
    name: "Folder",
    attributeRegions: [{ attribute: "name", region: "folder-name" }],
    childComponent: ["File", "Folder"],
    listLike: true,
  },
  { name: "File", attributeRegions: [{ attribute: "name", region: "file-name" }] },
];

const syntax = createSyntax([...filesFenceSpecs, ...jsxFilesSpecs]);

const fixture = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/files-fence.mdx"),
  "utf-8",
);

const TREE = `\`\`\`files
project
├── src
│   ├── index.js
│   └── utils
│       └── helper.js
├── package.json
└── assets/
\`\`\`
`;

function names(node: JSONContent): unknown {
  const content = node.content ?? [];
  const region = content[0]?.type === "mdxInlineRegion" ? content[0] : undefined;
  const rows = region ? content.slice(1) : content;
  const label = (region?.content ?? []).map((inline) => inline.text).join("");
  return { name: node.type, label: label || undefined, children: rows.map(names) };
}

test("a canonical tree parses into fence components", () => {
  const { doc } = parseMdxToDoc(TREE, syntax);
  const [root] = doc.content!;
  expect(names(root)).toEqual({
    name: FILES,
    label: undefined,
    children: [
      {
        name: FOLDER,
        label: "project",
        children: [
          {
            name: FOLDER,
            label: "src",
            children: [
              { name: FILE, label: "index.js", children: [] },
              {
                name: FOLDER,
                label: "utils",
                children: [{ name: FILE, label: "helper.js", children: [] }],
              },
            ],
          },
          { name: FILE, label: "package.json", children: [] },
          { name: FOLDER, label: "assets/", children: [] },
        ],
      },
    ],
  });
});

test("fixture round-trips byte-identical and idempotent", () => {
  const { doc, snapshot } = parseMdxToDoc(fixture, syntax);
  expect(serializeDocToMdx(doc, snapshot, syntax)).toBe(fixture);
  const normalized = serializeDocToMdx(doc, undefined, syntax);
  const reparsed = parseMdxToDoc(normalized, syntax);
  expect(serializeDocToMdx(reparsed.doc, undefined, syntax)).toBe(normalized);
});

test("a canonical tree re-emits its exact bytes even when normalized", () => {
  const { doc } = parseMdxToDoc(TREE, syntax);
  expect(serializeDocToMdx(doc, undefined, syntax)).toBe(TREE);
});

test("provenance: the fence re-emits fence syntax, JSX stays JSX", () => {
  const source = `${TREE}
<Files>
  <Folder name="app">
    <File name="page.mdx" />
  </Folder>
</Files>
`;
  const { doc } = parseMdxToDoc(source, syntax);
  const edited = structuredClone(doc);
  // rename a row in each tree
  const rename = (node: JSONContent, from: string, to: string): boolean => {
    for (const child of node.content ?? []) {
      const region = child.type === "mdxInlineRegion" ? child : undefined;
      if (region?.content?.[0]?.text === from) {
        region.content = [{ type: "text", text: to }];
        return true;
      }
      if (rename(child, from, to)) return true;
    }
    return false;
  };
  expect(rename(edited.content![0], "package.json", "package.json5")).toBe(true);
  expect(rename(edited.content![1], "page.mdx", "index.mdx")).toBe(true);

  const output = serializeDocToMdx(edited, undefined, syntax);
  expect(output).toContain("├── package.json5");
  expect(output).toContain('<File name="index.mdx" />');
  expect(output).not.toContain("<```");
});

describe("bails to a plain code block", () => {
  const cases: [string, string][] = [
    ["two roots", "one\ntwo"],
    ["no entries", "\n\n"],
    ["tree characters inside a name", "root\n├── weird│name"],
    ["non-canonical indentation", "root\n  ├── two-space"],
    ["an orphaned deep entry", "├── floating"],
  ];
  for (const [label, value] of cases) {
    test(label, () => {
      const source = `\`\`\`files\n${value}\n\`\`\`\n`;
      const { doc, snapshot } = parseMdxToDoc(source, syntax);
      expect(doc.content![0].type).toBe("codeBlock");
      expect(serializeDocToMdx(doc, snapshot, syntax)).toBe(source);
    });
  }
});

test("unregistered specs leave the fence a code block", () => {
  const { doc } = parseMdxToDoc(TREE, createSyntax());
  expect(doc.content![0].type).toBe("codeBlock");
});

test("a file line with children becomes a folder", () => {
  const source = "```files\nroot\n└── src\n    └── a.ts\n```\n";
  const { doc } = parseMdxToDoc(source, syntax);
  const root = (doc.content![0].content ?? [])[0];
  const src = root.content![1];
  expect(src.type).toBe(FOLDER);
});

test("a fresh row insert normalizes to its own re-parse once named", () => {
  // the listLike keymap creates rows via the child specs' inserts
  const row = filesFenceSpecs[2].insert!(syntax.components);
  row.content![0].content = [{ type: "text", text: "page.mdx" }];
  const doc: JSONContent = {
    type: "doc",
    content: [{ type: FILES, attrs: { attributes: [] }, content: [row] }],
  };
  const out = serializeDocToMdx(doc, undefined, syntax);
  expect(out).toBe("```files\npage.mdx\n```\n");
  const reparsed = parseMdxToDoc(out, syntax);
  expect(serializeDocToMdx(reparsed.doc, undefined, syntax)).toBe(out);
});
