import { Mark, Node, mergeAttributes } from "@tiptap/core";
import type { Fragment, MarkType, Node as PMNode } from "@tiptap/pm/model";
import { Plugin, type Transaction } from "@tiptap/pm/state";

export const JSX_TAG_MARK = "mdxJsxTag";
export const JSX_TAG_BLOCK = "mdxJsxTagBlock";
export const JSX_FLOW_ELEMENT = "mdxJsxFlowElement";

/*
 * Unregistered JSX is edited as source: inline tags are text carrying the tag
 * mark, block tags are textblocks around the element's children. Names and
 * attributes are typed in place. A tag whose brackets break, or whose partner
 * is gone, is removed together with its partner so the document always
 * re-parses.
 */

type Kind = "open" | "close" | "self";

const kindOf = (tag: string): Kind =>
  tag.startsWith("</") ? "close" : tag.endsWith("/>") ? "self" : "open";

/**
 * `[start, end)` of each tag in a run of tag source; null when a bracket is
 * missing or other text sits between tags. Quoted and braced attribute
 * values may contain `>`.
 */
function splitTags(text: string): [number, number][] | null {
  const out: [number, number][] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    if (text[i] !== "<") return null;
    const start = i;
    let braces = 0;
    let quote = "";
    while (++i < text.length) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "{") braces++;
      else if (c === "}") braces--;
      else if (c === ">" && braces === 0) break;
    }
    if (i === text.length) return null;
    out.push([start, i + 1]);
  }
  return out;
}

/** a block tag's kind: one tag, or a run of self-closing ones */
function blockKind(node: PMNode): Kind | null {
  if (node.type.name !== JSX_TAG_BLOCK) return null;
  const text = node.textContent.trim();
  const tags = splitTags(text);
  if (!tags?.length) return null;
  const kind = kindOf(text.slice(tags[0][0], tags[0][1]));
  for (let i = 1; i < tags.length; i++) {
    if (kind !== "self" || kindOf(text.slice(tags[i][0], tags[i][1])) !== "self") return null;
  }
  return kind;
}

interface Op {
  from: number;
  to: number;
  /** replaces the range instead of deleting it */
  content?: Fragment;
}

/** pair the tag runs of one textblock; unmatched and broken tags are deleted */
function repairInline(tr: Transaction, node: PMNode, base: number, mark: MarkType, ops: Op[]) {
  const keep = (op: Op, self: boolean) => tr.addMark(op.from, op.to, mark.create({ self }));
  const open: Op[] = [];
  let runFrom = -1;
  let run = "";
  const flush = () => {
    if (runFrom < 0) return;
    const tags = splitTags(run);
    if (!tags) ops.push({ from: runFrom, to: runFrom + run.length });
    for (const [start, end] of tags ?? []) {
      const kind = kindOf(run.slice(start, end));
      const op = { from: runFrom + start, to: runFrom + end };
      if (kind === "open") open.push(op);
      else if (kind === "self") keep(op, true);
      else if (open.length > 0) {
        keep(open.pop()!, false);
        keep(op, false);
      } else ops.push(op);
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
      if (blockKind(node.firstChild!) === "open" && blockKind(node.lastChild!) === "close") return;
      ops.push({ from: pos, to: pos + node.nodeSize, content: node.content });
    } else if (node.type.name === JSX_TAG_BLOCK) {
      const own =
        parent?.type.name === JSX_FLOW_ELEMENT && (index === 0 || index === parent.childCount - 1);
      if (!own && blockKind(node) !== "self") ops.push({ from: pos, to: pos + node.nodeSize });
    } else if (node.isTextblock) {
      repairInline(tr, node, pos + 1, mark, ops);
    } else return;
    return false;
  });
  if (ops.length === 0) return null;
  ops.sort((a, b) => b.from - a.from);
  const steps = tr.steps.length;
  for (const { from, to, content } of ops) {
    if (content) tr.replaceWith(from, to, content);
    else tr.delete(from, to);
  }
  return [ops[ops.length - 1].from, tr.mapping.slice(steps).map(ops[0].to, 1)];
}

function tagGuard(mark: MarkType): Plugin {
  return new Plugin({
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
  addProseMirrorPlugins() {
    return [tagGuard(this.type)];
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
