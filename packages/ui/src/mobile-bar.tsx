"use client";
// side-effect import: registers starter-kit command typings
import "@tiptap/starter-kit";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { consts } from "./styles/consts.stylex";
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { INLINE_REGION_NODE } from "@fumadocs-editor/core";
import { Popover } from "@base-ui/react/popover";
import { Bold, ChevronDown, Code, Italic, Plus, Redo2, Strikethrough, Undo2 } from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import type { MediaProvider } from "./components/media";
import { activeComponent } from "./components/attributes";
import { BlockPanel } from "./block-menu";
import { BlockTypePicker, activeBlock } from "./bubble-menu";
import { insertItems } from "./slash-menu";
import { chrome } from "./styles/shared";

const styles = stylex.create({
  /* Fixed above the on-screen keyboard while the editor is being edited.
   * The keyboard covers the bottom of the layout viewport on every mobile
   * browser and no CSS knows its height, so `bottom` is written from the
   * visual viewport on its own events (see `useKeyboardOffset`), directly
   * on the element and without a transition on that axis. The visual
   * viewport already excludes iOS Safari's keyboard accessory bar, so the
   * bar sits right above it. Its popups portal into it and open upward. */
  bar: {
    boxSizing: "border-box",
    position: "fixed",
    bottom: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    zIndex: 50,
    paddingBottom: "env(safe-area-inset-bottom)",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    backgroundColor: tokens.popover,
    color: tokens.popoverForeground,
    // slides away rather than vanishing: a tap that blurs the editor still
    // lands on the button it aimed at
    transition: { default: `translate 150ms ${consts.ease}`, [consts.reduceMotion]: "none" },
    translate: { default: null, ":is([data-hidden])": "0 100%" },
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
  chipIcon: { display: "inline-flex", color: tokens.mutedForeground },
  divider: { height: "1.25rem" },
  spacer: { minWidth: "0.25rem", flex: 1 },
  /* popups hang below the bar; capped so they stay above the keyboard */
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
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: "0.025em",
    textTransform: "uppercase",
    color: tokens.mutedForeground,
  },
  item: { minHeight: "2.5rem", flexShrink: 0 },
  panel: { display: "flex", width: "16rem", flexDirection: "column" },
});

const labeledClass = stylex.props(chrome.button, styles.button, styles.labeled).className!;

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

/** keep `bottom` on the visual viewport's bottom edge: above the keyboard */
function useKeyboardOffset(bar: HTMLElement | null) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!bar || !viewport) return;
    const place = () => {
      bar.style.bottom = `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`;
    };
    place();
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
    return () => {
      viewport.removeEventListener("resize", place);
      viewport.removeEventListener("scroll", place);
    };
  }, [bar]);
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

interface MobileBarProps {
  editor: Editor;
  components: UiComponentSpec[];
  specs: Map<string, UiComponentSpec>;
  media?: MediaProvider;
  math?: boolean;
}

/** Touch editing surface: a toolbar above the on-screen keyboard. */
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
  useKeyboardOffset(bar);
  const focused = useEditorFocused(editor);
  const [typeOpen, setTypeOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

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
        format: !inInlineRegion && $from.parent.type.name !== "codeBlock",
        block: activeBlock(current),
        active: activeComponent(current.state),
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
  const spec = state.active ? specs.get(state.active.name) : undefined;
  const visible = focused || typeOpen || insertOpen || panelOpen;

  const run = (fn: (chain: ReturnType<Editor["chain"]>) => { run: () => boolean }) => {
    fn(editor.chain().focus()).run();
  };

  const items = insertItems(components, media, math);
  let group = "";

  return (
    <div
      ref={setBar}
      role="toolbar"
      aria-label="Editing"
      data-hidden={visible ? undefined : ""}
      {...stylex.props(styles.bar)}
    >
      <div {...stylex.props(styles.row)}>
        <BlockTypePicker
          editor={editor}
          block={state.block}
          open={typeOpen}
          onOpenChange={setTypeOpen}
          side="top"
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
              side="top"
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
        {state.active && spec && (
          <>
            <span {...stylex.props(chrome.divider, styles.divider)} />
            <Popover.Root open={panelOpen} onOpenChange={setPanelOpen}>
              <Popover.Trigger
                aria-label={`${spec.label ?? spec.name} options`}
                className={labeledClass}
              >
                <span {...stylex.props(styles.chipIcon)}>{spec.icon}</span>
                {spec.label ?? spec.name}
                <ChevronDown size={12} {...stylex.props(styles.chipIcon)} />
              </Popover.Trigger>
              <Popover.Portal container={bar}>
                <Popover.Positioner
                  side="top"
                  sideOffset={4}
                  align="start"
                  {...stylex.props(chrome.layer)}
                >
                  <Popover.Popup
                    data-fde-popup=""
                    initialFocus={false}
                    finalFocus={false}
                    {...stylex.props(chrome.popup, styles.panel)}
                  >
                    <BlockPanel
                      editor={editor}
                      specs={specs}
                      active={state.active}
                      onDone={() => setPanelOpen(false)}
                    />
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
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
