import { afterEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import {
  createSyncClient,
  type ServerMessage,
  type SyncTransport,
} from "@fumadocs-editor/core/sync";
import { MdxEditor, type MdxEditorProps, type MdxEditorRef } from "../src/editor";
import { useSourceText } from "../src/root";

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
  act(() => void vi.advanceTimersByTime(50)); // deferred editor create/onCreate
  await settle();
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

test("onChange is debounced and serializes the edit", async () => {
  vi.useFakeTimers();
  const onChange = vi.fn<(markdown: string) => void>();
  const { editor } = await mount({ defaultValue: "Hello world.\n", onChange: onChange });

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
  const { editor, dom } = await mount({
    defaultValue: "Hello world.\n",
    onChange: onChange,
  });

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

test("applyExternalMarkdown merges a disk change without touching the caret", async () => {
  vi.useFakeTimers();
  const source = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";
  const editorRef = { current: null as MdxEditorRef | null };
  const { editor } = await mount({ defaultValue: source, ref: editorRef });

  // type into the first paragraph, leaving the caret there
  act(() => {
    editor.commands.setTextSelection(6);
    editor.commands.insertContent("LOCAL ");
  });
  const before = editor.state.selection.from;

  // disk edits the third paragraph meanwhile
  const remote = source.replace("Third paragraph.", "Third paragraph, from disk.");
  let conflicts: number[] = [];
  await act(async () => {
    conflicts = await editorRef.current!.applyExternalMarkdown(remote);
  });

  expect(conflicts).toEqual([]);
  expect(editor.state.doc.textContent).toContain("LOCAL");
  expect(editor.state.doc.textContent).toContain("Third paragraph, from disk.");
  expect(editor.state.selection.from).toBe(before);

  // merged doc serializes with the local edit in the disk text
  const out = editorRef.current!.getMarkdown();
  expect(out).toContain("FirstLOCAL  paragraph.");
  expect(out).toContain("Third paragraph, from disk.");
});

test("applyExternalMarkdown reports a conflict for a block edited on both sides", async () => {
  vi.useFakeTimers();
  const source = "First paragraph.\n\nSecond paragraph.\n";
  const editorRef = { current: null as MdxEditorRef | null };
  const { editor } = await mount({ defaultValue: source, ref: editorRef });

  act(() => {
    editor.commands.setTextSelection(3);
    editor.commands.insertContent("LOCAL ");
  });
  const remote = source.replace("First paragraph.", "First paragraph, disk.");
  let conflicts: number[] = [];
  await act(async () => {
    conflicts = await editorRef.current!.applyExternalMarkdown(remote);
  });

  expect(conflicts).toEqual([0]);
  expect(editor.state.doc.textContent).toContain("LOCAL");
  expect(editor.state.doc.textContent).not.toContain("disk");
});

test("unedited document round-trips byte-identical through the debounce", async () => {
  vi.useFakeTimers();
  const source = "# Title\n\nSome *rich* text.\n";
  const onChange = vi.fn<(markdown: string) => void>();
  const { editor } = await mount({ defaultValue: source, onChange: onChange });

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

test("sync: a save advances the merge base, so a later disk edit elsewhere merges cleanly", async () => {
  vi.useFakeTimers();
  let disk = "First.\n\nSecond.\n";
  let version = 1;
  let push = (_message: ServerMessage) => {};
  const file = () =>
    ({ resource: "file", path: "doc.mdx", text: disk, version: String(version) }) as const;
  // a backend speaking the protocol for one file
  const transport: SyncTransport = {
    connect(listener) {
      const later = (message: ServerMessage) =>
        void Promise.resolve().then(() => listener.message(message));
      push = later;
      void Promise.resolve().then(() => listener.open());
      return {
        send(message) {
          if (message.type === "hello") return later({ type: "hello", id: message.id });
          if (message.type === "subscribe")
            return later({ type: "update", id: message.id, ...file() });
          if (message.type !== "update" || message.resource !== "file") return;
          if (message.base === String(version)) {
            disk = message.text;
            version++;
          }
          later({ type: "update", id: message.id, ...file() });
        },
        close: () => listener.close(),
      };
    },
  };
  const client = createSyncClient({ transport });
  const statuses: string[] = [];
  render({ sync: { client, path: "doc.mdx", onStatus: (status) => statuses.push(status) } });
  await settle(); // the sync chunk loads and the file is read
  await settle();
  const { editor } = await hydrate();

  // type into the first paragraph and let the autosave land
  act(() => {
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("LOCAL ");
  });
  act(() => void vi.advanceTimersByTime(2000)); // change debounce, then the 800 ms autosave
  await settle();
  expect(disk).toContain("LOCAL First.");
  expect(statuses.at(-1)).toBe("synced");

  // the disk edits the other paragraph: no conflict, nothing duplicated
  disk = disk.replace("Second.", "Second, from disk.");
  version++;
  await act(async () => {
    push({ type: "update", ...file() });
  });
  await settle();
  expect(statuses).not.toContain("conflict");
  expect(editor.state.doc.textContent).toBe("LOCAL First.Second, from disk.");
});

test("compound: Visual and a custom source surface share one document", async () => {
  vi.useFakeTimers();
  const editorRef = { current: null as MdxEditorRef | null };
  const seen: string[] = [];
  function Source() {
    const { value, onChange, readOnly } = useSourceText();
    seen.push(value);
    return createElement("input", {
      "data-source": "",
      value,
      readOnly,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    });
  }
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(
        MdxEditor.Root,
        { defaultValue: "Hello.\n", ref: editorRef },
        createElement(MdxEditor.Visual),
        createElement(Source),
      ),
    ),
  );
  const { editor } = await hydrate();
  expect(host!.querySelector("textarea")).toBeNull();
  expect(seen.at(-1)).toBe("Hello.\n");

  // visual edits project into the source after the serialize debounce
  act(() => {
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("Hey. ");
  });
  act(() => void vi.advanceTimersByTime(300));
  expect(seen.at(-1)).toBe("Hey. Hello.\n");

  // source edits parse back into the live document
  const input = host!.querySelector<HTMLInputElement>("[data-source]")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "Changed.");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    vi.advanceTimersByTime(400);
    await vi.dynamicImportSettled();
  });
  expect(editor.state.doc.textContent).toBe("Changed.");
  expect(editorRef.current!.getMarkdown()).toBe("Changed.");
});
