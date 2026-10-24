import { afterEach, expect, test, vi } from "vitest";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Extension, Mark, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MdxEditor, type MdxEditorProps, type MdxEditorRef } from "../src/editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;

function cleanup() {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(props: MdxEditorProps) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(MdxEditor, props)));
}

const settle = () =>
  act(async () => {
    await vi.dynamicImportSettled();
  });

/** the parse stack, then the idle fallback mounts the live editor */
async function hydrate() {
  await settle();
  act(() => void vi.advanceTimersByTime(250));
  await settle();
  act(() => void vi.advanceTimersByTime(50));
  await settle();
  let editor: Editor | undefined;
  for (const el of host!.querySelectorAll<HTMLElement & { editor?: Editor }>(".ProseMirror")) {
    if (el.editor) editor = el.editor;
  }
  return editor!;
}

function mount(props: MdxEditorProps) {
  vi.useFakeTimers();
  render(props);
  return hydrate();
}

/** marks every `TODO` in the text */
const todo = Extension.create({
  name: "todoHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("todoHighlight"),
        props: {
          decorations(state) {
            const marks: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              for (const match of node.text!.matchAll(/TODO/g)) {
                const from = pos + match.index;
                marks.push(Decoration.inline(from, from + 4, { class: "todo" }));
              }
            });
            return DecorationSet.create(state.doc, marks);
          },
        },
      }),
    ];
  },
});

function press(editor: Editor, key: string) {
  const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
  const event = new KeyboardEvent("keydown", {
    key,
    ...mod,
    bubbles: true,
    cancelable: true,
  });
  editor.view.someProp("handleKeyDown", (handle) => handle(editor.view, event));
}

const todos = (editor: Editor) => editor.view.dom.querySelectorAll(".todo").length;

test("host extensions run in the live editor", async () => {
  const editor = await mount({
    defaultValue: "Fix the TODO here.\n",
    extensions: [todo],
  });
  expect(todos(editor)).toBe(1);
});

test("host keyboard shortcuts run", async () => {
  const ask = vi.fn(() => true);
  const shortcut = Extension.create({
    name: "askAi",
    addKeyboardShortcuts: () => ({ "Mod-j": ask }),
  });
  const editor = await mount({
    defaultValue: "Hello.\n",
    extensions: [shortcut],
  });
  press(editor, "j");
  expect(ask).toHaveBeenCalledOnce();
});

test("the live editor built after a mode switch has them again", async () => {
  const ref = createRef<MdxEditorRef>();
  const first = await mount({
    defaultValue: "A TODO.\n",
    extensions: [todo],
    ref,
  });
  act(() => ref.current!.setMode("source"));
  act(() => ref.current!.setMode("visual"));
  const second = await hydrate();
  expect(second).not.toBe(first);
  expect(todos(second)).toBe(1);
});

test("they run in a read-only editor", async () => {
  const editor = await mount({
    defaultValue: "A TODO.\n",
    extensions: [todo],
    editable: false,
  });
  expect(editor.isEditable).toBe(false);
  expect(todos(editor)).toBe(1);
});

test("built-in shortcuts win a tie; a higher priority takes the key", async () => {
  const mine = vi.fn(() => true);
  const tie = Extension.create({
    name: "myBold",
    addKeyboardShortcuts: () => ({ "Mod-b": mine }),
  });
  let editor = await mount({ defaultValue: "Hello.\n", extensions: [tie] });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  press(editor, "b");
  expect(mine).not.toHaveBeenCalled();
  expect(editor.isActive("bold")).toBe(true);
  cleanup();

  editor = await mount({
    defaultValue: "Hello.\n",
    extensions: [tie.extend({ priority: 1000 })],
  });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  press(editor, "b");
  expect(mine).toHaveBeenCalledOnce();
  expect(editor.isActive("bold")).toBe(false);
});

test("extensions that add content or reuse a built-in name are left out", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const color = Extension.create({
    name: "textColor",
    addExtensions: () => [Mark.create({ name: "color", parseHTML: () => [{ tag: "span" }] })],
  });
  const clash = Extension.create({
    name: "bold",
    addKeyboardShortcuts: () => ({ "Mod-b": () => true }),
  });
  const editor = await mount({
    defaultValue: "A TODO.\n",
    extensions: [color, clash, todo],
  });
  expect(editor.schema.marks.color).toBeUndefined();
  expect(editor.schema.marks.bold).toBeDefined();
  expect(todos(editor)).toBe(1);
  const messages = error.mock.calls.map(([message]) => String(message));
  expect(messages.some((m) => m.includes('"textColor"') && m.includes("mark"))).toBe(true);
  expect(messages.some((m) => m.includes('"bold"'))).toBe(true);
});

test("TipTap's core keys win a tie too", async () => {
  const mine = vi.fn(() => true);
  const enter = Extension.create({
    name: "myEnter",
    addKeyboardShortcuts: () => ({ Enter: mine }),
  });
  const editor = await mount({ defaultValue: "Hello world.\n", extensions: [enter] });
  editor.commands.setTextSelection(6);
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  editor.view.someProp("handleKeyDown", (handle) => handle(editor.view, event));
  expect(mine).not.toHaveBeenCalled();
  expect(editor.state.doc.childCount).toBe(2);
});

test("an extension that replaces a built-in command is left out", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const link = Extension.create({
    name: "myLink",
    addCommands: () => ({ setLink: () => () => false }),
  });
  const editor = await mount({ defaultValue: "A TODO.\n", extensions: [link, todo] });
  expect(editor.extensionManager.extensions.some((e) => e.name === "myLink")).toBe(false);
  expect(todos(editor)).toBe(1);
  expect(error.mock.calls.some(([message]) => String(message).includes('"setLink"'))).toBe(true);
});
