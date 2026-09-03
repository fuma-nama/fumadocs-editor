"use client";
// side-effect import: registers starter-kit command typings
import "@tiptap/starter-kit";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { Fragment, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Popover } from "@base-ui/react/popover";
import { Bold, Code, Italic, Plus, Redo2, Strikethrough, Undo2 } from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import type { MediaProvider } from "./components/media";
import { BlockMenu, useBlockMenuOpen } from "./block-panel";
import { BlockTypePicker, activeBlock, bubbleState } from "./bubble-menu";
import { DragHandle } from "./drag-handle";
import { insertItems } from "./slash-menu";
import { chrome } from "./styles/shared";

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
  divider: { height: "1.25rem" },
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
});

const labeledClass = stylex.props(chrome.button, styles.button, styles.labeled).className!;
const iconClass = stylex.props(chrome.button, styles.button).className!;

function useMediaQuery(query: string): boolean {
  const [subscribe, getSnapshot] = useMemo(() => {
    let list: MediaQueryList | undefined;
    const resolve = () => (list ??= window.matchMedia(query));
    return [
      (onChange: () => void) => {
        resolve().addEventListener("change", onChange);
        return () => resolve().removeEventListener("change", onChange);
      },
      () => resolve().matches,
    ] as const;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

function BarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      {...stylex.props(chrome.button, styles.button)}
      data-active={active || undefined}
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

/** Touch editing surface: a toolbar heading the editor, stuck to the top while scrolling. */
export function MobileBar(props: MobileBarProps) {
  // gate the whole subtree, not just its output: TouchBar's editor-state
  // selector (two can() trial runs) would otherwise run per transaction on
  // desktop only to render null
  const coarse = useMediaQuery("(pointer: coarse)");
  return coarse ? <TouchBar {...props} /> : null;
}

function TouchBar({ editor, components, specs, media, math }: MobileBarProps) {
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
        ...bubbleState(current.state, specs),
        turnInto: activeBlock(current),
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        strike: current.isActive("strike"),
        code: current.isActive("code"),
        // through the registered undo command, so this is the plugin history
        // in single-user mode and the Y undo manager under collab
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
      };
    },
  });

  const target = state?.active?.pos ?? state?.block?.pos;
  const [panelOpen, setPanelOpen] = useBlockMenuOpen(editor, target);
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
        <span {...stylex.props(chrome.divider, styles.divider)} />
        <BarButton
          label="Bold"
          active={state.bold}
          disabled={!state.format}
          onClick={() => run((c) => c.toggleBold())}
        >
          <Bold size={17} />
        </BarButton>
        <BarButton
          label="Italic"
          active={state.italic}
          disabled={!state.format}
          onClick={() => run((c) => c.toggleItalic())}
        >
          <Italic size={17} />
        </BarButton>
        <BarButton
          label="Strikethrough"
          active={state.strike}
          disabled={!state.format}
          onClick={() => run((c) => c.toggleStrike())}
        >
          <Strikethrough size={17} />
        </BarButton>
        <BarButton
          label="Inline code"
          active={state.code}
          disabled={!state.format}
          onClick={() => run((c) => c.toggleCode())}
        >
          <Code size={17} />
        </BarButton>
        {target != null && (
          <>
            <span {...stylex.props(chrome.divider, styles.divider)} />
            <DragHandle editor={editor} pos={target} specs={specs} look={styles.button} size={22} />
            <BlockMenu
              editor={editor}
              specs={specs}
              active={state.active}
              block={state.block}
              open={panelOpen}
              onOpenChange={setPanelOpen}
              container={bar ?? undefined}
              side="bottom"
              align="start"
              chipCls={labeledClass}
              iconCls={iconClass}
              touch
            />
          </>
        )}
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
