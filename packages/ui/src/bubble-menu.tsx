"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { consts } from "./styles/consts.stylex";
// side-effect imports: register starter-kit + table command typings
import "@tiptap/starter-kit";
import "@tiptap/extension-table";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction as PMTransaction,
} from "@tiptap/pm/state";
import { COMPONENT_NODE, INLINE_REGION_NODE, type MdxAttribute } from "@fumadocs-editor/core";
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
import { updateAtomAttributes } from "./components/attributes";
import { OPEN_COMPONENT_MENU } from "./components/caret-policy";
import { Picker } from "./components/picker";
import { useEditorProviders } from "./components/providers";
import { chrome } from "./styles/shared";

type Chain = ReturnType<Editor["chain"]>;

const muted = tokens.mutedForeground;
const border = tokens.border;

const styles = stylex.create({
  /* The bubble is a popup surface laid out as a toolbar row: it hugs its
   * controls, and stays under the popovers it opens. */
  bubble: { zIndex: 40, minWidth: 0, display: "flex", alignItems: "center", gap: "0.125rem" },
  linkPopup: {
    display: "flex",
    width: "16rem",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem",
  },
  /** the path suggestions track the input's width */
  linkList: { maxHeight: "16rem", width: "var(--anchor-width)", overflowY: "auto" },
  mono: { fontFamily: consts.mono, fontSize: 12 },
  muted: { color: muted },
  tablePopup: { display: "flex", width: "11rem", flexDirection: "column" },
  imageRow: { display: "flex", alignItems: "center", gap: "0.375rem" },
  imageSrc: { width: "13rem" },
  imageAlt: { width: "9rem" },
  yaml: {
    minHeight: "6rem",
    width: "18rem",
    resize: "vertical",
    borderRadius: "0.375rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: border, ":focus-visible": tokens.ring },
    backgroundColor: tokens.background,
    padding: "0.5rem",
    fontFamily: consts.mono,
    fontSize: 12,
    lineHeight: 1.625,
    color: tokens.foreground,
    outline: "none",
  },
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
    fontSize: 12.5,
    color: tokens.foreground,
    outline: "none",
  },
  /** the active component's chip: reads as a label until hovered */
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
  chipIcon: { display: "inline-flex", color: muted },
  panel: { display: "flex", width: "14rem", flexDirection: "column" },
});

const ghostSelectClass = stylex.props(chrome.button, chrome.ghostSelect).className!;

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

export function activeBlock(editor: Editor): string {
  for (const level of [1, 2, 3]) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  for (const name of ["taskList", "orderedList", "bulletList", "blockquote", "codeBlock"]) {
    if (editor.isActive(name)) return name;
  }
  return "p";
}

/**
 * The element type menu: every block a selection can become, with the
 * heading's anchor and TOC options under it. The bubble and the touch bar
 * share it; each supplies its own trigger styling and portal container.
 */
export function BlockTypePicker({
  editor,
  block,
  open,
  onOpenChange,
  side,
  triggerCls,
  container,
}: {
  editor: Editor;
  block: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
      open={open}
      onOpenChange={onOpenChange}
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
  // the ⋯ handle instead of a floating menu
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
      {...stylex.props(chrome.button, chrome.iconButton)}
      data-active={active || undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * URL editor for the link mark; portalled into the bubble's parent. With a
 * FileProvider the input autocompletes workspace pages (how docs link to
 * each other) while staying free-form for external URLs.
 */
function LinkControl({
  editor,
  href,
  container,
}: {
  editor: Editor;
  href: string | null;
  container: HTMLElement | undefined;
}) {
  const { files } = useEditorProviders();
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
        <Popover.Positioner sideOffset={6} align="start" {...stylex.props(chrome.layer)}>
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
                <Autocomplete.Positioner sideOffset={6} {...stylex.props(chrome.layer)}>
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
        <Popover.Positioner sideOffset={6} align="start" {...stylex.props(chrome.layer)}>
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

/** src / alt editor for a node-selected image, with provider upload. */
function ImagePanel({ editor, media }: { editor: Editor; media?: MediaProvider }) {
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

/** raw YAML editor for the node-selected frontmatter block */
function FrontmatterPanel({ editor }: { editor: Editor }) {
  const value = (editor.getAttributes("frontmatter").value as string) ?? "";
  return (
    <textarea
      {...stylex.props(chrome.input, styles.yaml)}
      value={value}
      spellCheck={false}
      onChange={(event) =>
        updateAtomAttributes(editor, "frontmatter", { value: event.target.value })
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
  // Portal target has three constraints: the menu hides on editor blur
  // unless focus lands inside the bubble's parent (plugin checks
  // `element.parentNode.contains(relatedTarget)`), the bubble is
  // positioned with a transform (would skew a popup measured inside it),
  // and the container must sit in [data-fde-root] for theme and
  // ::selection. The plugin appends the bubble to `view.dom.parentElement`,
  // which satisfies all three. Resolved from the editor, never through
  // refs (a ref-timing miss fell back to a body portal).
  // an object ref, not a callback: BubbleMenu assigns its ref during render,
  // where a state-setter callback would be a cross-component setState. The
  // element is created eagerly and never replaced, so mount effects see it.
  const menuRef = useRef<HTMLDivElement>(null);
  const panelContainer = (editor.view.dom.parentElement as HTMLElement | null) ?? undefined;
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const bubble = bubbleState(current.state, specs);
      const doc = current.state.doc;
      return {
        ...bubble,
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        strike: current.isActive("strike"),
        code: current.isActive("code"),
        link: current.isActive("link") ? String(current.getAttributes("link").href ?? "") : null,
        block: activeBlock(current),
        // the panels render these: without them in the snapshot, attribute
        // edits don't re-render and React resets the controlled inputs'
        // caret on every keystroke
        componentAttrs: bubble.active
          ? ((doc.nodeAt(bubble.active.pos)?.attrs.attributes ?? []) as MdxAttribute[])
          : null,
        atomAttrs: bubble.atom ? (doc.nodeAt(bubble.atom.pos)?.attrs ?? null) : null,
        headingAttrs: bubble.format ? current.getAttributes("heading") : null,
      };
    },
  });

  const active = state?.active ?? null;
  const hasActive = active != null;

  useEffect(() => {
    if (!hasActive) setPanelOpen(false);
  }, [hasActive]);

  // a click on a leaf component (nothing to type into) opens its menu
  useEffect(() => {
    const onTransaction = ({ transaction }: { transaction: PMTransaction }) => {
      if (transaction.getMeta(OPEN_COMPONENT_MENU)) setPanelOpen(true);
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  useEffect(() => {
    if (!state?.format) setTurnIntoOpen(false);
  }, [state?.format]);

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

  const spec = active ? specs.get(active.name) : undefined;

  return (
    <BubbleMenu
      ref={menuRef}
      editor={editor}
      updateDelay={150}
      options={{ placement: "bottom", offset: 6 }}
      shouldShow={({ state: editorState }) => {
        // touch has the mobile bar; one surface per input mode
        if (window.matchMedia("(pointer: coarse)").matches) return false;
        const { format, active: current, atom } = bubbleState(editorState, specs);
        return format || current != null || atom != null;
      }}
      {...stylex.props(chrome.popup, styles.bubble)}
    >
      {state?.format && (
        <>
          <BlockTypePicker
            editor={editor}
            block={state.block}
            open={turnIntoOpen}
            onOpenChange={setTurnIntoOpen}
            triggerCls={ghostSelectClass}
            container={panelContainer}
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
          <LinkControl editor={editor} href={state.link} container={panelContainer} />
          {state.table && <TableControl editor={editor} container={panelContainer} />}
        </>
      )}
      {state?.atom?.kind === "image" && <ImagePanel editor={editor} media={media} />}
      {state?.atom?.kind === "frontmatter" && <FrontmatterPanel editor={editor} />}
      {active && spec && (
        <>
          {state?.format && <span {...stylex.props(chrome.divider)} />}
          <Popover.Root open={panelOpen} onOpenChange={setPanelOpen}>
            <Popover.Trigger
              aria-label={`${spec.label ?? spec.name} options`}
              {...stylex.props(chrome.button, styles.chip)}
            >
              <span {...stylex.props(styles.chipIcon)}>{spec.icon}</span>
              {spec.label ?? spec.name}
              <ChevronDown size={12} {...stylex.props(styles.muted)} />
            </Popover.Trigger>
            <Popover.Portal container={panelContainer}>
              <Popover.Positioner sideOffset={6} align="end" {...stylex.props(chrome.layer)}>
                <Popover.Popup data-fde-popup="" {...stylex.props(chrome.popup, styles.panel)}>
                  <BlockPanel
                    editor={editor}
                    specs={specs}
                    active={{ ...active, attributes: state?.componentAttrs ?? [] }}
                    onDone={() => setPanelOpen(false)}
                  />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </>
      )}
    </BubbleMenu>
  );
}
