import { afterEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import type { MdxAttribute } from "@fumadocs-editor/core";
import type { SyncTransport } from "@fumadocs-editor/sync";
import { MdxEditor, type MdxEditorProps, type MdxEditorRef } from "../src/editor";
import { fumadocsUiComponents } from "../src/components/fumadocs-ui";
import { setStringProp } from "../src/components/attr-values";
import type { UiComponentSpec } from "../src/components/spec";

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

test("the static view paints first and captures keystrokes for replay", async () => {
  vi.useFakeTimers();
  const onChange = vi.fn<(markdown: string) => void>();
  render({ defaultValue: "Hello.\n", onChange: onChange });
  await settle(); // parse chunk resolves; the live editor is still unmounted

  // before hydration: the static paint is up, no live editor exists
  const staticView = host!.querySelector(".ProseMirror[aria-label]") as HTMLElement & {
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

test("editable={false}: read-only surface, typing dropped, no mutating chrome", async () => {
  vi.useFakeTimers();
  const source = 'Hello.\n\n<Callout type="info">Body</Callout>\n';
  render({ defaultValue: source, components: fumadocsUiComponents, editable: false });
  await settle();

  // typing on the static view must not queue a replay
  const staticView = host!.querySelector(".ProseMirror[aria-label]") as HTMLElement;
  act(() => {
    staticView.parentElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "X", bubbles: true }),
    );
  });

  const { editor, dom } = await hydrate();
  expect(editor.isEditable).toBe(false);
  expect(dom.getAttribute("contenteditable")).toBe("false");
  expect(editor.state.doc.textContent).toBe("Hello.Body");

  // the caret resting inside a component would normally surface the ⋯ handle
  act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 3);
  });
  act(() => void vi.advanceTimersByTime(50));
  expect(host!.querySelector('[aria-label$="options"]')).toBeNull();
});

/** a third-party renderer that throws unless its `mode` attr is "ok" */
const boomSpec: UiComponentSpec = {
  name: "Boom",
  childrenRegion: { region: "children" },
  render: ({ props, children }) => {
    if (props.mode !== "ok") throw new Error("renderer exploded");
    return createElement("div", { "data-boom-ok": "" }, children);
  },
};

/** React logs every boundary-caught error; keep the test output clean */
const quietly = async (run: () => Promise<void>) => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
};

test("a throwing renderer degrades to the fallback card; document and siblings intact", () =>
  quietly(async () => {
    vi.useFakeTimers();
    const source =
      'Intro.\n\n<Boom mode="bad">Boom body.</Boom>\n\n<Callout type="info">Callout body</Callout>\n';
    const editorRef = { current: null as MdxEditorRef | null };
    const onChange = vi.fn<(markdown: string) => void>();
    const { editor } = await mount({
      defaultValue: source,
      components: [...fumadocsUiComponents, boomSpec],
      onChange: onChange,
      ref: editorRef,
    });

    // the crashed component degraded to the card, its region text still shown
    const fallback = host!.querySelector('[data-component="Boom"] [data-component-fallback]');
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toContain("<Boom>");
    expect(fallback!.textContent).toContain("Boom body.");
    // the sibling renderer is unaffected
    expect(host!.querySelector('[data-component="Callout"] [data-component-fallback]')).toBeNull();
    expect(host!.querySelector('[data-component="Callout"]')!.textContent).toContain(
      "Callout body",
    );

    // the document stayed lossless, and editing elsewhere still works
    expect(editorRef.current!.getMarkdown()).toBe(source);
    act(() => {
      editor.commands.setTextSelection(1);
      editor.commands.insertContent("Hey. ");
    });
    act(() => void vi.advanceTimersByTime(300));
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(source.replace("Intro.", "Hey. Intro."));
  }));

test("the boundary retries on the next node update: an attr fix heals the component", () =>
  quietly(async () => {
    vi.useFakeTimers();
    const { editor } = await mount({
      defaultValue: '<Boom mode="bad">Body.</Boom>\n',
      components: [...fumadocsUiComponents, boomSpec],
    });
    expect(host!.querySelector("[data-component-fallback]")).not.toBeNull();

    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "Boom") pos = at;
      return pos === -1;
    });
    await act(async () => {
      const node = editor.state.doc.nodeAt(pos)!;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          attributes: setStringProp(node.attrs.attributes as MdxAttribute[], "mode", "ok"),
        }),
      );
    });
    expect(host!.querySelector("[data-component-fallback]")).toBeNull();
    expect(host!.querySelector("[data-boom-ok]")!.textContent).toContain("Body.");
  }));

test("a throwing renderer cannot kill the static first paint", () =>
  quietly(async () => {
    vi.useFakeTimers();
    render({
      defaultValue: 'Intro.\n\n<Boom mode="bad">Boom body.</Boom>\n',
      components: [...fumadocsUiComponents, boomSpec],
    });
    await settle(); // parse chunk → static paint; the live editor never mounts
    const staticView = host!.querySelector(".ProseMirror[aria-label]") as HTMLElement & {
      editor?: unknown;
    };
    expect(staticView.editor).toBeUndefined();
    expect(staticView.textContent).toContain("Intro.");
    const fallback = staticView.querySelector("[data-component-fallback]");
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toContain("Boom body.");
  }));

test("arrow keys enter math source on every engine (hidden text traversal differs)", async () => {
  vi.useFakeTimers();
  const source = "Before $x+y$ after.\n\n$$\nE=mc^2\n$$\n\nLast.\n";
  const { editor, dom } = await mount({ defaultValue: source, syntax: { math: true } });
  const arrow = (key: string) =>
    act(() => {
      dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  const nodes: Record<string, { pos: number; size: number }> = {};
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name.startsWith("math")) {
      nodes[node.type.name] = { pos, size: node.nodeSize };
    }
    return true;
  });
  const inline = nodes.mathInline;
  const block = nodes.mathBlock;
  const parentAt = () => editor.state.selection.$from.parent.type.name;

  // inline: from either side, one arrow enters edit mode, caret at the
  // source end (the click-to-edit position: a caret at source offset 0
  // cannot be distinguished from "before the node" in the DOM)
  act(() => editor.commands.setTextSelection(inline.pos));
  arrow("ArrowRight");
  expect(parentAt()).toBe("mathInline");
  expect(editor.state.selection.from).toBe(inline.pos + inline.size - 1);
  act(() => editor.commands.setTextSelection(inline.pos + inline.size));
  arrow("ArrowLeft");
  expect(parentAt()).toBe("mathInline");
  expect(editor.state.selection.from).toBe(inline.pos + inline.size - 1);

  // block: from the paragraph above (right/down) and below (left/up)
  act(() => editor.commands.setTextSelection(block.pos - 1));
  arrow("ArrowRight");
  expect(parentAt()).toBe("mathBlock");
  expect(editor.state.selection.from).toBe(block.pos + block.size - 1);
  act(() => editor.commands.setTextSelection(block.pos - 1));
  arrow("ArrowDown");
  expect(parentAt()).toBe("mathBlock");
  act(() => editor.commands.setTextSelection(block.pos + block.size + 1));
  arrow("ArrowLeft");
  expect(parentAt()).toBe("mathBlock");
  expect(editor.state.selection.from).toBe(block.pos + block.size - 1);
  act(() => editor.commands.setTextSelection(block.pos + block.size + 1));
  arrow("ArrowUp");
  expect(parentAt()).toBe("mathBlock");
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
  const watchers = new Set<(state: { text: string; version: string }) => void>();
  const transport: SyncTransport = {
    list: async () => ["doc.mdx"],
    read: async () => ({ text: disk, version: String(version) }),
    write: async (_path, text, base) => {
      if (base !== String(version)) {
        return { ok: false, current: { text: disk, version: String(version) } };
      }
      disk = text;
      version++;
      return { ok: true, version: String(version) };
    },
    watch: (_path, onChange) => {
      watchers.add(onChange);
      return () => watchers.delete(onChange);
    },
  };
  const statuses: string[] = [];
  render({ sync: { transport, path: "doc.mdx", onStatus: (status) => statuses.push(status) } });
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
    for (const notify of watchers) notify({ text: disk, version: String(version) });
  });
  await settle();
  expect(statuses).not.toContain("conflict");
  expect(editor.state.doc.textContent).toBe("LOCAL First.Second, from disk.");
});
