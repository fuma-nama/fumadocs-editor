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

function mount(props: MdxEditorProps) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(MdxEditor, props)));
  const dom = host.querySelector(".ProseMirror") as HTMLElement & { editor: Editor };
  return { editor: dom.editor, dom };
}

test("onMarkdownChange is debounced and serializes the edit", () => {
  vi.useFakeTimers();
  const onChange = vi.fn<(markdown: string) => void>();
  const { editor } = mount({ defaultValue: "Hello world.\n", onMarkdownChange: onChange });

  act(() => {
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("Hey. ");
  });
  expect(onChange).not.toHaveBeenCalled();

  act(() => void vi.advanceTimersByTime(300));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0]).toContain("Hey. Hello world.");
});

test("blur flushes the pending serialize so no edit is lost", () => {
  vi.useFakeTimers();
  const onChange = vi.fn<(markdown: string) => void>();
  const { editor, dom } = mount({ defaultValue: "Hello world.\n", onMarkdownChange: onChange });

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

test("unedited document round-trips byte-identical through the debounce", () => {
  vi.useFakeTimers();
  const source = "# Title\n\nSome *rich* text.\n";
  const onChange = vi.fn<(markdown: string) => void>();
  const { editor } = mount({ defaultValue: source, onMarkdownChange: onChange });

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
