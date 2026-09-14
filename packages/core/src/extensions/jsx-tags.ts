import { Mark, Node, mergeAttributes } from "@tiptap/core";
import type { Fragment, MarkType, Node as PMNode } from "@tiptap/pm/model";
import { Plugin, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

export const JSX_TAG_MARK = "mdxJsxTag";
export const JSX_TAG_BLOCK = "mdxJsxTagBlock";
export const JSX_FLOW_ELEMENT = "mdxJsxFlowElement";

/*
 * Unregistered JSX is edited as source: inline tags are text carrying the tag
 * mark, block tags are textblocks around the element's children. Names and
 * attributes are typed in place; a renamed tag renames its partner. Only the
 * brackets are structure: a tag that loses them, or its partner, is removed
 * together with the partner so the document always re-parses.
 */

type Kind = "open" | "close" | "self";

const kindOf = (tag: string): Kind =>
  tag.startsWith("</") ? "close" : tag.endsWith("/>") ? "self" : "open";

/** an unclosed quote or brace: the scan ends inside an attribute value */
function unbalanced(text: string): boolean {
  let braces = 0;
  let quote = "";
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "{") braces++;
    else if (c === "}") braces--;
  }
  return quote !== "" || braces > 0;
}

/**
 * `[start, end)` of each tag in a run of tag source; null once a bracket is
 * gone or other text sits between tags. Quoted and braced values may hold
 * `>`; while one is unclosed, the rest of the run is the tag.
 */
function splitTags(text: string): [number, number][] | null {
  const out: [number, number][] = [];
  for (let i = 0; i < text.length;) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    if (text[i] !== "<") return null;
    let end = i + 1;
    while (end < text.length && (text[end] !== ">" || unbalanced(text.slice(i, end)))) end++;
    if (end === text.length) {
      if (!text.endsWith(">")) return null;
    } else end++;
    out.push([i, end]);
    i = end;
  }
  return out;
}

const NAME = /^<\/?([\w$.:-]*)/;

/** the name's `[start, end)` within a tag */
function nameRange(tag: string): [number, number] {
  const prefix = tag.startsWith("</") ? 2 : 1;
  return [prefix, prefix + NAME.exec(tag)![1].length];
}

function blockKind(node: PMNode): Kind | null {
  if (node.type.name !== JSX_TAG_BLOCK) return null;
  const text = node.textContent.trim();
  return text.startsWith("<") && text.endsWith(">") ? kindOf(text) : null;
}

interface Op {
  from: number;
  to: number;
  /** replacement for the range; deleted when absent */
  content?: Fragment | string;
}

interface Tag extends Op {
  text: string;
}

/** the partner outside the edit takes the edited tag's name */
function syncNames(open: Tag, close: Tag, from: number, to: number, ops: Op[]) {
  const [os, oe] = nameRange(open.text);
  const [cs, ce] = nameRange(close.text);
  const openName = open.text.slice(os, oe);
  const closeName = close.text.slice(cs, ce);
  if (openName === closeName) return;
  const edited = (tag: Tag) => tag.from < to && tag.to > from;
  if (edited(close) && !edited(open)) {
    ops.push({ from: open.from + os, to: open.from + oe, content: closeName });
  } else ops.push({ from: close.from + cs, to: close.from + ce, content: openName });
}

/** pair the tag runs of one textblock; unmatched and broken tags are deleted */
function repairInline(
  tr: Transaction,
  node: PMNode,
  base: number,
  from: number,
  to: number,
  mark: MarkType,
  ops: Op[],
) {
  const keep = (op: Op, self: boolean) => tr.addMark(op.from, op.to, mark.create({ self }));
  const open: Tag[] = [];
  let runFrom = -1;
  let run = "";
  const flush = () => {
    if (runFrom < 0) return;
    const tags = splitTags(run);
    if (!tags) ops.push({ from: runFrom, to: runFrom + run.length });
    for (const [start, end] of tags ?? []) {
      const text = run.slice(start, end);
      const kind = kindOf(text);
      const tag = { from: runFrom + start, to: runFrom + end, text };
      if (kind === "open") open.push(tag);
      else if (kind === "self") keep(tag, true);
      else if (open.length > 0) {
        const partner = open.pop()!;
        keep(partner, false);
        keep(tag, false);
        syncNames(partner, tag, from, to, ops);
      } else ops.push(tag);
    }
    runFrom = -1;
    run = "";
  };
  node.forEach((child, offset) => {
    if (child.isText && mark.isInSet(child.marks)) {
      if (runFrom < 0) runFrom = base + offset;
      run += child.text;
    } else flush();
  });
  flush();
  ops.push(...open);
}

/** repairs `from`..`to`; returns the range its own edits cover in the new doc */
function repair(
  tr: Transaction,
  from: number,
  to: number,
  mark: MarkType,
): [number, number] | null {
  const ops: Op[] = [];
  tr.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (node.type.name === JSX_FLOW_ELEMENT) {
      const open = node.firstChild!;
      const close = node.lastChild!;
      if (blockKind(open) !== "open" || blockKind(close) !== "close") {
        ops.push({ from: pos, to: pos + node.nodeSize, content: node.content });
        return false;
      }
      const tag = (block: PMNode, start: number): Tag => {
        const at = block.textContent.indexOf("<");
        const from = start + 1 + at;
        return { from, to: start + block.nodeSize - 1, text: block.textContent.slice(at) };
      };
      syncNames(
        tag(open, pos + 1),
        tag(close, pos + node.nodeSize - 1 - close.nodeSize),
        from,
        to,
        ops,
      );
      return;
    } else if (node.type.name === JSX_TAG_BLOCK) {
      const own =
        parent?.type.name === JSX_FLOW_ELEMENT && (index === 0 || index === parent.childCount - 1);
      if (!own && blockKind(node) !== "self") ops.push({ from: pos, to: pos + node.nodeSize });
    } else if (node.isTextblock) {
      repairInline(tr, node, pos + 1, from, to, mark, ops);
    } else return;
    return false;
  });
  if (ops.length === 0) return null;
  ops.sort((a, b) => b.from - a.from);
  const steps = tr.steps.length;
  for (const { from, to, content } of ops) {
    if (typeof content === "string") tr.insertText(content, from, to);
    else if (content) tr.replaceWith(from, to, content);
    else tr.delete(from, to);
  }
  return [ops[ops.length - 1].from, tr.mapping.slice(steps).map(ops[0].to, 1)];
}

/** the caret sits in tag source: a tag block, or text inside the tag mark */
function inTagSource(state: EditorState, mark: MarkType): boolean {
  const { $from, empty } = state.selection;
  return empty && ($from.parent.type.name === JSX_TAG_BLOCK || !!mark.isInSet($from.marks()));
}

function tagPlugin(mark: MarkType): Plugin {
  return new Plugin({
    props: {
      // `name=` grows its quotes, and a typed `"` steps over the closing one
      handleTextInput(view, from, to, text) {
        const { state } = view;
        if (from !== to || !inTagSource(state, mark)) return false;
        const $from = state.doc.resolve(from);
        const before = $from.nodeBefore?.text ?? "";
        const after = $from.nodeAfter?.text?.[0];
        if (text === '"' && after === '"' && unbalanced(before)) {
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
          return true;
        }
        if (text !== "=" || !/[\w$.:-]$/.test(before) || unbalanced(before)) return false;
        const tr = state.tr.insertText('=""', from);
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 2)));
        return true;
      },
    },
    appendTransaction(transactions, _old, state) {
      // a peer's remote transaction ('y-sync$') is already repaired on its
      // side; repairing it here too would duplicate unwrapped children
      let from = Infinity;
      let to = -1;
      for (const tr of transactions) {
        if (!tr.docChanged) continue;
        if (to >= 0) {
          from = tr.mapping.map(from, -1);
          to = tr.mapping.map(to, 1);
        }
        if (tr.getMeta("y-sync$")) continue;
        tr.mapping.maps.forEach((map, i) => {
          const rest = tr.mapping.slice(i + 1);
          map.forEach((_from, _to, start, end) => {
            from = Math.min(from, rest.map(start, -1));
            to = Math.max(to, rest.map(end, 1));
          });
        });
      }
      if (to < 0) return null;
      // an unwrapped element's own tags become lone blocks: repair until
      // the doc stands still (a plugin never sees its own appended steps)
      const tr = state.tr;
      let range: [number, number] | null = [from, to];
      while ((range = repair(tr, range[0], range[1], mark)));
      return tr.docChanged ? tr : null;
    },
  });
}

export const MdxJsxFlowElement = Node.create({
  name: JSX_FLOW_ELEMENT,
  group: "block",
  content: "block+",
  defining: true,
  parseHTML: () => [{ tag: "div[data-mdx-flow]" }],
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-mdx-flow": "" }), 0];
  },
});

export const MdxJsxTag = Mark.create({
  name: JSX_TAG_MARK,
  // typing at either edge lands outside the tag; inside it edits the source
  inclusive: false,
  code: true,
  addAttributes: () => ({
    self: {
      default: false,
      parseHTML: (element: HTMLElement) => element.hasAttribute("data-self"),
      renderHTML: (attrs: Record<string, unknown>) => (attrs.self ? { "data-self": "" } : {}),
    },
  }),
  parseHTML: () => [{ tag: "code[data-mdx-tag]", priority: 60 }],
  renderHTML({ HTMLAttributes }) {
    return ["code", mergeAttributes(HTMLAttributes, { "data-mdx-tag": "" }), 0];
  },
  addKeyboardShortcuts() {
    return {
      // Backspace inside `=""` takes the whole value away again
      Backspace: ({ editor }) => {
        const { state } = editor;
        if (!inTagSource(state, this.type)) return false;
        const { $from } = state.selection;
        if (!$from.nodeBefore?.text?.endsWith('="') || !$from.nodeAfter?.text?.startsWith('"')) {
          return false;
        }
        editor.view.dispatch(state.tr.delete($from.pos - 2, $from.pos + 1));
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [tagPlugin(this.type)];
  },
});

export const MdxJsxTagBlock = Node.create({
  name: JSX_TAG_BLOCK,
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  parseHTML: () => [{ tag: "pre[data-mdx-tag-block]", preserveWhitespace: "full", priority: 60 }],
  renderHTML({ HTMLAttributes }) {
    return ["pre", mergeAttributes(HTMLAttributes, { "data-mdx-tag-block": "" }), 0];
  },
});
