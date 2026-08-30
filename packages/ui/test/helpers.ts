import { expect } from "vitest";
import { Editor } from "@tiptap/core";
import {
  createSyntax,
  editorExtensions,
  parseMdxToDoc,
  serializeDocToMdx,
} from "@fumadocs-editor/core";
import { componentKeymap, type SpecMap } from "../src/components/keymap";
import { caretPolicy } from "../src/components/caret-policy";
import { structureGuard } from "../src/components/structure";
import { fumadocsUiComponents } from "../src/components/fumadocs-ui";

export const syntax = createSyntax(fumadocsUiComponents);
export const specs: SpecMap = new Map(fumadocsUiComponents.map((spec) => [spec.name, spec]));

export function makeEditor(mdx: string) {
  const { doc, snapshot } = parseMdxToDoc(mdx, syntax);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      ...editorExtensions(),
      ...componentKeymap(specs),
      structureGuard(specs),
      caretPolicy,
    ],
    content: doc,
  });
  void editor.view; // the view (and plugin view hooks) mount lazily
  // serialized output must always reparse: structural moves may never emit invalid MDX
  const serialize = () => {
    const out = serializeDocToMdx(editor.getJSON(), snapshot, syntax);
    expect(() => parseMdxToDoc(out, syntax)).not.toThrow();
    return out;
  };
  return { editor, serialize };
}

/** place the caret right after (or at the start of) the first occurrence of `text` */
export function caret(editor: Editor, text: string, at: "start" | "end" = "end") {
  let pos = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos !== -1) return false;
    if (node.isText && node.text!.includes(text)) {
      const index = node.text!.indexOf(text);
      pos = nodePos + index + (at === "end" ? text.length : 0);
    }
  });
  if (pos === -1) throw new Error(`text not found: ${text}`);
  editor.commands.setTextSelection(pos);
  return pos;
}

/** dispatch a keydown; returns whether a handler consumed it */
export function press(editor: Editor, key: string, init: KeyboardEventInit = {}) {
  return !editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
}

/** node names on the path from doc to the caret */
export function caretPath(editor: Editor): string[] {
  const { $from } = editor.state.selection;
  const path: string[] = [];
  for (let depth = 1; depth <= $from.depth; depth++) path.push($from.node(depth).type.name);
  return path;
}
