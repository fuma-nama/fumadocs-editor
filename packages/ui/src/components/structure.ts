import { Extension } from "@tiptap/core";
import {
  NodeSelection,
  Plugin,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import type { Node as PMNode, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { BLOCK_REGION_NODE, COMPONENT_NODE, INLINE_REGION_NODE } from "@fumadocs-editor/core";
import { FRONTMATTER_NODE, childNames, childOnlyNames, type SpecMap } from "./keymap";
import { contentClass } from "../styles/content";

/*
 * Structural invariants the schema can't express: a component's regions are
 * part of its identity. `mdxComponent` content must stay repeatable (regions
 * vary per spec), so a DOM edit (native word delete, autocorrect, IME) can
 * parse a region out of the document. After each transaction this reconciles
 * touched components against their spec, and vets drops so a child row only
 * lands in a container that accepts it.
 */

type Fix =
  | { kind: "retag"; pos: number; attrs: Record<string, unknown> }
  | { kind: "insert"; pos: number; node: PMNode }
  | { kind: "remove"; pos: number; size: number }
  /** move a stray block into a region (append at `target`, a pos inside it) */
  | { kind: "fold"; pos: number; target: number }
  /** dissolve a surplus region: its content moves to `target` inside the real one */
  | { kind: "merge"; pos: number; target: number };

/** missing regions inserted, present ones retagged to the spec's names in order */
function reconcile(state: EditorState, node: PMNode, pos: number, specs: SpecMap, fixes: Fix[]) {
  const spec = specs.get(node.attrs.name as string);
  if (!spec) return;
  const inline: { region: string }[] = [];
  // a container's `itemsAttribute` (Tabs `items`) gives each child a label
  // region, first: part of the child's own shape
  const parent = state.doc.resolve(pos).parent;
  const items =
    parent.type.name === COMPONENT_NODE
      ? specs.get(parent.attrs.name as string)?.itemsAttribute
      : undefined;
  if (items) inline.push({ region: items.childRegion });
  for (const region of spec.attributeRegions ?? []) inline.push(region);
  if (spec.contentRegion) inline.push(spec.contentRegion);
  const block = spec.childrenRegion;

  // a container with no regions of its own (Files, Cards, Steps) has no
  // editable surface once its last child goes: it dies with it. A leaf
  // component (no childComponent either) is legitimately empty.
  if (spec.childComponent && inline.length === 0 && !block && node.childCount === 0) {
    fixes.push({ kind: "remove", pos, size: node.nodeSize });
    return;
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
  // a paste can split regions or smuggle wrapped ones in: a component owns
  // exactly the spec's regions, so surplus ones dissolve into the last real
  // one (their content survives, the duplicate identity does not)
  if (inline.length > 0) {
    for (let i = inline.length; i < inlinePresent.length; i++) {
      const into = inlinePresent[inline.length - 1];
      fixes.push({
        kind: "merge",
        pos: inlinePresent[i].pos,
        target: into.pos + into.node.nodeSize - 1,
      });
    }
  }

  if (!block) return;
  const present = blockPresent[0];
  if (present) {
    if (present.node.attrs.region !== block.region) {
      fixes.push({ kind: "retag", pos: present.pos, attrs: { region: block.region } });
    }
    for (let i = 1; i < blockPresent.length; i++) {
      fixes.push({
        kind: "merge",
        pos: blockPresent[i].pos,
        target: present.pos + present.node.nodeSize - 1,
      });
    }
    // a component with a body region owns ALL its block content through it
    // (that's what childrenRegion folding means at parse time). A bare block
    // that lands directly in the component (cross-region type-over, a
    // native edit) is folded into the body, never left floating.
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
    } else if (fix.kind === "merge") {
      const from = tr.mapping.map(fix.pos);
      const region = tr.doc.nodeAt(from);
      if (!region) continue;
      tr.delete(from, from + region.nodeSize);
      tr.insert(tr.mapping.map(fix.target), region.content);
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

/** the block a drop from outside carries, when it is exactly one we manage */
function draggedBlock(slice: Slice | undefined, specs: SpecMap): PMNode | null {
  if (!slice || slice.openStart !== 0 || slice.openEnd !== 0 || slice.content.childCount !== 1) {
    return null;
  }
  const node = slice.content.firstChild!;
  const type = node.type.name;
  if (!node.isBlock || type === FRONTMATTER_NODE) return null;
  if (type === COMPONENT_NODE && !specs.has(node.attrs.name as string)) return null;
  return node;
}

/**
 * Where a dragged block would land. ProseMirror's dropPoint picks the
 * deepest schema-valid spot, and this schema legally nests any component in
 * any component, so a drop over a row's text would land inside that row.
 * Walk up to the nearest container that takes it instead (for a component,
 * one its spec allows), before or after the hovered child by pointer
 * height. The lifted node itself (`source`, on a move) is opaque, and its
 * own slot is no target: over itself, nothing happens. Null when no valid
 * spot exists.
 */
function dropTarget(
  view: EditorView,
  x: number,
  y: number,
  dragged: PMNode,
  source: { from: number; to: number } | null,
  specs: SpecMap,
  childOnly: Set<string>,
): number | null {
  const component = dragged.type.name === COMPONENT_NODE;
  const name = dragged.attrs.name as string;
  const coords = view.posAtCoords({ left: x, top: y });
  if (!coords) return null;
  const $pos = view.state.doc.resolve(coords.pos);

  let top = $pos.depth;
  for (let d = 1; d <= $pos.depth; d++) if ($pos.before(d) === source?.from) top = d - 1;

  for (let depth = top; depth >= 0; depth--) {
    const parent = $pos.node(depth);
    if (parent.isTextblock) continue;
    const allowed =
      parent.type.name === COMPONENT_NODE
        ? component && childNames(specs.get(parent.attrs.name as string)).includes(name)
        : !component || !childOnly.has(name);
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
          ? y < rect.top + rect.height / 2
          : $pos.pos <= ($pos.start(depth + 1) + $pos.end(depth + 1)) / 2;
        insert = before ? $pos.before(depth + 1) : $pos.after(depth + 1);
      }
    }

    if (insert === source?.from || insert === source?.to) return null;
    const $insert = view.state.doc.resolve(insert);
    if ($insert.nodeAfter?.type.name === FRONTMATTER_NODE) return null; // pinned first
    const index = $insert.index();
    return $insert.parent.canReplaceWith(index, index, dragged.type) ? insert : null;
  }
  return null;
}

/*
 * The drag preview line, drawn from `dropTarget` so it always shows the real
 * destination: one line between same-level siblings, and an indented one
 * when the drop nests into a folder. Hidden entirely over invalid targets.
 * Replaces the stock dropcursor, which previews its own dropPoint and paints
 * a different line for every schema-valid position sharing one visual gap.
 */
let line: HTMLElement | null = null;

/**
 * The drag overlays (line, ghost) are absolute children of the editor's
 * scroll body, placed in its own coordinates: a scroll moves them with the
 * content, so nothing depends on how the platform maps fixed boxes to the
 * viewport (iOS repositions those lazily while scrolling, and offsets them
 * from the visual viewport once the keyboard is up). The body is already a
 * positioned ancestor of the content.
 */
const overlay = (view: EditorView) =>
  (view.dom.closest("[data-fde-overlay]") ??
    view.dom.closest("[data-fde-root]") ??
    document.body) as HTMLElement;

/** a client point in the overlay's coordinates */
function local(root: HTMLElement, x: number, y: number) {
  const rect = root.getBoundingClientRect();
  return {
    left: x - rect.left - root.clientLeft + root.scrollLeft,
    top: y - rect.top - root.clientTop + root.scrollTop,
  };
}

function hideIndicator() {
  line?.remove();
  line = null;
}

function showIndicator(view: EditorView, target: number) {
  const $pos = view.state.doc.resolve(target);
  const { nodeAfter, nodeBefore } = $pos;
  const next = nodeAfter ? view.nodeDOM(target) : null;
  const prev = nodeBefore ? view.nodeDOM(target - nodeBefore.nodeSize) : null;
  const ref = next ?? prev ?? ($pos.depth > 0 ? view.nodeDOM($pos.before()) : null);
  if (!(ref instanceof HTMLElement)) return hideIndicator();
  const rect = ref.getBoundingClientRect();
  // between two blocks the line splits their gap; at a container's edge it
  // hugs the only neighbour
  let y = next ? rect.top : rect.bottom;
  if (next && prev instanceof HTMLElement) y = (prev.getBoundingClientRect().bottom + y) / 2;
  const root = overlay(view);
  if (!line) {
    line = document.createElement("div");
    line.className = contentClass.dropIndicator;
    root.appendChild(line);
  }
  const at = local(root, rect.left, y - 1.5);
  line.style.transform = `translate(${at.left}px, ${at.top}px)`;
  line.style.width = `${rect.width}px`;
}

/** the line at the pointer's target, or none; the target itself */
function hover(
  view: EditorView,
  dragged: PMNode,
  source: { from: number; to: number } | null,
  x: number,
  y: number,
  specs: SpecMap,
  childOnly: Set<string>,
): number | null {
  const target = dropTarget(view, x, y, dragged, source, specs, childOnly);
  if (target == null) hideIndicator();
  else showIndicator(view, target);
  return target;
}

/**
 * A copy of the block riding under the pointer, rasterized once at its own
 * place and moved by transform only: on the compositor, dirtying no
 * layout before the next hit test. It sits below the line, so the target
 * always reads through it.
 */
function lift(root: HTMLElement, dom: HTMLElement, x: number, y: number) {
  const rect = dom.getBoundingClientRect();
  const at = local(root, rect.left, rect.top);
  const base = local(root, x, y);
  const ghost = dom.cloneNode(true) as HTMLElement;
  ghost.className += ` ${contentClass.dragGhost}`;
  // inline: the copy keeps the block's own classes, which position it
  ghost.style.cssText = `position:absolute;left:${at.left}px;top:${at.top}px;width:${rect.width}px;box-sizing:border-box;margin:0;z-index:49;pointer-events:none`;
  root.appendChild(ghost);
  return {
    move(x: number, y: number) {
      const at = local(root, x, y);
      ghost.style.transform = `translate(${at.left - base.left}px, ${at.top - base.top}px)`;
    },
    remove: () => ghost.remove(),
  };
}

/** move `node` to `insert`, removing it from `source` first */
function placeDrop(
  view: EditorView,
  node: PMNode,
  insert: number,
  source: { from: number; to: number } | null,
) {
  const { selection } = view.state;
  const tr = view.state.tr;
  if (source) tr.delete(source.from, source.to);
  // an insert point inside the deleted source maps to the deletion
  // boundary, so dropping into itself is a no-op
  const mapped = tr.mapping.map(insert);
  tr.insert(mapped, node);
  // a selection inside the block travels with it, so the next drag needs
  // no reselecting; otherwise the caret lands on the block's first text
  const shift =
    source && selection.from >= source.from && selection.to <= source.to
      ? mapped - source.from
      : null;
  if (shift != null && selection instanceof TextSelection) {
    tr.setSelection(TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift));
  } else if (shift != null && selection instanceof NodeSelection) {
    tr.setSelection(NodeSelection.create(tr.doc, selection.from + shift));
  } else {
    const text = Selection.findFrom(tr.doc.resolve(mapped + 1), 1, true);
    if (text && text.from < mapped + node.nodeSize) tr.setSelection(text);
  }
  view.dispatch(tr.scrollIntoView());
}

/** window scroll while the pointer rides the viewport's top or bottom edge */
const EDGE = 48;

/** movement before a press becomes a drag */
const SLOP = 3;

/**
 * Drag from the toolbar's joystick. The handle captures the pointer, so a
 * mouse and a finger drive one drag; the native drag session is no use for
 * touch (iOS lifts a mis-scaled page snapshot, its autoscroll strands the
 * drop line, and its drop lands nowhere; Android has none). The first real
 * move lifts the block, and the same target, line and drop as a native
 * drag apply. A press that never moves does nothing.
 */
export function startPointerDrag(
  view: EditorView,
  pos: number,
  handle: HTMLElement,
  event: PointerEvent,
  specs: SpecMap,
  /** the pointer's offset from the press, for the handle's own motion; (0, 0) at the end */
  tilt: (dx: number, dy: number) => void,
): void {
  const node = view.state.doc.nodeAt(pos);
  const dom = view.nodeDOM(pos);
  if (!node || !(dom instanceof HTMLElement)) return;
  const childOnly = childOnlyNames(specs.values());
  const viewport = window.visualViewport;
  const source = { from: pos, to: pos + node.nodeSize };
  const { pointerId, clientX: startX, clientY: startY } = event;
  let x = startX;
  let y = startY;
  let ghost: ReturnType<typeof lift> | null = null;
  let target: number | null = null;
  let scrolling = 0;

  const follow = () => {
    // the block's extent as it stands: a composition committing mid-drag
    // rewrites it in place, so its identity is no guide, its position is
    source.to = pos + (view.state.doc.nodeAt(pos)?.nodeSize ?? node.nodeSize);
    target = hover(view, node, source, x, y, specs, childOnly);
    ghost!.move(x, y);
  };
  const scroll = () => {
    const top = viewport?.offsetTop ?? 0;
    const height = viewport?.height ?? window.innerHeight;
    const dy = y < top + EDGE ? -8 : y > top + height - EDGE ? 8 : 0;
    if (!dy) return void (scrolling = 0);
    window.scrollBy(0, dy);
    follow();
    scrolling = requestAnimationFrame(scroll);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    x = e.clientX;
    y = e.clientY;
    tilt(x - startX, y - startY);
    if (!ghost) {
      if (Math.abs(x - startX) < SLOP && Math.abs(y - startY) < SLOP) return;
      ghost = lift(overlay(view), dom, x, y);
      // a finger's drag leaves the keyboard: the page shows under the
      // block, and the IME commits the word it was composing in it (the
      // browser fights a block moving under an open composition)
      if (e.pointerType !== "mouse") view.dom.blur();
    }
    follow();
    if (!scrolling) scrolling = requestAnimationFrame(scroll);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    handle.removeEventListener("lostpointercapture", end);
    cancelAnimationFrame(scrolling);
    hideIndicator();
    tilt(0, 0);
    if (!ghost) return;
    ghost.remove();
    const current = view.state.doc.nodeAt(pos);
    if (e.type === "pointerup" && target != null && current?.type === node.type) {
      placeDrop(view, current, target, { from: pos, to: pos + current.nodeSize });
      // a finger's drop must not raise the keyboard
      if (e.pointerType === "mouse") view.focus();
    }
  };
  handle.setPointerCapture(pointerId);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  // the handle can unmount mid-drag (its toolbar hides): a cancel
  handle.addEventListener("lostpointercapture", end);
}

export function structureGuard(specs: SpecMap): Extension {
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
            // remote Yjs transactions ('y-sync$' is the sync plugin's meta
            // key) are a peer's already-guarded state. Healing them here
            // would race the peer doing the same and duplicate the moved
            // content, so only local edits are guarded.
            if (!transactions.some((tr) => tr.docChanged && !tr.getMeta("y-sync$"))) return null;
            return applyFixes(newState, touchedComponents(newState, transactions, specs));
          },
          view: () => ({ destroy: hideIndicator }),
          props: {
            handleDOMEvents: {
              // blocks move by the joystick only: the browser's drag session
              // stays for selected text, never for a selected node
              dragstart(view, event) {
                const { selection } = view.state;
                if (selection instanceof TextSelection && !selection.empty) return false;
                event.preventDefault();
                return true;
              },
            },
            handleDrop(view, event, slice) {
              const dragged = draggedBlock(slice, specs);
              if (!dragged) return false;
              const insert = dropTarget(
                view,
                event.clientX,
                event.clientY,
                dragged,
                null,
                specs,
                childOnly,
              );
              if (insert == null) return true; // nowhere valid: swallow the drop
              placeDrop(view, dragged, insert, null);
              view.focus();
              return true;
            },
          },
        }),
      ];
    },
  });
}
