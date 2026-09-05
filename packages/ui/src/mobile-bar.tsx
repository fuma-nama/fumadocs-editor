"use client";
// side-effect import: registers starter-kit command typings
import "@tiptap/starter-kit";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Popover } from "@base-ui/react/popover";
import { Plus, Redo2, Undo2 } from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import type { MediaProvider } from "./components/media";
import { BlockMenu, useBlockMenuOpen } from "./block-panel";
import { BlockTypePicker, activeBlock, bubbleState } from "./bubble-menu";
import { DragHandle } from "./drag-handle";
import { insertItems } from "./slash-menu";
import { chrome } from "./styles/shared";
import { useEditorPortal } from "./utils/portal";

/** the gutter buttons' side, in px */
const GUTTER_BUTTON = 28;

const styles = stylex.create({
  /* Heads the editor and sticks to the top of the viewport while scrolling,
   * below a site header by `--fde-sticky-top`. Its popups portal into it
   * and hang below. */
  bar: {
    boxSizing: "border-box",
    position: "sticky",
    top: tokens.stickyTop,
    zIndex: 40,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    backgroundColor: tokens.popover,
    color: tokens.popoverForeground,
  },
  row: {
    display: "flex",
    height: "3rem",
    alignItems: "center",
    gap: "0.125rem",
    overflowX: "auto",
    scrollbarWidth: "none",
    paddingInline: "0.375rem",
  },
  /** touch target: 40px square minimum */
  button: {
    display: "inline-flex",
    height: "2.5rem",
    minWidth: "2.5rem",
    flexShrink: 0,
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.375rem",
    borderRadius: "0.5rem",
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: "nowrap",
    outline: "none",
    color: {
      default: tokens.mutedForeground,
      ":is([data-active])": tokens.foreground,
    },
    backgroundColor: {
      default: "transparent",
      ":active": tokens.accent,
      ":is([data-active])": tokens.accent,
      ":is([data-popup-open])": tokens.accent,
    },
    opacity: { default: null, ":disabled": 0.35 },
  },
  labeled: { paddingInline: "0.625rem", color: tokens.foreground },
  spacer: { minWidth: "0.25rem", flex: 1 },
  /* popups hang below the bar; capped so they stay usable with the keyboard up */
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
  item: { minHeight: "2.5rem", flexShrink: 0 },
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
});

const labeledClass = stylex.props(chrome.button, styles.button, styles.labeled).className!;
const gutterIconClass = stylex.props(chrome.button, styles.gutterButton).className!;

function BarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      {...stylex.props(chrome.button, styles.button)}
      disabled={disabled}
      // Keep focus (and the virtual keyboard) in the editor by cancelling the
      // mouse focus transfer, but never a touch pointerdown: WebKit then
      // suppresses the synthesized click entirely and the button goes dead on
      // real touches. Touch taps don't focus buttons on iOS, and every action
      // refocuses the editor through chain().focus() anyway.
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") event.preventDefault();
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface MobileBarProps {
  editor: Editor;
  components: UiComponentSpec[];
  specs: Map<string, UiComponentSpec>;
  media?: MediaProvider;
  math?: boolean;
}

/**
 * Touch editing surface: a toolbar heading the editor, stuck to the top while
 * scrolling, and the block's own controls beside the block. Formatting a
 * selection is the bubble's, below the selection.
 */
export function MobileBar(props: MobileBarProps) {
  return (
    <>
      <TouchBar {...props} />
      <BlockGutter editor={props.editor} specs={props.specs} />
    </>
  );
}

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
 * The joystick and menu of the caret's block: in the spot the block
 * reserves for them, else in the gutter left of its first line (a nested
 * block's gutter would be its parent's chrome). From the bar they were a
 * screen away from the block: a drag lifted the ghost far from the finger
 * while the line sat under it.
 */
function BlockGutter({ editor, specs }: { editor: Editor; specs: Map<string, UiComponentSpec> }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const { active, block } = bubbleState(current.state, specs);
      return { active, block };
    },
  });
  const target = state?.active?.pos ?? state?.block?.pos;
  const [open, setOpen] = useBlockMenuOpen(editor, target);
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

  if (state == null || target == null) return null;
  return (
    <div
      ref={(node) => {
        ref.current = node;
        anchorRef(node);
      }}
      {...stylex.props(styles.gutter)}
    >
      <DragHandle editor={editor} pos={target} specs={specs} look={styles.gutterButton} size={18} />
      <BlockMenu
        editor={editor}
        specs={specs}
        active={state.active}
        block={state.block}
        open={open}
        onOpenChange={setOpen}
        container={container}
        side="bottom"
        align="start"
        chipCls={gutterIconClass}
        iconCls={gutterIconClass}
        touch
        compact
      />
    </div>
  );
}

function TouchBar({ editor, components, media, math }: MobileBarProps) {
  // popups portal into the bar itself: inside the theme scope, and moving
  // with it rather than repositioned on every scroll
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      return {
        turnInto: activeBlock(current),
        // through the registered undo command, so this is the plugin history
        // in single-user mode and the Y undo manager under collab
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
      };
    },
  });

  if (state == null) return null;

  const run = (fn: (chain: ReturnType<Editor["chain"]>) => { run: () => boolean }) => {
    fn(editor.chain().focus()).run();
  };

  const items = insertItems(components, media, math);
  let group = "";

  return (
    <div ref={setBar} role="toolbar" aria-label="Editing" {...stylex.props(styles.bar)}>
      <div {...stylex.props(styles.row)}>
        <BlockTypePicker
          editor={editor}
          block={state.turnInto}
          open={typeOpen}
          onOpenChange={setTypeOpen}
          side="bottom"
          triggerCls={labeledClass}
          container={bar ?? undefined}
        />
        <Popover.Root open={insertOpen} onOpenChange={setInsertOpen}>
          <Popover.Trigger className={labeledClass}>
            <Plus size={16} />
            Insert
          </Popover.Trigger>
          <Popover.Portal container={bar}>
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
        <span {...stylex.props(styles.spacer)} />
        <BarButton label="Undo" disabled={!state.canUndo} onClick={() => run((c) => c.undo())}>
          <Undo2 size={17} />
        </BarButton>
        <BarButton label="Redo" disabled={!state.canRedo} onClick={() => run((c) => c.redo())}>
          <Redo2 size={17} />
        </BarButton>
      </div>
    </div>
  );
}
