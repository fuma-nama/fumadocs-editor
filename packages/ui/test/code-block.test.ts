import { expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import {
  createSyntax,
  editorExtensions,
  parseMdxToDoc,
  serializeDocToMdx,
} from "@fumadocs-editor/core";
import { addCodeTab, codeBlockExtension } from "../src/components/code-block";
import { buildCodeMeta, parseCodeMeta } from "../src/components/code-meta";
import { track } from "./helpers";

test("parses and rebuilds the tab meta", () => {
  const meta = parseCodeMeta('tab="npm" title="a.ts" tab-group="pkg" twoslash');
  expect(meta).toEqual({
    title: "a.ts",
    lineNumbers: false,
    noCopy: false,
    tab: "npm",
    rest: 'tab-group="pkg" twoslash',
  });
  expect(buildCodeMeta(meta)).toBe('tab="npm" title="a.ts" tab-group="pkg" twoslash');
  // fumadocs only groups a quoted tab
  expect(parseCodeMeta("tab lineNumbers")).toMatchObject({ tab: null, rest: "tab" });
  expect(parseCodeMeta('tab=""').tab).toBe("");
});

const syntax = createSyntax();
const source = `\`\`\`ts tab="npm"
npm i
\`\`\`

\`\`\`ts tab="pnpm"
pnpm i
\`\`\`
`;

function makeEditor(mdx: string) {
  const { doc, snapshot } = parseMdxToDoc(mdx, syntax);
  const editor = track(
    new Editor({
      element: document.createElement("div"),
      extensions: [...editorExtensions({ codeBlock: false }), codeBlockExtension()],
      content: doc,
    }),
  );
  return { editor, serialize: () => serializeDocToMdx(editor.getJSON(), snapshot, syntax) };
}

test("addCodeTab numbers the new tab after the whole group", () => {
  const { editor, serialize } = makeEditor(source);
  expect(addCodeTab(editor, 0)).toBe(true);
  expect(editor.state.selection.$from.parent.attrs.meta).toBe('tab="Tab 3"');
  expect(serialize()).toBe(`\`\`\`ts tab="npm"
npm i
\`\`\`

\`\`\`ts tab="Tab 3"
\`\`\`

\`\`\`ts tab="pnpm"
pnpm i
\`\`\`
`);
});

test("addCodeTab names a plain block's tab first", () => {
  const { editor, serialize } = makeEditor('```ts title="a.ts"\nconst a = 1;\n```\n');
  expect(addCodeTab(editor, 0)).toBe(true);
  expect(serialize()).toBe(`\`\`\`ts tab="Tab 1" title="a.ts"
const a = 1;
\`\`\`

\`\`\`ts tab="Tab 2"
\`\`\`
`);
});

function codeBlocks(editor: Editor): number {
  let n = 0;
  editor.state.doc.forEach((node) => void (node.type.spec.code && n++));
  return n;
}

test("Mod-Enter adds a tab only inside a tabbed block", () => {
  const { editor } = makeEditor(source);
  editor.commands.setTextSelection(3);
  editor.commands.keyboardShortcut("Mod-Enter");
  expect(codeBlocks(editor)).toBe(3);

  const plain = makeEditor("```ts\nx\n```\n").editor;
  plain.commands.setTextSelection(1);
  plain.commands.keyboardShortcut("Mod-Enter");
  expect(codeBlocks(plain)).toBe(1);
});
