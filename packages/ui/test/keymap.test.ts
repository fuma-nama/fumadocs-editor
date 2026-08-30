// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { caret, caretPath, makeEditor, press } from "./helpers";

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
      if (node.attrs?.name === "Callout") calloutPos = pos;
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
      if (sel instanceof NodeSelection) names.push(sel.node.attrs.name as string);
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
    expect((second as NodeSelection).node.attrs.name).toBe("Callout");
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
  const DOC = `---
title: Test
---

# Heading

Text.
`;

  test("ArrowUp from the first block selects the frontmatter atom", () => {
    const { editor } = makeEditor(DOC);
    caret(editor, "Heading", "start");
    press(editor, "ArrowUp");
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(NodeSelection);
    expect((sel as NodeSelection).node.type.name).toBe("frontmatter");
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
    expect(out.indexOf("intro")).toBeGreaterThan(out.indexOf("---"));
    expect(out.indexOf("intro")).toBeLessThan(out.indexOf("# Heading"));
  });
});

describe("adding rows and folders", () => {
  test("a File row offers its container rows as sibling inserts", async () => {
    const { childInsertContext } = await import("../src/components/keymap");
    const { fumadocsUiComponents } = await import("../src/components/fumadocs-ui");
    const { editor, serialize } = makeEditor(FILES);
    const pos = caret(editor, "page.tsx");
    const $pos = editor.state.doc.resolve(pos);
    let filePos = -1;
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).attrs?.name === "File") {
        filePos = $pos.before(d);
        break;
      }
    }
    const specs = new Map(fumadocsUiComponents.map((s) => [s.name, s]));
    const context = childInsertContext(editor.state, filePos, specs);
    expect(context).not.toBeNull();
    expect(context!.children.map((c) => c.name)).toEqual(["File", "Folder"]);
    const folder = context!.children[1];
    editor.chain().insertContentAt(context!.insertAt, folder.insert!()).run();
    expect(serialize()).toContain(`<File name="page.tsx" />
    <Folder name="" />`);
  });

  test("slash in an empty row swaps it for the chosen type", async () => {
    const { entryItems } = await import("../src/slash-menu");
    const { fumadocsUiComponents } = await import("../src/components/fumadocs-ui");
    const { editor, serialize } = makeEditor(FILES);
    caret(editor, "layout.tsx");
    press(editor, "Enter"); // fresh empty File row
    const specs = new Map(fumadocsUiComponents.map((s) => [s.name, s]));
    const items = entryItems(editor, specs);
    expect(items!.map((i) => i.title)).toEqual(["File", "Folder"]);
    items![1].run(editor, { from: 0, to: 0 });
    editor.commands.insertContent("src");
    expect(serialize()).toContain(`<File name="layout.tsx" />
    <Folder name="src" />`);
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
    caret(editor, "Body text.");
    expect(press(editor, "ArrowDown", { altKey: true })).toBe(true);
    const out = serialize();
    expect(out.indexOf("After.")).toBeLessThan(out.indexOf("<Callout"));
    expect(editor.state.selection.$from.parent.textContent).toBe("Body text.");
  });
});
