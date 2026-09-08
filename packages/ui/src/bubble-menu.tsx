"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { consts } from "./styles/consts.stylex";
// side-effect imports: register starter-kit + table command typings
import "@tiptap/starter-kit";
import "@tiptap/extension-table";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { posToDOMRect } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { type MdxAttribute } from "@fumadocs-editor/core";
import { INLINE_REGION_NODE, isComponent } from "@fumadocs-editor/core/extensions";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Popover } from "@base-ui/react/popover";
import {
  Bold,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  Redo2,
  SquareCode,
  Strikethrough,
  Table2,
  TextQuote,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import { BlockMenu, useBlockMenuOpen, type ActiveComponent } from "./block-panel";
import { DragHandle } from "./drag-handle";
import { updateAtomAttributes } from "./components/attributes";
import { handleBlock, movableIn } from "./components/keymap";
import { Picker } from "./components/picker";
import { useEditorContext } from "./components/context";
import { chrome } from "./styles/shared";

type Chain = ReturnType<Editor["chain"]>;

const muted = tokens.mutedForeground;
const border = tokens.border;

const styles = stylex.create({
  bubble: {
    zIndex: 40,
    minWidth: 0,
    maxWidth: "calc(100vw - 1rem)",
    display: "grid",
    gridAutoFlow: "column",
    gridAutoColumns: "max-content",
    alignItems: "center",
    gap: "0.125rem",
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    scrollbarWidth: "none",
    transitionProperty: "top, left",
    transitionDuration: { default: "200ms", [consts.reduceMotion]: "0ms" },
    transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
  },
  linkPopup: {
    display: "flex",
    width: "16rem",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem",
  },
  linkList: { maxHeight: "16rem", width: "var(--anchor-width)", overflowY: "auto" },
  mono: { fontFamily: consts.mono },
  muted: { color: muted },
  tablePopup: { display: "flex", width: "11rem", flexDirection: "column" },
  imageRow: { display: "flex", alignItems: "center", gap: "0.375rem" },
  imageSrc: { width: "13rem" },
  imageAlt: { width: "9rem" },
  headingOptions: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: border,
    padding: "0.5rem",
  },
  tocSelect: {
    height: "1.75rem",
    width: "100%",
    cursor: "pointer",
    /** keeps the native disclosure arrow that chrome.input's reset removes */
    appearance: "auto",
    borderRadius: "0.375rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: border, ":focus-visible": tokens.ring },
    backgroundColor: tokens.background,
    paddingInline: "0.375rem",
    fontSize: tokens.fieldSize,
    color: tokens.foreground,
    outline: "none",
  },
  chip: {
    display: "inline-flex",
    height: "1.75rem",
    cursor: "pointer",
    alignItems: "center",
    gap: "0.375rem",
    borderRadius: "0.5rem",
    paddingInline: "0.5rem",
    fontSize: 12.5,
    fontWeight: 500,
    color: tokens.foreground,
    outline: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.accent,
      ":is([data-popup-open])": tokens.accent,
    },
  },
});

const ghostSelectClass = stylex.props(chrome.button, chrome.ghostSelect).className!;
const chipClass = stylex.props(chrome.button, styles.chip).className!;
const iconClass = stylex.props(chrome.button, chrome.iconButton).className!;

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

export function activeBlock(editor: Editor): string {
  for (const level of [1, 2, 3]) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  for (const name of ["taskList", "orderedList", "bulletList", "blockquote", "codeBlock"]) {
    if (editor.isActive(name)) return name;
  }
  return "p";
}

export function BlockTypePicker({
  editor,
  block,
  side,
  triggerCls,
  container,
}: {
  editor: Editor;
  block: string;
  side?: "top" | "bottom";
  triggerCls: string;
  container: HTMLElement | undefined;
}) {
  const current = TURN_INTO.find((item) => item.value === block);
  return (
    <Picker
      items={TURN_INTO}
      value={current}
      onPick={(item) => item.run(editor.chain().focus()).run()}
      side={side}
      ariaLabel="Block type"
      triggerCls={triggerCls}
      container={container}
      lead={(item) => (
        <span {...stylex.props(chrome.itemIcon)}>
          <item.icon size={15} />
        </span>
      )}
      footer={
        block.startsWith("h") ? (
          <div {...stylex.props(styles.headingOptions)}>
            <input
              {...stylex.props(chrome.input, chrome.field, styles.mono)}
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
              {...stylex.props(chrome.input, styles.tocSelect)}
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
      {current?.label ?? "Paragraph"}
      <ChevronDown size={13} {...stylex.props(styles.muted)} />
    </Picker>
  );
}

export interface BubbleState {
  format: boolean;
  table: boolean;
  atom: { kind: "image"; pos: number } | null;
  active: ActiveComponent | null;
  /** the selection sits in a movable run: the joystick and ⋯ read it when they act */
  block: boolean;
}

export function bubbleState(state: EditorState): BubbleState {
  const selection = state.selection;
  const { $from } = selection;
  let format = selection instanceof TextSelection && !$from.parent.type.spec.code;
  let table = false;
  for (let depth = $from.depth; depth > 0; depth--) {
    const { type } = $from.node(depth);
    if (type.name === INLINE_REGION_NODE) format = false;
    else if (type.spec.tableRole === "table") table = true;
  }

  let atom: BubbleState["atom"] = null;
  if (selection instanceof NodeSelection && selection.node.type.name === "image") {
    atom = { kind: "image", pos: selection.from };
  }

  const range = handleBlock(selection);
  const node = range && state.doc.nodeAt(range.from);
  const component =
    range && node && isComponent(node.type) && node.nodeSize === range.to - range.from;
  return {
    format,
    table: format && table,
    atom,
    active: component
      ? {
          pos: range.from,
          type: node.type.name,
          attributes: node.attrs.attributes as MdxAttribute[],
        }
      : null,
    block: range != null,
  };
}

function summoned(state: EditorState): boolean {
  const selection = state.selection;
  if (selection instanceof NodeSelection) {
    const { node } = selection;
    if (isComponent(node.type)) return true;
    // a code block's header holds its menu, the gutter its joystick
    if (node.type.spec.code) return false;
    return movableIn(node, selection.$from.parent);
  }
  // a selection of structural tokens only (a double-click at a region's
  // end can produce one) renders nothing: it must not summon the bubble.
  // Neither does selected code: the block's header holds its menu, and its
  // joystick sits in the gutter beside it
  return (
    selection instanceof TextSelection &&
    !selection.empty &&
    !selection.$from.parent.type.spec.code &&
    state.doc.textBetween(selection.from, selection.to).length > 0
  );
}

function MarkButton({
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
      {...stylex.props(chrome.button, chrome.iconButton)}
      data-active={active || undefined}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function LinkControl({
  editor,
  href,
  container,
}: {
  editor: Editor;
  href: string | null;
  container: HTMLElement | undefined;
}) {
  const { files } = useEditorContext();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  // Enter applies the typed draft only while no suggestion is highlighted;
  // a highlighted one commits through Base UI as an item-press instead
  const highlighted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (open) setDraft(href ?? "");
  }, [open, href]);
  useEffect(() => {
    if (open && files) void files.list().then(setPaths);
  }, [open, files]);

  const apply = (url: string) => {
    const target = url.trim();
    if (target) editor.chain().focus().extendMarkRange("link").setLink({ href: target }).run();
    else editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Link"
        {...stylex.props(chrome.button, chrome.iconButton)}
        data-active={href != null || undefined}
      >
        <Link2 size={15} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner
          positionMethod="fixed"
          sideOffset={6}
          align="start"
          {...stylex.props(chrome.layer)}
        >
          <Popover.Popup {...stylex.props(chrome.popup, styles.linkPopup)}>
            <Autocomplete.Root
              items={paths}
              value={draft}
              onValueChange={(value, details) => {
                setDraft(value);
                if (details.reason === "item-press") apply(value);
              }}
              onItemHighlighted={(value) => {
                highlighted.current = value;
              }}
            >
              <Autocomplete.Input
                {...stylex.props(chrome.input, chrome.field)}
                placeholder="https://… or ./page.mdx"
                spellCheck={false}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && highlighted.current == null) {
                    // apply() focuses the editor during this keydown; without
                    // preventDefault WebKit then delivers Enter's editing
                    // action (delete selection + split) to the editor
                    event.preventDefault();
                    apply(draft);
                  }
                  if (event.key === "Escape") setOpen(false);
                }}
              />
              <Autocomplete.Portal container={container}>
                <Autocomplete.Positioner
                  positionMethod="fixed"
                  sideOffset={6}
                  {...stylex.props(chrome.layer)}
                >
                  <Autocomplete.Popup {...stylex.props(chrome.popup, styles.linkList)}>
                    <Autocomplete.List>
                      {(path: string) => (
                        <Autocomplete.Item
                          key={path}
                          value={path}
                          {...stylex.props(chrome.item, styles.mono)}
                        >
                          {path}
                        </Autocomplete.Item>
                      )}
                    </Autocomplete.List>
                  </Autocomplete.Popup>
                </Autocomplete.Positioner>
              </Autocomplete.Portal>
            </Autocomplete.Root>
            {href != null && (
              <button
                type="button"
                aria-label="Remove link"
                {...stylex.props(chrome.button, chrome.iconButton)}
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
      <Popover.Trigger
        aria-label="Table options"
        {...stylex.props(chrome.button, chrome.iconButton)}
      >
        <Table2 size={15} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner
          positionMethod="fixed"
          sideOffset={6}
          align="start"
          {...stylex.props(chrome.layer)}
        >
          <Popover.Popup {...stylex.props(chrome.popup, styles.tablePopup)}>
            {TABLE_OPS.map((op) => (
              <button
                key={op.label}
                type="button"
                {...stylex.props(chrome.button, chrome.item)}
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

function ImagePanel({ editor }: { editor: Editor }) {
  const { media } = useEditorContext();
  const attrs = editor.getAttributes("image");
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div {...stylex.props(styles.imageRow)}>
      <input
        {...stylex.props(chrome.input, chrome.field, styles.imageSrc)}
        placeholder="Image source…"
        value={(attrs.src as string) ?? ""}
        spellCheck={false}
        onChange={(event) => updateAtomAttributes(editor, "image", { src: event.target.value })}
      />
      <input
        {...stylex.props(chrome.input, chrome.field, styles.imageAlt)}
        placeholder="Alt text"
        value={(attrs.alt as string) ?? ""}
        onChange={(event) => updateAtomAttributes(editor, "image", { alt: event.target.value })}
      />
      {media && (
        <>
          <button
            type="button"
            aria-label="Upload image"
            {...stylex.props(chrome.button, chrome.iconButton)}
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
                if (!editor.isDestroyed) updateAtomAttributes(editor, "image", { src });
              });
              event.target.value = "";
            }}
          />
        </>
      )}
      <button
        type="button"
        aria-label="Remove image"
        {...stylex.props(chrome.button, chrome.iconButton)}
        onClick={() => editor.chain().focus().deleteSelection().run()}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function EditorBubble({
  editor,
  specs,
  touch,
}: {
  editor: Editor;
  specs: Map<string, UiComponentSpec>;
  touch: boolean;
}) {
  // Cmd-. shows the bubble at a resting caret, past `shouldShow`
  const [forced, setForced] = useState(false);
  // Portal target: the menu hides on editor blur unless focus lands inside
  // the bubble's parent, the bubble is positioned with a transform (would
  // skew a popup measured inside it), and the container must sit in
  // [data-fde-root] for theme and ::selection. The plugin appends the bubble
  // to `view.dom.parentElement`, which satisfies all three. Resolved from the
  // editor, never through refs (a ref-timing miss fell back to a body portal).
  // An object ref, not a callback: BubbleMenu assigns its ref during render,
  // where a state-setter callback would be a cross-component setState.
  const menuRef = useRef<HTMLDivElement>(null);
  const wrapper = (editor.view.dom.parentElement as HTMLElement | null) ?? undefined;
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const bubble = bubbleState(current.state);
      return {
        ...bubble,
        // the plugin hides the element; nothing is rendered into it meanwhile
        shown: touch || summoned(current.state),
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        strike: current.isActive("strike"),
        code: current.isActive("code"),
        link: current.isActive("link") ? String(current.getAttributes("link").href ?? "") : null,
        turnInto: activeBlock(current),
        // the panels render these: without them in the snapshot, attribute
        // edits don't re-render and React resets the controlled inputs'
        // caret on every keystroke
        atomAttrs: bubble.atom ? (current.state.doc.nodeAt(bubble.atom.pos)?.attrs ?? null) : null,
        headingAttrs: bubble.format ? current.getAttributes("heading") : null,
        canUndo: touch && current.can().undo(),
        canRedo: touch && current.can().redo(),
      };
    },
  });

  const [panelOpen, setPanelOpen] = useBlockMenuOpen(editor, state?.block === true);

  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "." || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      editor.view.dispatch(editor.state.tr.setMeta("bubbleMenu", "show"));
      setForced(true);
      setPanelOpen(!panelOpen);
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor, panelOpen, setPanelOpen]);

  // the plugin positions the bubble once on show, before React fills it in,
  // and never again when its size changes (chip ↔ full toolbar). Re-anchor
  // through the plugin's own updatePosition hook whenever the element resizes.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      editor.view.dispatch(editor.state.tr.setMeta("bubbleMenu", "updatePosition"));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [editor]);

  const run = (fn: (chain: ReturnType<Editor["chain"]>) => { run: () => boolean }) => {
    fn(editor.chain().focus()).run();
  };

  // stable: the plugin re-reads its options in a transaction whenever they change
  const options = useMemo(
    () => ({
      placement: touch ? ("bottom" as const) : ("bottom-start" as const),
      // past the selection and caret handles, which hang below the line
      offset: touch ? 20 : 6,
      onHide: () => {
        setPanelOpen(false);
        setForced(false);
      },
      onShow: () => {
        menuRef.current!.style.transition = "none";
      },
      onUpdate: () => {
        const el = menuRef.current!;
        if (!el.style.transition) return;
        // flush the landing position before transitions come back
        void el.offsetTop;
        el.style.transition = "";
      },
    }),
    [touch, setPanelOpen],
  );
  const shouldShow = useCallback(
    ({ state: editorState, view }: { state: EditorState; view: EditorView }) => {
      // focus in the bubble or a popover it portals into the wrapper keeps it
      // open; chrome inside node views (a table cell, an add button) does not
      const active = document.activeElement;
      if (!view.hasFocus() && wrapper?.contains(active) && !view.dom.contains(active)) return true;
      return touch ? view.hasFocus() : summoned(editorState);
    },
    [wrapper, touch],
  );
  const getReferencedVirtualElement = useCallback(() => {
    const { selection } = editor.state;
    if (!touch || !selection.empty) return null;
    const caret = posToDOMRect(editor.view, selection.from, selection.to);
    const { left, width } = editor.view.dom.getBoundingClientRect();
    const rect = new DOMRect(left, caret.top, width, caret.height);
    return { getBoundingClientRect: () => rect };
  }, [editor, touch]);

  const visible = state && (state.shown || forced);
  return (
    <BubbleMenu
      ref={menuRef}
      editor={editor}
      updateDelay={150}
      options={options}
      shouldShow={shouldShow}
      getReferencedVirtualElement={getReferencedVirtualElement}
      {...stylex.props(chrome.popup, styles.bubble)}
    >
      {visible && state.format && (
        <>
          <BlockTypePicker
            editor={editor}
            block={state.turnInto}
            triggerCls={ghostSelectClass}
            container={wrapper}
          />
          <span {...stylex.props(chrome.divider)} />
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
          <LinkControl editor={editor} href={state.link} container={wrapper} />
          {state.table && <TableControl editor={editor} container={wrapper} />}
        </>
      )}
      {visible && state.atom?.kind === "image" && <ImagePanel editor={editor} />}
      {visible && state.block && (
        <>
          {(state.format || state.atom) && <span {...stylex.props(chrome.divider)} />}
          {!touch && <DragHandle editor={editor} look={chrome.iconButton} size={20} />}
          <BlockMenu
            editor={editor}
            specs={specs}
            active={state.active}
            open={panelOpen}
            onOpenChange={setPanelOpen}
            container={wrapper}
            align="end"
            chipCls={chipClass}
            iconCls={iconClass}
            touch={touch}
          />
        </>
      )}
      {visible && touch && (
        <>
          <span {...stylex.props(chrome.divider)} />
          <MarkButton label="Undo" disabled={!state.canUndo} onClick={() => run((c) => c.undo())}>
            <Undo2 size={15} />
          </MarkButton>
          <MarkButton label="Redo" disabled={!state.canRedo} onClick={() => run((c) => c.redo())}>
            <Redo2 size={15} />
          </MarkButton>
        </>
      )}
    </BubbleMenu>
  );
}
