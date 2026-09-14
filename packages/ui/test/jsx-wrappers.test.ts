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

function deleteText(text: string) {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (position >= 0) return false;
    const offset = node.text?.indexOf(text) ?? -1;
    if (offset >= 0) position = pos + offset;
  });
  expect(position).toBeGreaterThan(0);
  editor.view.dispatch(editor.state.tr.delete(position, position + text.length));
}

test.each([
  'Before <span className="text-red-400">xxx</span> after.\n',
  'Before <Icon name="x" /> after.\n',
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

test.each([
  ["<span", "<strong", "Before <strong>xxx</strong> after.\n"],
  ["</span", "</em", "Before <em>xxx</em> after.\n"],
])("renaming %s renames the partner tag", (before, after, output) => {
  const { snapshot } = mount("Before <span>xxx</span> after.\n");
  replaceText(before, after);
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(output);
});

test("renaming a block tag renames its partner", () => {
  const { snapshot } = mount('<div className="x">\n\nxxx\n\n</div>\n');
  replaceText("</div", "</section");
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(
    '<section className="x">\n  xxx\n</section>\n',
  );
});

test.each([
  [
    'Before <span className="text-red-400">xxx</span> after.\n',
    'Before <span className="text>xxx</span> after.\n',
  ],
  ['<div className="text-red-400">\n\nxxx\n\n</div>\n', '<div className="text>\n  xxx\n</div>\n'],
])("an unclosed attribute value keeps the element: %s", (source, output) => {
  const { snapshot } = mount(source);
  replaceText('"text-red-400"', '"text');
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(output);
});

function typeText(text: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, text));
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text));
}

test("typing = after an attribute name opens quotes, Backspace closes them again", () => {
  const { snapshot } = mount("Before <span title>xxx</span> after.\n");
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (position < 0 && node.text === "<span title>") position = pos + 11;
  });
  editor.commands.setTextSelection(position);
  typeText("=");
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(
    'Before <span title="">xxx</span> after.\n',
  );
  expect(editor.state.selection.from).toBe(position + 2);
  typeText("a");
  typeText('"');
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(
    'Before <span title="a">xxx</span> after.\n',
  );
  expect(editor.state.selection.from).toBe(position + 4);
  editor.commands.setTextSelection(position + 2);
  editor.view.dispatch(editor.state.tr.delete(position + 2, position + 3));
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
  );
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe(
    "Before <span title>xxx</span> after.\n",
  );
});

test.each(["<span>", "</span>"])(
  "a broken %s bracket removes the tag pair, keeping the content",
  (tag) => {
    const { snapshot } = mount("Before <span>xxx</span> after.\n");
    deleteText(tag.slice(-1) === ">" ? tag.slice(1) : tag);
    expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe("Before xxx after.\n");
    editor.commands.undo();
    expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe("Before <span>xxx</span> after.\n");
  },
);

test("a broken block tag unwraps the element", () => {
  const { snapshot } = mount('<div className="text-red-400">\n\nxxx\n\n</div>\n');
  deleteText(">");
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe("xxx\n");
});

test("a lone tag that stops self-closing is removed", () => {
  const { snapshot } = mount('<Widget\n  title="x > y"\n  value={{ test: ">" }}\n/>\n');
  deleteText("/>");
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe("");
});

test("closing a tag in place drops its partner and marks it self-closing", () => {
  const { snapshot } = mount("Before <span>xxx</span> after.\n");
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (position < 0 && node.text === "<span>") position = pos + 5;
  });
  editor.view.dispatch(editor.state.tr.insertText("/", position));
  expect(serializeDocToMdx(editor.getJSON(), snapshot)).toBe("Before <span/>xxx after.\n");
  const tag = editor.getJSON().content![0].content![1];
  expect(tag.marks![0].attrs!.self).toBe(true);
});
