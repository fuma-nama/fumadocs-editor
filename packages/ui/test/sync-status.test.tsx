import { afterEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import {
  createSyncClient,
  type DocumentStatus,
  type SyncTransport,
} from "@fumadocs-editor/core/sync";
import { MdxEditor, type MdxEditorProps } from "../src/editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  vi.useRealTimers();
});

function render(props: MdxEditorProps) {
  host ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(host);
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

/**
 * A backend speaking the protocol for a few files; saves always land.
 * `access.writable` goes into each subscribe answer; `access.drop()` ends the
 * connection, and the client reconnects.
 */
function backend(files: Record<string, string>, access = { writable: true, drop() {} }) {
  const versions = new Map<string, number>();
  const file = (path: string) =>
    ({
      resource: "file",
      path,
      text: files[path],
      version: String(versions.get(path) ?? 1),
    }) as const;
  const transport: SyncTransport = {
    connect(listener) {
      const later = (message: Parameters<typeof listener.message>[0]) =>
        void Promise.resolve().then(() => listener.message(message));
      void Promise.resolve().then(() => listener.open());
      access.drop = () => listener.close();
      return {
        send(message) {
          if (message.type === "hello") return later({ type: "hello", id: message.id });
          if (message.type === "subscribe" && message.resource === "file")
            return later({
              type: "update",
              id: message.id,
              ...file(message.path),
              writable: access.writable,
            });
          if (message.type !== "update" || message.resource !== "file") return;
          if (message.base === file(message.path).version) {
            files[message.path] = message.text;
            versions.set(message.path, (versions.get(message.path) ?? 1) + 1);
          }
          later({ type: "update", id: message.id, ...file(message.path) });
        },
        close: () => listener.close(),
      };
    },
  };
  return createSyncClient({ transport });
}

function setup() {
  vi.useFakeTimers();
  const client = backend({ "a.mdx": "First.\n", "b.mdx": "Other.\n" });
  const statuses: DocumentStatus[] = [];
  const show = (path: string) =>
    render({ sync: { client, path, onStatus: (status) => void statuses.push(status) } });
  return { statuses, show };
}

test("onStatus reports the status a document opens with", async () => {
  const { statuses, show } = setup();
  show("a.mdx");
  await settle();
  await settle();
  expect(statuses).toEqual(["synced"]);
});

test("onStatus does not repeat an unchanged status on re-render", async () => {
  const { statuses, show } = setup();
  show("a.mdx");
  await settle();
  await settle();
  show("a.mdx"); // a new `sync` object for the same path
  await settle();
  show("a.mdx");
  await settle();
  expect(statuses).toEqual(["synced"]);
});

test("onStatus reports the next document's status after the path changes", async () => {
  const { statuses, show } = setup();
  show("a.mdx");
  await settle();
  await settle();
  const editor = await hydrate();
  act(() => {
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("LOCAL ");
  });
  act(() => void vi.advanceTimersByTime(300)); // the change debounce, not the autosave
  await settle();
  expect(statuses.at(-1)).toBe("dirty");

  show("b.mdx");
  await settle();
  await settle();
  // a was last reported "dirty"; b opens clean and says so
  expect(statuses).toEqual(["synced", "dirty", "synced"]);
});

test("onStatus still reports every change of an open document", async () => {
  const { statuses, show } = setup();
  show("a.mdx");
  await settle();
  await settle();
  const editor = await hydrate();
  act(() => {
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("LOCAL ");
  });
  act(() => void vi.advanceTimersByTime(2000)); // the change debounce, then the autosave
  await settle();
  expect(statuses.slice(statuses.indexOf("dirty"))).toEqual(["dirty", "saving", "synced"]);
});

test("onWritable reports a change of write access after a reconnect, not the opening value", async () => {
  vi.useFakeTimers();
  const access = { writable: true, drop() {} };
  const client = backend({ "a.mdx": "First.\n" }, access);
  const opened: boolean[] = [];
  const writable: boolean[] = [];
  render({
    sync: {
      client,
      path: "a.mdx",
      onOpen: (result) => void opened.push(result.writable),
      onWritable: (next) => void writable.push(next),
    },
  });
  await settle();
  await settle();
  expect(opened).toEqual([true]);
  expect(writable).toEqual([]);

  const reconnect = async () => {
    act(() => access.drop());
    act(() => void vi.advanceTimersByTime(1000)); // the reconnect backoff
    await settle();
    await settle();
  };
  access.writable = false;
  await reconnect();
  expect(writable).toEqual([false]);
  await reconnect(); // unchanged: not reported again
  expect(writable).toEqual([false]);
  access.writable = true;
  await reconnect();
  expect(writable).toEqual([false, true]);
  expect(opened).toEqual([true]);
});

test("the status shows a document that lost write access as read only", async () => {
  vi.useFakeTimers();
  const access = { writable: true, drop() {} };
  const client = backend({ "a.mdx": "First.\n" }, access);
  render({ sync: { client, path: "a.mdx" } });
  await settle();
  await settle();
  const label = () => host!.textContent;
  expect(label()).toContain("Saved");

  const reconnect = async () => {
    act(() => access.drop());
    act(() => void vi.advanceTimersByTime(1000)); // the reconnect backoff
    await settle();
    await settle();
  };
  access.writable = false;
  await reconnect();
  expect(label()).toContain("Read only");
  expect(label()).not.toContain("Saved");

  // an edit the host let through is kept, and the status says it is not saved
  const editor = await hydrate();
  act(() => {
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("LOCAL ");
  });
  act(() => void vi.advanceTimersByTime(2000));
  await settle();
  expect(label()).toContain("Read only, not saved");

  access.writable = true;
  await reconnect();
  act(() => void vi.advanceTimersByTime(2000)); // the autosave
  await settle();
  expect(label()).not.toContain("Read only");
  expect(label()).toContain("Saved");
});
