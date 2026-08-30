import { describe, expect, test } from "vitest";
import { parseMdxToDoc, serializeDocToMdx } from "../src";
import { stringifyBlock } from "../src/mdast/stringify";

// `mdast-util-mdx-jsx` serializes JSX flow children with a hard-coded blank
// line between siblings, so an edited `<Files>` tree used to come back as
// `<File name="a" />\n\n<File name="b" />`. Our `mdxJsxFlowElement` override
// collapses those gaps to a single newline, matching fumadocs authoring style.
describe("JSX flow siblings", () => {
  const source = `<Files>
  <Folder name="app">
    <File name="layout.tsx" />
    <File name="page.tsx" />
  </Folder>
  <File name="package.json" />
</Files>
`;

  test("an edited <Files> tree serializes without blank lines between rows", () => {
    const { doc, snapshot } = parseMdxToDoc(source);

    // Rename a nested <File />, forcing the block to be re-serialized instead
    // of emitted verbatim from the snapshot.
    const files = doc.content![0];
    const folder = files.content![0];
    folder.content![0].attrs!.attributes[0].value = "layout.ts";

    const output = serializeDocToMdx(doc, snapshot);

    expect(output).toBe(`<Files>
  <Folder name="app">
    <File name="layout.ts" />
    <File name="page.tsx" />
  </Folder>
  <File name="package.json" />
</Files>
`);
    // no blank line anywhere between two JSX element rows
    expect(output).not.toMatch(/\/>\n\s*\n\s*</);
  });

  test("normalizing (no snapshot) keeps JSX siblings adjacent", () => {
    const { doc } = parseMdxToDoc(source);
    expect(serializeDocToMdx(doc)).toBe(source);
  });

  test("blank lines inside a fenced code block are preserved", () => {
    // A fenced code sample inside a JSX element may itself contain a
    // self-closing tag followed by a blank line and another tag; the collapse
    // pass must not treat that as a JSX-sibling gap.
    const block = {
      type: "mdxJsxFlowElement",
      name: "Tab",
      attributes: [],
      children: [{ type: "code", lang: "html", value: '<img src="x" />\n\n<div>y</div>' }],
    } as never;

    expect(stringifyBlock(block)).toBe(`<Tab>
  \`\`\`html
  <img src="x" />

  <div>y</div>
  \`\`\`
</Tab>`);
  });
});
