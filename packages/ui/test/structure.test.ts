// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
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

  test("a surplus body region from a paste dissolves into the real one", () => {
    const { editor, serialize } = makeEditor(`<Callout type="info" title="Heads up">
  Body text.
</Callout>
`);
    // a multi-block paste into the title can arrive wrapped in a fresh
    // region sitting between the title and the real body
    const body = findNode(editor, (node) => node.type.name === "mdxBlockRegion");
    const { schema } = editor.state;
    const extra = schema.nodes.mdxBlockRegion.create({ region: null }, [
      schema.nodes.paragraph.create(null, schema.text("Pasted lead")),
    ]);
    editor.view.dispatch(editor.state.tr.insert(body.pos, extra));

    const callout = findNode(editor, (node) => node.type.name === "mdxComponent");
    expect(callout.node.childCount).toBe(2);
    expect(callout.node.child(0).attrs.region).toBe("title");
    expect(callout.node.child(1).attrs.region).toBe("body");
    expect(callout.node.child(1).textContent).toContain("Pasted lead");
    expect(callout.node.child(1).textContent).toContain("Body text.");
    expect(serialize()).toContain("Pasted lead");
  });

  test("a split title region merges back into one", () => {
    const { editor } = makeEditor(`<Callout type="info" title="Heads up">
  Body text.
</Callout>
`);
    const title = findNode(editor, (node) => node.type.name === "mdxInlineRegion");
    const { schema } = editor.state;
    const extra = schema.nodes.mdxInlineRegion.create({ region: "title" }, [
      schema.text("and more"),
    ]);
    editor.view.dispatch(editor.state.tr.insert(title.pos + title.node.nodeSize, extra));

    const callout = findNode(editor, (node) => node.type.name === "mdxComponent");
    expect(callout.node.childCount).toBe(2);
    expect(callout.node.child(0).attrs.region).toBe("title");
    expect(callout.node.child(0).textContent).toBe("Heads upand more");
    expect(callout.node.child(1).attrs.region).toBe("body");
  });

  test("a stray inline region in a Tab dissolves into its label", () => {
    const { editor, serialize } = makeEditor(`<Tabs items={["One", "Two"]}>
  <Tab value="One">First.</Tab>
  <Tab value="Two">Second.</Tab>
</Tabs>
`);
    // a DOM edit beside the label parses as a fresh, unnamed region
    const label = findNode(
      editor,
      (node) => node.type.name === "mdxInlineRegion" && node.textContent === "One",
    );
    const { schema } = editor.state;
    const stray = schema.nodes.mdxInlineRegion.create({ region: null }, [schema.text("x")]);
    editor.view.dispatch(editor.state.tr.insert(label.pos + label.node.nodeSize, stray));

    const tab = findNode(
      editor,
      (node) => node.type.name === "mdxComponent" && node.attrs.name === "Tab",
    );
    expect(tab.node.childCount).toBe(2);
    expect(tab.node.child(0).attrs.region).toBe("label");
    expect(tab.node.child(0).textContent).toBe("Onex");
    expect(tab.node.child(1).attrs.region).toBe("body");
    expect(serialize()).toContain('items={["Onex", "Two"]}');
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

describe("drop slots", () => {
  const LISTS = `Intro.

- one
- two
  - nested a
  - nested b
- three

Between.

- [ ] task a
- [x] task b

<Callout type="info" title="Heads up">
  Body text.

  - in callout
</Callout>
`;

  async function rig(mdx = LISTS) {
    const { dropSlot, placeDrop } = await import("../src/components/structure");
    const { childOnlyNames, handleBlock } = await import("../src/components/keymap");
    const { caret } = await import("./helpers");
    const { specs } = await import("./helpers");
    const { editor, serialize } = makeEditor(mdx);
    const childOnly = childOnlyNames(specs.values());
    /** the blocks the selection targets, as a drag source */
    const selected = () => {
      const source = handleBlock(editor.state.selection)!;
      return { content: editor.state.doc.slice(source.from, source.to).content, source };
    };
    /** the movable block holding `text` */
    const block = (text: string) => {
      caret(editor, text);
      return selected();
    };
    /** the run of blocks from `start` to `end` */
    const run = (start: string, end: string) => {
      const from = caret(editor, start, "start");
      const to = caret(editor, end);
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
      );
      return selected();
    };
    /** the slot for `dragged` when hovering `text`, in the given half of it */
    const slot = (
      dragged: Fragment,
      text: string,
      before: boolean,
      source = null as null | { from: number; to: number },
    ) => {
      const $pos = editor.state.doc.resolve(caret(editor, text));
      const at = dropSlot(editor.state, $pos, dragged, source, specs, childOnly, () => before);
      if (at == null) return null;
      const $at = editor.state.doc.resolve(at);
      return {
        at,
        parent: $at.parent.type.name,
        after: $at.nodeBefore?.textContent,
        next: $at.nodeAfter?.textContent,
      };
    };
    return { editor, serialize, block, run, slot, placeDrop };
  }

  test("an item lands between items of any bullet or ordered list, nested ones included", async () => {
    const { block, slot } = await rig();
    const one = block("one");
    expect(slot(one.content, "three", false, one.source)).toMatchObject({
      parent: "bulletList",
      after: "three",
    });
    expect(slot(one.content, "nested b", true, one.source)).toMatchObject({
      parent: "bulletList",
      next: "nested b",
    });
    expect(slot(one.content, "in callout", false, one.source)).toMatchObject({
      parent: "bulletList",
      after: "in callout",
    });
  });

  test("the schema rejects an item between paragraphs and in a task list", async () => {
    const { block, slot } = await rig();
    const one = block("one");
    expect(slot(one.content, "Intro.", false, one.source)).toBeNull();
    expect(slot(one.content, "task a", false, one.source)).toBeNull();
    expect(slot(one.content, "Body text.", false, one.source)).toBeNull();
    const task = block("task a");
    expect(slot(task.content, "two", false, task.source)).toBeNull();
    expect(slot(task.content, "task b", false, task.source)).toMatchObject({ parent: "taskList" });
  });

  test("a paragraph over a list lands around the list, not in it", async () => {
    const { block, slot } = await rig();
    const intro = block("Intro.");
    expect(slot(intro.content, "two", false, intro.source)).toMatchObject({
      parent: "doc",
      after: "onetwonested anested bthree",
    });
    // before the list is where the paragraph already sits: its own slot
    expect(slot(intro.content, "two", true, intro.source)).toBeNull();
    expect(slot(intro.content, "in callout", false, intro.source)).toMatchObject({
      parent: "mdxBlockRegion",
      after: "in callout",
    });
  });

  test("the item's own slot is no target", async () => {
    const { block, slot } = await rig();
    const two = block("two");
    expect(slot(two.content, "two", true, two.source)).toBeNull();
    expect(slot(two.content, "two", false, two.source)).toBeNull();
  });

  test("moves within one list map past the removed source, both ways", async () => {
    const { editor, serialize, block, slot, placeDrop } = await rig();
    const one = block("one");
    placeDrop(
      editor.view,
      one.content,
      slot(one.content, "three", false, one.source)!.at,
      one.source,
    );
    expect(serialize()).toContain(`- two
  - nested a
  - nested b
- three
- one
`);
    const three = block("three");
    placeDrop(
      editor.view,
      three.content,
      slot(three.content, "two", true, three.source)!.at,
      three.source,
    );
    expect(serialize()).toContain(`- three
- two
  - nested a
  - nested b
- one
`);
  });

  test("dragging a body's only block away leaves the body an empty paragraph", async () => {
    const { parentBlock } = await import("../src/components/keymap");
    const { caret } = await import("./helpers");
    const { editor, serialize, slot, placeDrop } = await rig(`<Tabs items={["One", "Two"]}>
  <Tab>First.</Tab>
  <Tab>Second.</Tab>
</Tabs>
`);
    const { node, from, to } = parentBlock(editor.state.doc, caret(editor, "First."))!;
    const source = { from, to };
    const content = Fragment.from(node);
    placeDrop(editor.view, content, slot(content, "Second.", true, source)!.at, source);
    const bodies: number[] = [];
    editor.state.doc.descendants((child) => {
      if (child.type.name === "mdxBlockRegion") bodies.push(child.childCount);
    });
    expect(bodies).toEqual([1, 2]);
    expect(serialize()).toContain(`  <Tab>
    First.

    Second.
  </Tab>`);
  });

  test("an inline image drops at a text position, and its emptied paragraph goes", async () => {
    const { editor, serialize, slot, placeDrop } = await rig(`Intro.

![pic](/a.png)

- item

<Callout type="info" title="Heads up">
  Body.
</Callout>

After.
`);
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (pos === -1 && node.type.name === "image") pos = at;
    });
    const image = Fragment.from(editor.state.doc.nodeAt(pos)!);
    const source = { from: pos, to: pos + 1 };
    expect(slot(image, "Heads up", false, source)).toBeNull(); // never into a component's title
    expect(slot(image, "Body", false, source)).toMatchObject({ parent: "paragraph" });
    const into = slot(image, "After", false, source);
    expect(into).toMatchObject({ parent: "paragraph", after: "After" });
    placeDrop(editor.view, image, into!.at, source);
    expect(serialize()).toBe(`Intro.

- item

<Callout type="info" title="Heads up">
  Body.
</Callout>

After![pic](/a.png).
`);
  });

  test("a run of items drops as one into another list", async () => {
    const { editor, run, slot, placeDrop } = await rig();
    const two = run("one", "two");
    expect(slot(two.content, "Intro.", false, two.source)).toBeNull();
    const into = slot(two.content, "in callout", false, two.source);
    expect(into).toMatchObject({ parent: "bulletList", after: "in callout" });
    placeDrop(editor.view, two.content, into!.at, two.source);
    const texts = (n: PMNode) => {
      const kids: string[] = [];
      n.forEach((c) => kids.push(c.textContent));
      return kids;
    };
    const { doc } = editor.state;
    expect(texts(doc.child(1))).toEqual(["three"]);
    expect(texts(doc.child(4).lastChild!.lastChild!)).toEqual([
      "in callout",
      "one",
      "twonested anested b",
    ]);
  });

  test("a body paragraph drags out of its component", async () => {
    const { editor, block, slot, placeDrop } = await rig(`Intro.

<Callout type="info" title="Heads up">
  Body.
</Callout>
`);
    const body = block("Body.");
    const out = slot(body.content, "Intro.", false, body.source);
    expect(out).toMatchObject({ parent: "doc", after: "Intro." });
    placeDrop(editor.view, body.content, out!.at, body.source);
    const { doc } = editor.state;
    expect(doc.child(1).textContent).toBe("Body.");
    const region = doc.child(2).lastChild!;
    expect(region.type.name).toBe("mdxBlockRegion");
    expect(region.childCount).toBe(1);
    expect(region.textContent).toBe("");
  });

  test("part of a text drops at another text position", async () => {
    const { editor, run, slot, placeDrop } = await rig();
    const word = run("Intro", "Intro");
    expect(word.source.to - word.source.from).toBe(5);
    const into = slot(word.content, "Between", false, word.source);
    expect(into).toMatchObject({ parent: "paragraph" });
    placeDrop(editor.view, word.content, into!.at, word.source);
    expect(editor.state.doc.child(0).textContent).toBe(".");
    expect(editor.state.doc.child(2).textContent).toBe("BetweenIntro.");
  });

  test("moving the last item out removes the emptied list", async () => {
    const { editor, serialize, block, slot, placeDrop } = await rig(`- [ ] only

Para.

- [ ] t1
- [ ] t2
`);
    const only = block("only");
    placeDrop(
      editor.view,
      only.content,
      slot(only.content, "t2", false, only.source)!.at,
      only.source,
    );
    expect(serialize()).toBe(`Para.

- [ ] t1
- [ ] t2
- [ ] only
`);
  });

  test("a nested list emptied by a move goes, its item keeps its paragraph", async () => {
    const { editor, serialize, block, slot, placeDrop } = await rig(`- one
  - nested
- two
`);
    const nested = block("nested");
    placeDrop(
      editor.view,
      nested.content,
      slot(nested.content, "two", false, nested.source)!.at,
      nested.source,
    );
    expect(serialize()).toBe(`- one
- two
- nested
`);
  });
});
