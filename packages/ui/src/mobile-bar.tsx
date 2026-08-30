"use client";
// side-effect import: registers starter-kit command typings
import "@tiptap/starter-kit";
import { useEffect, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEditorPortal } from "./utils/portal";
import { redoDepth, undoDepth } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import { COMPONENT_NODE, INLINE_REGION_NODE } from "@fumadocs-editor/core";
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
import {
  handleModEnter,
  listEntryDepth,
  outdentEntry,
  toggleEntryType,
  type SpecMap,
} from "./components/keymap";
import { BlockPanel } from "./block-menu";
import { TURN_INTO } from "./bubble-menu";
import { insertItems } from "./slash-menu";
import { itemCls } from "./components/styles";
import { cn } from "./utils/cn";

/** distance the virtual keyboard covers at the bottom of the layout viewport */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    update();
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

const barButtonCls =
  "inline-flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fd-muted-foreground active:bg-fd-accent disabled:opacity-35 data-[active]:bg-fd-accent data-[active]:text-fd-foreground";

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
      className={barButtonCls}
      data-active={active || undefined}
      disabled={disabled}
      // keep focus (and the virtual keyboard) in the editor
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type Sheet = "turn-into" | "insert" | "component" | null;

/** Touch editing surface: a fixed bar riding above the virtual keyboard. */
export function MobileBar({
  editor,
  components,
  specs,
}: {
  editor: Editor;
  components: UiComponentSpec[];
  specs: Map<string, UiComponentSpec>;
}) {
  const { anchorRef, container } = useEditorPortal();
  const coarse = useMediaQuery("(pointer: coarse)");
  const inset = useKeyboardInset();
  const [focused, setFocused] = useState(editor.isFocused);
  const [sheet, setSheet] = useState<Sheet>(null);

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const selection = current.state.selection;
      const { $from } = selection;
      let inInlineRegion = false;
      let active: { pos: number; name: string } | null = null;
      if (selection instanceof NodeSelection && selection.node.type.name === COMPONENT_NODE) {
        active = { pos: selection.from, name: selection.node.attrs.name as string };
      }
      for (let depth = $from.depth; depth > 0; depth--) {
        const name = $from.node(depth).type.name;
        if (name === INLINE_REGION_NODE) inInlineRegion = true;
        if (!active && name === COMPONENT_NODE) {
          active = { pos: $from.before(depth), name: $from.node(depth).attrs.name as string };
        }
      }
      return {
        inInlineRegion,
        active,
        listEntry: listEntryDepth($from, specs as SpecMap) !== -1,
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        strike: current.isActive("strike"),
        code: current.isActive("code"),
        canUndo: undoDepth(current.state) > 0,
        canRedo: redoDepth(current.state) > 0,
      };
    },
  });

  if (!coarse || state == null) return null;
  const visible = focused || sheet != null;

  const run = (fn: (chain: ReturnType<Editor["chain"]>) => { run: () => boolean }) => {
    fn(editor.chain().focus()).run();
  };

  return (
    <>
      <div
        ref={anchorRef}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-fd-border bg-fd-popover text-fd-popover-foreground transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] pb-[env(safe-area-inset-bottom)]"
        style={{
          transform: visible ? `translateY(-${inset}px)` : "translateY(100%)",
        }}
      >
        <div className="flex items-center gap-0.5 overflow-x-auto px-1.5 py-0.5">
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
          <span className="mx-0.5 h-5 w-px shrink-0 bg-fd-border" />
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
              <span className="mx-0.5 h-5 w-px shrink-0 bg-fd-border" />
              <BarButton label="Outdent" onClick={() => outdentEntry(editor, specs as SpecMap)}>
                <IndentDecrease size={17} />
              </BarButton>
              <BarButton
                label="Toggle folder"
                onClick={() => toggleEntryType(editor, specs as SpecMap)}
              >
                <Folder size={17} />
              </BarButton>
              <BarButton label="New row" onClick={() => handleModEnter(editor, specs as SpecMap)}>
                <ListPlus size={17} />
              </BarButton>
            </>
          )}
          {state.active && (
            <>
              <span className="mx-0.5 h-5 w-px shrink-0 bg-fd-border" />
              <BarButton label="Component options" onClick={() => setSheet("component")}>
                <Settings2 size={17} />
              </BarButton>
            </>
          )}
          <span className="mx-0.5 h-5 w-px shrink-0 bg-fd-border" />
          <BarButton label="Undo" disabled={!state.canUndo} onClick={() => run((c) => c.undo())}>
            <Undo2 size={17} />
          </BarButton>
          <BarButton label="Redo" disabled={!state.canRedo} onClick={() => run((c) => c.redo())}>
            <Redo2 size={17} />
          </BarButton>
          <span className="min-w-1 flex-1" />
          <BarButton label="Done" onClick={() => editor.commands.blur()}>
            <CornerDownLeft size={17} />
          </BarButton>
        </div>
      </div>

      <Dialog.Root open={sheet != null} onOpenChange={(next) => !next && setSheet(null)}>
        <Dialog.Portal container={container}>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
          <Dialog.Popup data-fde-popup="" className="fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-t-2xl border-t border-fd-border bg-fd-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-fd-popover-foreground shadow-xl transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full [scrollbar-color:var(--color-fd-border)_transparent] [scrollbar-width:thin]">
            {sheet === "turn-into" &&
              TURN_INTO.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={cn(itemCls, "h-11 shrink-0")}
                  onClick={() => {
                    item.run(editor.chain().focus()).run();
                    setSheet(null);
                  }}
                >
                  <span className="inline-flex w-5 shrink-0 justify-center text-fd-muted-foreground">
                    <item.icon size={16} />
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            {sheet === "insert" &&
              insertItems(components).map((item) => (
                <button
                  key={item.title}
                  type="button"
                  className={cn(itemCls, "h-11 shrink-0")}
                  onClick={() => {
                    const { from } = editor.state.selection;
                    item.run(editor, { from, to: from });
                    setSheet(null);
                  }}
                >
                  <span className="inline-flex w-5 shrink-0 justify-center text-fd-muted-foreground">
                    {item.icon}
                  </span>
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
