import type { Extensions } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder, Selection } from "@tiptap/extensions";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Heading } from "@tiptap/extension-heading";
import { Link } from "@tiptap/extension-link";
import { Image } from "@tiptap/extension-image";
import { BulletList, ListItem, OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { mdxNodes } from "./mdx-nodes";
import { MdxBlockRegion, MdxInlineRegion, componentNodeTypes } from "../components/nodes";
import type { ComponentSpec } from "../components/spec";
import { mathNodes } from "../syntax/math/nodes";

/** code fences keep their info string (` ```ts tab="cli" `) */
export const CodeBlockMdx = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      meta: { default: null },
    };
  },
});

/**
 * Fumadocs heading suffixes live as attributes: `## Title [#custom-id]`
 * (anchor), `[!toc]` (hidden from TOC) and `[toc]` (TOC-only). Parsed out
 * of the text so flags never read as prose; surfaced as data attributes for
 * the editor chrome.
 */
export const HeadingMdx = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      anchor: { default: null as string | null },
      toc: { default: null as "hide" | "only" | null },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = this.options.levels.includes(node.attrs.level)
      ? (node.attrs.level as number)
      : this.options.levels[0];
    const attrs: Record<string, unknown> = { ...HTMLAttributes };
    delete attrs.anchor;
    delete attrs.toc;
    if (node.attrs.anchor) attrs["data-anchor"] = node.attrs.anchor;
    if (node.attrs.toc) attrs["data-toc"] = node.attrs.toc;
    return [`h${level}`, attrs, 0];
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

/**
 * mdast's `spread`: a loose list has blank lines between its items, a loose
 * item between its own blocks. Kept on the node so an edited list is written
 * back as it was parsed; lists made in the editor stay tight.
 */
const spreadAttribute = {
  spread: {
    default: false,
    parseHTML: (element: HTMLElement) => element.hasAttribute("data-spread"),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.spread ? { "data-spread": "" } : {},
  },
};

const BulletListMdx = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...spreadAttribute };
  },
});

const OrderedListMdx = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...spreadAttribute };
  },
});

const ListItemMdx = ListItem.extend({
  addAttributes() {
    return { ...this.parent?.(), ...spreadAttribute };
  },
});

const TaskListMdx = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...spreadAttribute };
  },
});

const TaskItemMdx = TaskItem.extend({
  addAttributes() {
    return { ...this.parent?.(), ...spreadAttribute };
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
  /** Registered components; each becomes a node type ({@link componentNodeTypes}). */
  components?: ComponentSpec[];
  /**
   * Include the base (view-less) region and component nodes. Set `false` when
   * the UI layer supplies its own node-view-backed versions to avoid duplicate
   * schema names.
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
  /** Include the base image node; `false` when the UI ships a node view. */
  image?: boolean;
  /**
   * Include the base math nodes (inert either way; the dialect gate lives in
   * `SyntaxOptions.math`); `false` when the UI ships node views.
   */
  mathNodes?: boolean;
  /**
   * Include the local undo/redo history. Set `false` under collaborative
   * editing, where the Collaboration extension supplies a `Y.UndoManager`
   * that undoes only this client's own edits.
   */
  history?: boolean;
}

export function editorExtensions({
  components = [],
  componentNodes = true,
  codeBlock = true,
  image = true,
  mathNodes: math = true,
  history = true,
}: EditorExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      underline: false,
      codeBlock: false,
      heading: false,
      link: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      // the UI layer draws its own drop indicator from the real drop target;
      // the stock cursor previews dropPoint, which disagrees with it
      dropcursor: false,
      ...(history ? {} : { undoRedo: false as const }),
    }),
    // keeps the text selection visibly highlighted (`.selection` decoration)
    // while focus is in the bubble or a panel: native ::selection paints only
    // for the focused element
    Selection,
    // a ghost hint on the current empty paragraph; `includeChildren` stays off
    // so component regions keep their own placeholders
    Placeholder.configure({ placeholder: "Write, or type '/' for blocks…" }),
    HeadingMdx,
    ...(codeBlock ? [CodeBlockMdx] : []),
    LinkMdx.configure({ openOnClick: false }),
    ...(image ? [Image.configure({ inline: true })] : []),
    BulletListMdx,
    OrderedListMdx,
    ListItemMdx,
    TaskListMdx,
    TaskItemMdx.configure({ nested: true }),
    // prosemirror-tables would otherwise turn a node-selected table into a
    // CellSelection: the table then rings and moves like any other block
    TableMdx.configure({ allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    ...mdxNodes,
    ...(componentNodes ? [MdxInlineRegion, MdxBlockRegion, ...componentNodeTypes(components)] : []),
    ...(math ? mathNodes : []),
  ];
}
