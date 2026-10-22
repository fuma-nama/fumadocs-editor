import { expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions, parseMdxToDoc } from "@fumadocs-editor/core";
import { imageExtension } from "../src/components/image-view";
import { track } from "./helpers";

const media = {
  upload: async () => "",
  resolve: (src: string) => `https://cdn.example/${src}`,
};

function makeEditor(mdx: string) {
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

const imageSrc = (editor: Editor) => {
  let src: unknown;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") src = node.attrs.src;
  });
  return src;
};

test("an image drawn without its node view loads the resolved src", () => {
  const editor = makeEditor("![a](assets/a.png)\n");
  // what @tiptap/react's EditorContent does on unmount (and on React's
  // StrictMode double effect in development)
  editor.view.setProps({ nodeViews: {} });
  const img = editor.view.dom.querySelector("img");
  expect(img?.getAttribute("src")).toBe("https://cdn.example/assets/a.png");
});

test("copied image HTML pastes back with the document's src", () => {
  const editor = makeEditor("![a](assets/a.png)\n");
  editor.commands.setContent(editor.getHTML());
  expect(imageSrc(editor)).toBe("assets/a.png");
});
