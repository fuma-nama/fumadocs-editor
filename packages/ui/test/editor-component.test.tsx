import { afterEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { MdxEditor, type MdxEditorProps } from "../src/editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.useRealTimers();
});

function render(props: MdxEditorProps) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(MdxEditor, props)));
}

/** flush pending lazy chunks (the parse stack, the editor runtime) */
const settle = () =>
  act(async () => {
    await vi.dynamicImportSettled();
  });

/** progressive mount: the idle fallback timer hydrates the live editor */
async function hydrate() {
  await settle(); // parse chunk → static content
  act(() => void vi.advanceTimersByTime(250)); // idle fallback → mounting
  await settle(); // editor-runtime chunk → live
  let dom: (HTMLElement & { editor?: Editor }) | undefined;
  for (const el of host!.querySelectorAll<HTMLElement & { editor?: Editor }>(".ProseMirror")) {
    if (el.editor) dom = el as HTMLElement & { editor: Editor };
  }
  return { editor: dom!.editor!, dom: dom! };
}

function mount(props: MdxEditorProps) {
  render(props);
  return hydrate();
}

test("onMarkdownChange is debounced and serializes the edit", async () => {
  vi.useFakeTimers();
  const onChange = vi.fn<(markdown: string) => void>();
  const { editor } = await mount({ defaultValue: "Hello world.\n", onMarkdownChange: onChange });

  act(() => {
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("Hey. ");
  });
  expect(onChange).not.toHaveBeenCalled();

  act(() => void vi.advanceTimersByTime(300));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0]).toContain("Hey. Hello world.");
});

test("blur flushes the pending serialize so no edit is lost", async () => {
  vi.useFakeTimers();
  const onChange = vi.fn<(markdown: string) => void>();
  const { editor, dom } = await mount({ defaultValue: "Hello world.\n", onMarkdownChange: onChange });

  act(() => {
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("Hey. ");
    dom.dispatchEvent(new FocusEvent("blur"));
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0]).toContain("Hey. Hello world.");

  // the debounce timer was cancelled: no duplicate report later
  act(() => void vi.advanceTimersByTime(1000));
  expect(onChange).toHaveBeenCalledTimes(1);
});

test("the static view paints first and captures keystrokes for replay", async () => {
  vi.useFakeTimers();
  const onChange = vi.fn<(markdown: string) => void>();
  render({ defaultValue: "Hello.\n", onMarkdownChange: onChange });
  await settle(); // parse chunk resolves; the live editor is still unmounted

  // before hydration: the static paint is up, no live editor exists
  const staticView = host!.querySelector(".fde-content .ProseMirror") as HTMLElement & {
    editor?: unknown;
  };
  expect(staticView.editor).toBeUndefined();
  expect(staticView.textContent).toContain("Hello.");

  // type while only the static view is mounted
  const container = staticView.parentElement!;
  act(() => {
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "H", bubbles: true }));
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
  });

  const { editor } = await hydrate();
  expect(editor.state.doc.textContent).toBe("HiHello.");

  act(() => void vi.advanceTimersByTime(300));
  expect(onChange.mock.calls.at(-1)?.[0]).toContain("HiHello.");
});

test("unedited document round-trips byte-identical through the debounce", async () => {
  vi.useFakeTimers();
  const source = "# Title\n\nSome *rich* text.\n";
  const onChange = vi.fn<(markdown: string) => void>();
  const { editor } = await mount({ defaultValue: source, onMarkdownChange: onChange });

  // a no-op edit pair: insert then undo, each reported
  act(() => {
    editor.commands.setTextSelection(3);
    editor.commands.insertContent("X");
  });
  act(() => void vi.advanceTimersByTime(300));
  act(() => void editor.commands.undo());
  act(() => void vi.advanceTimersByTime(300));

  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange.mock.calls[1][0]).toBe(source);
});
