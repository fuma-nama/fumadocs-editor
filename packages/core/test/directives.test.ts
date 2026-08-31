import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JSONContent } from "@tiptap/core";
import {
  ADMONITION_TYPES,
  DIRECTIVE_ADMONITION,
  admonitionSpec,
  createSyntax,
  parseMdxToDoc,
  serializeDocToMdx,
  type ComponentSpec,
} from "../src";

const calloutSpec: ComponentSpec = {
  name: "Callout",
  attributeRegions: [{ attribute: "title", region: "title" }],
  childrenRegion: { region: "body" },
  props: [{ name: "type", type: "enum", options: ["info", "warn", "error", "success", "idea"] }],
};

const syntax = createSyntax([admonitionSpec, calloutSpec]);

const fixture = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/directives.mdx"),
  "utf-8",
);

function components(doc: JSONContent): JSONContent[] {
  return (doc.content ?? []).filter((node) => node.type === "mdxComponent");
}

function region(node: JSONContent, type: string, name: string): JSONContent | undefined {
  return (node.content ?? []).find((child) => child.type === type && child.attrs?.region === name);
}

function editBody(node: JSONContent, text: string) {
  region(node, "mdxBlockRegion", "body")!.content = [
    { type: "paragraph", content: [{ type: "text", text }] },
  ];
}

test("registering the admonition spec turns the dialect on", () => {
  expect(syntax.options.directives).toBe(true);
  expect(createSyntax([calloutSpec]).options.directives).toBe(false);
  expect(createSyntax([admonitionSpec], { directives: false }).options.directives).toBe(false);
});

describe("dialect off (default)", () => {
  test("directives stay plain blocks and round-trip byte-for-byte", () => {
    const off = createSyntax([calloutSpec]);
    const { doc, snapshot } = parseMdxToDoc(fixture, off);
    expect(components(doc).map((node) => node.attrs?.name)).toEqual(["Callout"]);
    expect(serializeDocToMdx(doc, snapshot, off)).toBe(fixture);
  });
});

describe("dialect on", () => {
  test("the fixture round-trips byte-for-byte", () => {
    const { doc, snapshot } = parseMdxToDoc(fixture, syntax);
    expect(serializeDocToMdx(doc, snapshot, syntax)).toBe(fixture);
  });

  test("normalized serialization is idempotent", () => {
    const { doc } = parseMdxToDoc(fixture, syntax);
    const once = serializeDocToMdx(doc, undefined, syntax);
    const twice = serializeDocToMdx(parseMdxToDoc(once, syntax).doc, undefined, syntax);
    expect(twice).toBe(once);
  });

  test("known types become admonition components; the rest stay verbatim", () => {
    const { doc } = parseMdxToDoc(fixture, syntax);
    const names = components(doc).map((node) => node.attrs?.name);
    // 5 directives + the JSX Callout; spoiler and the rich label fall back
    expect(names).toEqual([":::", ":::", ":::", ":::", ":::", "Callout"]);
    const verbatim = (doc.content ?? []).filter((node) => node.type === "verbatim");
    expect(verbatim.map((node) => String(node.attrs?.value).split("\n")[0])).toEqual([
      ":::spoiler",
      ":::note[A **rich** label]",
      "::video[Leaf directives stay verbatim]",
    ]);
  });

  test("every alias parses and maps to a Callout type", () => {
    for (const name of Object.keys(ADMONITION_TYPES)) {
      const { doc } = parseMdxToDoc(`:::${name}\nbody\n:::\n`, syntax);
      const [node] = components(doc);
      expect(node.attrs?.name).toBe(DIRECTIVE_ADMONITION);
      expect((node.attrs?.attributes as { value?: unknown }[])[0].value).toBe(name);
    }
  });

  test("label and body become the title and body regions", () => {
    const { doc } = parseMdxToDoc(fixture, syntax);
    const warning = components(doc)[1];
    expect(region(warning, "mdxInlineRegion", "title")?.content?.[0].text).toBe("Watch out");
    expect(region(warning, "mdxBlockRegion", "body")?.content).toHaveLength(2);
  });

  test("an edited admonition re-emits ::: syntax, never JSX", () => {
    const { doc, snapshot } = parseMdxToDoc(fixture, syntax);
    const edited = structuredClone(doc);
    editBody(components(edited)[0], "edited body");
    const out = serializeDocToMdx(edited, snapshot, syntax);
    expect(out).toContain(":::note\nedited body\n:::");
    expect(out).not.toContain("<:::");
  });

  test("an edited JSX Callout re-emits JSX, never :::", () => {
    const { doc, snapshot } = parseMdxToDoc(fixture, syntax);
    const edited = structuredClone(doc);
    const callout = components(edited).find((node) => node.attrs?.name === "Callout")!;
    editBody(callout, "edited jsx");
    const out = serializeDocToMdx(edited, snapshot, syntax);
    expect(out).toContain('<Callout type="info" title="JSX">');
    expect(out).toContain("edited jsx");
    expect(out).not.toContain(":::info[JSX]");
  });

  test("an edited title re-emits the [label] form; type switch renames", () => {
    const { doc, snapshot } = parseMdxToDoc(":::warn[Old]\nbody\n:::\n", syntax);
    const edited = structuredClone(doc);
    const [node] = components(edited);
    region(node, "mdxInlineRegion", "title")!.content = [{ type: "text", text: "New" }];
    const attrs = node.attrs!.attributes as { name: string; value: unknown }[];
    attrs.find((attr) => attr.name === "type")!.value = "danger";
    expect(serializeDocToMdx(edited, snapshot, syntax)).toBe(":::danger[New]\nbody\n:::\n");
  });

  test("directive attributes survive an edit", () => {
    const { doc, snapshot } = parseMdxToDoc(
      ':::info{class="wide" data-x="1"}\nbody\n:::\n',
      syntax,
    );
    const edited = structuredClone(doc);
    editBody(components(edited)[0], "edited");
    expect(serializeDocToMdx(edited, snapshot, syntax)).toBe(
      ':::info{.wide data-x="1"}\nedited\n:::\n',
    );
  });

  test("a nested admonition keeps the outer fence one size larger", () => {
    const { doc, snapshot } = parseMdxToDoc(fixture, syntax);
    const edited = structuredClone(doc);
    const outer = components(edited)[3];
    const body = region(outer, "mdxBlockRegion", "body")!;
    body.content = [
      { type: "paragraph", content: [{ type: "text", text: "edited" }] },
      ...body.content!.filter((node) => node.type === "mdxComponent"),
    ];
    const out = serializeDocToMdx(edited, snapshot, syntax);
    expect(out).toContain("::::danger[Outer]\nedited\n\n:::tip");
    expect(out).toContain(":::\n::::");
  });

  test("an unknown directive nested in a known one bails the whole block", () => {
    const { doc } = parseMdxToDoc("::::note\n:::spoiler\nx\n:::\n::::\n", syntax);
    expect(doc.content?.[0].type).toBe("verbatim");
  });

  test("a directive attribute colliding with type/title storage bails", () => {
    for (const source of [':::note{title="x"}\nbody\n:::\n', ':::note{type="x"}\nbody\n:::\n']) {
      expect(parseMdxToDoc(source, syntax).doc.content?.[0].type).toBe("verbatim");
    }
  });

  test("the insert fragment serializes to a bare :::note", () => {
    const doc: JSONContent = { type: "doc", content: [admonitionSpec.insert!()] };
    expect(serializeDocToMdx(doc, undefined, syntax)).toBe(":::note\n:::\n");
  });

  test("directive-looking text gains escapes only while the dialect is on", () => {
    const source = "a :emoji: mention\n";
    const { doc } = parseMdxToDoc(source, syntax);
    expect(serializeDocToMdx(doc, undefined, syntax)).toBe("a \\:emoji: mention\n");
    const off = createSyntax();
    const plain = parseMdxToDoc(source, off);
    expect(serializeDocToMdx(plain.doc, undefined, off)).toBe(source);
  });
});
