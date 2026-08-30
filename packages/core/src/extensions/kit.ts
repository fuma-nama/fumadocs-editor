import type { Extensions } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder, Selection } from "@tiptap/extensions";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Link } from "@tiptap/extension-link";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { mdxNodes } from "./mdx-nodes";
import { mdxComponentNodes } from "../components/nodes";

/** code fences keep their info string (` ```ts tab="cli" `) */
export const CodeBlockMdx = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      meta: { default: null },
    };
  },
});

/** markdown links carry an optional title: `[text](url "title")` */
export const LinkMdx = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    };
  },
});

/** column alignment from GFM tables lives on the table, not per-cell */
export const TableMdx = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: { default: null },
    };
  },
});

export interface EditorExtensionsOptions {
  /**
   * Include the base (view-less) component nodes. Set `false` when the UI layer
   * supplies its own node-view-backed versions to avoid duplicate schema names.
   * @defaultValue true
   */
  componentNodes?: boolean;
  /**
   * Include the base {@link CodeBlockMdx} node. Set `false` when the UI layer
   * supplies its own (e.g. a syntax-highlighted, node-view-backed version) to
   * avoid duplicate schema names.
   * @defaultValue true
   */
  codeBlock?: boolean;
}

export function editorExtensions({
  componentNodes = true,
  codeBlock = true,
}: EditorExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      underline: false,
      codeBlock: false,
      link: false,
      // the UI layer draws its own drop indicator from the real drop target;
      // the stock cursor previews dropPoint, which disagrees with it
      dropcursor: false,
    }),
    // keeps the text selection visibly highlighted (`.selection` decoration)
    // while focus is in the bubble or a panel: native ::selection paints only
    // for the focused element
    Selection,
    // a ghost hint on the current empty paragraph; `includeChildren` stays off
    // so component regions keep their own placeholders
    Placeholder.configure({ placeholder: "Write, or type '/' for blocks…" }),
    ...(codeBlock ? [CodeBlockMdx] : []),
    LinkMdx.configure({ openOnClick: false }),
    Image.configure({ inline: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableMdx,
    TableRow,
    TableHeader,
    TableCell,
    ...mdxNodes,
    ...(componentNodes ? mdxComponentNodes : []),
  ];
}
