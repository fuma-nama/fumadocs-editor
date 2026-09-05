"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { useLayoutEffect, useRef } from "react";
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

function gutterRow(dom: HTMLElement, inList: boolean): DOMRect {
  const row = dom.querySelector("[data-fde-row]");
  if (row instanceof HTMLElement && row.closest(".react-renderer") === dom) {
    return row.getBoundingClientRect();
  }
  const rect = dom.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(dom).lineHeight) || 24;
  // an item's marker or checkbox renders in the list's padding, outside the item's box
  const pad = inList ? parseFloat(getComputedStyle(dom.parentElement!).paddingInlineStart) || 0 : 0;
  return new DOMRect(rect.left - pad, rect.top, rect.width + pad, Math.min(line, rect.height));
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
      const { range } = bubbleState(current.state);
      if (!range) return null;
      const node = current.state.doc.nodeAt(range.from)!;
      if (node.type.spec.code) return range;
      if (!touch || (node.isTextblock && node.content.size === 0)) return null;
      return range;
    },
  });
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !target) return;
    const place = () => {
      // an inline run sits beside its textblock
      const $from = editor.state.doc.resolve(target.from);
      const dom = editor.view.nodeDOM($from.parent.inlineContent ? $from.before() : target.from);
      const frame = el.offsetParent;
      if (!(dom instanceof HTMLElement) || !frame) return;
      const base = frame.getBoundingClientRect();
      const slot = controlsSlot(dom);
      if (slot) {
        const at = slot.getBoundingClientRect();
        el.style.transform = `translate(${at.left - base.left}px, ${at.top - base.top}px)`;
        return;
      }
      const row = gutterRow(dom, isList($from.parent.type));
      // centred on the row, in the 24px gutter of the content's padding
      const x = row.left - base.left - (24 + GUTTER_BUTTON) / 2;
      const y = row.top - base.top + (row.height - GUTTER_BUTTON) / 2;
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
