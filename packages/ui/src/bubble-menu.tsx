"use client";
// side-effect imports: register starter-kit + table command typings
import "@tiptap/starter-kit";
import "@tiptap/extension-table";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { COMPONENT_NODE, INLINE_REGION_NODE } from "@fumadocs-editor/core";
import { Popover } from "@base-ui/react/popover";
import {
  Bold,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  SquareCode,
  Strikethrough,
  Table2,
  TextQuote,
  Trash2,
  Upload,
} from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import type { MediaProvider } from "./components/media";
import { BlockPanel } from "./block-menu";
import { Picker } from "./components/picker";
import { ghostSelectCls, iconButtonCls, itemCls, popupCls, popupSurfaceCls } from "./components/styles";

type Chain = ReturnType<Editor["chain"]>;

/** The turn-into list: every block a text selection can become. */
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
  /** text selection sits inside a table: row/column controls apply */
  table: boolean;
  /** a node-selected atom the bubble edits directly */
  atom: { kind: "image" | "frontmatter"; pos: number } | null;
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
  let atom: BubbleState["atom"] = null;
  if (selection instanceof NodeSelection) {
    const name = selection.node.type.name;
    if (name === COMPONENT_NODE) {
      const componentName = selection.node.attrs.name as string;
      if (specs.has(componentName)) active = { pos: selection.from, name: componentName };
    } else if (name === "image" || name === "frontmatter") {
      atom = { kind: name, pos: selection.from };
    }
  } else if (textual) {
    for (let depth = $from.depth; !active && depth > 0; depth--) {
      if ($from.node(depth).type.name === COMPONENT_NODE) {
        const name = $from.node(depth).attrs.name as string;
        if (specs.has(name)) active = { pos: $from.before(depth), name };
      }
    }
  }

  let table = false;
  if (textual) {
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === "table") table = true;
    }
  }
  return { format, active, table, atom };
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

const fieldCls =
  "h-7 w-full rounded-md border border-fd-border bg-fd-background px-2 text-[13px] text-fd-foreground outline-none placeholder:text-fd-muted-foreground/60 focus-visible:border-fd-ring";

/** URL editor for the link mark; portalled into the bubble's parent. */
function LinkControl({
  editor,
  href,
  container,
}: {
  editor: Editor;
  href: string | null;
  container: HTMLElement | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (open) setDraft(href ?? "");
  }, [open, href]);

  const apply = () => {
    const url = draft.trim();
    if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    else editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Link"
        className={iconButtonCls}
        data-active={href != null || undefined}
      >
        <Link2 size={15} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className={`${popupSurfaceCls} flex w-64 items-center gap-2 p-2`}>
            <input
              className={fieldCls}
              placeholder="https://… or ./page.mdx"
              value={draft}
              spellCheck={false}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") apply();
                if (event.key === "Escape") setOpen(false);
              }}
            />
            {href != null && (
              <button
                type="button"
                aria-label="Remove link"
                className={iconButtonCls}
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setOpen(false);
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const TABLE_OPS = [
  { label: "Add row below", run: (c: Chain) => c.addRowAfter() },
  { label: "Add column right", run: (c: Chain) => c.addColumnAfter() },
  { label: "Delete row", run: (c: Chain) => c.deleteRow() },
  { label: "Delete column", run: (c: Chain) => c.deleteColumn() },
  { label: "Delete table", run: (c: Chain) => c.deleteTable() },
] as const;

function TableControl({
  editor,
  container,
}: {
  editor: Editor;
  container: HTMLElement | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label="Table options" className={iconButtonCls}>
        <Table2 size={15} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className={`${popupCls} flex w-44 flex-col`}>
            {TABLE_OPS.map((op) => (
              <button
                key={op.label}
                type="button"
                className={itemCls}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  op.run(editor.chain().focus()).run();
                  setOpen(false);
                }}
              >
                {op.label}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** src / alt editor for a node-selected image, with provider upload. */
function ImagePanel({ editor, media }: { editor: Editor; media?: MediaProvider }) {
  const attrs = editor.getAttributes("image");
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1.5 p-0.5">
      <input
        className={`${fieldCls} w-52`}
        placeholder="Image source…"
        value={(attrs.src as string) ?? ""}
        spellCheck={false}
        onChange={(event) => editor.commands.updateAttributes("image", { src: event.target.value })}
      />
      <input
        className={`${fieldCls} w-36`}
        placeholder="Alt text"
        value={(attrs.alt as string) ?? ""}
        onChange={(event) => editor.commands.updateAttributes("image", { alt: event.target.value })}
      />
      {media && (
        <>
          <button
            type="button"
            aria-label="Upload image"
            className={iconButtonCls}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void media.upload(file).then((src) => {
                if (!editor.isDestroyed) editor.commands.updateAttributes("image", { src });
              });
              event.target.value = "";
            }}
          />
        </>
      )}
      <button
        type="button"
        aria-label="Remove image"
        className={iconButtonCls}
        onClick={() => editor.chain().focus().deleteSelection().run()}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/** raw YAML editor for the node-selected frontmatter block */
function FrontmatterPanel({ editor }: { editor: Editor }) {
  const value = (editor.getAttributes("frontmatter").value as string) ?? "";
  return (
    <textarea
      className="min-h-24 w-72 resize-y rounded-md border border-fd-border bg-fd-background p-2 font-mono text-[12px] leading-relaxed text-fd-foreground outline-none focus-visible:border-fd-ring"
      value={value}
      spellCheck={false}
      onChange={(event) =>
        editor.commands.updateAttributes("frontmatter", { value: event.target.value })
      }
    />
  );
}

export function EditorBubble({
  editor,
  specs,
  media,
}: {
  editor: Editor;
  specs: Map<string, UiComponentSpec>;
  media?: MediaProvider;
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
        link: current.isActive("link") ? String(current.getAttributes("link").href ?? "") : null,
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
        const { format, active: current, atom } = bubbleState(editorState, specs);
        return format || current != null || atom != null;
      }}
      className="z-40 flex items-center gap-0.5 rounded-[10px] border border-fd-border bg-fd-popover p-1 text-fd-popover-foreground shadow-lg"
    >
      {state?.format && (
        <>
          <Picker
            items={TURN_INTO}
            value={TURN_INTO.find((item) => item.value === state.block)}
            onPick={(item) => run(item.run)}
            open={turnIntoOpen}
            onOpenChange={setTurnIntoOpen}
            ariaLabel="Block type"
            triggerCls={ghostSelectCls}
            container={panelContainer}
            lead={(item) => (
              <span className="inline-flex w-4 shrink-0 justify-center text-fd-muted-foreground">
                <item.icon size={15} />
              </span>
            )}
            footer={
              state.block.startsWith("h") ? (
                <div className="flex flex-col gap-1.5 border-t border-fd-border p-2">
                  <input
                    className={`${fieldCls} font-mono text-[12px]`}
                    placeholder="#anchor-id"
                    spellCheck={false}
                    value={String(editor.getAttributes("heading").anchor ?? "")}
                    onChange={(event) =>
                      editor.commands.updateAttributes("heading", {
                        anchor: event.target.value.replace(/^#/, "") || null,
                      })
                    }
                  />
                  <select
                    className="h-7 w-full cursor-pointer rounded-md border border-fd-border bg-fd-background px-1.5 text-[12.5px] text-fd-foreground outline-none focus-visible:border-fd-ring"
                    value={String(editor.getAttributes("heading").toc ?? "")}
                    onChange={(event) =>
                      editor.commands.updateAttributes("heading", {
                        toc: event.target.value || null,
                      })
                    }
                  >
                    <option value="">In the TOC (default)</option>
                    <option value="hide">Hidden from TOC</option>
                    <option value="only">TOC only</option>
                  </select>
                </div>
              ) : undefined
            }
          >
            {TURN_INTO.find((item) => item.value === state.block)?.label ?? "Paragraph"}
            <ChevronDown size={13} className="text-fd-muted-foreground" />
          </Picker>
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
          <LinkControl editor={editor} href={state.link} container={panelContainer} />
          {state.table && <TableControl editor={editor} container={panelContainer} />}
        </>
      )}
      {state?.atom?.kind === "image" && <ImagePanel editor={editor} media={media} />}
      {state?.atom?.kind === "frontmatter" && (
        <div className="p-0.5">
          <FrontmatterPanel editor={editor} />
        </div>
      )}
      {active && spec && (
        <>
          {state?.format && <span className="mx-0.5 h-4 w-px bg-fd-border" />}
          <Popover.Root open={panelOpen} onOpenChange={setPanelOpen}>
            <Popover.Trigger
              aria-label={`${spec.title ?? spec.name} options`}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-fd-foreground outline-none hover:bg-fd-accent data-[popup-open]:bg-fd-accent"
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
