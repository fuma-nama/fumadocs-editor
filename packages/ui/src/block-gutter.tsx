"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Popover } from "@base-ui/react/popover";
import { Plus } from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import type { MediaProvider } from "./components/media";
import { bubbleState } from "./bubble-menu";
import { DragHandle } from "./drag-handle";
import { insertItems } from "./slash-menu";
import { chrome } from "./styles/shared";
import { useEditorPortal } from "./utils/portal";

/** the gutter buttons' side, in px */
const GUTTER_BUTTON = 28;

const styles = stylex.create({
  /* the block's own controls: stacked in the gutter left of its first line,
   * or a row in the spot the component reserves for them */
  gutter: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 1,
    display: "flex",
    flexDirection: { default: "column", ":is([data-row])": "row" },
    alignItems: "center",
    willChange: "transform",
  },
  gutterButton: {
    display: "inline-flex",
    width: GUTTER_BUTTON,
    height: GUTTER_BUTTON,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
    outline: "none",
    color: { default: tokens.mutedForeground, ":is([data-popup-open])": tokens.foreground },
    backgroundColor: {
      default: "transparent",
      ":active": tokens.accent,
      ":is([data-popup-open])": tokens.accent,
    },
  },
  /* capped so the list stays usable with the keyboard up */
  insertPopup: {
    display: "flex",
    width: "15rem",
    maxHeight: "40vh",
    flexDirection: "column",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  group: {
    margin: 0,
    paddingInline: "0.5rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.125rem",
    fontSize: 11.5,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  /** touch target: 40px minimum */
  item: { minHeight: "2.5rem", flexShrink: 0 },
});

const gutterIconClass = stylex.props(chrome.button, styles.gutterButton).className!;

/** the spot a component reserves for the controls inside its own chrome */
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
 * Touch chrome beside the caret's block: its joystick and an insert button,
 * in the spot the block reserves for them, else in the gutter left of its
 * first line (a nested block's gutter would be its parent's chrome). The
 * joystick lives here, not in the bubble: from a toolbar a drag lifted the
 * ghost far from the finger while the line sat under it.
 */
export function BlockGutter({
  editor,
  components,
  specs,
  media,
  math,
}: {
  editor: Editor;
  components: UiComponentSpec[];
  specs: Map<string, UiComponentSpec>;
  media?: MediaProvider;
  math?: boolean;
}) {
  const target = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const { active, block } = bubbleState(current.state, specs);
      return active?.pos ?? block?.pos ?? null;
    },
  });
  const [insertOpen, setInsertOpen] = useState(false);
  const { anchorRef, container } = useEditorPortal();
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
      el.toggleAttribute("data-row", slot != null);
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

  const items = insertItems(components, media, math);
  let group = "";

  return (
    <div
      ref={(node) => {
        ref.current = node;
        anchorRef(node);
      }}
      {...stylex.props(styles.gutter)}
    >
      <DragHandle editor={editor} pos={target} specs={specs} look={styles.gutterButton} size={18} />
      <Popover.Root open={insertOpen} onOpenChange={setInsertOpen}>
        <Popover.Trigger aria-label="Insert" className={gutterIconClass}>
          <Plus size={18} />
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Positioner
            positionMethod="fixed"
            side="bottom"
            sideOffset={4}
            align="start"
            {...stylex.props(chrome.layer)}
          >
            <Popover.Popup
              data-fde-popup=""
              initialFocus={false}
              finalFocus={false}
              {...stylex.props(chrome.popup, styles.insertPopup)}
            >
              {items.map((item) => {
                const heading = item.group !== group;
                group = item.group;
                return (
                  <Fragment key={item.title}>
                    {heading && <p {...stylex.props(styles.group)}>{group}</p>}
                    <Popover.Close
                      {...stylex.props(chrome.button, chrome.item, styles.item)}
                      onClick={() => {
                        const { from } = editor.state.selection;
                        item.run(editor, { from, to: from });
                      }}
                    >
                      <span {...stylex.props(chrome.itemIcon)}>{item.icon}</span>
                      <span>{item.title}</span>
                    </Popover.Close>
                  </Fragment>
                );
              })}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
