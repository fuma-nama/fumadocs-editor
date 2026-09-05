import { Extension } from "@tiptap/core";
import {
  NodeSelection,
  Plugin,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Fragment, type Node as PMNode, type ResolvedPos, type Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { BLOCK_REGION_NODE, COMPONENT_NODE, INLINE_REGION_NODE } from "@fumadocs-editor/core";
import {
  FRONTMATTER_NODE,
  childNames,
  childOnlyNames,
  deleteBlocks,
  movableIn,
  type BlockRange,
  type SpecMap,
} from "./keymap";
import { contentClass } from "../styles/content";

type Fix =
  | { kind: "retag"; pos: number; attrs: Record<string, unknown> }
  | { kind: "insert"; pos: number; node: PMNode }
  | { kind: "remove"; pos: number; size: number }
  | { kind: "fold"; pos: number; target: number }
  | { kind: "merge"; pos: number; target: number };

function reconcile(state: EditorState, node: PMNode, pos: number, specs: SpecMap, fixes: Fix[]) {
  const spec = specs.get(node.attrs.name as string);
  if (!spec) return;
  const inline: { region: string }[] = [];
  const parent = state.doc.resolve(pos).parent;
  const items =
    parent.type.name === COMPONENT_NODE
      ? specs.get(parent.attrs.name as string)?.itemsAttribute
      : undefined;
  if (items) inline.push({ region: items.childRegion });
  for (const region of spec.attributeRegions ?? []) inline.push(region);
  if (spec.contentRegion) inline.push(spec.contentRegion);
  const block = spec.childrenRegion;

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
/** the specs' say on components: a component takes only the children it names, other containers no child-only row */
function fits(content: Fragment, parent: PMNode, specs: SpecMap, childOnly: Set<string>): boolean {
  const names =
    parent.type.name === COMPONENT_NODE ? childNames(specs.get(parent.attrs.name as string)) : null;
  let ok = true;
  content.forEach((child) => {
    if (child.type.name !== COMPONENT_NODE) {
      if (names) ok = false;
      return;
    }
    const name = child.attrs.name as string;
    if (names ? !names.includes(name) : childOnly.has(name)) ok = false;
  });
  return ok;
}

export function dropSlot(
  state: EditorState,
  $pos: ResolvedPos,
  dragged: Fragment,
  source: BlockRange | null,
  specs: SpecMap,
  childOnly: Set<string>,
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
    if (!movableIn(first, parent) || !fits(dragged, parent, specs, childOnly)) continue;

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
  specs: SpecMap,
  childOnly: Set<string>,
): number | null {
  const coords = view.posAtCoords({ left: x, top: y });
  if (!coords) return null;
  const { doc } = view.state;
  return dropSlot(view.state, doc.resolve(coords.pos), dragged, source, specs, childOnly, (pos) => {
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
  specs: SpecMap,
  childOnly: Set<string>,
): number | null {
  const target = dropTarget(view, x, y, dragged, source, specs, childOnly);
  if (target == null) hideIndicator();
  else showIndicator(view, target);
  return target;
}

/** a copy of the run for the ghost: the text of an inline run, the blocks' clones stacked */
function ghostOf(
  view: EditorView,
  from: number,
  to: number,
): { el: HTMLElement; rect: DOMRect } | null {
  const $from = view.state.doc.resolve(from);
  if ($from.parent.inlineContent) {
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const el = document.createElement("span");
    el.appendChild(range.cloneContents());
    const block = view.nodeDOM($from.before());
    if (block instanceof HTMLElement) el.style.font = getComputedStyle(block).font;
    return { el, rect: range.getBoundingClientRect() };
  }
  const doms: HTMLElement[] = [];
  const rects: DOMRect[] = [];
  for (let pos = from; pos < to; pos += view.state.doc.nodeAt(pos)!.nodeSize) {
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return null;
    doms.push(dom);
    rects.push(dom.getBoundingClientRect());
  }
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const rect = new DOMRect(
    left,
    rects[0].top,
    right - left,
    rects[rects.length - 1].bottom - rects[0].top,
  );
  if (doms.length === 1) return { el: doms[0].cloneNode(true) as HTMLElement, rect };
  const el = document.createElement("div");
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.gap = `${rects[1].top - rects[0].bottom}px`;
  for (const dom of doms) {
    const copy = dom.cloneNode(true) as HTMLElement;
    copy.style.margin = "0";
    el.appendChild(copy);
  }
  return { el, rect };
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
  const tr = view.state.tr;
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
  specs: SpecMap,
  tilt: (dx: number, dy: number) => void,
): void {
  const { from } = range;
  if (range.to <= from) return;
  const $from = view.state.doc.resolve(from);
  const inline = $from.parent.inlineContent;
  const count = inline ? 0 : view.state.doc.resolve(range.to).index() - $from.index();
  const shape = ghostOf(view, from, range.to);
  if (!shape) return;
  const content = view.state.doc.slice(from, range.to).content;
  const childOnly = childOnlyNames(specs.values());
  const viewport = window.visualViewport;
  const source: BlockRange = { from, to: range.to };
  // the run as it stands: a composition committing mid-drag rewrites a
  // block in place, so for blocks the count is the guide, not the sizes
  const extent = () => {
    const { doc } = view.state;
    if (range.to > doc.content.size) return null;
    if (inline) return range.to;
    const $now = doc.resolve(from);
    const end = $now.index() + count;
    return end <= $now.parent.childCount ? $now.posAtIndex(end) : null;
  };
  const { pointerId, clientX: startX, clientY: startY } = event;
  let x = startX;
  let y = startY;
  let ghost: ReturnType<typeof lift> | null = null;
  let target: number | null = null;
  let scrolling = 0;

  const follow = () => {
    const to = extent();
    if (to == null) return;
    source.to = to;
    target = hover(view, content, source, x, y, specs, childOnly);
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
    const to = extent();
    if (e.type === "pointerup" && target != null && to != null) {
      placeDrop(view, view.state.doc.slice(from, to).content, target, { from, to });
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
              const content = Fragment.from(dragged);
              const insert = dropTarget(
                view,
                event.clientX,
                event.clientY,
                content,
                null,
                specs,
                childOnly,
              );
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
