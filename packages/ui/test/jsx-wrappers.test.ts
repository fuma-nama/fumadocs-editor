import { afterEach, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { DOMParser } from "@tiptap/pm/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMdxToDoc, serializeDocToMdx } from "@fumadocs-editor/core";
import { editorExtensions } from "@fumadocs-editor/core/extensions";
import { contentStyles } from "../src/components/content-styles";
import { StaticMdx } from "../src/static-mdx";

let editor: Editor;
afterEach(() => editor?.destroy());

function mount(source: string) {
  const parsed = parseMdxToDoc(source);
  editor = new Editor({ extensions: [...editorExtensions(), contentStyles], content: parsed.doc });
  return parsed;
}

function replaceText(before: string, after: string) {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    const offset = node.text?.indexOf(before) ?? -1;
    if (offset >= 0) position = pos + offset;
  });
  expect(position).toBeGreaterThan(0);
  editor.commands.setTextSelection({ from: position, to: position + before.length });
  // Use a text transaction; insertContent would parse tag strings as HTML.
  editor.view.dispatch(editor.state.tr.insertText(after));
}

test.each([
  'Before <span className="text-red-400">xxx</span> after.\n',
  '<div className="text-red-400">\n\nxxx\n\n</div>\n',
  '<Widget enabled title="A &amp; &quot;B&quot;" value={count > 1} {...props}>xxx</Widget>\n',
  '<Widget\n  title="x > y"\n  value={{ test: ">" }}\n/>\n',
  "<>xxx</>\n",
])("JSX stays editable source in static and live views: %s", (source) => {
  const { doc, snapshot } = mount(source);
  expect(editor.view.dom.querySelector('[contenteditable="false"]')).toBeNull();
  editor.state.doc.descendants((node) => {
    expect(node.isInline && !node.isLeaf).toBe(false);
  });
  const staticHost = document.createElement("div");
  staticHost.innerHTML = renderToStaticMarkup(createElement(StaticMdx, { doc, specs: new Map() }));
  expect(staticHost.querySelector(".ProseMirror")!.textContent).toBe(editor.view.dom.textContent);
  const fromDOM = DOMParser.fromSchema(editor.schema).parse(editor.view.dom);
  expect(serializeDocToMdx(fromDOM.toJSON(), snapshot)).toBe(source);
});

test.each([
  'Before <span className="text-red-400">xxx</span> after.\n',
  '<div className="text-red-400">\n\nxxx\n\n</div>\n',
])("direct attribute and child edits survive serialization and undo: %s", (source) => {
  const { snapshot } = mount(source);
  replaceText("text-red-400", "text-blue-400");
  replaceText("xxx", "edited text");
  const output = serializeDocToMdx(editor.getJSON(), snapshot);
  expect(output).toContain('className="text-blue-400"');
  expect(output).toContain("edited text");
  expect(() => parseMdxToDoc(output)).not.toThrow();
  while (editor.can().undo()) editor.commands.undo();
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(source);
});

test("incomplete tags stay as authored source while typing", () => {
  const { snapshot } = mount('Before <span className="red">xxx</span> after.\n');
  replaceText('="red"', "=");
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(
    "Before <span className=>xxx</span> after.\n",
  );
  replaceText("className=", 'className="blue"');
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(
    'Before <span className="blue">xxx</span> after.\n',
  );
});

test("opening and closing tag names can be edited directly", () => {
  const { snapshot } = mount("Before <span>xxx</span> after.\n");
  replaceText("<span", "<strong");
  replaceText("</span", "</strong");
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(
    "Before <strong>xxx</strong> after.\n",
  );
});
