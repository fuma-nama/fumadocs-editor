import { describe, expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import {
  createSyntax,
  editorExtensions,
  emptyComponent,
  isComponent,
  type ComponentSpec,
} from "../src";

const components: ComponentSpec[] = [
  {
    name: "Callout",
    attributeRegions: [{ attribute: "title", region: "title" }],
    childrenRegion: { region: "body" },
  },
  {
    name: "Card",
    attributeRegions: [{ attribute: "title", region: "title" }],
    childrenRegion: { region: "body", fromAttribute: "description" },
  },
  { name: "Cards", childComponent: "Card" },
  {
    name: "Tabs",
    childComponent: "Tab",
    itemsAttribute: { attribute: "items", childRegion: "label" },
  },
  { name: "Tab", childrenRegion: { region: "body" } },
  { name: "Files", childComponent: ["File", "Folder"] },
  {
    name: "Folder",
    attributeRegions: [{ attribute: "name", region: "name" }],
    childComponent: ["File", "Folder"],
  },
  { name: "File", attributeRegions: [{ attribute: "name", region: "name" }] },
  { name: "include", contentRegion: { region: "path" } },
  { name: "GithubInfo" },
];

const schema = getSchema(editorExtensions({ components }));
const { doc, paragraph, mdxInlineRegion, mdxBlockRegion, Callout, Card, Cards, Tab, Folder } =
  schema.nodes;

describe("component node types", () => {
  test("content expressions: regions in order, then children", () => {
    const content = (name: string) => schema.nodes[name].spec.content;
    expect(content("Callout")).toBe("mdxInlineRegion mdxBlockRegion");
    expect(content("Tab")).toBe("mdxInlineRegion mdxBlockRegion");
    expect(content("Tabs")).toBe("Tab*");
    expect(content("Folder")).toBe("mdxInlineRegion (File | Folder)*");
    expect(content("Files")).toBe("(File | Folder)*");
    expect(content("include")).toBe("mdxInlineRegion");
    expect(content("GithubInfo")).toBe("");
  });

  test("every component is in the component group; child-only ones are not blocks", () => {
    expect(isComponent(Callout)).toBe(true);
    expect(isComponent(Card)).toBe(true);
    expect(isComponent(paragraph)).toBe(false);
    expect(doc.contentMatch.matchType(Callout)).toBeTruthy();
    expect(doc.contentMatch.matchType(Cards)).toBeTruthy();
    expect(doc.contentMatch.matchType(Card)).toBeNull();
    expect(doc.contentMatch.matchType(Tab)).toBeNull();
    expect(doc.contentMatch.matchType(Folder)).toBeNull();
  });

  test("Cards accepts only Card", () => {
    expect(Cards.contentMatch.matchType(Card)).toBeTruthy();
    expect(Cards.contentMatch.matchType(paragraph)).toBeNull();
    expect(Cards.contentMatch.matchType(Callout)).toBeNull();
    expect(Cards.contentMatch.matchType(mdxBlockRegion)).toBeNull();
  });

  test("Callout requires exactly its two regions", () => {
    const title = mdxInlineRegion.create();
    const body = mdxBlockRegion.createAndFill()!;
    expect(Callout.validContent(Fragment.from([title, body]))).toBe(true);
    expect(Callout.validContent(Fragment.from([title]))).toBe(false);
    expect(Callout.validContent(Fragment.from([body, title]))).toBe(false);
    expect(Callout.validContent(Fragment.from([title, body, body]))).toBe(false);
  });

  test("a body region refills a paragraph", () => {
    const fill = mdxBlockRegion.contentMatch.fillBefore(Fragment.empty, true)!;
    expect(fill.childCount).toBe(1);
    expect(fill.firstChild!.type).toBe(paragraph);
  });

  test("emptyComponent is valid for every spec", () => {
    const specs = createSyntax(components).components;
    for (const spec of components) {
      expect(() => schema.nodeFromJSON(emptyComponent(spec, specs)).check()).not.toThrow();
    }
  });
});
