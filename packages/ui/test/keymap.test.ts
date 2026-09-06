// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { deleteBlocks, handleBlock } from "../src/components/keymap";
import { caret, caretPath, makeEditor, press, specs } from "./helpers";

const FILES = `<Files>
  <Folder name="app">
    <File name="layout.tsx" />
    <File name="page.tsx" />
  </Folder>
  <File name="package.json" />
</Files>
`;

const CALLOUT = `<Callout type="info" title="Heads up">
  Body text.
</Callout>
`;

describe("marks at the caret", () => {
  test("a shortcut toggle with no selection marks what is typed next", () => {
    const { editor, serialize } = makeEditor("Hello\n");
    caret(editor, "Hello");
    editor.commands.insertContent(" ");
    editor.commands.toggleBold();
    editor.commands.insertContent("big");
    expect(serialize()).toBe("Hello **big**\n");
  });

  test("ArrowRight at the end of a marked line drops the marks", () => {
    const { editor, serialize } = makeEditor("Hello **bold**\n");
    caret(editor, "bold");
    editor.commands.insertContent("er");
    expect(press(editor, "ArrowRight")).toBe(true);
    editor.commands.insertContent(" plain");
    expect(serialize()).toBe("Hello **bolder** plain\n");
  });

  test("ArrowRight mid-line, or with no marks, is left to the browser", () => {
    const { editor } = makeEditor("Hello **bold** end\n");
    caret(editor, "bold");
    expect(press(editor, "ArrowRight")).toBe(false);
    caret(editor, "end");
    expect(press(editor, "ArrowRight")).toBe(false);
  });
});

describe("Enter", () => {
  test("in a file name inserts a sibling row and focuses it", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "layout.tsx");
    press(editor, "Enter");
    editor.commands.insertContent("x");
    expect(serialize()).toBe(`<Files>
  <Folder name="app">
    <File name="layout.tsx" />
    <File name="x" />
    <File name="page.tsx" />
  </Folder>
  <File name="package.json" />
</Files>
`);
  });

  test("in a folder name inserts the first child inside it", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "app");
    press(editor, "Enter");
    editor.commands.insertContent("new.ts");
    expect(serialize()).toContain(`<Folder name="app">
    <File name="new.ts" />
    <File name="layout.tsx" />`);
  });

  test("in a Card title jumps to the body region", () => {
    const { editor } = makeEditor(`<Cards>
  <Card title="Getting Started" href="/docs">Set up.</Card>
</Cards>
`);
    caret(editor, "Getting Started");
    press(editor, "Enter");
    expect(caretPath(editor)).toContain("mdxBlockRegion");
  });

  test("on an empty trailing body paragraph leaves the component", () => {
    const { editor, serialize } = makeEditor(CALLOUT);
    caret(editor, "Body text.");
    press(editor, "Enter");
    expect(caretPath(editor)).toContain("mdxBlockRegion");
    press(editor, "Enter");
    expect(caretPath(editor)).toEqual(["paragraph"]);
    editor.commands.insertContent("after");
    const out = serialize();
    expect(out).toContain("</Callout>");
    expect(out.indexOf("after")).toBeGreaterThan(out.indexOf("</Callout>"));
    expect(out).toContain("Body text.");
  });

  test("on a selected component drills into its first region", () => {
    const { editor } = makeEditor(FILES);
    caret(editor, "layout.tsx");
    press(editor, "Escape");
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    press(editor, "Enter");
    expect(caretPath(editor)).toContain("mdxInlineRegion");
  });
});

describe("Tab", () => {
  test("toggles a file row into a folder and back, caret staying put", () => {
    const { editor, serialize } = makeEditor(FILES);
    const pos = caret(editor, "page.tsx");
    press(editor, "Tab");
    expect(serialize()).toBe(`<Files>
  <Folder name="app">
    <File name="layout.tsx" />
    <Folder name="page.tsx" />
  </Folder>
  <File name="package.json" />
</Files>
`);
    expect(editor.state.selection.from).toBe(pos);
    expect(editor.state.selection.$from.parent.textContent).toBe("page.tsx");
    press(editor, "Tab");
    expect(serialize()).toBe(FILES);
    expect(editor.state.selection.from).toBe(pos);
  });

  test("a folder with children stays a folder", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "app");
    press(editor, "Tab");
    expect(serialize()).toBe(FILES);
  });

  test("stays put when the container has no folder-like row type", () => {
    const CARDS = `<Cards>
  <Card title="One" href="/a">A.</Card>
  <Card title="Two" href="/b">B.</Card>
</Cards>
`;
    const { editor, serialize } = makeEditor(CARDS);
    caret(editor, "Two");
    press(editor, "Tab");
    expect(serialize()).toBe(CARDS);
  });

  test("toggle is a single undo step", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "package.json");
    press(editor, "Tab");
    editor.commands.undo();
    expect(serialize()).toBe(FILES);
  });

  test("Shift-Tab moves a row out, after its parent folder", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "page.tsx");
    press(editor, "Tab", { shiftKey: true });
    expect(serialize()).toBe(`<Files>
  <Folder name="app">
    <File name="layout.tsx" />
  </Folder>
  <File name="page.tsx" />
  <File name="package.json" />
</Files>
`);
  });

  test("Shift-Tab at the container root is a no-op", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "package.json");
    press(editor, "Tab", { shiftKey: true });
    expect(serialize()).toBe(FILES);
  });

  test("navigates fields in non-list components", () => {
    const { editor } = makeEditor(CALLOUT);
    caret(editor, "Heads up");
    press(editor, "Tab");
    expect(caretPath(editor)).toContain("mdxBlockRegion");
    press(editor, "Tab", { shiftKey: true });
    expect(caretPath(editor)).toContain("mdxInlineRegion");
  });
});

describe("Backspace / Delete", () => {
  test("deletes an empty row", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "layout.tsx");
    press(editor, "Enter");
    press(editor, "Backspace");
    expect(serialize()).toBe(FILES);
  });

  test("is swallowed at the start of a non-empty name", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "page.tsx", "start");
    press(editor, "Backspace");
    expect(serialize()).toBe(FILES);
  });

  test("deletes a fully empty component", () => {
    const { editor, serialize } = makeEditor(`before

<Callout type="info" title="" />

after
`);
    // place the caret inside the empty callout title
    let calloutPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "Callout") calloutPos = pos;
    });
    editor.commands.setTextSelection(calloutPos + 2);
    press(editor, "Backspace");
    const out = serialize();
    expect(out).not.toContain("Callout");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  test("emptying a folder name then Backspace deletes the folder, children move up", () => {
    const { editor, serialize } = makeEditor(FILES);
    const from = caret(editor, "app", "start");
    editor.commands.setTextSelection({ from, to: from + 3 });
    editor.commands.deleteSelection();
    press(editor, "Backspace");
    expect(serialize()).toBe(`<Files>
  <File name="layout.tsx" />
  <File name="page.tsx" />
  <File name="package.json" />
</Files>
`);
  });

  test("a region-crossing selection deletes text only, never structure", () => {
    // label → body selections must not reach PM's structural replace: it
    // splits the Tab into valid-but-wrong pieces
    const { editor, serialize } = makeEditor(`<Tabs items={["npm", "pnpm"]}>
  <Tab>
    Run npm.
  </Tab>

  <Tab>
    Run pnpm.
  </Tab>
</Tabs>
`);
    const from = caret(editor, "npm", "start");
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "Run npm.") to = pos + 4;
    });
    editor.commands.setTextSelection({ from, to });
    press(editor, "Backspace");
    const out = serialize();
    expect(out).toContain('items={["');
    expect(out).toContain('"pnpm"');
    expect(out).toContain("npm.");
    // still exactly two tabs, each with its own label region
    expect(out.match(/<Tab>/g)).toHaveLength(2);
  });

  test("deleting a body's only block leaves an empty paragraph, not an empty region", () => {
    const { editor, serialize } = makeEditor(`<Tabs items={["npm", "pnpm"]}>
  <Tab>
    Run npm.
  </Tab>

  <Tab>
    Run pnpm.
  </Tab>
</Tabs>
`);
    const $pos = editor.state.doc.resolve(caret(editor, "Run npm."));
    editor.commands.setNodeSelection($pos.before());
    editor.commands.deleteSelection();
    const body = editor.state.selection.$from.node(-1);
    expect(body.type.name).toBe("mdxBlockRegion");
    expect(body.childCount).toBe(1);
    expect(caretPath(editor)).toContain("paragraph");
    expect(serialize().match(/<Tab>/g)).toHaveLength(2);
  });

  test("type-over of a region-crossing selection edits text in place", () => {
    const { editor, serialize } = makeEditor(`<Tabs items={["npm", "pnpm"]}>
  <Tab>
    Run npm.
  </Tab>

  <Tab>
    Run pnpm.
  </Tab>
</Tabs>
`);
    const from = caret(editor, "npm", "start");
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "Run npm.") to = pos + 4;
    });
    editor.commands.setTextSelection({ from: from + 1, to });
    // the browser delivers typing over a selection through handleTextInput
    const handled = editor.view.someProp("handleTextInput", (f) =>
      f(editor.view, from + 1, to, "Z"),
    );
    expect(handled).toBe(true);
    const out = serialize();
    expect(out).toContain('"nZ"');
    expect(out).toContain("npm.");
    expect(out.match(/<Tab>/g)).toHaveLength(2);
  });

  test("selection wiping all text of a leaf component removes it", () => {
    const { editor, serialize } = makeEditor(CALLOUT);
    const from = caret(editor, "Heads up", "start");
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "Body text.") to = pos + node.text.length;
    });
    editor.commands.setTextSelection({ from, to });
    press(editor, "Delete");
    expect(serialize()).not.toContain("Callout");
  });
});

describe("Mod-Enter", () => {
  test("inserts the next sibling child from anywhere inside one", () => {
    const { editor, serialize } = makeEditor(`<Steps>
  <Step>
    One.
  </Step>
  <Step>
    Two.
  </Step>
</Steps>
`);
    caret(editor, "One", "start");
    press(editor, "Enter", { ctrlKey: true });
    editor.commands.insertContent("Between.");
    const out = serialize();
    expect(out.match(/<Step>/g)).toHaveLength(3);
    expect(out.indexOf("Between.")).toBeGreaterThan(out.indexOf("One."));
    expect(out.indexOf("Between.")).toBeLessThan(out.indexOf("Two."));
  });

  test("inside a standalone component starts a paragraph after it", () => {
    const { editor, serialize } = makeEditor(CALLOUT);
    caret(editor, "Body", "start");
    press(editor, "Enter", { ctrlKey: true });
    editor.commands.insertContent("outside");
    const out = serialize();
    expect(out.indexOf("outside")).toBeGreaterThan(out.indexOf("</Callout>"));
  });
});

describe("Escape", () => {
  test("walks selection up the component chain", () => {
    const { editor } = makeEditor(FILES);
    caret(editor, "page.tsx");
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      press(editor, "Escape");
      const sel = editor.state.selection;
      if (sel instanceof NodeSelection) names.push(sel.node.type.name);
    }
    expect(names).toEqual(["File", "Folder", "Files"]);
  });
});

describe("Mod-A", () => {
  test("widens region text → component → container", () => {
    const { editor } = makeEditor(CALLOUT);
    caret(editor, "Body", "start");
    press(editor, "a", { ctrlKey: true });
    const first = editor.state.selection;
    expect(first.empty).toBe(false);
    expect(editor.state.doc.textBetween(first.from, first.to)).toBe("Body text.");
    press(editor, "a", { ctrlKey: true });
    const second = editor.state.selection;
    expect(second).toBeInstanceOf(NodeSelection);
    expect((second as NodeSelection).node.type.name).toBe("Callout");
  });
});

describe("structural arrow traversal", () => {
  const TREE = `above

<Files>
  <Folder name="app">
    <File name="layout.tsx" />
    <File name="page.tsx" />
  </Folder>
  <File name="package.json" />
</Files>

below
`;

  const parentText = (editor: Editor) => editor.state.selection.$from.parent.textContent;

  test("ArrowUp moves from a row into the row above, not a wrapper", () => {
    const { editor } = makeEditor(TREE);
    caret(editor, "page.tsx", "start");
    press(editor, "ArrowUp");
    expect(editor.state.selection.empty).toBe(true);
    expect(parentText(editor)).toBe("layout.tsx");
  });

  test("ArrowDown moves row to row in document order", () => {
    const { editor } = makeEditor(TREE);
    caret(editor, "layout.tsx");
    press(editor, "ArrowDown");
    expect(parentText(editor)).toBe("page.tsx");
  });

  test("ArrowUp leaves the component into the paragraph above", () => {
    const { editor } = makeEditor(TREE);
    caret(editor, "app", "start");
    press(editor, "ArrowUp");
    expect(parentText(editor)).toBe("above");
  });

  test("ArrowDown leaves the component into the paragraph below", () => {
    const { editor } = makeEditor(TREE);
    caret(editor, "package.json");
    press(editor, "ArrowDown");
    expect(parentText(editor)).toBe("below");
  });

  test("ArrowDown enters the component from the paragraph above", () => {
    const { editor } = makeEditor(TREE);
    caret(editor, "above");
    press(editor, "ArrowDown");
    expect(parentText(editor)).toBe("app");
  });

  test("ArrowRight and ArrowLeft cross rows at name edges", () => {
    const { editor } = makeEditor(TREE);
    caret(editor, "layout.tsx");
    press(editor, "ArrowRight");
    expect(parentText(editor)).toBe("page.tsx");
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    press(editor, "ArrowLeft");
    expect(parentText(editor)).toBe("layout.tsx");
  });

  test("prose-to-prose crossings are left to native handling", () => {
    const { editor } = makeEditor("one\n\ntwo\n");
    const pos = caret(editor, "one");
    press(editor, "ArrowDown");
    expect(editor.state.selection.from).toBe(pos);
  });
});

describe("vertical arrows", () => {
  const DOC = `export const meta = {};

# Heading

Text.
`;

  test("ArrowUp from the first block selects the atom before it", () => {
    const { editor } = makeEditor(DOC);
    caret(editor, "Heading", "start");
    press(editor, "ArrowUp");
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(NodeSelection);
    expect((sel as NodeSelection).node.type.name).toBe("mdxjsEsm");
  });

  test("ArrowDown from a selected atom returns to text", () => {
    const { editor } = makeEditor(DOC);
    caret(editor, "Heading", "start");
    press(editor, "ArrowUp");
    press(editor, "ArrowDown");
    expect(editor.state.selection.empty).toBe(true);
    expect(caretPath(editor)).toEqual(["heading"]);
  });

  test("Enter on a selected atom starts a paragraph after it", () => {
    const { editor, serialize } = makeEditor(DOC);
    caret(editor, "Heading", "start");
    press(editor, "ArrowUp");
    press(editor, "Enter");
    editor.commands.insertContent("intro");
    const out = serialize();
    expect(out.indexOf("intro")).toBeGreaterThan(out.indexOf("export"));
    expect(out.indexOf("intro")).toBeLessThan(out.indexOf("# Heading"));
  });
});

describe("adding rows and folders", () => {
  test("a File row offers its container rows as sibling inserts", async () => {
    const { childInsertContext } = await import("../src/components/keymap");
    const { editor, serialize } = makeEditor(FILES);
    const pos = caret(editor, "page.tsx");
    const $pos = editor.state.doc.resolve(pos);
    let filePos = -1;
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === "File") {
        filePos = $pos.before(d);
        break;
      }
    }
    const context = childInsertContext(editor.state, filePos, specs);
    expect(context).not.toBeNull();
    expect(context!.children.map((c) => c.name)).toEqual(["File", "Folder"]);
    const folder = context!.children[1];
    editor.chain().insertContentAt(context!.insertAt, folder.insert!(specs)).run();
    expect(serialize()).toContain(`<File name="page.tsx" />
    <Folder name="" />`);
  });

  test("slash in an empty row swaps it for the chosen type", async () => {
    const { entryItems } = await import("../src/slash-menu");
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "layout.tsx");
    press(editor, "Enter"); // fresh empty File row
    const items = entryItems(editor, specs);
    expect(items!.map((i) => i.title)).toEqual(["File", "Folder"]);
    items![1].run(editor, { from: 0, to: 0 });
    editor.commands.insertContent("src");
    expect(serialize()).toContain(`<File name="layout.tsx" />
    <Folder name="src" />`);
  });
});

describe("slash menu context", () => {
  test("inside a Tab body the menu offers the blocks, not the row swaps", async () => {
    const { entryItems } = await import("../src/slash-menu");
    const { specs } = await import("./helpers");
    const { editor } = makeEditor(`<Tabs items={["One"]}>
  <Tab>Body.</Tab>
</Tabs>
`);
    caret(editor, "Body");
    expect(entryItems(editor, specs)).toBeNull();
  });
});

describe("word and line deletes", () => {
  test("Alt-Backspace in an empty file name deletes the row, not its region", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "layout.tsx");
    press(editor, "Enter"); // fresh empty File row
    expect(press(editor, "Backspace", { altKey: true })).toBe(true);
    expect(serialize()).toBe(FILES);
  });

  test("Mod-Backspace at the start of a file name is guarded", () => {
    const { editor, serialize } = makeEditor(FILES);
    const pos = caret(editor, "page.tsx", "start");
    expect(press(editor, "Backspace", { ctrlKey: true })).toBe(true);
    expect(serialize()).toBe(FILES);
    expect(editor.state.selection.from).toBe(pos);
  });

  test("Alt-Delete at the end of a file name is guarded", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "page.tsx");
    expect(press(editor, "Delete", { altKey: true })).toBe(true);
    expect(serialize()).toBe(FILES);
  });

  test("Alt-Backspace mid-word falls through to the default handling", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "page.tsx");
    expect(press(editor, "Backspace", { altKey: true })).toBe(false);
    expect(serialize()).toBe(FILES);
  });
});

describe("moving components", () => {
  test("Alt-Arrow moves a row among its siblings, caret following", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "page.tsx");
    expect(press(editor, "ArrowUp", { altKey: true })).toBe(true);
    expect(serialize()).toBe(`<Files>
  <Folder name="app">
    <File name="page.tsx" />
    <File name="layout.tsx" />
  </Folder>
  <File name="package.json" />
</Files>
`);
    expect(editor.state.selection.$from.parent.textContent).toBe("page.tsx");
    press(editor, "ArrowDown", { altKey: true });
    expect(serialize()).toBe(FILES);
  });

  test("the first row never moves above the folder name", () => {
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "layout.tsx");
    press(editor, "ArrowUp", { altKey: true });
    expect(serialize()).toBe(FILES);
  });

  test("a top-level component moves past a plain paragraph", () => {
    const { editor, serialize } = makeEditor(`${CALLOUT}
After.
`);
    caret(editor, "Heads up");
    expect(press(editor, "ArrowDown", { altKey: true })).toBe(true);
    const out = serialize();
    expect(out.indexOf("After.")).toBeLessThan(out.indexOf("<Callout"));
    expect(editor.state.selection.$from.parent.textContent).toBe("Heads up");
  });
});

describe("leaf component click", () => {
  test("selects the component and flags its menu to open", () => {
    const { editor } = makeEditor('<GithubInfo owner="fuma-nama" repo="fumadocs" />\n');
    let pos = -1;
    let leaf: import("@tiptap/pm/model").Node | null = null;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "GithubInfo") {
        pos = at;
        leaf = node;
      }
    });
    const handled = editor.view.someProp("handleClickOn", (f) =>
      f(editor.view, pos + 1, leaf!, pos, new MouseEvent("click"), true),
    );
    expect(handled).toBe(true);
    const selection = editor.state.selection;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe("GithubInfo");
  });
});

describe("panel attribute edits", () => {
  test("keep a childless component node-selected (setNodeMarkup replaces it whole)", async () => {
    const { setComponentAttributes } = await import("../src/components/attributes");
    const { editor } = makeEditor('<GithubInfo owner="a" repo="b" />\n');
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "GithubInfo") pos = at;
    });
    editor.commands.setNodeSelection(pos);
    setComponentAttributes(editor, pos, [
      { type: "mdxJsxAttribute", name: "owner", value: "fuma" },
      { type: "mdxJsxAttribute", name: "repo", value: "fumadocs" },
    ]);
    const selection = editor.state.selection;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe("GithubInfo");
  });
});

describe("block targets", () => {
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

\`\`\`ts
code
\`\`\`
`;

  /** the node of a single-block target */
  const nodeOf = (editor: Editor) => {
    const block = handleBlock(editor.state.selection)!;
    return editor.state.doc.nodeAt(block.from)!;
  };

  /** node names Escape selects, one per press, until it stops widening */
  const escalate = (editor: Editor) => {
    const names: string[] = [];
    let last = -1;
    for (let i = 0; i < 6; i++) {
      press(editor, "Escape");
      const sel = editor.state.selection;
      if (!(sel instanceof NodeSelection) || sel.from === last) break;
      last = sel.from;
      names.push(sel.node.type.name);
    }
    return names;
  };

  const target = async (text: string) => {
    const { editor } = makeEditor(LISTS);
    caret(editor, text);
    const node = nodeOf(editor);
    return { editor, node, name: node.type.name, text: node.textContent };
  };

  test("a caret resolves to the innermost movable block", async () => {
    expect(await target("Intro.")).toMatchObject({ name: "paragraph" });
    expect(await target("two")).toMatchObject({ name: "listItem", text: "twonested anested b" });
    expect(await target("nested a")).toMatchObject({ name: "listItem", text: "nested a" });
    expect(await target("task a")).toMatchObject({ name: "taskItem" });
    expect(await target("in callout")).toMatchObject({ name: "listItem", text: "in callout" });
    expect(await target("code")).toMatchObject({ name: "codeBlock" });
  });

  /** the run a selection spans: its parent and the item count */
  const runOf = (editor: Editor) => {
    const block = handleBlock(editor.state.selection)!;
    const $from = editor.state.doc.resolve(block.from);
    return {
      parent: $from.parent.type.name,
      count: editor.state.doc.resolve(block.to).index() - $from.index(),
    };
  };

  test("a selection across every item of a list targets the list", async () => {
    const { editor } = makeEditor(LISTS);
    const from = caret(editor, "one", "start");
    const to = caret(editor, "three");
    editor.commands.setTextSelection({ from, to });
    expect(nodeOf(editor).type.name).toBe("bulletList");
    // all the nested items: the nested list is a container, so the run stays
    editor.commands.setTextSelection({
      from: caret(editor, "nested a", "start"),
      to: caret(editor, "nested b"),
    });
    expect(runOf(editor)).toEqual({ parent: "bulletList", count: 2 });
    editor.commands.setTextSelection({ from, to });
    expect(press(editor, "ArrowDown", { altKey: true })).toBe(true);
    expect(editor.state.doc.child(1).textContent).toBe("Between.");
    expect(editor.state.doc.child(2).type.name).toBe("bulletList");
  });

  test("some items of a list are a run: moved, deleted and widened together", async () => {
    const { editor } = makeEditor(LISTS);
    const from = caret(editor, "one", "start");
    editor.commands.setTextSelection({ from, to: caret(editor, "two") });
    expect(runOf(editor)).toEqual({ parent: "bulletList", count: 2 });
    expect(press(editor, "ArrowDown", { altKey: true })).toBe(true);
    const list = editor.state.doc.child(1);
    expect(list.child(0).textContent).toBe("three");
    expect(list.child(1).textContent).toBe("one");
    expect(list.child(2).firstChild!.textContent).toBe("two");
    const { selection } = editor.state;
    expect(editor.state.doc.textBetween(selection.from, selection.to, "|")).toBe("one|two");
    press(editor, "Escape");
    expect((editor.state.selection as NodeSelection).node.type.name).toBe("bulletList");
    editor.commands.setTextSelection({
      from: caret(editor, "three", "start"),
      to: caret(editor, "two"),
    });
    editor.view.dispatch(deleteBlocks(editor.state.tr, handleBlock(editor.state.selection)!));
    expect(editor.state.doc.child(1).textContent).toBe("Between.");
  });

  test("an inline image among text is the target; alone, it is its paragraph", async () => {
    const { editor, serialize } = makeEditor(`Intro.

![pic](/a.png)

Text ![inline](/b.png) more.
`);
    const images: number[] = [];
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "image") images.push(at);
    });
    editor.commands.setNodeSelection(images[0]);
    expect(nodeOf(editor).type.name).toBe("paragraph");
    editor.commands.setNodeSelection(images[1]);
    expect(nodeOf(editor).type.name).toBe("image");
    expect(press(editor, "ArrowUp", { altKey: true })).toBe(true);
    expect(editor.state.doc.child(1).textContent).toBe("Text  more.");
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(NodeSelection);
    expect((sel as NodeSelection).node.type.name).toBe("image");
    editor.view.dispatch(deleteBlocks(editor.state.tr, handleBlock(sel)!));
    let alone = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "image") alone = at;
    });
    // the image alone in its paragraph is the paragraph: deleting the target takes it
    editor.commands.setNodeSelection(alone);
    editor.view.dispatch(deleteBlocks(editor.state.tr, handleBlock(editor.state.selection)!));
    expect(serialize()).toBe(`Intro.

Text  more.
`);
  });

  test("a selection widens to each parent it covers entirely, settling on a unit", async () => {
    const { editor } = makeEditor(LISTS);
    const select = (start: string, end: string) => {
      const from = caret(editor, start, "start");
      const to = caret(editor, end);
      editor.commands.setTextSelection({ from, to });
    };
    // part of a text: the text itself
    select("Intro", "Intro");
    const part = handleBlock(editor.state.selection)!;
    expect(part).toEqual({ from: editor.state.selection.from, to: editor.state.selection.to });
    // the whole text of a bullet: the bullet
    select("three", "three");
    expect(nodeOf(editor).type.name).toBe("listItem");
    // the whole text of a bullet with a nested list: the text (the bullet is more)
    select("two", "two");
    expect(runOf(editor)).toEqual({ parent: "paragraph", count: 1 });
    // the whole body text: its paragraph, since a region is no unit
    select("Body text.", "Body text.");
    expect(nodeOf(editor).type.name).toBe("paragraph");
  });

  test("dragging an attribute's whole text away leaves its region in place", async () => {
    const { editor, serialize } = makeEditor(CALLOUT);
    const from = caret(editor, "Heads up", "start");
    editor.commands.setTextSelection({ from, to: caret(editor, "Heads up") });
    const run = handleBlock(editor.state.selection)!;
    expect(run).toEqual({ from, to: from + 8 });
    editor.view.dispatch(deleteBlocks(editor.state.tr, run));
    const callout = editor.state.doc.firstChild!;
    expect(callout.child(0).type.name).toBe("mdxInlineRegion");
    expect(callout.child(0).textContent).toBe("");
    expect(serialize()).toContain('title=""');
  });

  test("a whole file name is its row", async () => {
    const { editor } = makeEditor(`<Files>
  <File name="layout.tsx" />
  <File name="page.tsx" />
</Files>
`);
    const from = caret(editor, "layout.tsx", "start");
    editor.commands.setTextSelection({ from, to: caret(editor, "layout.tsx") });
    const node = nodeOf(editor);
    expect(node.type.name).toBe("File");
  });

  test("a body paragraph is its own target; its component is one step up", async () => {
    const { editor, name } = await target("Body text.");
    expect(name).toBe("paragraph");
    expect(escalate(editor)).toEqual(["paragraph", "Callout"]);
  });

  test("Escape widens from the target to each enclosing block", async () => {
    expect(escalate((await target("Intro.")).editor)).toEqual(["paragraph"]);
    expect(escalate((await target("two")).editor)).toEqual(["listItem", "bulletList"]);
    // a nested list sits in an item, not a list: it is a container, not a block
    expect(escalate((await target("nested a")).editor)).toEqual([
      "listItem",
      "listItem",
      "bulletList",
    ]);
    expect(escalate((await target("task a")).editor)).toEqual(["taskItem", "taskList"]);
    expect(escalate((await target("in callout")).editor)).toEqual([
      "listItem",
      "bulletList",
      "Callout",
    ]);
    expect(escalate((await target("code")).editor)).toEqual(["codeBlock"]);
  });

  test("a node-selected list is the target, wherever it sits", async () => {
    const { editor } = await target("in callout");
    press(editor, "Escape");
    press(editor, "Escape");
    expect(nodeOf(editor).type.name).toBe("bulletList");
    expect(editor.state.selection.from).toBe(handleBlock(editor.state.selection)!.from);
  });

  test("Alt-Arrow moves the item within its list and stops at its edges", async () => {
    const { editor } = await target("two");
    expect(press(editor, "ArrowDown", { altKey: true })).toBe(true);
    const list = editor.state.doc.child(1);
    expect(list.type.name).toBe("bulletList");
    expect(list.child(1).textContent).toBe("three");
    expect(list.child(2).firstChild!.textContent).toBe("two");
    expect(editor.state.selection.$from.parent.textContent).toBe("two");
    expect(press(editor, "ArrowDown", { altKey: true })).toBe(false);
    expect(list.eq(editor.state.doc.child(1))).toBe(true);
  });

  test("deleting the last item takes the emptied list with it", async () => {
    const { editor, serialize } = makeEditor(LISTS);
    caret(editor, "nested a");
    editor.view.dispatch(deleteBlocks(editor.state.tr, handleBlock(editor.state.selection)!));
    caret(editor, "nested b");
    editor.view.dispatch(deleteBlocks(editor.state.tr, handleBlock(editor.state.selection)!));
    const out = serialize();
    expect(out).not.toContain("nested");
    expect(out).toContain("- two\n- three");
    caret(editor, "task a");
    editor.view.dispatch(deleteBlocks(editor.state.tr, handleBlock(editor.state.selection)!));
    caret(editor, "task b");
    editor.view.dispatch(deleteBlocks(editor.state.tr, handleBlock(editor.state.selection)!));
    let lists = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "taskList") lists++;
    });
    expect(lists).toBe(0);
    expect(serialize()).not.toContain("[ ]");
  });
});
