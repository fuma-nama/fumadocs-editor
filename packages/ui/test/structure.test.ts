// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { makeEditor } from "./helpers";

const FILES = `<Files>
  <Folder name="app">
    <File name="page.tsx" />
  </Folder>
  <File name="package.json" />
</Files>
`;

function findNode(editor: Editor, match: (node: PMNode) => boolean) {
  let found: { node: PMNode; pos: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!found && match(node)) found = { node, pos };
    return !found;
  });
  if (!found) throw new Error("node not found");
  return found as { node: PMNode; pos: number };
}

describe("structure guard", () => {
  test("a deleted file-name region grows back empty", () => {
    const { editor, serialize } = makeEditor(FILES);
    const region = findNode(
      editor,
      (node) => node.type.name === "mdxInlineRegion" && node.textContent === "page.tsx",
    );
    editor.view.dispatch(editor.state.tr.delete(region.pos, region.pos + region.node.nodeSize));

    const file = findNode(
      editor,
      (node) => node.type.name === "mdxComponent" && node.attrs.name === "File",
    );
    expect(file.node.childCount).toBe(1);
    expect(file.node.firstChild!.type.name).toBe("mdxInlineRegion");
    expect(file.node.firstChild!.attrs.region).toBe("file-name");
    expect(file.node.firstChild!.textContent).toBe("");
    expect(serialize()).toContain('<File name="" />');
  });

  test("a region with a lost name is retagged from the spec", () => {
    const { editor } = makeEditor(FILES);
    const region = findNode(
      editor,
      (node) => node.type.name === "mdxInlineRegion" && node.textContent === "page.tsx",
    );
    editor.view.dispatch(editor.state.tr.setNodeMarkup(region.pos, undefined, { region: null }));
    const healed = findNode(
      editor,
      (node) => node.type.name === "mdxInlineRegion" && node.textContent === "page.tsx",
    );
    expect(healed.node.attrs.region).toBe("file-name");
  });

  test("a deleted Callout body grows back with an editable paragraph", () => {
    const { editor } = makeEditor(`<Callout type="info" title="Heads up">
  Body text.
</Callout>
`);
    const body = findNode(editor, (node) => node.type.name === "mdxBlockRegion");
    editor.view.dispatch(editor.state.tr.delete(body.pos, body.pos + body.node.nodeSize));

    const healed = findNode(editor, (node) => node.type.name === "mdxBlockRegion");
    expect(healed.node.attrs.region).toBe("body");
    expect(healed.node.childCount).toBe(1);
    expect(healed.node.firstChild!.type.name).toBe("paragraph");
    // the callout keeps its region order: title first, body second
    const callout = findNode(editor, (node) => node.type.name === "mdxComponent");
    expect(callout.node.child(0).attrs.region).toBe("title");
    expect(callout.node.child(1).attrs.region).toBe("body");
  });

  test("healing is undone together with the damage", () => {
    const { editor, serialize } = makeEditor(FILES);
    const region = findNode(
      editor,
      (node) => node.type.name === "mdxInlineRegion" && node.textContent === "page.tsx",
    );
    editor.view.dispatch(editor.state.tr.delete(region.pos, region.pos + region.node.nodeSize));
    editor.commands.undo();
    expect(serialize()).toBe(FILES);
  });
});

describe("empty containers", () => {
  test("deleting the last row deletes the Files component too", () => {
    const { editor, serialize } = makeEditor(`<Files>
  <File name="" />
</Files>

After.
`);
    const region = findNode(editor, (node) => node.type.name === "mdxInlineRegion");
    editor.commands.setTextSelection(region.pos + 1);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
    );
    const out = serialize();
    expect(out).not.toContain("<Files");
    expect(out).toContain("After.");
  });

  test("a container emptied by direct deletes goes with its last child", () => {
    const { editor, serialize } = makeEditor(`<Cards>
  <Card title="One" href="/a">A.</Card>
</Cards>

After.
`);
    const card = findNode(
      editor,
      (node) => node.type.name === "mdxComponent" && node.attrs.name === "Card",
    );
    editor.view.dispatch(editor.state.tr.delete(card.pos, card.pos + card.node.nodeSize));
    const out = serialize();
    expect(out).not.toContain("<Cards");
    expect(out).toContain("After.");
  });

  test("removing the only block leaves an editable paragraph", () => {
    const { editor } = makeEditor(`<Files>
  <File name="" />
</Files>
`);
    const file = findNode(
      editor,
      (node) => node.type.name === "mdxComponent" && node.attrs.name === "File",
    );
    editor.view.dispatch(editor.state.tr.delete(file.pos, file.pos + file.node.nodeSize));
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
  });
});
