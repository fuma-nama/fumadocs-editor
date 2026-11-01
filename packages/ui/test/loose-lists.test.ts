import { describe, expect, test } from "vitest";
import { caret, makeEditor } from "./helpers";

const LOOSE = "1. First item.\n\n   More about the first.\n\n2. Second item.\n";

describe("loose lists in the editor", () => {
  test("typing in a loose list keeps its blank lines", () => {
    const { editor, serialize } = makeEditor(LOOSE);
    expect(serialize()).toBe(LOOSE);
    caret(editor, "First item");
    editor.commands.insertContent("!");
    expect(serialize()).toBe("1. First item!.\n\n   More about the first.\n\n2. Second item.\n");
  });

  test("a list made in the editor is tight", () => {
    const { editor, serialize } = makeEditor("Intro.\n\nOne\n");
    caret(editor, "One");
    editor.chain().toggleBulletList().run();
    editor.commands.splitListItem("listItem");
    editor.commands.insertContent("Two");
    expect(serialize()).toBe("Intro.\n\n- One\n- Two\n");
  });

  test("a new item in a loose list is loose too", () => {
    const { editor, serialize } = makeEditor("- a\n\n- b\n");
    caret(editor, "b");
    editor.commands.splitListItem("listItem");
    editor.commands.insertContent("c");
    expect(serialize()).toBe("- a\n\n- b\n\n- c\n");
  });

  test("copied HTML keeps the list loose", () => {
    const { editor } = makeEditor(LOOSE);
    const html = editor.getHTML();
    expect(html).toContain("data-spread");
    const pasted = makeEditor("");
    pasted.editor.commands.setContent(html);
    expect(pasted.serialize()).toBe(LOOSE);
  });
});
