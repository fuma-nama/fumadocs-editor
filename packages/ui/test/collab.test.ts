import { expect, test } from "vitest";
import * as Y from "yjs";
import { Editor, getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Collaboration } from "@tiptap/extension-collaboration";
import {
  createSyntax,
  editorExtensions,
  parseMdxToDoc,
  serializeDocToMdx,
} from "@fumadocs-editor/core";
import { componentKeymap } from "../src/components/keymap";
import { caretPolicy } from "../src/components/caret-policy";
import { structureGuard } from "../src/components/structure";
import { fumadocsUiComponents } from "../src/components/fumadocs-ui";
import { componentExtensions } from "../src/components/node-views";
import { codeBlockExtension } from "../src/components/code-block";
import { mathExtensions } from "../src/components/math";
import { imageExtension } from "../src/components/image-view";
import { caret, specs } from "./helpers";

const syntax = createSyntax(fumadocsUiComponents, { math: true });

/** two Y.Docs wired doc-to-doc; updates queue until `flush` so edits between
 * flushes are concurrent */
function link(a: Y.Doc, b: Y.Doc) {
  const toB: Uint8Array[] = [];
  const toA: Uint8Array[] = [];
  a.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "link") toB.push(update);
  });
  b.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "link") toA.push(update);
  });
  return {
    flush() {
      while (toB.length > 0 || toA.length > 0) {
        for (const update of toB.splice(0)) Y.applyUpdate(b, update, "link");
        for (const update of toA.splice(0)) Y.applyUpdate(a, update, "link");
      }
    },
  };
}

function collabEditor(ydoc: Y.Doc) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      ...editorExtensions({ components: fumadocsUiComponents, history: false }),
      ...componentKeymap(specs),
      structureGuard(specs),
      caretPolicy,
      Collaboration.configure({ document: ydoc }),
    ],
  });
  void editor.view;
  return editor;
}

/**
 * Seed a Y.Doc with the parsed document through a throwaway editor (standing
 * in for the server authority), then hand identical copies to two editors.
 * Like clients, they see the seed as pre-existing state, not their own edit.
 */
function seedPair(mdx: string) {
  const parsed = parseMdxToDoc(mdx, syntax);
  const seedDoc = new Y.Doc();
  const seeder = collabEditor(seedDoc);
  seeder.commands.setContent(parsed.doc, { emitUpdate: false });
  seeder.destroy();
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const seed = Y.encodeStateAsUpdate(seedDoc);
  Y.applyUpdate(docA, seed);
  Y.applyUpdate(docB, seed);
  const wire = link(docA, docB);
  const a = collabEditor(docA);
  const b = collabEditor(docB);
  return { a, b, wire, parsed };
}

const identical = (a: Editor, b: Editor) => expect(a.getJSON()).toEqual(b.getJSON());

function childRange(doc: PMNode, index: number) {
  let from = 0;
  for (let i = 0; i < index; i++) from += doc.child(i).nodeSize;
  return { from, to: from + doc.child(index).nodeSize };
}

test("editor → Y → editor keeps a rich document byte-identical on serialize", () => {
  const src = `---
title: Demo
---

# Head [#anchor]

<Callout type="warn" title="Careful">
  Body *text* with \`code\`.
</Callout>

<Files>
  <Folder name="src">
    <File name="index.ts" />
  </Folder>
</Files>

\`\`\`ts title="x.ts"
const a = 1;
\`\`\`

| a | b |
| --- | --- |
| 1 | 2 |

$$
x^2
$$
`;
  const { a, b, parsed } = seedPair(src);
  // the peer never saw the source text, only the Y.Doc. Content-based
  // snapshot matching must still reproduce every byte.
  expect(serializeDocToMdx(b.getJSON(), parsed.snapshot, syntax)).toBe(src);
  expect(serializeDocToMdx(a.getJSON(), parsed.snapshot, syntax)).toBe(src);
});

test("concurrent text edits in different blocks converge", () => {
  const { a, b, wire } = seedPair("para one\n\npara two\n");
  caret(a, "one");
  a.commands.insertContent(" (a)");
  caret(b, "two");
  b.commands.insertContent(" (b)");
  wire.flush();
  identical(a, b);
  expect(a.getText()).toContain("one (a)");
  expect(a.getText()).toContain("two (b)");
});

test("concurrent edits in the same paragraph converge", () => {
  const { a, b, wire } = seedPair("shared paragraph\n");
  caret(a, "shared");
  a.commands.insertContent("A");
  caret(b, "paragraph");
  b.commands.insertContent("B");
  wire.flush();
  identical(a, b);
  expect(a.getText()).toContain("sharedA");
  expect(a.getText()).toContain("paragraphB");
});

test("concurrent attribute writes converge last-writer-wins", () => {
  const { a, b, wire } = seedPair("## Title\n");
  const set = (editor: Editor, anchor: string) => {
    const { from } = childRange(editor.state.doc, 0);
    const node = editor.state.doc.child(0);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(from, undefined, { ...node.attrs, anchor }));
  };
  set(a, "from-a");
  set(b, "from-b");
  wire.flush();
  identical(a, b);
  expect(["from-a", "from-b"]).toContain(a.state.doc.child(0).attrs.anchor);
});

test("edits in two regions of one component converge", () => {
  const { a, b, wire } = seedPair('<Callout type="info" title="Tip">\n  Body here.\n</Callout>\n');
  caret(a, "Tip");
  a.commands.insertContent("py");
  caret(b, "here");
  b.commands.insertContent(" too");
  wire.flush();
  identical(a, b);
  const out = serializeDocToMdx(a.getJSON(), undefined, syntax);
  expect(out).toContain('title="Tippy"');
  expect(out).toContain("here too");
});

test("a structural move against concurrent typing inside converges to valid MDX", () => {
  const { a, b, wire } = seedPair(
    '<Callout type="info" title="Tip">\n  Body here.\n</Callout>\n\ntrailing paragraph\n',
  );
  // A moves the component below the paragraph in one transaction
  const doc = a.state.doc;
  const callout = childRange(doc, 0);
  const tr = a.state.tr;
  tr.delete(callout.from, callout.to);
  tr.insert(tr.mapping.map(childRange(doc, 1).to), doc.child(0));
  a.view.dispatch(tr);
  // B types into the component being moved
  caret(b, "here");
  b.commands.insertContent(" while dragged");
  wire.flush();
  identical(a, b);
  const out = serializeDocToMdx(a.getJSON(), undefined, syntax);
  expect(() => parseMdxToDoc(out, syntax)).not.toThrow();
  expect(out.indexOf("trailing paragraph")).toBeLessThan(out.indexOf("<Callout"));
});

test("a peer's edit leaves unedited blocks byte-identical on serialize", () => {
  // `* bullet` survives only through the snapshot: normalization emits `-`
  const src = "* bullet one\n\nedit me\n\n## Tail\n";
  const { a, b, wire, parsed } = seedPair(src);
  caret(b, "edit me");
  b.commands.insertContent(" (edited)");
  wire.flush();
  expect(serializeDocToMdx(a.getJSON(), parsed.snapshot, syntax)).toBe(
    "* bullet one\n\nedit me (edited)\n\n## Tail\n",
  );
});

test("local undo reverts only own edits, never a peer's", () => {
  const { a, b, wire } = seedPair("hello\n");
  caret(a, "hello");
  a.commands.insertContent(" from-a");
  wire.flush();
  caret(b, "from-a");
  b.commands.insertContent(" from-b");
  wire.flush();
  expect(a.getText()).toBe("hello from-a from-b");
  a.commands.undo();
  wire.flush();
  identical(a, b);
  expect(a.getText()).toBe("hello from-b");
  expect(a.can().undo()).toBe(false);
});

test("the live editor's schema matches the server authority's", () => {
  // the sync server rebuilds PM nodes with core's spec-less schema; any node
  // or attribute the UI layer added would be dropped from every merge
  const server = getSchema(editorExtensions({ components: fumadocsUiComponents }));
  const client = getSchema([
    ...editorExtensions({
      componentNodes: false,
      codeBlock: false,
      image: false,
      mathNodes: false,
      history: false,
    }),
    codeBlockExtension(),
    imageExtension({ current: {} }),
    ...componentExtensions(specs),
    ...mathExtensions(true),
  ]);
  const attrSpec = (schema: typeof server, kind: "nodes" | "marks") => {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, type] of Object.entries(schema[kind])) {
      const attrs: Record<string, unknown> = {};
      for (const [attr, spec] of Object.entries(type.spec.attrs ?? {})) {
        attrs[attr] = (spec as { default?: unknown }).default ?? null;
      }
      out[name] = attrs;
    }
    return out;
  };
  expect(attrSpec(client, "nodes")).toEqual(attrSpec(server, "nodes"));
  expect(attrSpec(client, "marks")).toEqual(attrSpec(server, "marks"));
});
