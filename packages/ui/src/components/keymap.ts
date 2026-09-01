import { Extension, isMacOS, type Editor } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import {
  BLOCK_REGION_NODE,
  COMPONENT_NODE,
  INLINE_REGION_NODE,
  type ComponentSpec,
} from "@fumadocs-editor/core";

/*
 * The component keyboard grammar. Everything here derives from `ComponentSpec`
 * (`listLike`, `childComponent`, regions): no behaviour is keyed on literal
 * component names, and structural moves only place a component into parents
 * whose spec accepts it, so an invalid document is unproducible.
 */

/** read-only, so a `Map<string, UiComponentSpec>` passes without casts */
export type SpecMap = ReadonlyMap<string, ComponentSpec>;

export function childNames(spec: ComponentSpec | undefined): string[] {
  if (!spec?.childComponent) return [];
  return Array.isArray(spec.childComponent) ? spec.childComponent : [spec.childComponent];
}

/** components that only exist inside a container (File, Card, Step, …) */
export function childOnlyNames(specs: Iterable<ComponentSpec>): Set<string> {
  const out = new Set<string>();
  for (const spec of specs) {
    for (const name of childNames(spec)) out.add(name);
  }
  return out;
}

/** child specs a container can insert */
export function insertableChildren<S extends ComponentSpec>(
  spec: ComponentSpec | undefined,
  specs: ReadonlyMap<string, S>,
): S[] {
  const out: S[] = [];
  for (const name of childNames(spec)) {
    const child = specs.get(name);
    if (child?.insert) out.push(child);
  }
  return out;
}

/**
 * What a component's panel can insert and where: the component's own children
 * at its end, or: for a childless entry like a File row, the nearest
 * ancestor container's children as siblings after the entry.
 */
export function childInsertContext<S extends ComponentSpec>(
  state: EditorState,
  pos: number,
  specs: ReadonlyMap<string, S>,
): { children: S[]; insertAt: number } | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== COMPONENT_NODE) return null;
  const own = insertableChildren(specs.get(node.attrs.name as string), specs);
  if (own.length > 0) return { children: own, insertAt: pos + node.nodeSize - 1 };

  const $inside = state.doc.resolve(pos + 1);
  let self = -1;
  for (let depth = $inside.depth; depth > 0; depth--) {
    if ($inside.before(depth) === pos) {
      self = depth;
      break;
    }
  }
  for (let depth = self - 1; depth > 0; depth--) {
    if ($inside.node(depth).type.name !== COMPONENT_NODE) continue;
    const children = insertableChildren(specs.get($inside.node(depth).attrs.name as string), specs);
    // insert after the ancestor's child that contains `pos`
    if (children.length > 0) return { children, insertAt: $inside.after(depth + 1) };
  }
  return null;
}

/**
 * Put the caret on the nearest text position at/after (`dir: 1`) or at/before
 * (`dir: -1`) `pos`. Refuses to move against `dir`, so a caller can never
 * teleport the caret out of the area it intended.
 */
function focusNear(editor: Editor, pos: number, dir: 1 | -1): boolean {
  const { view } = editor;
  const tr = view.state.tr;
  const clamped = Math.max(0, Math.min(pos, tr.doc.content.size));
  // text-only search: TextSelection.near can fall back to node selections
  const selection = Selection.findFrom(tr.doc.resolve(clamped), dir, true);
  if (!selection || (dir === 1 ? selection.from < pos : selection.to > pos)) return false;
  view.dispatch(tr.setSelection(selection).scrollIntoView());
  view.focus();
  return true;
}

export function focusAt(editor: Editor, pos: number): void {
  focusNear(editor, pos, 1);
}

/** depth of the enclosing inline region at the cursor, or -1 */
function inlineRegionDepth($from: ResolvedPos): number {
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === INLINE_REGION_NODE) return depth;
  }
  return -1;
}

/** depth of the enclosing inline or block region, or -1 */
function regionDepth($from: ResolvedPos): number {
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === INLINE_REGION_NODE || name === BLOCK_REGION_NODE) return depth;
  }
  return -1;
}

/** depth of the innermost enclosing component, or -1 */
function componentDepth($from: ResolvedPos): number {
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === COMPONENT_NODE) return depth;
  }
  return -1;
}

function hasComponentChild(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (child.type.name === COMPONENT_NODE) found = true;
  });
  return found;
}

/** innermost component whose range fully contains [from, to], or null */
function enclosingComponent(
  editor: Editor,
  from: number,
  to: number,
): { node: PMNode; pos: number } | null {
  const $from = editor.state.doc.resolve(from);
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== COMPONENT_NODE) continue;
    const pos = $from.before(depth);
    if (to <= pos + node.nodeSize) return { node, pos };
  }
  return null;
}

/**
 * The entry component of a list-like container at the cursor: the innermost
 * component whose parent is a component with `listLike` accepting it (a File
 * or Folder row). Null when the innermost component is anything else.
 */
export function listEntryDepth($from: ResolvedPos, specs: SpecMap): number {
  const depth = componentDepth($from);
  if (depth < 2) return -1;
  const parent = $from.node(depth - 1);
  if (parent.type.name !== COMPONENT_NODE) return -1;
  const containerSpec = specs.get(parent.attrs.name as string);
  if (!containerSpec?.listLike) return -1;
  const name = $from.node(depth).attrs.name as string;
  return childNames(containerSpec).includes(name) ? depth : -1;
}

/* ---- Enter ---- */

/**
 * Enter on an empty trailing paragraph of a block region leaves the component:
 * move to the next sibling component when there is one, otherwise pop levels
 * until a paragraph fits and start one there. Each press pops one component,
 * mirroring how double-Enter lifts out of a list.
 */
function exitOnEmptyParagraph(editor: Editor): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const para = $from.parent;
  if (para.type.name !== "paragraph" || para.content.size > 0 || $from.depth < 2) return false;
  const region = $from.node($from.depth - 1);
  if (region.type.name !== BLOCK_REGION_NODE) return false;
  if ($from.index($from.depth - 1) !== region.childCount - 1) return false;
  const comp = $from.depth - 2;
  if ($from.node(comp).type.name !== COMPONENT_NODE) return false;

  const paraStart = $from.before($from.depth);
  const tr = state.tr.delete(paraStart, paraStart + para.nodeSize);

  const afterComp = $from.after(comp);
  if (state.doc.resolve(afterComp).nodeAfter?.type.name === COMPONENT_NODE) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(afterComp) + 1), 1));
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  }

  const paragraph = state.schema.nodes.paragraph;
  for (let depth = comp; depth >= 1; depth--) {
    const parent = $from.node(depth - 1);
    const index = $from.indexAfter(depth - 1);
    if (!parent.canReplaceWith(index, index, paragraph)) continue;
    const pos = tr.mapping.map($from.after(depth));
    tr.insert(pos, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  }
  return false;
}

/**
 * Enter inside an inline region never splits it (the backing attribute is a
 * single string). Behaviour depends on the component:
 *   - list-like container's own name (Folder): insert a child entry inside it;
 *   - repeated child of a list-like container (File): insert a sibling entry;
 *   - anything else (Card / Accordion title): move to the component's next
 *     editable region, matching how Tab-style field navigation reads.
 */
function handleEnter(editor: Editor, specs: SpecMap): boolean {
  const { state } = editor;
  const selection = state.selection;

  if (selection instanceof NodeSelection) {
    const node = selection.node;
    if (node.type.name === COMPONENT_NODE) return focusNear(editor, selection.from + 1, 1);
    if (node.isBlock && node.isAtom) {
      const tr = state.tr.insert(selection.to, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, selection.to + 1));
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    }
    return false;
  }

  const { $from } = selection;
  const regionDepth = inlineRegionDepth($from);
  if (regionDepth === -1) return exitOnEmptyParagraph(editor);

  const compDepth = regionDepth - 1;
  const comp = compDepth >= 1 ? $from.node(compDepth) : null;
  if (!comp || comp.type.name !== COMPONENT_NODE) return true;
  const spec = specs.get(comp.attrs.name as string);

  // list-like container name (Folder): add the default child after the name
  if (spec?.listLike) {
    const childSpec = insertableChildren(spec, specs)[0];
    if (childSpec) {
      const insertPos = $from.after(regionDepth);
      editor.chain().insertContentAt(insertPos, childSpec.insert!()).run();
      focusAt(editor, insertPos + 1);
      return true;
    }
  }

  // repeated child of a list-like container (File): add a sibling after it
  const container = compDepth >= 1 ? $from.node(compDepth - 1) : null;
  const containerSpec =
    container?.type.name === COMPONENT_NODE ? specs.get(container.attrs.name as string) : undefined;
  if (
    containerSpec?.listLike &&
    spec?.insert &&
    childNames(containerSpec).includes(comp.attrs.name as string)
  ) {
    const insertPos = $from.after(compDepth);
    editor.chain().insertContentAt(insertPos, spec.insert()).run();
    focusAt(editor, insertPos + 1);
    return true;
  }

  // otherwise: jump to the next region in this component, if any
  const nextRegionStart = $from.after(regionDepth);
  if (nextRegionStart < $from.end(compDepth)) focusAt(editor, nextRegionStart + 1);
  return true; // never split an inline region
}

/**
 * Mod-Enter inserts the next sibling from anywhere inside a container child
 * (a new Step mid-typing); inside a standalone component it starts a
 * paragraph after it.
 */
export function handleModEnter(editor: Editor, specs: SpecMap): boolean {
  const { state } = editor;
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 1; depth--) {
    if ($from.node(depth).type.name !== COMPONENT_NODE) continue;
    const parent = $from.node(depth - 1);
    if (parent.type.name !== COMPONENT_NODE) continue;
    const name = $from.node(depth).attrs.name as string;
    const spec = specs.get(name);
    if (!spec?.insert || !childNames(specs.get(parent.attrs.name as string)).includes(name))
      continue;
    const insertPos = $from.after(depth);
    editor.chain().insertContentAt(insertPos, spec.insert()).run();
    focusAt(editor, insertPos + 1);
    return true;
  }

  const outer = outermostComponentDepth($from);
  if (outer === -1) return false;
  const pos = $from.after(outer);
  const tr = state.tr.insert(pos, state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function outermostComponentDepth($from: ResolvedPos): number {
  for (let depth = 1; depth <= $from.depth; depth++) {
    if ($from.node(depth).type.name === COMPONENT_NODE) return depth;
  }
  return -1;
}

/* ---- Tab ---- */

/**
 * Tab toggles the row in place between the container's plain entry type and
 * its container type (File ↔ Folder). Only attributes change: the node and
 * its text are kept, so the node view updates in place and the caret never
 * moves. A folder that still has children stays a folder.
 */
export function toggleEntryType(editor: Editor, specs: SpecMap): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const depth = listEntryDepth($from, specs);
  if (depth === -1) return false;
  const entry = $from.node(depth);
  if (hasComponentChild(entry)) return false;
  const entryName = entry.attrs.name as string;
  const containerSpec = specs.get($from.node(depth - 1).attrs.name as string);

  let target: ComponentSpec | undefined;
  if (childNames(specs.get(entryName)).length === 0) {
    // plain row: become the type that can hold rows like it
    for (const name of childNames(containerSpec)) {
      const spec = specs.get(name);
      if (spec && childNames(spec).includes(entryName)) {
        target = spec;
        break;
      }
    }
  } else {
    // empty container row: back to the plain type
    for (const name of childNames(containerSpec)) {
      const spec = specs.get(name);
      if (spec && name !== entryName && childNames(spec).length === 0) {
        target = spec;
        break;
      }
    }
  }
  if (!target || target.childrenRegion) return false;

  // regions must correspond one to one for a clean retag
  const regions = target.attributeRegions ?? [];
  const sources: number[] = [];
  entry.forEach((child, off) => {
    if (child.type.name === INLINE_REGION_NODE) sources.push(off);
  });
  if (sources.length !== regions.length) return false;

  const entryStart = $from.before(depth);
  const pos = $from.pos;
  const tr = state.tr.setNodeMarkup(entryStart, undefined, {
    name: target.name,
    attributes: entry.attrs.attributes,
  });
  regions.forEach((region, i) => {
    tr.setNodeMarkup(entryStart + 1 + sources[i], undefined, { region: region.region });
  });
  editor.view.dispatch(tr);
  // The name change swaps the spec renderer; React remounts the row's content
  // a microtask later, which throws the DOM caret out of the region: and
  // ProseMirror would then adopt that stray selection. Re-assert the caret
  // after the commit and force the DOM selection back in sync.
  queueMicrotask(() => {
    if (editor.isDestroyed) return;
    const restored = TextSelection.create(
      editor.state.doc,
      Math.min(pos, editor.state.doc.content.size),
    );
    if (!editor.state.selection.eq(restored)) {
      editor.view.dispatch(editor.state.tr.setSelection(restored));
    }
    if (editor.view.hasFocus()) editor.view.focus();
  });
  return true;
}

/** Shift-Tab moves the entry out, right after its parent folder. */
export function outdentEntry(editor: Editor, specs: SpecMap): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const depth = listEntryDepth($from, specs);
  if (depth === -1 || depth < 3) return false;
  const grand = $from.node(depth - 2);
  if (grand.type.name !== COMPONENT_NODE) return false;
  const entry = $from.node(depth);
  if (!childNames(specs.get(grand.attrs.name as string)).includes(entry.attrs.name as string)) {
    return false;
  }

  const entryStart = $from.before(depth);
  const offset = $from.pos - entryStart;
  const afterParent = $from.after(depth - 1);
  const tr = state.tr.delete(entryStart, entryStart + entry.nodeSize);
  const target = tr.mapping.map(afterParent);
  tr.insert(target, entry);
  tr.setSelection(TextSelection.create(tr.doc, target + offset));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Tab as field navigation: next/previous region, then the next sibling child. */
function navigateRegion(editor: Editor, dir: 1 | -1): boolean {
  const { $from } = editor.state.selection;
  const depth = regionDepth($from);
  if (depth === -1) return false;
  const comp = depth - 1;
  if (comp < 1 || $from.node(comp).type.name !== COMPONENT_NODE) return false;

  if (dir === 1) {
    const next = $from.after(depth);
    if (next < $from.end(comp)) return focusNear(editor, next + 1, 1);
    const afterComp = $from.after(comp);
    if (editor.state.doc.resolve(afterComp).nodeAfter?.type.name === COMPONENT_NODE) {
      return focusNear(editor, afterComp + 1, 1);
    }
    return true; // end of the component: stay put, never let focus escape
  }
  const prev = $from.before(depth);
  if (prev > $from.start(comp)) return focusNear(editor, prev - 1, -1);
  const beforeComp = $from.before(comp);
  if (editor.state.doc.resolve(beforeComp).nodeBefore?.type.name === COMPONENT_NODE) {
    return focusNear(editor, beforeComp - 1, -1);
  }
  return true;
}

function handleTab(editor: Editor, specs: SpecMap, dir: 1 | -1): boolean {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name === "codeBlock") {
    return dir === 1 ? editor.commands.insertContent("  ") : true;
  }
  // lists and tables keep their own Tab handling; the guard extension swallows misses
  if (editor.isActive("listItem") || editor.isActive("taskItem") || editor.isActive("table")) {
    return false;
  }
  if (listEntryDepth($from, specs) !== -1) {
    return (dir === 1 ? toggleEntryType(editor, specs) : outdentEntry(editor, specs)) || true;
  }
  return navigateRegion(editor, dir);
}

/* ---- moving components ---- */

/**
 * Swap the component at `pos` with its previous/next sibling: the keyboard
 * and touch counterpart of dragging a row. Regions are not siblings a
 * component may cross (a row never moves above its folder's name), so those
 * swaps are refused.
 */
export function moveComponentAt(editor: Editor, pos: number, dir: 1 | -1): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== COMPONENT_NODE) return false;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index();
  const siblingIndex = index + dir;
  if (siblingIndex < 0 || siblingIndex >= $pos.parent.childCount) return false;
  const sibling = $pos.parent.child(siblingIndex);
  const name = sibling.type.name;
  if (name === INLINE_REGION_NODE || name === BLOCK_REGION_NODE) return false;

  const end = pos + node.nodeSize;
  const newStart = dir === -1 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
  const selection = state.selection;
  const inside = selection.from >= pos && selection.to <= end;
  const offset = selection.from - pos;

  const tr = state.tr.delete(pos, end);
  tr.insert(newStart, node);
  if (selection instanceof NodeSelection && selection.from === pos) {
    tr.setSelection(NodeSelection.create(tr.doc, newStart));
  } else if (inside) {
    tr.setSelection(TextSelection.create(tr.doc, newStart + offset));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Alt-Arrow: move the innermost component containing the selection */
function handleMove(editor: Editor, dir: 1 | -1): boolean {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === COMPONENT_NODE) {
    return moveComponentAt(editor, selection.from, dir);
  }
  const depth = componentDepth(selection.$from);
  if (depth === -1) return false;
  return moveComponentAt(editor, selection.$from.before(depth), dir);
}

/* ---- Backspace / Delete ---- */

/**
 * Delete a whole leaf component when a selection wipes out all of its text at
 * once (e.g. select-all inside a Callout → Delete), instead of leaving an empty
 * shell behind. Only fires for leaf components (no child components) so a
 * cross-item selection in a container is left to the default handler.
 */
function handleClearingDelete(editor: Editor, specs: SpecMap): boolean {
  const { state } = editor;
  const { selection } = state;
  if (selection.empty) return false;

  const comp = enclosingComponent(editor, selection.from, selection.to);
  if (!comp) return false;
  const spec = specs.get(comp.node.attrs.name as string);
  if (!spec || spec.childComponent) return false;
  if (comp.node.textContent.length === 0) return false;

  // nothing textual survives on either side of the selection within the component
  const start = comp.pos;
  const end = comp.pos + comp.node.nodeSize;
  const before = state.doc.textBetween(start, selection.from, "", "");
  const after = state.doc.textBetween(selection.to, end, "", "");
  if (before !== "" || after !== "") return false;

  editor.chain().deleteRange({ from: start, to: end }).focus().run();
  return true;
}

/**
 * A text selection spanning an inline-region boundary must never reach
 * ProseMirror's structural replace: the region backs a single string, and a
 * replace across it splits the component into valid-but-wrong pieces (a
 * Tab's body remnant re-healed as a second Tab's label).
 */
export function crossesRegion(state: EditorState): boolean {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return false;
  const startOf = ($pos: ResolvedPos) => {
    const depth = inlineRegionDepth($pos);
    return depth === -1 ? -1 : $pos.start(depth);
  };
  return startOf(selection.$from) !== startOf(selection.$to);
}

/** clear the selected text block-by-block, leaving every node intact */
export function deleteAcrossRegions(editor: Editor): boolean {
  if (!crossesRegion(editor.state)) return false;
  const { from, to } = editor.state.selection;
  const tr = editor.state.tr;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = Math.max(from, pos + 1);
    const end = Math.min(to, pos + 1 + node.content.size);
    if (start < end) tr.delete(tr.mapping.map(start), tr.mapping.map(end));
    return false;
  });
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(from))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Backspace/Delete at the edge of a fully empty, childless component removes
 * the component itself: an empty File row, an emptied Callout.
 */
function deleteEmptyComponent(editor: Editor, dir: 1 | -1): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if (dir === -1 ? $from.parentOffset > 0 : $from.parentOffset < $from.parent.content.size) {
    return false;
  }
  const depth = componentDepth($from);
  if (depth === -1) return false;
  const comp = $from.node(depth);
  if (comp.textContent.length > 0 || hasComponentChild(comp)) return false;

  // the caret must sit at the component's own edge, not an inner one
  const start = $from.before(depth);
  const inside = dir === -1 ? start + 1 : start + comp.nodeSize - 1;
  const edge = TextSelection.near(state.doc.resolve(inside), dir === -1 ? 1 : -1);
  if (edge.from !== $from.pos) return false;

  const tr = state.tr.delete(start, start + comp.nodeSize);
  tr.setSelection(TextSelection.near(tr.doc.resolve(start), dir));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Backspace in an emptied folder name deletes the folder itself: its children
 * splice up into its place, so no content is lost with it.
 */
function unwrapEmptyEntry(editor: Editor, specs: SpecMap): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0 || $from.parent.content.size > 0) return false;
  const region = inlineRegionDepth($from);
  if (region === -1 || region < 2) return false;
  const depth = region - 1;
  const entry = $from.node(depth);
  const parent = $from.node(depth - 1);
  if (entry.type.name !== COMPONENT_NODE || parent.type.name !== COMPONENT_NODE) return false;

  const allowed = childNames(specs.get(parent.attrs.name as string));
  const children: PMNode[] = [];
  let fits = true;
  entry.forEach((child) => {
    if (child.type.name !== COMPONENT_NODE) return;
    if (!allowed.includes(child.attrs.name as string)) fits = false;
    children.push(child);
  });
  if (!fits || children.length === 0) return false;

  const start = $from.before(depth);
  const tr = state.tr.replaceWith(start, start + entry.nodeSize, children);
  tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1), 1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Word and line deletes (Alt/Cmd-Backspace and their macOS aliases) have no
 * ProseMirror implementation: TipTap's bindings all fail inside an isolated
 * region and the event reaches the browser's native editing. Mid-text that is
 * fine: the mutation stays inside one textblock, but at a textblock edge the
 * browser deletes across node-view boundaries and the DOM observer then parses
 * whole regions out of the document (an empty file name loses its region and
 * with it the placeholder). Route the edge cases through the same structural
 * chain as plain Backspace/Delete.
 */
function handleUnitDelete(editor: Editor, specs: SpecMap, dir: 1 | -1): boolean {
  const { selection } = editor.state;
  if (!selection.empty) {
    return (
      handleClearingDelete(editor, specs) ||
      deleteAcrossRegions(editor) ||
      editor.commands.deleteSelection()
    );
  }
  const { $from } = selection;
  if (!$from.parent.isTextblock) return false;
  const atEdge =
    dir === -1 ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size;
  if (!atEdge) return false;
  return (
    deleteEmptyComponent(editor, dir) ||
    unwrapEmptyEntry(editor, specs) ||
    guardRegionBoundary(editor, dir) ||
    (dir === -1
      ? editor.commands.joinBackward() || editor.commands.selectNodeBackward()
      : editor.commands.joinForward() || editor.commands.selectNodeForward())
  );
}

/** Swallow joins across region boundaries so structure can't be damaged. */
function guardRegionBoundary(editor: Editor, dir: 1 | -1): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty) return false;
  const depth = regionDepth($from);
  if (depth === -1) return false;
  if (dir === -1 ? $from.parentOffset > 0 : $from.parentOffset < $from.parent.content.size) {
    return false;
  }
  if (depth === $from.depth) return true; // inline region edge
  const region = $from.node(depth);
  return dir === -1 ? $from.index(depth) === 0 : $from.index(depth) === region.childCount - 1;
}

/* ---- Escape / Mod-A ---- */

/** Escape steps the selection up: component → parent component → blur. */
function handleEscape(editor: Editor): boolean {
  const { state } = editor;
  const selection = state.selection;

  if (selection instanceof NodeSelection) {
    const $pos = state.doc.resolve(selection.from);
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name === COMPONENT_NODE) {
        selectNode(editor, $pos.before(depth));
        return true;
      }
    }
    return editor.commands.blur();
  }

  const depth = componentDepth(selection.$from);
  if (depth !== -1) {
    selectNode(editor, selection.$from.before(depth));
    return true;
  }
  return editor.commands.blur();
}

function selectNode(editor: Editor, pos: number): void {
  const tr = editor.state.tr;
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  editor.view.dispatch(tr.scrollIntoView());
}

/** Mod-A widens the selection: region text → component → outer component → doc. */
function handleSelectScope(editor: Editor): boolean {
  const { state } = editor;
  const selection = state.selection;
  const { $from } = selection;

  const candidates: { from: number; to: number; node?: number }[] = [];
  const rd = regionDepth($from);
  if (rd !== -1) candidates.push({ from: $from.start(rd), to: $from.end(rd) });
  else if ($from.parent.type.name === "codeBlock") {
    candidates.push({ from: $from.start($from.depth), to: $from.end($from.depth) });
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === COMPONENT_NODE) {
      const pos = $from.before(depth);
      candidates.push({ from: pos, to: pos + $from.node(depth).nodeSize, node: pos });
    }
  }
  if (candidates.length === 0) return false;

  for (const candidate of candidates) {
    if (selection.from <= candidate.from && selection.to >= candidate.to) continue;
    const tr = state.tr;
    tr.setSelection(
      candidate.node != null
        ? NodeSelection.create(tr.doc, candidate.node)
        : TextSelection.create(tr.doc, candidate.from, candidate.to),
    );
    editor.view.dispatch(tr);
    return true;
  }
  return false; // everything covered: fall through to select-all
}

/* ---- arrows across structural boundaries ---- */

/**
 * Arrow keys at a textblock edge, when the crossing is structural (into, out
 * of, or between components), move the caret straight to the adjacent text in
 * document order. Left to ProseMirror/native handling, these crossings strand
 * the caret on node-view wrappers and icons. An adjacent block atom
 * (frontmatter, ESM, verbatim) is selected instead: it has no text, and from
 * a selected node the same keys step back into text. Plain prose-to-prose
 * moves stay native so the caret keeps its goal column.
 */
function handleBoundaryArrow(editor: Editor, dir: 1 | -1, axis: "v" | "h"): boolean {
  const { state, view } = editor;
  const selection = state.selection;

  if (selection instanceof NodeSelection && selection.node.isBlock) {
    const edge = dir === 1 ? selection.to : selection.from;
    const $edge = state.doc.resolve(edge);
    const next = dir === 1 ? $edge.nodeAfter : $edge.nodeBefore;
    if (next?.isBlock && next.isAtom) {
      selectNode(editor, dir === 1 ? edge : edge - next.nodeSize);
      return true;
    }
    return focusNear(editor, edge, dir);
  }
  if (!selection.empty || !selection.$from.parent.isTextblock) return false;
  const { $from } = selection;
  const atEdge =
    dir === 1 ? $from.parentOffset === $from.parent.content.size : $from.parentOffset === 0;
  if (axis === "h") {
    if (!atEdge) return false;
  } else if (!atEdge && !view.endOfTextblock(dir === 1 ? "down" : "up")) {
    return false;
  }

  for (let depth = $from.depth; depth > 0; depth--) {
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    const sibIndex = index + dir;
    if (sibIndex < 0 || sibIndex >= parent.childCount) continue;
    const sibling = parent.child(sibIndex);

    if (sibling.isBlock && sibling.isAtom) {
      selectNode(editor, dir === -1 ? $from.before(depth) - sibling.nodeSize : $from.after(depth));
      return true;
    }
    // structural: the sibling is a component, or the move exits one
    let structural = sibling.type.name === COMPONENT_NODE;
    for (let d = depth; !structural && d <= $from.depth; d++) {
      structural = $from.node(d).type.name === COMPONENT_NODE;
    }
    if (!structural) return false;
    const boundary = dir === -1 ? $from.before(depth) : $from.after(depth);
    return focusNear(editor, boundary, dir);
  }
  return false;
}

/* ---- the extensions ---- */

export function componentKeymap(specs: SpecMap): Extension[] {
  return [
    Extension.create({
      name: "fdeComponentKeymap",
      addKeyboardShortcuts() {
        const back = ({ editor }: { editor: Editor }) => handleUnitDelete(editor, specs, -1);
        const forward = ({ editor }: { editor: Editor }) => handleUnitDelete(editor, specs, 1);
        return {
          "Alt-Backspace": back,
          "Mod-Backspace": back,
          "Alt-Delete": forward,
          "Mod-Delete": forward,
          ...(isMacOS()
            ? {
                "Ctrl-h": back,
                "Ctrl-d": forward,
                "Ctrl-k": forward,
                "Alt-d": forward,
                "Ctrl-Alt-Backspace": forward,
              }
            : {}),
          Enter: ({ editor }) => handleEnter(editor, specs),
          "Mod-Enter": ({ editor }) => handleModEnter(editor, specs),
          "Shift-Enter": ({ editor }) => inlineRegionDepth(editor.state.selection.$from) !== -1,
          Tab: ({ editor }) => handleTab(editor, specs, 1),
          "Shift-Tab": ({ editor }) => handleTab(editor, specs, -1),
          Backspace: ({ editor }) =>
            handleClearingDelete(editor, specs) ||
            deleteAcrossRegions(editor) ||
            deleteEmptyComponent(editor, -1) ||
            unwrapEmptyEntry(editor, specs) ||
            guardRegionBoundary(editor, -1),
          Delete: ({ editor }) =>
            handleClearingDelete(editor, specs) ||
            deleteAcrossRegions(editor) ||
            deleteEmptyComponent(editor, 1) ||
            unwrapEmptyEntry(editor, specs) ||
            guardRegionBoundary(editor, 1),
          Escape: ({ editor }) => handleEscape(editor),
          "Mod-a": ({ editor }) => handleSelectScope(editor),
          ArrowUp: ({ editor }) => handleBoundaryArrow(editor, -1, "v"),
          ArrowDown: ({ editor }) => handleBoundaryArrow(editor, 1, "v"),
          "Alt-ArrowUp": ({ editor }) => handleMove(editor, -1),
          "Alt-ArrowDown": ({ editor }) => handleMove(editor, 1),
          ArrowLeft: ({ editor }) => handleBoundaryArrow(editor, -1, "h"),
          ArrowRight: ({ editor }) => handleBoundaryArrow(editor, 1, "h"),
        };
      },
    }),
    // runs after every default handler: Tab never moves focus out of the editor
    Extension.create({
      name: "fdeTabGuard",
      priority: 50,
      addKeyboardShortcuts() {
        return { Tab: () => true, "Shift-Tab": () => true };
      },
    }),
  ];
}
