import { Extension } from "@tiptap/core";
import { Plugin, Selection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import {
  BLOCK_REGION_NODE,
  COMPONENT_NODE,
  INLINE_REGION_NODE,
  type ComponentSpec,
} from "@fumadocs-editor/core";
import { childNames, childOnlyNames, type SpecMap } from "./keymap";

/*
 * Structural invariants the schema alone can't express: a component's regions
 * are part of its identity. The schema must keep `mdxComponent` content
 * repeatable (regions vary per spec), so a DOM-level edit: native word
 * deletes, autocorrect, IME: can parse a region right out of the document,
 * leaving a File with no name field and no placeholder. This guard reconciles
 * every touched component against its spec after each transaction, and vets
 * drops so a child row only lands in a container that accepts it.
 */

type Fix =
  | { kind: "retag"; pos: number; attrs: Record<string, unknown> }
  | { kind: "insert"; pos: number; node: PMNode }
  | { kind: "remove"; pos: number; size: number }
  /** move a stray block into a region (append at `target`, a pos inside it) */
  | { kind: "fold"; pos: number; target: number };

/** missing regions inserted, present ones retagged to the spec's names in order */
function reconcile(state: EditorState, node: PMNode, pos: number, specs: SpecMap, fixes: Fix[]) {
  const spec = specs.get(node.attrs.name as string);
  if (!spec) return;
  const inline: { region: string }[] = [
    ...(spec.attributeRegions ?? []),
    ...(spec.contentRegion ? [spec.contentRegion] : []),
  ];
  const block = spec.childrenRegion;

  // a container with no regions of its own (Files, Cards, Steps) has no
  // editable surface once its last child goes: it dies with it. A leaf
  // component (no childComponent either) is legitimately empty.
  if (spec.childComponent && inline.length === 0 && !block && node.childCount === 0) {
    fixes.push({ kind: "remove", pos, size: node.nodeSize });
    return;
  }

  // children of an items-carrying container (Tabs) each own a label region
  // injected by the parent; keep it first and correctly tagged
  if (spec.itemsAttribute) {
    const region = spec.itemsAttribute.childRegion;
    node.forEach((child, offset) => {
      if (child.type.name !== COMPONENT_NODE) return;
      const at = pos + 1 + offset;
      const first = child.firstChild;
      if (first?.type.name === INLINE_REGION_NODE) {
        if (first.attrs.region !== region) {
          fixes.push({ kind: "retag", pos: at + 1, attrs: { region } });
        }
      } else {
        fixes.push({
          kind: "insert",
          pos: at + 1,
          node: state.schema.nodes[INLINE_REGION_NODE].create({ region }),
        });
      }
    });
  }

  const inlinePresent: { pos: number; node: PMNode }[] = [];
  const blockPresent: { pos: number; node: PMNode }[] = [];
  let firstComponent = -1;
  node.forEach((child, offset) => {
    const at = pos + 1 + offset;
    if (child.type.name === INLINE_REGION_NODE) inlinePresent.push({ pos: at, node: child });
    else if (child.type.name === BLOCK_REGION_NODE) blockPresent.push({ pos: at, node: child });
    else if (firstComponent === -1) firstComponent = at;
  });

  for (let i = 0; i < inline.length; i++) {
    const present = inlinePresent[i];
    if (present) {
      if (present.node.attrs.region !== inline[i].region) {
        fixes.push({ kind: "retag", pos: present.pos, attrs: { region: inline[i].region } });
      }
      continue;
    }
    const last = inlinePresent[inlinePresent.length - 1];
    fixes.push({
      kind: "insert",
      pos: last ? last.pos + last.node.nodeSize : pos + 1,
      node: state.schema.nodes[INLINE_REGION_NODE].create({ region: inline[i].region }),
    });
  }

  if (!block) return;
  const present = blockPresent[0];
  if (present) {
    if (present.node.attrs.region !== block.region) {
      fixes.push({ kind: "retag", pos: present.pos, attrs: { region: block.region } });
    }
    // a component with a body region owns ALL its block content through it
    // (that's what childrenRegion folding means at parse time): a bare block
    // that lands directly in the component — a cross-region selection typed
    // over, a native edit — is folded into the body, never left floating
    node.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (
        child.type.name === INLINE_REGION_NODE ||
        child.type.name === BLOCK_REGION_NODE ||
        at === present.pos
      )
        return;
      fixes.push({ kind: "fold", pos: at, target: present.pos + present.node.nodeSize - 1 });
    });
    return;
  }
  // after the inline regions, before any child component
  const last = inlinePresent[inlinePresent.length - 1];
  fixes.push({
    kind: "insert",
    pos: firstComponent !== -1 ? firstComponent : last ? last.pos + last.node.nodeSize : pos + 1,
    node: state.schema.nodes[BLOCK_REGION_NODE].create(
      { region: block.region },
      state.schema.nodes.paragraph.create(),
    ),
  });
}

function applyFixes(state: EditorState, fixes: Fix[]): Transaction | null {
  if (fixes.length === 0) return null;
  const tr = state.tr;
  for (const fix of fixes) {
    if (fix.kind === "retag") {
      tr.setNodeMarkup(tr.mapping.map(fix.pos), undefined, fix.attrs);
    } else if (fix.kind === "insert") {
      tr.insert(tr.mapping.map(fix.pos), fix.node);
    } else if (fix.kind === "fold") {
      const from = tr.mapping.map(fix.pos);
      const stray = tr.doc.nodeAt(from);
      if (!stray) continue;
      tr.delete(from, from + stray.nodeSize);
      tr.insert(tr.mapping.map(fix.target), stray);
    } else {
      const from = tr.mapping.map(fix.pos);
      const to = tr.mapping.map(fix.pos + fix.size);
      const $from = tr.doc.resolve(from);
      // a plain delete of the document's only block would be invalid
      if (
        $from.parent.childCount === 1 &&
        !$from.parent.canReplace($from.index(), $from.index() + 1)
      ) {
        tr.replaceWith(from, to, state.schema.nodes.paragraph.create());
      } else {
        tr.delete(from, to);
      }
    }
  }
  return tr;
}

/** components overlapping the ranges these transactions touched, deduped */
function touchedComponents(
  state: EditorState,
  transactions: readonly Transaction[],
  specs: SpecMap,
): Fix[] {
  const fixes: Fix[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < transactions.length; i++) {
    const steps = transactions[i].steps;
    for (let j = 0; j < steps.length; j++) {
      steps[j].getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        let from = newStart;
        let to = newEnd;
        for (let k = j + 1; k < steps.length; k++) {
          const map = steps[k].getMap();
          from = map.map(from, -1);
          to = map.map(to, 1);
        }
        for (let k = i + 1; k < transactions.length; k++) {
          from = transactions[k].mapping.map(from, -1);
          to = transactions[k].mapping.map(to, 1);
        }
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isTextblock) return false;
          if (node.type.name !== COMPONENT_NODE || seen.has(pos)) return true;
          seen.add(pos);
          reconcile(state, node, pos, specs, fixes);
          return true;
        });
      });
    }
  }
  return fixes;
}

/** the component being dragged, when the drag carries exactly one we manage */
function draggedComponent(view: EditorView, specs: SpecMap): PMNode | null {
  const slice = view.dragging?.slice;
  if (!slice || slice.openStart !== 0 || slice.openEnd !== 0 || slice.content.childCount !== 1) {
    return null;
  }
  const node = slice.content.firstChild!;
  if (node.type.name !== COMPONENT_NODE || !specs.has(node.attrs.name as string)) return null;
  return node;
}

/**
 * Where a dragged component would land. ProseMirror's dropPoint picks the
 * deepest schema-valid spot, and this schema legally nests any component in
 * any component, so a drop over a row's text would land inside that row.
 * Walk up to the nearest container the spec allows instead, before or after
 * the hovered child by pointer height. Null when no valid spot exists.
 */
function dropTarget(
  view: EditorView,
  event: DragEvent,
  dragged: PMNode,
  specs: SpecMap,
  childOnly: Set<string>,
): number | null {
  const name = dragged.attrs.name as string;
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return null;
  const $pos = view.state.doc.resolve(coords.pos);

  for (let depth = $pos.depth; depth >= 0; depth--) {
    const parent = $pos.node(depth);
    if (parent.isTextblock) continue;
    const allowed =
      parent.type.name === COMPONENT_NODE
        ? childNames(specs.get(parent.attrs.name as string)).includes(name)
        : !childOnly.has(name);
    if (!allowed) continue;

    let insert: number;
    if (depth === $pos.depth) {
      insert = $pos.pos; // a gap directly inside the container
    } else {
      const child = $pos.node(depth + 1);
      if (child.type.name === INLINE_REGION_NODE || child.type.name === BLOCK_REGION_NODE) {
        // never split a component's regions: land right after them
        // (dropping on a folder's name nests as its first row)
        insert = $pos.after(depth + 1);
      } else {
        const dom = view.nodeDOM($pos.before(depth + 1));
        const rect = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
        const before = rect
          ? event.clientY < rect.top + rect.height / 2
          : $pos.pos <= ($pos.start(depth + 1) + $pos.end(depth + 1)) / 2;
        insert = before ? $pos.before(depth + 1) : $pos.after(depth + 1);
      }
    }

    const $insert = view.state.doc.resolve(insert);
    const index = $insert.index();
    return $insert.parent.canReplaceWith(index, index, dragged.type) ? insert : null;
  }
  return null;
}

/**
 * The drag preview line, drawn from {@link dropTarget} so it always shows the
 * real destination: one line between same-level siblings, and an indented one
 * when the drop nests into a folder. Hidden entirely over invalid targets.
 * Replaces the stock dropcursor, which previews its own dropPoint and paints
 * a different line for every schema-valid position sharing one visual gap.
 */
function dropIndicator(specs: SpecMap, childOnly: Set<string>): Plugin {
  let line: HTMLElement | null = null;
  const hide = () => {
    line?.remove();
    line = null;
  };
  return new Plugin({
    view: () => ({ destroy: hide }),
    props: {
      handleDOMEvents: {
        dragover(view, event) {
          const dragged = draggedComponent(view, specs);
          if (!dragged) return false;
          const target = dropTarget(view, event, dragged, specs, childOnly);
          if (target == null) {
            hide();
            return false;
          }
          const $pos = view.state.doc.resolve(target);
          const after = $pos.nodeAfter;
          const before = $pos.nodeBefore;
          const ref = after
            ? view.nodeDOM(target)
            : before
              ? view.nodeDOM(target - before.nodeSize)
              : $pos.depth > 0
                ? view.nodeDOM($pos.before())
                : null;
          if (!(ref instanceof HTMLElement)) {
            hide();
            return false;
          }
          const rect = ref.getBoundingClientRect();
          if (!line) {
            line = document.createElement("div");
            line.className = "fde-drop-indicator";
            (view.dom.closest("[data-fde-root]") ?? document.body).appendChild(line);
          }
          line.style.left = `${rect.left}px`;
          line.style.width = `${rect.width}px`;
          line.style.top = `${(after ? rect.top : rect.bottom) - 1.5}px`;
          return false;
        },
        drop: () => (hide(), false),
        dragend: () => (hide(), false),
        dragleave(view, event) {
          if (!(event.relatedTarget instanceof Node) || !view.dom.contains(event.relatedTarget)) {
            hide();
          }
          return false;
        },
      },
    },
  });
}

export function structureGuard(specs: Map<string, ComponentSpec>): Extension {
  const childOnly = childOnlyNames(specs.values());

  return Extension.create({
    name: "fdeStructureGuard",

    // documents from disk may predate the invariants: normalize once on mount,
    // outside the undo history
    onBeforeCreate() {
      this.editor.on("mount", ({ editor }) => {
        const state = editor.state;
        const fixes: Fix[] = [];
        state.doc.descendants((node, pos) => {
          if (node.isTextblock) return false;
          if (node.type.name === COMPONENT_NODE) reconcile(state, node, pos, specs, fixes);
          return true;
        });
        const tr = applyFixes(state, fixes);
        if (tr) editor.view.dispatch(tr.setMeta("addToHistory", false));
      });
    },

    addProseMirrorPlugins() {
      return [
        new Plugin({
          appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            return applyFixes(newState, touchedComponents(newState, transactions, specs));
          },
          props: {
            handleDrop(view, event, slice, moved) {
              if (slice.openStart !== 0 || slice.openEnd !== 0 || slice.content.childCount !== 1) {
                return false;
              }
              const dragged = slice.content.firstChild!;
              if (
                dragged.type.name !== COMPONENT_NODE ||
                !specs.has(dragged.attrs.name as string)
              ) {
                return false;
              }
              const insert = dropTarget(view, event, dragged, specs, childOnly);
              if (insert == null) return true; // nowhere valid: swallow the drop

              const tr = view.state.tr;
              if (moved) {
                // the source is the node the drag carries (ProseMirror remaps
                // it through doc changes); the live selection may have drifted
                const node = (view.dragging as { node?: Selection } | null)?.node;
                if (node) tr.delete(node.from, node.to);
                else tr.deleteSelection();
              }
              // an insert point inside the deleted source maps to the
              // deletion boundary, so dropping into itself is a no-op
              const mapped = tr.mapping.map(insert);
              tr.insert(mapped, dragged);
              const text = Selection.findFrom(tr.doc.resolve(mapped + 1), 1, true);
              if (text && text.from < mapped + dragged.nodeSize) tr.setSelection(text);
              view.dispatch(tr.scrollIntoView());
              view.focus();
              return true;
            },
          },
        }),
        dropIndicator(specs, childOnly),
      ];
    },
  });
}
