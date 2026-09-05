"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { useLayoutEffect, useRef } from "react";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { bubbleState } from "./bubble-menu";
import { isList } from "./components/keymap";
import { DragHandle } from "./drag-handle";

const GUTTER_BUTTON = 28;

const styles = stylex.create({
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

function gutterRow(dom: HTMLElement): DOMRect {
  const row = dom.querySelector("[data-fde-row]");
  if (row instanceof HTMLElement && row.closest(".react-renderer") === dom) {
    return row.getBoundingClientRect();
  }
  const rect = dom.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(dom).lineHeight) || 24;
  return new DOMRect(rect.left, rect.top, rect.width, Math.min(line, rect.height));
}

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

export function BlockGutter({ editor, touch }: { editor: Editor; touch: boolean }) {
  const target = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const { selection, doc } = current.state;
      const { range } = bubbleState(current.state);
      if (!range) return null;
      const node = doc.nodeAt(range.from)!;
      if (!node.type.spec.code && (!touch || (node.isTextblock && node.content.size === 0))) {
        return null;
      }
      // the row the finger last touched: a long selection's joystick stays on
      // screen, and clear of the system's copy bar above the selection's start
      const head =
        selection instanceof TextSelection
          ? Math.min(Math.max(selection.head, range.from), range.to)
          : range.from;
      return { from: range.from, to: range.to, head };
    },
  });
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !target) return;
    const place = () => {
      const frame = el.offsetParent;
      if (!frame) return;
      const { doc } = editor.state;
      const base = frame.getBoundingClientRect();
      const dom = editor.view.nodeDOM(target.from);
      const slot = dom instanceof HTMLElement ? controlsSlot(dom) : null;
      if (slot) {
        const at = slot.getBoundingClientRect();
        el.style.transform = `translate(${at.left - base.left}px, ${at.top - base.top}px)`;
        return;
      }
      const $head = doc.resolve(target.head);
      let row = dom instanceof HTMLElement ? dom : null;
      for (let depth = $head.depth; depth > 0; depth--) {
        if (!$head.node(depth).isTextblock) continue;
        const block = editor.view.nodeDOM($head.before(depth));
        if (block instanceof HTMLElement) row = block;
        break;
      }
      if (!row) return;
      const rect = gutterRow(row);
      // beside the dragged block's own edge; an item's marker or checkbox
      // renders in the list's padding, outside the item's box
      let left = dom instanceof HTMLElement ? dom.getBoundingClientRect().left : rect.left;
      if (dom instanceof HTMLElement && isList(doc.resolve(target.from).parent.type)) {
        left -= parseFloat(getComputedStyle(dom.parentElement!).paddingInlineStart) || 0;
      }
      // centred on the row, in the 24px gutter of the content's padding
      const x = left - base.left - (24 + GUTTER_BUTTON) / 2;
      const y = rect.top - base.top + (rect.height - GUTTER_BUTTON) / 2;
      el.style.transform = `translate(${x}px, ${y}px)`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(editor.view.dom);
    return () => observer.disconnect();
  }, [editor, target]);

  if (!target) return null;
  return (
    <div ref={ref} {...stylex.props(styles.gutter)}>
      <DragHandle editor={editor} range={target} look={styles.button} size={18} />
    </div>
  );
}
