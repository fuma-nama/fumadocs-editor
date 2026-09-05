"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import type { UiComponentSpec } from "./components/spec";
import { bubbleState } from "./bubble-menu";
import { DragHandle } from "./drag-handle";

/** the joystick's side, in px */
const GUTTER_BUTTON = 28;

const styles = stylex.create({
  /* in the gutter left of the block's first line, or in the spot the
   * component reserves for it */
  gutter: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 1,
    willChange: "transform",
  },
  button: {
    display: "inline-flex",
    width: GUTTER_BUTTON,
    height: GUTTER_BUTTON,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
    outline: "none",
    color: tokens.mutedForeground,
    backgroundColor: { default: "transparent", ":active": tokens.accent },
  },
});

/** the spot a component reserves for the joystick inside its own chrome */
function controlsSlot(dom: HTMLElement): HTMLElement | null {
  const slot = dom.querySelector("[data-fde-controls]");
  const own = dom.querySelector("[data-component]");
  // a slot the component shows only on touch screens is `display: none` elsewhere
  return slot instanceof HTMLElement &&
    slot.offsetWidth > 0 &&
    own &&
    slot.closest("[data-component]") === own
    ? slot
    : null;
}

/**
 * The joystick of the caret's block on touch: in the spot the block
 * reserves for it, else in the gutter left of its first line (a nested
 * block's gutter would be its parent's chrome). An empty line has nothing
 * to drag and gets none. It lives here, not in the bubble: from a toolbar a
 * drag lifted the ghost far from the finger while the line sat under it.
 */
export function BlockGutter({
  editor,
  specs,
}: {
  editor: Editor;
  specs: Map<string, UiComponentSpec>;
}) {
  const target = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const { active, block } = bubbleState(current.state, specs);
      const pos = active?.pos ?? block?.pos;
      if (pos == null) return null;
      const node = current.state.doc.nodeAt(pos)!;
      return node.isTextblock && node.content.size === 0 ? null : pos;
    },
  });
  const ref = useRef<HTMLDivElement>(null);

  // re-placed whenever the document's layout changes under it (an edit
  // above, a resize, an image loading); a transform, so nothing lays out
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || target == null) return;
    const place = () => {
      const dom = editor.view.nodeDOM(target);
      const frame = el.offsetParent;
      if (!(dom instanceof HTMLElement) || !frame) return;
      const base = frame.getBoundingClientRect();
      const slot = controlsSlot(dom);
      if (slot) {
        const at = slot.getBoundingClientRect();
        el.style.transform = `translate(${at.left - base.left}px, ${at.top - base.top}px)`;
        return;
      }
      const rect = dom.getBoundingClientRect();
      const line = parseFloat(getComputedStyle(dom).lineHeight) || 24;
      // centred on the block's first line, in the 24px gutter of the content's padding
      const x = rect.left - base.left - (24 + GUTTER_BUTTON) / 2;
      const y = rect.top - base.top + (Math.min(line, rect.height) - GUTTER_BUTTON) / 2;
      el.style.transform = `translate(${x}px, ${y}px)`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(editor.view.dom);
    return () => observer.disconnect();
  }, [editor, target]);

  if (target == null) return null;
  return (
    <div ref={ref} {...stylex.props(styles.gutter)}>
      <DragHandle editor={editor} pos={target} specs={specs} look={styles.button} size={18} />
    </div>
  );
}
