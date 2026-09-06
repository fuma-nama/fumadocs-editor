import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { createSyntax, parseMdxToDoc, serializeDocToMdx, type ComponentSpec } from "../src";

const tabSpec: ComponentSpec = {
  name: "Tab",
  childrenRegion: { region: "body" },
};

const tabsSpec: ComponentSpec = {
  name: "Tabs",
  childComponent: "Tab",
  listLike: true,
  itemsAttribute: { attribute: "items", childRegion: "label" },
  props: [{ name: "groupId", type: "string" }],
};

const includeSpec: ComponentSpec = {
  name: "include",
  contentRegion: { region: "path" },
  props: [
    { name: "lang", type: "string" },
    { name: "cwd", type: "boolean" },
  ],
};

const githubInfoSpec: ComponentSpec = {
  name: "GithubInfo",
  props: [
    { name: "owner", type: "string" },
    { name: "repo", type: "string" },
  ],
};

const syntax = createSyntax([tabsSpec, tabSpec, includeSpec, githubInfoSpec]);

function find(node: JSONContent, type: string): JSONContent | undefined {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = find(child, type);
    if (found) return found;
  }
  return undefined;
}

describe("itemsAttribute (Tabs)", () => {
  const source = `<Tabs items={["First", "Second"]} groupId="demo">
  <Tab>One.</Tab>
  <Tab>Two.</Tab>
</Tabs>
`;

  test("items become per-child label regions; the attr is dropped from editing", () => {
    const { doc } = parseMdxToDoc(source, syntax);
    const tabs = find(doc, "Tabs")!;
    const children = tabs.content!;
    expect(children.map((c) => c.type)).toEqual(["Tab", "Tab"]);
    // the derived label region comes first, then the Tab's own body region
    expect(children[0].content![0].content?.[0].text).toBe("First");
    expect(children[1].content![0].content?.[0].text).toBe("Second");
    expect(children[1].content![1].type).toBe("mdxBlockRegion");
    const names = (tabs.attrs!.attributes as { name?: string }[]).map((a) => a.name);
    expect(names).not.toContain("items");
    expect(names).toContain("groupId");
  });

  test("unedited Tabs round-trip byte-for-byte", () => {
    const { doc, snapshot } = parseMdxToDoc(source, syntax);
    expect(serializeDocToMdx(doc, snapshot, syntax)).toBe(source);
  });

  test("an edited label rebuilds the items expression", () => {
    const { doc, snapshot } = parseMdxToDoc(source, syntax);
    const edited = structuredClone(doc);
    const second = find(edited, "Tabs")!.content![1];
    second.content![0].content = [{ type: "text", text: "Renamed" }];

    const out = serializeDocToMdx(edited, snapshot, syntax);
    expect(out).toContain('items={["First", "Renamed"]}');
    expect(out).toContain('groupId="demo"');
  });

  test("a non-literal items expression keeps the element generic", () => {
    const { doc } = parseMdxToDoc("<Tabs items={tabs}>\n  <Tab>One.</Tab>\n</Tabs>\n", syntax);
    expect(doc.content?.[0].type).toBe("mdxJsxFlowElement");
  });

  test("normalized serialization is idempotent", () => {
    const { doc } = parseMdxToDoc(source, syntax);
    const once = serializeDocToMdx(doc, undefined, syntax);
    const twice = serializeDocToMdx(parseMdxToDoc(once, syntax).doc, undefined, syntax);
    expect(twice).toBe(once);
  });
});

describe("contentRegion (include)", () => {
  test("the element text is the editable path region", () => {
    const { doc } = parseMdxToDoc("<include>./shared/setup.mdx</include>\n", syntax);
    const component = find(doc, "include")!;
    expect(component.content![0].content?.[0].text).toBe("./shared/setup.mdx");
  });

  test("attributes survive alongside the path", () => {
    const source = '<include lang="tsx" cwd>./scripts/build.ts</include>\n';
    const { doc, snapshot } = parseMdxToDoc(source, syntax);
    const component = find(doc, "include")!;
    const names = (component.attrs!.attributes as { name?: string }[]).map((a) => a.name);
    expect(names).toEqual(["lang", "cwd"]);
    expect(serializeDocToMdx(doc, snapshot, syntax)).toBe(source);
  });

  test("an edited path serializes back to the tight inline form", () => {
    const { doc, snapshot } = parseMdxToDoc("<include>./old.mdx</include>\n", syntax);
    const edited = structuredClone(doc);
    find(edited, "include")!.content![0].content = [{ type: "text", text: "./new.mdx" }];
    expect(serializeDocToMdx(edited, snapshot, syntax)).toBe("<include>./new.mdx</include>\n");
  });

  test("the flow form parses too", () => {
    const { doc } = parseMdxToDoc("<include>\n  ./spread/over/lines.mdx\n</include>\n", syntax);
    const component = find(doc, "include")!;
    expect(component.content![0].content?.[0].text?.trim()).toBe("./spread/over/lines.mdx");
  });
});

describe("heading suffixes", () => {
  test("[#id], [!toc] and [toc] parse into attributes, not text", () => {
    const source = "## Install [#setup]\n\n### Internal [!toc]\n\n### Ghost [toc]\n";
    const { doc } = parseMdxToDoc(source, syntax);
    const [a, b, c] = doc.content!;
    expect(a.attrs).toMatchObject({ level: 2, anchor: "setup" });
    expect(a.content?.[0].text).toBe("Install");
    expect(b.attrs).toMatchObject({ toc: "hide" });
    expect(b.content?.[0].text).toBe("Internal");
    expect(c.attrs).toMatchObject({ toc: "only" });
  });

  test("suffixes round-trip byte-for-byte and re-serialize unescaped", () => {
    const source = "## Install [#setup]\n\n# Page title [toc] [#top]\n";
    const { doc, snapshot } = parseMdxToDoc(source, syntax);
    expect(serializeDocToMdx(doc, snapshot, syntax)).toBe(source);
    // normalized (edited) form keeps the exact suffix syntax
    expect(serializeDocToMdx(doc, undefined, syntax)).toBe(source);
  });

  test("headingSuffixes: false leaves the text alone", () => {
    const plain = createSyntax([], { headingSuffixes: false });
    const { doc } = parseMdxToDoc("## Install [#setup]\n", plain);
    expect(doc.content?.[0].content?.[0].text).toBe("Install [#setup]");
    expect(doc.content?.[0].attrs?.anchor ?? null).toBeNull();
  });
});

describe("leaf components", () => {
  test("a props-only component parses with no regions and round-trips", () => {
    const source = '<GithubInfo owner="fuma-nama" repo="fumadocs" />\n';
    const { doc, snapshot } = parseMdxToDoc(source, syntax);
    const component = find(doc, "GithubInfo")!;
    expect(component.content ?? []).toHaveLength(0);
    expect(serializeDocToMdx(doc, snapshot, syntax)).toBe(source);
  });
});
