// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { caret, caretPath, makeEditor, press } from "./helpers";

const DOC = `---
title: Test
---

# Heading

<Files>
  <Folder name="app">
    <File name="layout.tsx" />
  </Folder>
</Files>
`;

describe("caret policy", () => {
  test("the initial selection skips a leading atom", () => {
    const { editor } = makeEditor(DOC);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(caretPath(editor)).toEqual(["heading"]);
  });

  test("typing over a selected atom or component is blocked", () => {
    const { editor, serialize } = makeEditor(DOC);
    caret(editor, "Heading", "start");
    press(editor, "ArrowUp");
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    const blocked = editor.view.someProp("handleTextInput", (f) =>
      f(editor.view, editor.state.selection.from, editor.state.selection.to, "x"),
    );
    expect(blocked).toBe(true);
    expect(serialize()).toBe(DOC);
  });

  test("a chrome click on a component places the caret inside it", () => {
    const { editor } = makeEditor(DOC);
    let filesPos = -1;
    let files = editor.state.doc.firstChild!;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "Files") {
        filesPos = pos;
        files = node;
      }
    });
    const handled = editor.view.someProp("handleClickOn", (f) =>
      f(editor.view, filesPos, files, filesPos, new MouseEvent("click"), true),
    );
    expect(handled).toBe(true);
    const { $from } = editor.state.selection;
    expect($from.pos).toBeGreaterThan(filesPos);
    expect($from.pos).toBeLessThan(filesPos + files.nodeSize);
    expect(caretPath(editor)).toContain("mdxInlineRegion");
  });
});
