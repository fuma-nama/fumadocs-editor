import { expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, parseMdxToDoc } from "@fumadocs-editor/core";
import { imageExtension, insertImages } from "../src/components/image-view";
import type { MediaProvider } from "../src/components/media";
import { track } from "./helpers";

const file = new File(["png"], "diagram.png", { type: "image/png" });

function makeEditor(media: MediaProvider, mdx: string) {
  const editor = track(
    new Editor({
      element: document.createElement("div"),
      extensions: [...editorExtensions({ image: false }), imageExtension({ media })],
      content: parseMdxToDoc(mdx).doc,
    }),
  );
  void editor.view;
  return editor;
}

const images = (editor: Editor) => {
  const srcs: unknown[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") srcs.push(node.attrs.src);
  });
  return srcs;
};

/** the range of the first occurrence of `text` */
function rangeOf(editor: Editor, text: string) {
  let range = { from: -1, to: -1 };
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
    if (range.from < 0 && at >= 0) range = { from: pos + at, to: pos + at + text.length };
  });
  return range;
}

test("a failed upload calls onError", async () => {
  const error = new Error("storage full");
  const onError = vi.fn();
  const media: MediaProvider = { upload: () => Promise.reject(error), onError };
  const editor = makeEditor(media, "Text\n");
  await insertImages(editor, media, [file], 1);
  expect(onError).toHaveBeenCalledWith(error, file);
  expect(images(editor)).toEqual([]);
});

test("an uploaded image replaces the given range", async () => {
  const media: MediaProvider = { upload: async () => "./assets/diagram.png" };
  const editor = makeEditor(media, "Before /image after\n");
  await insertImages(editor, media, [file], rangeOf(editor, "/image"));
  expect(images(editor)).toEqual(["./assets/diagram.png"]);
  expect(editor.state.doc.textContent).toBe("Before  after");
});

test("a failed upload leaves the given range in place", async () => {
  const media: MediaProvider = {
    upload: () => Promise.reject(new Error("offline")),
    onError: () => {},
  };
  const editor = makeEditor(media, "Before /image after\n");
  await insertImages(editor, media, [file], rangeOf(editor, "/image"));
  expect(editor.state.doc.textContent).toBe("Before /image after");
});
