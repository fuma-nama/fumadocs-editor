import type { NodeViewRendererOptions } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

/** TipTap flags every node view the selection covers as `selected`; only the node-selected one rings */
export function isRinged({ selected, editor, getPos }: NodeViewProps): boolean {
  const { selection } = editor.state;
  return selected && selection instanceof NodeSelection && selection.from === getPos();
}

/**
 * TipTap's default `stopEvent` swallows any event whose target
 * `isContentEditable`, which silences keydowns from editable areas nested in
 * renderer chrome before ProseMirror sees them. Stop only events on real
 * controls.
 */
function stopEvent({ event }: { event: Event }): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest("input, button, select, textarea") !== null
  );
}

/**
 * TipTap's default reads node-view mutations on iOS and Android while the
 * editor is focused (a virtual keyboard edits the DOM without key events).
 * Our chrome is React-rendered and commits after ProseMirror's own update,
 * so there every mount read as a DOM edit, and ProseMirror synthesizes Enter
 * from added block elements: an insert that mounts more chrome, forever.
 * Only the content element is ProseMirror's; the rest of the view is ours.
 */
function ignoreMutation({ mutation }: { mutation: { type: string; target: Node } }): boolean {
  if (mutation.type === "selection") return false;
  for (let el: Node | null = mutation.target; el; el = el.parentNode) {
    if (!(el instanceof Element)) continue;
    if (el.hasAttribute("data-node-view-content-react")) return false;
    if (el.classList.contains("react-renderer")) return true;
  }
  return true;
}

export const nodeViewOptions: Partial<NodeViewRendererOptions> = { stopEvent, ignoreMutation };
