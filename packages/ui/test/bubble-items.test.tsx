import { afterEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { MdxEditor, type MdxEditorProps } from "../src/editor";
import type { BubbleItem } from "../src/bubble-items";

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

/** select `from..to` and let the bubble's update delay pass */
function select(editor: Editor, from: number, to: number) {
  act(() => {
    editor.commands.focus();
    editor.commands.setTextSelection({ from, to });
  });
  act(() => void vi.advanceTimersByTime(200));
}

const button = (label: string) =>
  host!.querySelector<HTMLButtonElement>(`button[data-fde-bubble-item][aria-label="${label}"]`);

const ask = (run = vi.fn<(editor: Editor) => void>()): BubbleItem => ({
  label: "Ask AI",
  icon: "✦",
  shortcut: "Mod-j",
  run,
});

test("items show in the bubble for a text selection and run with the editor", async () => {
  const run = vi.fn<(editor: Editor) => void>();
  const editor = await mount({ defaultValue: "Hello world.\n", bubbleItems: [ask(run)] });
  expect(button("Ask AI")).toBeNull();
  select(editor, 1, 6);
  const item = button("Ask AI")!;
  expect(item).not.toBeNull();
  expect(item.title).toMatch(/Ask AI \((Ctrl|⌘)/);
  act(() => item.click());
  expect(run).toHaveBeenCalledWith(editor);
});

test("isActive and isEnabled follow the selection", async () => {
  const item: BubbleItem = {
    ...ask(),
    isActive: (editor) => editor.isActive("bold"),
    isEnabled: (editor) => editor.state.selection.from > 1,
  };
  const editor = await mount({ defaultValue: "Hello **world**.\n", bubbleItems: [item] });
  select(editor, 1, 6);
  expect(button("Ask AI")!.disabled).toBe(true);
  expect(button("Ask AI")!.dataset.active).toBeUndefined();
  select(editor, 7, 12);
  expect(button("Ask AI")!.disabled).toBe(false);
  expect(button("Ask AI")!.dataset.active).toBe("true");
});

test("no items in a read-only editor or without a text selection", async () => {
  let editor = await mount({ defaultValue: "Hello world.\n", bubbleItems: [ask()] });
  select(editor, 3, 3);
  expect(button("Ask AI")).toBeNull();
  cleanup();

  editor = await mount({ defaultValue: "Hello world.\n", bubbleItems: [ask()], editable: false });
  select(editor, 1, 6);
  expect(button("Ask AI")).toBeNull();
});
