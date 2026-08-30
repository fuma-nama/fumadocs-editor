"use client";
// side-effect import: registers starter-kit command typings
import "@tiptap/starter-kit";
import { useEffect, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { COMPONENT_NODE, INLINE_REGION_NODE } from "@fumadocs-editor/core";
import { Popover } from "@base-ui/react/popover";
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  SquareCode,
  Strikethrough,
  TextQuote,
} from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import { BlockPanel } from "./block-menu";
import { ghostSelectCls, iconButtonCls, itemCls, popupCls } from "./components/styles";

type Chain = ReturnType<Editor["chain"]>;

/**
 * The turn-into menu. A Popover, not a Select: the select's own focus
 * management fights the bubble's blur handling, while a popover of plain
 * buttons (like the component panel) leaves focus where it lies.
 */
export const TURN_INTO = [
  { value: "p", label: "Paragraph", icon: Pilcrow, run: (c: Chain) => c.setParagraph() },
  {
    value: "h1",
    label: "Heading 1",
    icon: Heading1,
    run: (c: Chain) => c.toggleHeading({ level: 1 }),
  },
  {
    value: "h2",
    label: "Heading 2",
    icon: Heading2,
    run: (c: Chain) => c.toggleHeading({ level: 2 }),
  },
  {
    value: "h3",
    label: "Heading 3",
    icon: Heading3,
    run: (c: Chain) => c.toggleHeading({ level: 3 }),
  },
  {
    value: "bulletList",
    label: "Bullet list",
    icon: List,
    run: (c: Chain) => c.toggleBulletList(),
  },
  {
    value: "orderedList",
    label: "Numbered list",
    icon: ListOrdered,
    run: (c: Chain) => c.toggleOrderedList(),
  },
  { value: "taskList", label: "Task list", icon: ListTodo, run: (c: Chain) => c.toggleTaskList() },
  { value: "blockquote", label: "Quote", icon: TextQuote, run: (c: Chain) => c.toggleBlockquote() },
  {
    value: "codeBlock",
    label: "Code block",
    icon: SquareCode,
    run: (c: Chain) => c.toggleCodeBlock(),
  },
] as const;

function activeBlock(editor: Editor): string {
  for (const level of [1, 2, 3]) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  for (const name of ["taskList", "orderedList", "bulletList", "blockquote", "codeBlock"]) {
    if (editor.isActive(name)) return name;
  }
  return "p";
}

/**
 * The one floating surface. What it holds follows the selection: a text
 * selection gets the formatting controls, a caret inside a component gets that
 * component's chip (props, inserts, moves, delete), and a text selection
 * inside a component gets both: never two competing menus.
 */
interface BubbleState {
  format: boolean;
  active: { pos: number; name: string } | null;
}

function bubbleState(state: EditorState, specs: Map<string, UiComponentSpec>): BubbleState {
  const selection = state.selection;
  const { $from } = selection;

  // a selection of structural tokens only (a double-click at a region's end
  // can produce one) renders nothing: it must not summon the bubble
  const textual =
    selection instanceof TextSelection &&
    !selection.empty &&
    state.doc.textBetween(selection.from, selection.to).length > 0;

  let format = textual;
  if (format && $from.parent.type.name === "codeBlock") format = false;
  if (format) {
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === INLINE_REGION_NODE) format = false;
    }
  }

  // the chip appears only when something is selected: a resting caret keeps
  // the quieter ⋯ handle instead of a floating menu
  let active: BubbleState["active"] = null;
  if (selection instanceof NodeSelection && selection.node.type.name === COMPONENT_NODE) {
    const name = selection.node.attrs.name as string;
    if (specs.has(name)) active = { pos: selection.from, name };
  } else if (textual) {
    for (let depth = $from.depth; !active && depth > 0; depth--) {
      if ($from.node(depth).type.name === COMPONENT_NODE) {
        const name = $from.node(depth).attrs.name as string;
        if (specs.has(name)) active = { pos: $from.before(depth), name };
      }
    }
  }
  return { format, active };
}

function MarkButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={iconButtonCls}
      data-active={active || undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function EditorBubble({
  editor,
  specs,
}: {
  editor: Editor;
  specs: Map<string, UiComponentSpec>;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);
  // Where the panel portals matters twice over: the menu hides on editor blur
  // unless focus lands inside the bubble's parent, and the bubble itself is
  // positioned with a transform, which would skew any popup measured inside
  // it. The bubble's parent (the editor wrapper) satisfies both.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const panelContainer = portalEl?.parentElement?.parentElement ?? undefined;
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      return {
        ...bubbleState(current.state, specs),
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        strike: current.isActive("strike"),
        code: current.isActive("code"),
        block: activeBlock(current),
      };
    },
  });

  const active = state?.active ?? null;

  useEffect(() => {
    if (active == null) setPanelOpen(false);
  }, [active == null]);

  useEffect(() => {
    if (!state?.format) setTurnIntoOpen(false);
  }, [state?.format]);

  // the plugin positions the bubble once on show, before React fills it in,
  // and never again when its size changes (chip ↔ full toolbar). Re-anchor
  // through the plugin's own updatePosition hook whenever the element resizes.
  useEffect(() => {
    const el = portalEl?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      editor.view.dispatch(editor.state.tr.setMeta("bubbleMenu", "updatePosition"));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [portalEl, editor]);

  const run = (fn: (chain: ReturnType<Editor["chain"]>) => { run: () => boolean }) => {
    fn(editor.chain().focus()).run();
  };

  const spec = active ? specs.get(active.name) : undefined;

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={150}
      options={{ placement: "bottom", offset: 6 }}
      shouldShow={({ state: editorState }) => {
        // touch has the mobile bar; one surface per input mode
        if (window.matchMedia("(pointer: coarse)").matches) return false;
        const { format, active: current } = bubbleState(editorState, specs);
        return format || current != null;
      }}
      className="z-40 flex items-center gap-0.5 rounded-[10px] border border-fd-border bg-fd-popover p-1 text-fd-popover-foreground shadow-lg"
    >
      {state?.format && (
        <>
          <Popover.Root open={turnIntoOpen} onOpenChange={setTurnIntoOpen}>
            <Popover.Trigger className={ghostSelectCls}>
              {TURN_INTO.find((item) => item.value === state.block)?.label ?? "Paragraph"}
              <ChevronDown size={13} className="text-fd-muted-foreground" />
            </Popover.Trigger>
            <Popover.Portal container={panelContainer}>
              <Popover.Positioner sideOffset={6} align="start" className="z-50">
                <Popover.Popup className={`${popupCls} flex w-44 flex-col`}>
                  {TURN_INTO.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={itemCls}
                      // keep the caret where it is; act on click like a menu
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        run(item.run);
                        setTurnIntoOpen(false);
                      }}
                    >
                      <span className="inline-flex w-4 shrink-0 justify-center text-fd-muted-foreground">
                        <item.icon size={15} />
                      </span>
                      <span>{item.label}</span>
                      {state.block === item.value && (
                        <Check size={14} className="ms-auto text-fd-foreground" />
                      )}
                    </button>
                  ))}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          <span className="mx-0.5 h-4 w-px bg-fd-border" />
          <MarkButton label="Bold" active={state.bold} onClick={() => run((c) => c.toggleBold())}>
            <Bold size={15} />
          </MarkButton>
          <MarkButton
            label="Italic"
            active={state.italic}
            onClick={() => run((c) => c.toggleItalic())}
          >
            <Italic size={15} />
          </MarkButton>
          <MarkButton
            label="Strikethrough"
            active={state.strike}
            onClick={() => run((c) => c.toggleStrike())}
          >
            <Strikethrough size={15} />
          </MarkButton>
          <MarkButton
            label="Inline code"
            active={state.code}
            onClick={() => run((c) => c.toggleCode())}
          >
            <Code size={15} />
          </MarkButton>
        </>
      )}
      {active && spec && (
        <>
          {state?.format && <span className="mx-0.5 h-4 w-px bg-fd-border" />}
          <Popover.Root open={panelOpen} onOpenChange={setPanelOpen}>
            <Popover.Trigger
              aria-label={`${spec.title ?? spec.name} options`}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-fd-foreground outline-none transition-colors hover:bg-fd-accent data-[popup-open]:bg-fd-accent"
            >
              <span className="inline-flex text-fd-muted-foreground">{spec.icon}</span>
              {spec.title ?? spec.name}
              <ChevronDown size={12} className="text-fd-muted-foreground" />
            </Popover.Trigger>
            <Popover.Portal container={panelContainer}>
              <Popover.Positioner sideOffset={6} align="end" className="z-50">
                <Popover.Popup className={`${popupCls} flex w-56 flex-col`}>
                  <BlockPanel
                    editor={editor}
                    specs={specs}
                    active={active}
                    onDone={() => setPanelOpen(false)}
                  />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </>
      )}
      <span ref={setPortalEl} />
    </BubbleMenu>
  );
}
