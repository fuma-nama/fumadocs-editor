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

describe("schema refills", () => {
  test("a deleted file-name region comes back empty", () => {
    const { editor, serialize } = makeEditor(FILES);
    const region = findNode(
      editor,
      (node) => node.type.name === "mdxInlineRegion" && node.textContent === "page.tsx",
    );
    editor.view.dispatch(editor.state.tr.delete(region.pos, region.pos + region.node.nodeSize));

    const file = findNode(editor, (node) => node.type.name === "File");
    expect(file.node.childCount).toBe(1);
    expect(file.node.firstChild!.type.name).toBe("mdxInlineRegion");
    expect(file.node.firstChild!.textContent).toBe("");
    expect(serialize()).toContain('<File name="" />');
  });

  test("a deleted Callout body comes back with an editable paragraph", () => {
    const { editor } = makeEditor(`<Callout type="info" title="Heads up">
  Body text.
</Callout>
`);
    const body = findNode(editor, (node) => node.type.name === "mdxBlockRegion");
    editor.view.dispatch(editor.state.tr.delete(body.pos, body.pos + body.node.nodeSize));

    const callout = findNode(editor, (node) => node.type.name === "Callout");
    expect(callout.node.childCount).toBe(2);
    expect(callout.node.child(0).type.name).toBe("mdxInlineRegion");
    expect(callout.node.child(1).type.name).toBe("mdxBlockRegion");
    expect(callout.node.child(1).childCount).toBe(1);
    expect(callout.node.child(1).firstChild!.type.name).toBe("paragraph");
  });

  test("the refill is undone together with the deletion", () => {
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
    const card = findNode(editor, (node) => node.type.name === "Card");
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
    const file = findNode(editor, (node) => node.type.name === "File");
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
    const { handleBlock } = await import("../src/components/keymap");
    const { caret } = await import("./helpers");
    const { editor, serialize } = makeEditor(mdx);
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
      const at = dropSlot(editor.state, $pos, dragged, source, () => before);
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

  test("a component nests into a list item when dropped on the item's text", async () => {
    const { editor, block, slot, placeDrop } = await rig(`- one
- two

<Callout type="info" title="Heads up">
  Body.
</Callout>
`);
    const callout = block("Heads up");
    expect(callout.content.firstChild!.type.name).toBe("Callout");
    const into = slot(callout.content, "two", false, callout.source);
    expect(into).toMatchObject({ parent: "listItem", after: "two" });
    placeDrop(editor.view, callout.content, into!.at, callout.source);
    const item = editor.state.doc.child(0).child(1);
    expect(item.childCount).toBe(2);
    expect(item.child(1).type.name).toBe("Callout");
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

  test("the lit run follows edits around it and goes with its blocks", async () => {
    const { setLifted } = await import("../src/components/structure");
    const { parentBlock } = await import("../src/components/keymap");
    const { contentClass } = await import("../src/styles/content");
    const { caret } = await import("./helpers");
    const { editor } = makeEditor(`Intro.

Body.
`);
    const lit = () => {
      const texts: string[] = [];
      for (const el of editor.view.dom.getElementsByClassName(contentClass.lifted)) {
        texts.push(el.textContent!);
      }
      return texts;
    };
    const body = parentBlock(editor.state.doc, caret(editor, "Body."))!;
    setLifted(editor.view, { from: body.from, to: body.to });
    expect(lit()).toEqual(["Body."]);
    editor.view.dispatch(editor.state.tr.insertText("Long ", 1));
    expect(lit()).toEqual(["Body."]);
    const moved = parentBlock(editor.state.doc, caret(editor, "Body."))!;
    editor.view.dispatch(editor.state.tr.delete(moved.from, moved.to));
    expect(lit()).toEqual([]);
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
