"use client";
// side-effect import: registers starter-kit command typings
import "@tiptap/starter-kit";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { consts } from "./styles/consts.stylex";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEditorPortal } from "./utils/portal";
import { INLINE_REGION_NODE } from "@fumadocs-editor/core";
import { Dialog } from "@base-ui/react/dialog";
import {
  Bold,
  Code,
  CornerDownLeft,
  Folder,
  IndentDecrease,
  Italic,
  ListPlus,
  Plus,
  Redo2,
  Settings2,
  Strikethrough,
  Type,
  Undo2,
} from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import { handleModEnter, listEntryDepth, outdentEntry, toggleEntryType } from "./components/keymap";
import { activeComponent } from "./components/attributes";
import { BlockPanel } from "./block-menu";
import { TURN_INTO } from "./bubble-menu";
import { insertItems } from "./slash-menu";
import { chrome } from "./styles/shared";

const SHEET_EASE = "cubic-bezier(0.2, 0, 0, 1)";

const styles = stylex.create({
  bar: {
    boxSizing: "border-box",
    position: "fixed",
    insetInlineStart: 0,
    insetInlineEnd: 0,
    bottom: 0,
    zIndex: 40,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    backgroundColor: tokens.popover,
    color: tokens.popoverForeground,
    transition: { default: `transform 200ms ${SHEET_EASE}`, [consts.reduceMotion]: "none" },
    paddingBottom: "env(safe-area-inset-bottom)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.125rem",
    overflowX: "auto",
    paddingInline: "0.375rem",
    paddingBlock: "0.125rem",
  },
  /** touch target: 44px square minimum */
  button: {
    display: "inline-flex",
    height: "2.75rem",
    minWidth: "2.75rem",
    flexShrink: 0,
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.5rem",
    color: {
      default: tokens.mutedForeground,
      ":is([data-active])": tokens.foreground,
    },
    backgroundColor: {
      default: "transparent",
      ":active": tokens.accent,
      ":is([data-active])": tokens.accent,
    },
    opacity: { default: null, ":disabled": 0.35 },
  },
  divider: { height: "1.25rem" },
  spacer: { minWidth: "0.25rem", flex: 1 },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    backgroundColor: "rgb(0 0 0 / 0.4)",
    transition: { default: `opacity 150ms ${consts.ease}`, [consts.reduceMotion]: "none" },
    opacity: { default: 1, ":is([data-starting-style])": 0, ":is([data-ending-style])": 0 },
  },
  sheet: {
    boxSizing: "border-box",
    position: "fixed",
    insetInlineStart: 0,
    insetInlineEnd: 0,
    bottom: 0,
    zIndex: 50,
    display: "flex",
    maxHeight: "70vh",
    flexDirection: "column",
    gap: "0.5rem",
    overflowY: "auto",
    borderStartStartRadius: "1rem",
    borderStartEndRadius: "1rem",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    backgroundColor: tokens.popover,
    padding: "0.75rem",
    paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
    color: tokens.popoverForeground,
    boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    transition: { default: `translate 220ms ${SHEET_EASE}`, [consts.reduceMotion]: "none" },
    translate: {
      default: null,
      ":is([data-starting-style])": "0 100%",
      ":is([data-ending-style])": "0 100%",
    },
    scrollbarColor: `${tokens.border} transparent`,
    scrollbarWidth: "thin",
  },
  /* chrome.item leaves the resting background undeclared, which on a
   * <button> would let the UA button face through */
  sheetItem: { height: "2.75rem", flexShrink: 0 },
  sheetIcon: { width: "1.25rem" },
});

const readKeyboardInset = () => {
  const viewport = window.visualViewport;
  return viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
};

const subscribeKeyboardInset = (onChange: () => void) => {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
  };
};

/** distance the virtual keyboard covers at the bottom of the layout viewport */
function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeKeyboardInset, readKeyboardInset, () => 0);
}

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

function useEditorFocused(editor: Editor): boolean {
  const [subscribe, getSnapshot] = useMemo(
    () =>
      [
        (onChange: () => void) => {
          editor.on("focus", onChange);
          editor.on("blur", onChange);
          return () => {
            editor.off("focus", onChange);
            editor.off("blur", onChange);
          };
        },
        () => editor.isFocused,
      ] as const,
    [editor],
  );
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

type Sheet = "turn-into" | "insert" | "component" | null;

interface MobileBarProps {
  editor: Editor;
  components: UiComponentSpec[];
  specs: Map<string, UiComponentSpec>;
  math?: boolean;
}

/** Touch editing surface: a fixed bar above the virtual keyboard. */
export function MobileBar(props: MobileBarProps) {
  // gate the whole subtree, not just its output: TouchBar's editor-state
  // selector (two can() trial runs) would otherwise run per transaction on
  // desktop only to render null
  const coarse = useMediaQuery("(pointer: coarse)");
  return coarse ? <TouchBar {...props} /> : null;
}

function TouchBar({ editor, components, specs, math }: MobileBarProps) {
  const { anchorRef, container } = useEditorPortal();
  const inset = useKeyboardInset();
  const focused = useEditorFocused(editor);
  const [sheet, setSheet] = useState<Sheet>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const { $from } = current.state.selection;
      let inInlineRegion = false;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === INLINE_REGION_NODE) inInlineRegion = true;
      }
      return {
        inInlineRegion,
        active: activeComponent(current.state),
        listEntry: listEntryDepth($from, specs) !== -1,
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

  if (state == null) return null;
  const visible = focused || sheet != null;

  const run = (fn: (chain: ReturnType<Editor["chain"]>) => { run: () => boolean }) => {
    fn(editor.chain().focus()).run();
  };

  return (
    <>
      <div
        ref={anchorRef}
        {...stylex.props(styles.bar)}
        style={{
          transform: visible ? `translateY(-${inset}px)` : "translateY(100%)",
        }}
      >
        <div {...stylex.props(styles.row)}>
          <BarButton
            label="Turn into"
            disabled={state.inInlineRegion}
            onClick={() => setSheet("turn-into")}
          >
            <Type size={17} />
          </BarButton>
          <BarButton label="Insert" onClick={() => setSheet("insert")}>
            <Plus size={17} />
          </BarButton>
          <span {...stylex.props(chrome.divider, styles.divider)} />
          <BarButton
            label="Bold"
            active={state.bold}
            disabled={state.inInlineRegion}
            onClick={() => run((c) => c.toggleBold())}
          >
            <Bold size={17} />
          </BarButton>
          <BarButton
            label="Italic"
            active={state.italic}
            disabled={state.inInlineRegion}
            onClick={() => run((c) => c.toggleItalic())}
          >
            <Italic size={17} />
          </BarButton>
          <BarButton
            label="Strikethrough"
            active={state.strike}
            disabled={state.inInlineRegion}
            onClick={() => run((c) => c.toggleStrike())}
          >
            <Strikethrough size={17} />
          </BarButton>
          <BarButton
            label="Inline code"
            active={state.code}
            disabled={state.inInlineRegion}
            onClick={() => run((c) => c.toggleCode())}
          >
            <Code size={17} />
          </BarButton>
          {state.listEntry && (
            <>
              <span {...stylex.props(chrome.divider, styles.divider)} />
              <BarButton label="Outdent" onClick={() => outdentEntry(editor, specs)}>
                <IndentDecrease size={17} />
              </BarButton>
              <BarButton label="Toggle folder" onClick={() => toggleEntryType(editor, specs)}>
                <Folder size={17} />
              </BarButton>
              <BarButton label="New row" onClick={() => handleModEnter(editor, specs)}>
                <ListPlus size={17} />
              </BarButton>
            </>
          )}
          {state.active && (
            <>
              <span {...stylex.props(chrome.divider, styles.divider)} />
              <BarButton label="Component options" onClick={() => setSheet("component")}>
                <Settings2 size={17} />
              </BarButton>
            </>
          )}
          <span {...stylex.props(chrome.divider, styles.divider)} />
          <BarButton label="Undo" disabled={!state.canUndo} onClick={() => run((c) => c.undo())}>
            <Undo2 size={17} />
          </BarButton>
          <BarButton label="Redo" disabled={!state.canRedo} onClick={() => run((c) => c.redo())}>
            <Redo2 size={17} />
          </BarButton>
          <span {...stylex.props(styles.spacer)} />
          <BarButton label="Done" onClick={() => editor.commands.blur()}>
            <CornerDownLeft size={17} />
          </BarButton>
        </div>
      </div>

      <Dialog.Root open={sheet != null} onOpenChange={(next) => !next && setSheet(null)}>
        <Dialog.Portal container={container}>
          <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
          <Dialog.Popup data-fde-popup="" {...stylex.props(styles.sheet)}>
            {sheet === "turn-into" &&
              TURN_INTO.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  {...stylex.props(chrome.button, chrome.item, styles.sheetItem)}
                  onClick={() => {
                    item.run(editor.chain().focus()).run();
                    setSheet(null);
                  }}
                >
                  <span {...stylex.props(chrome.itemIcon, styles.sheetIcon)}>
                    <item.icon size={16} />
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            {sheet === "insert" &&
              insertItems(components, undefined, math).map((item) => (
                <button
                  key={item.title}
                  type="button"
                  {...stylex.props(chrome.button, chrome.item, styles.sheetItem)}
                  onClick={() => {
                    const { from } = editor.state.selection;
                    item.run(editor, { from, to: from });
                    setSheet(null);
                  }}
                >
                  <span {...stylex.props(chrome.itemIcon, styles.sheetIcon)}>{item.icon}</span>
                  <span>{item.title}</span>
                </button>
              ))}
            {sheet === "component" && state.active && (
              <BlockPanel
                editor={editor}
                specs={specs}
                active={state.active}
                onDone={() => setSheet(null)}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
