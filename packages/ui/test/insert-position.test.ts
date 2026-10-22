import { expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, parseMdxToDoc } from "@fumadocs-editor/core";
import { imageExtension, insertImages } from "../src/components/image-view";
import type { MediaProvider } from "../src/components/media";
import { track } from "./helpers";

const file = (name = "diagram.png") => new File(["png"], name, { type: "image/png" });

/** a provider whose uploads resolve when the test says so, in order */
function pendingMedia() {
  const pending: ((src: string) => void)[] = [];
  const media: MediaProvider = {
    upload: () => new Promise<string>((resolve) => pending.push(resolve)),
  };
  const settle = async (src: string) => {
    await Promise.resolve();
    pending.shift()?.(src);
  };
  return { media, settle };
}

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

/** the document as text, images as `[src]` */
const text = (editor: Editor) => {
  let out = "";
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") out += `[${String(node.attrs.src)}]`;
    else if (node.isText) out += node.text;
    else if (node.isBlock && out !== "") out += "|";
  });
  return out;
};

/** the position just after the first occurrence of `text` */
function after(editor: Editor, needle: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text?.indexOf(needle) ?? -1) : -1;
    if (at < 0 && index >= 0) at = pos + index + needle.length;
  });
  return at;
}

function rangeOf(editor: Editor, needle: string) {
  const to = after(editor, needle);
  return { from: to - needle.length, to };
}

test("an image goes where it was dropped, though text was added above meanwhile", async () => {
  const { media, settle } = pendingMedia();
  const editor = makeEditor(media, "First.\n\nSecond, here.\n");
  const done = insertImages(editor, media, [file()], after(editor, "Second,"));
  editor.commands.insertContentAt(1, "Added. ");
  await settle("a.png");
  await done;
  expect(text(editor)).toBe("Added. First.|Second,[a.png] here.");
});

test("an image still goes in when the document shrank below its position", async () => {
  const { media, settle } = pendingMedia();
  const editor = makeEditor(media, "First.\n\nSecond paragraph, long enough.\n");
  const done = insertImages(editor, media, [file()], after(editor, "long enough."));
  editor.commands.setContent(parseMdxToDoc("Hi\n").doc);
  await settle("a.png");
  await expect(done).resolves.toBeUndefined();
  expect(text(editor)).toContain("[a.png]");
});

test("the slash command range is replaced, though text was added above meanwhile", async () => {
  const { media, settle } = pendingMedia();
  const editor = makeEditor(media, "Before /image after\n");
  const done = insertImages(editor, media, [file()], rangeOf(editor, "/image"));
  editor.commands.insertContentAt(1, "Added. ");
  await settle("a.png");
  await done;
  expect(text(editor)).toBe("Added. Before [a.png] after");
});

test("a slash command range removed meanwhile replaces nothing else", async () => {
  const { media, settle } = pendingMedia();
  const editor = makeEditor(media, "Before /image after\n");
  const range = rangeOf(editor, "/image");
  const done = insertImages(editor, media, [file()], range);
  editor.commands.deleteRange(range);
  await settle("a.png");
  await done;
  expect(text(editor)).toBe("Before [a.png] after");
});

test("several images keep their order", async () => {
  const { media, settle } = pendingMedia();
  const editor = makeEditor(media, "Text.\n");
  const done = insertImages(editor, media, [file("1.png"), file("2.png")], after(editor, "Text."));
  await settle("1.png");
  await settle("2.png");
  await done;
  expect(text(editor)).toBe("Text.[1.png][2.png]");
});

test("text typed at the drop point while uploading stays after the image", async () => {
  const { media, settle } = pendingMedia();
  const editor = makeEditor(media, "Text.\n");
  const at = after(editor, "Text.");
  const done = insertImages(editor, media, [file()], at);
  editor.commands.insertContentAt(at, " more");
  await settle("a.png");
  await done;
  expect(text(editor)).toBe("Text.[a.png] more");
});
