import { Extension } from "@tiptap/core";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Fragment, type Node as PMNode, type ResolvedPos, type Slice } from "@tiptap/pm/model";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  BLOCK_REGION_NODE,
  INLINE_REGION_NODE,
  isComponent,
} from "@fumadocs-editor/core/extensions";
import { FRONTMATTER_NODE, deleteBlocks, movableIn, type BlockRange, type SpecMap } from "./keymap";
import { contentClass } from "../styles/content";

function draggedBlock(slice: Slice | undefined): PMNode | null {
  if (!slice || slice.openStart !== 0 || slice.openEnd !== 0 || slice.content.childCount !== 1) {
    return null;
  }
  const node = slice.content.firstChild!;
  return node.isBlock && node.type.name !== FRONTMATTER_NODE ? node : null;
}

/**
 * Where a dragged block would land. ProseMirror's dropPoint picks the
 * deepest schema-valid spot, so a drop over a nested block's text would
 * land inside it. Walk up to the nearest container that takes it instead,
 * before or after the hovered child by pointer height. The lifted node
 * itself (`source`, on a move) is opaque, and its own slot is no target:
 * over itself, nothing happens. Null when no valid spot exists.
 */
export function dropSlot(
  state: EditorState,
  $pos: ResolvedPos,
  dragged: Fragment,
  source: BlockRange | null,
  before: (pos: number) => boolean,
): number | null {
  const first = dragged.firstChild;
  if (!first) return null;
  if (first.isInline) {
    if (source && $pos.pos >= source.from && $pos.pos <= source.to) return null;
    const index = $pos.index();
    return movableIn(first, $pos.parent) && $pos.parent.canReplace(index, index, dragged)
      ? $pos.pos
      : null;
  }

  let top = $pos.depth;
  for (let d = 1; d <= $pos.depth; d++) {
    if (source && $pos.before(d) >= source.from && $pos.after(d) <= source.to) top = d - 1;
  }

  for (let depth = top; depth >= 0; depth--) {
    const parent = $pos.node(depth);
    if (!movableIn(first, parent)) continue;

    let insert: number;
    if (depth === $pos.depth) {
      insert = $pos.pos; // a gap directly inside the container
    } else {
      const child = $pos.node(depth + 1);
      if (child.type.name === INLINE_REGION_NODE || child.type.name === BLOCK_REGION_NODE) {
        insert = $pos.after(depth + 1); // never split a component's regions
      } else {
        insert = before($pos.before(depth + 1)) ? $pos.before(depth + 1) : $pos.after(depth + 1);
      }
    }

    if (source && insert >= source.from && insert <= source.to) return null;
    const $insert = state.doc.resolve(insert);
    if ($insert.nodeAfter?.type.name === FRONTMATTER_NODE) return null; // pinned first
    const index = $insert.index();
    if ($insert.parent.canReplace(index, index, dragged)) return insert;
  }
  return null;
}

function dropTarget(
  view: EditorView,
  x: number,
  y: number,
  dragged: Fragment,
  source: BlockRange | null,
): number | null {
  const coords = view.posAtCoords({ left: x, top: y });
  if (!coords) return null;
  const { doc } = view.state;
  return dropSlot(view.state, doc.resolve(coords.pos), dragged, source, (pos) => {
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    }
    return coords.pos <= pos + doc.nodeAt(pos)!.nodeSize / 2;
  });
}

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
  const root = overlay(view);
  if (!line) {
    line = document.createElement("div");
    line.className = contentClass.dropIndicator;
    root.appendChild(line);
  }
  if ($pos.parent.isTextblock) {
    // an inline drop: a caret-shaped bar at the text position
    const caret = view.coordsAtPos(target);
    const at = local(root, caret.left - 1.5, caret.top);
    line.style.transform = `translate(${at.left}px, ${at.top}px)`;
    line.style.width = "3px";
    line.style.height = `${caret.bottom - caret.top}px`;
    return;
  }
  const { nodeAfter, nodeBefore } = $pos;
  const next = nodeAfter ? view.nodeDOM(target) : null;
  const prev = nodeBefore ? view.nodeDOM(target - nodeBefore.nodeSize) : null;
  const ref = next ?? prev ?? ($pos.depth > 0 ? view.nodeDOM($pos.before()) : null);
  if (!(ref instanceof HTMLElement)) return hideIndicator();
  const rect = ref.getBoundingClientRect();
  let y = next ? rect.top : rect.bottom;
  if (next && prev instanceof HTMLElement) y = (prev.getBoundingClientRect().bottom + y) / 2;
  const at = local(root, rect.left, y - 1.5);
  line.style.transform = `translate(${at.left}px, ${at.top}px)`;
  line.style.width = `${rect.width}px`;
  line.style.height = "";
}

function hover(
  view: EditorView,
  dragged: Fragment,
  source: BlockRange | null,
  x: number,
  y: number,
): number | null {
  const target = dropTarget(view, x, y, dragged, source);
  if (target == null) hideIndicator();
  else showIndicator(view, target);
  return target;
}

/** a copy of the run for the ghost, and the box it occupies */
function ghostOf(view: EditorView, from: number, to: number): { el: HTMLElement; rect: DOMRect } {
  const start = view.domAtPos(from);
  const end = view.domAtPos(to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const el = document.createElement("div");
  el.appendChild(range.cloneContents());
  // the clone leaves the content root: its font and the blocks' gap
  // (`--fde-gap` on `view.dom`) are inherited there, not in the overlay
  const host = range.commonAncestorContainer;
  const style = getComputedStyle(host instanceof Element ? host : host.parentElement!);
  el.style.font = style.font;
  el.style.setProperty("--fde-gap", style.getPropertyValue("--fde-gap"));
  // the block clones' outer margins would offset them inside the ghost's box
  (el.firstElementChild as HTMLElement | null)?.style.setProperty("margin-top", "0");
  (el.lastElementChild as HTMLElement | null)?.style.setProperty("margin-bottom", "0");
  return { el, rect: range.getBoundingClientRect() };
}

function lift(root: HTMLElement, ghost: HTMLElement, rect: DOMRect, x: number, y: number) {
  const at = local(root, rect.left, rect.top);
  const base = local(root, x, y);
  ghost.className += ` ${contentClass.dragGhost}`;
  ghost.style.cssText += `;position:absolute;left:${at.left}px;top:${at.top}px;width:${rect.width}px;box-sizing:border-box;margin:0;z-index:49;pointer-events:none`;
  root.appendChild(ghost);
  return {
    move(x: number, y: number) {
      const at = local(root, x, y);
      ghost.style.transform = `translate(${at.left - base.left}px, ${at.top - base.top}px)`;
    },
    remove: () => ghost.remove(),
  };
}

export function placeDrop(
  view: EditorView,
  content: Fragment,
  insert: number,
  source: BlockRange | null,
) {
  const { selection } = view.state;
  const tr = view.state.tr.setMeta(liftKey, null);
  if (source) deleteBlocks(tr, source);
  // an insert point inside the deleted source maps to the deletion
  // boundary, so dropping into itself is a no-op
  const mapped = tr.mapping.map(insert);
  tr.insert(mapped, content);
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
    if (text && text.from < mapped + content.size) tr.setSelection(text);
  }
  view.dispatch(tr.scrollIntoView());
}

const liftKey = new PluginKey<BlockRange | null>("fdeLift");

/**
 * Light `range` as the run a joystick would drag (null clears). The range
 * follows edits by position mapping, so a drag reads it back as its source.
 * A decoration, not a class on the nodes' DOM: ProseMirror owns that DOM
 * and redraws it.
 */
export function setLifted(view: EditorView, range: BlockRange | null): void {
  const lit = liftKey.getState(view.state);
  if (lit?.from === range?.from && lit?.to === range?.to) return;
  view.dispatch(view.state.tr.setMeta(liftKey, range));
}

const lifted = new Plugin<BlockRange | null>({
  key: liftKey,
  state: {
    init: () => null,
    apply(tr, range) {
      const meta = tr.getMeta(liftKey) as BlockRange | null | undefined;
      if (meta !== undefined) return meta;
      if (!range || !tr.docChanged) return range;
      const from = tr.mapping.map(range.from, -1);
      const to = tr.mapping.map(range.to, 1);
      return to > from ? { from, to } : null;
    },
  },
  props: {
    decorations(state) {
      const range = liftKey.getState(state);
      if (!range || range.to > state.doc.content.size) return DecorationSet.empty;
      if (state.doc.resolve(range.from).parent.inlineContent) {
        return DecorationSet.create(state.doc, [
          Decoration.inline(range.from, range.to, { class: contentClass.lifted }),
        ]);
      }
      const decorations: Decoration[] = [];
      state.doc.nodesBetween(range.from, range.to, (node, pos) => {
        if (pos < range.from) return true;
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: contentClass.lifted }));
        return false;
      });
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

const EDGE = 48;

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
  range: BlockRange,
  handle: HTMLElement,
  event: PointerEvent,
  tilt: (dx: number, dy: number) => void,
): void {
  const { from, to } = range;
  if (to <= from) return;
  setLifted(view, range);
  const shape = ghostOf(view, from, to);
  const content = view.state.doc.slice(from, to).content;
  const viewport = window.visualViewport;
  const { pointerId, clientX: startX, clientY: startY } = event;
  let x = startX;
  let y = startY;
  let ghost: ReturnType<typeof lift> | null = null;
  let target: number | null = null;
  let scrolling = 0;

  const follow = () => {
    const source = liftKey.getState(view.state);
    if (!source) return;
    target = hover(view, content, source, x, y);
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
      ghost = lift(overlay(view), shape.el, shape.rect, x, y);
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
    const source = liftKey.getState(view.state);
    if (e.type === "pointerup" && target != null && source) {
      placeDrop(view, view.state.doc.slice(source.from, source.to).content, target, source);
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

/** a container of child components (Cards, Steps, Tabs, Files) goes with its last child */
function dropEmptyContainers(state: EditorState, specs: SpecMap): Transaction | null {
  let tr: Transaction | null = null;
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) return false;
    if (
      isComponent(node.type) &&
      node.childCount === 0 &&
      specs.get(node.type.name)!.childComponent
    ) {
      tr ??= state.tr;
      tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize));
    }
    return true;
  });
  return tr;
}

export function structureGuard(specs: SpecMap): Extension {
  return Extension.create({
    name: "fdeStructureGuard",

    addProseMirrorPlugins() {
      return [
        lifted,
        new Plugin({
          appendTransaction(transactions, _oldState, newState) {
            // remote Yjs transactions ('y-sync$' is the sync plugin's meta
            // key) are a peer's already-guarded state. Healing them here
            // would race the peer doing the same and duplicate the moved
            // content, so only local edits are guarded.
            if (!transactions.some((tr) => tr.docChanged && !tr.getMeta("y-sync$"))) return null;
            return dropEmptyContainers(newState, specs);
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
              const dragged = draggedBlock(slice);
              if (!dragged) return false;
              const content = Fragment.from(dragged);
              const insert = dropTarget(view, event.clientX, event.clientY, content, null);
              if (insert == null) return true; // nowhere valid: swallow the drop
              placeDrop(view, content, insert, null);
              view.focus();
              return true;
            },
          },
        }),
      ];
    },
  });
}
