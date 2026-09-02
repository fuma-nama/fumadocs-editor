"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { consts } from "./styles/consts.stylex";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEditorPortal } from "./utils/portal";
import { NodeSelection } from "@tiptap/pm/state";
import { startTouchDrag } from "./components/structure";
import type { MdxAttribute } from "@fumadocs-editor/core";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowDown,
  ArrowUp,
  EllipsisVertical,
  IndentDecrease,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import {
  childInsertContext,
  entryParentFolder,
  entryToggleTarget,
  focusAt,
  handleBlock,
  moveBlockAt,
  outdentEntry,
  toggleEntryType,
} from "./components/keymap";
import { PropControl } from "./attributes-panel";
import { activeComponent, setComponentAttributes } from "./components/attributes";
import { readPropValue, setPropValue } from "./components/attr-values";
import { chrome } from "./styles/shared";

const muted = tokens.mutedForeground;

const styles = stylex.create({
  /** sits above the component's own chrome, inside the editor wrapper */
  handle: {
    position: "absolute",
    zIndex: 3,
    display: "inline-flex",
    width: "1.5rem",
    height: "1.5rem",
    cursor: "pointer",
    touchAction: "none",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
    color: { default: muted, ":hover": tokens.foreground },
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.accent,
      ":is([data-popup-open])": tokens.accent,
    },
  },
  panel: { display: "flex", width: "14rem", flexDirection: "column" },
  title: {
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
    paddingInline: "0.5rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.375rem",
    fontFamily: consts.mono,
    fontSize: 11,
    fontWeight: 600,
    color: muted,
  },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    paddingInline: "0.25rem",
    paddingBottom: "0.375rem",
  },
  separator: {
    marginInline: "-0.25rem",
    marginBottom: "0.25rem",
    height: 1,
    backgroundColor: tokens.border,
  },
  actionIcon: { width: "1rem", flexShrink: 0 },
  danger: { color: { default: muted, ":hover": tokens.error } },
});

/** the handle's drag wiring: the browser's drag for a mouse, the editor's own for a touch */
function dragProps(editor: Editor, pos: number, specs: Map<string, UiComponentSpec>) {
  return {
    draggable: true,
    // a touch drags through the editor's own touch drag; the browser's
    // long-press drag must not start on top of it
    onTouchStart(event: TouchEvent<HTMLButtonElement>) {
      const dom = editor.view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) return;
      event.currentTarget.draggable = false;
      startTouchDrag(editor.view, pos, dom, event.nativeEvent, specs);
    },
    onTouchEnd(event: TouchEvent<HTMLButtonElement>) {
      event.currentTarget.draggable = true;
    },
    onTouchCancel(event: TouchEvent<HTMLButtonElement>) {
      event.currentTarget.draggable = true;
    },
    // the handle lives outside ProseMirror's DOM, so its dragstart never
    // reaches the view: stage the node drag by hand
    onDragStart(event: DragEvent<HTMLButtonElement>) {
      if (!event.dataTransfer || editor.state.doc.nodeAt(pos) == null) return;
      const selection = NodeSelection.create(editor.state.doc, pos);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      event.dataTransfer.setData("text/plain", "");
      event.dataTransfer.effectAllowed = "copyMove";
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        // the browser sizes the image to the node's box including every
        // descendant, and Base UI's visually hidden inputs are position:
        // fixed at the viewport corner: out of the picture while it captures
        const fixed: HTMLElement[] = [];
        for (const el of dom.querySelectorAll<HTMLElement>("*")) {
          if (getComputedStyle(el).position === "fixed") fixed.push(el);
        }
        for (const el of fixed) el.hidden = true;
        // the image stays over the block: the cursor keeps its grab point
        const rect = dom.getBoundingClientRect();
        event.dataTransfer.setDragImage(dom, event.clientX - rect.left, event.clientY - rect.top);
        setTimeout(() => {
          for (const el of fixed) el.hidden = false;
        });
      }
      // carry the dragged node like ProseMirror's own drags do: the drop
      // deletes by this remapped range, never by the live selection,
      // which the browser can collapse mid-drag
      editor.view.dragging = {
        slice: selection.content(),
        move: true,
        node: selection,
      } as unknown as typeof editor.view.dragging;
    },
    // ProseMirror clears `dragging` from its own dragend handler; a drag
    // from here ends outside its DOM, so clear a cancelled one ourselves
    onDragEnd() {
      window.setTimeout(() => {
        editor.view.dragging = null;
      }, 50);
    },
  };
}

/**
 * A ⋯ handle beside the block at `pos`: at a component's top-right corner
 * (`align: "end"`), or in the gutter left of any other block's first line.
 * Click (or Mod-. on the primary one) opens its panel; dragging it moves
 * the block.
 */
function Handle({
  editor,
  specs,
  pos,
  align,
  label,
  shortcut,
  children,
}: {
  editor: Editor;
  specs: Map<string, UiComponentSpec>;
  pos: number;
  align: "start" | "end";
  label: string;
  shortcut: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { anchorRef, container } = useEditorPortal();

  useEffect(() => {
    const button = buttonRef.current;
    const wrapper = button?.offsetParent;
    const dom = editor.view.nodeDOM(pos);
    if (!button || !wrapper || !(dom instanceof HTMLElement)) return;
    const rect = dom.getBoundingClientRect();
    const base = wrapper.getBoundingClientRect();
    if (align === "end") {
      button.style.top = `${rect.top - base.top + 2}px`;
      button.style.left = `${rect.right - base.left - 26}px`;
    } else {
      const line = parseFloat(getComputedStyle(dom).lineHeight) || 24;
      button.style.top = `${rect.top - base.top + (line - 24) / 2}px`;
      button.style.left = `${rect.left - base.left - 24}px`;
    }
  }, [editor, pos, align]);

  // Mod-. opens the menu from the keyboard
  useEffect(() => {
    if (!shortcut) return;
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "." && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor, shortcut]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        ref={(node: HTMLButtonElement | null) => {
          buttonRef.current = node;
          anchorRef(node);
        }}
        aria-label={label}
        {...stylex.props(chrome.button, chrome.focusRing, styles.handle)}
        {...dragProps(editor, pos, specs)}
      >
        {align === "end" ? <MoreHorizontal size={15} /> : <EllipsisVertical size={15} />}
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner sideOffset={6} align={align} {...stylex.props(chrome.layer)}>
          <Popover.Popup data-fde-popup="" {...stylex.props(chrome.popup, styles.panel)}>
            {children(() => setOpen(false))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The resting affordances while the caret sits in a block (the bubble
 * appears only for selections): a handle for the innermost component, and
 * one for the innermost plain block in the document or a body region.
 */
export function BlockMenu({
  editor,
  specs,
}: {
  editor: Editor;
  specs: Map<string, UiComponentSpec>;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? activeComponent(current.state) : null),
  });
  const block = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? handleBlock(current.state.selection) : null),
  });
  const spec = active ? specs.get(active.name) : undefined;

  return (
    <>
      {active && spec && (
        <Handle
          editor={editor}
          specs={specs}
          pos={active.pos}
          align="end"
          label={`${spec.label ?? spec.name} options`}
          shortcut
        >
          {(close) => <BlockPanel editor={editor} specs={specs} active={active} onDone={close} />}
        </Handle>
      )}
      {block && (
        <Handle
          editor={editor}
          specs={specs}
          pos={block.pos}
          align="start"
          label="Block options"
          shortcut={!spec}
        >
          {(close) => <BlockActions editor={editor} pos={block.pos} onDone={close} />}
        </Handle>
      )}
    </>
  );
}

/**
 * Attributes and actions for one component. The ⋯ handle and the bubble's
 * component chip open it as a popover; the mobile bar opens it as a sheet.
 */
export function BlockPanel({
  editor,
  specs,
  active,
  onDone,
}: {
  editor: Editor;
  specs: Map<string, UiComponentSpec>;
  active: { pos: number; name: string; attributes: MdxAttribute[] };
  onDone: () => void;
}) {
  const spec = specs.get(active.name);
  if (!spec) return null;

  const attributes = active.attributes;
  const fields = (spec.props ?? []).filter((field) => !field.inline);
  const inserts = childInsertContext(editor.state, active.pos, specs);
  // row actions of a list entry (File ↔ Folder, out of its folder): Tab and
  // Shift-Tab on a keyboard, labelled here for touch and discovery
  const { $from } = editor.state.selection;
  const toggle = entryToggleTarget($from, specs);
  const folder = entryParentFolder($from, specs);

  const setAttributes = (next: MdxAttribute[]) => setComponentAttributes(editor, active.pos, next);
  // These edit the document while a panel button holds focus, then hand it
  // back with ProseMirror's own focus(): it writes the selection into the
  // DOM synchronously. TipTap's focus command raw-focuses the DOM first on
  // iOS/Android, and the browser's stale caret (inside a node view that no
  // longer exists) gets read back as the new selection before the deferred
  // sync runs.

  return (
    <>
      <p {...stylex.props(styles.title)}>
        {spec.icon}
        {spec.label ?? spec.name}
      </p>
      {fields.length > 0 && (
        <div {...stylex.props(styles.fields)}>
          {fields.map((field) => (
            <PropControl
              key={field.name}
              field={field}
              value={readPropValue(attributes, field)}
              onChange={(value) => setAttributes(setPropValue(attributes, field, value))}
            />
          ))}
        </div>
      )}
      {/* not an <hr>: the UA gives one its own border and margins */}
      <div role="separator" {...stylex.props(styles.separator)} />
      {inserts?.children.map((child) => (
        <button
          key={child.name}
          type="button"
          {...stylex.props(chrome.button, chrome.item)}
          onClick={() => {
            const content = child.insert?.();
            if (!content) return;
            editor.chain().insertContentAt(inserts.insertAt, content).run();
            onDone();
            focusAt(editor, inserts.insertAt + 1);
          }}
        >
          <span {...stylex.props(chrome.itemIcon)}>{child.icon}</span>
          <span>Add {child.label ?? child.name}</span>
        </button>
      ))}
      {toggle && (
        <button
          type="button"
          {...stylex.props(chrome.button, chrome.item)}
          onClick={() => {
            toggleEntryType(editor, specs);
            onDone();
            editor.view.focus();
          }}
        >
          <span {...stylex.props(chrome.itemIcon)}>{toggle.target.icon}</span>
          <span>Turn into {toggle.target.label ?? toggle.target.name}</span>
        </button>
      )}
      {folder && (
        <button
          type="button"
          {...stylex.props(chrome.button, chrome.item)}
          onClick={() => {
            outdentEntry(editor, specs);
            onDone();
            editor.view.focus();
          }}
        >
          <IndentDecrease size={13} {...stylex.props(styles.actionIcon)} />
          <span>Move out of {folder.label ?? folder.name}</span>
        </button>
      )}
      <BlockActions editor={editor} pos={active.pos} onDone={onDone} />
    </>
  );
}

/** move and delete: the tail of a component's panel, and all of a block's */
function BlockActions({
  editor,
  pos,
  onDone,
}: {
  editor: Editor;
  pos: number;
  onDone: () => void;
}) {
  return (
    <>
      {(
        [
          [-1, "Move up", ArrowUp],
          [1, "Move down", ArrowDown],
        ] as const
      ).map(([dir, label, Icon]) => (
        <button
          key={label}
          type="button"
          {...stylex.props(chrome.button, chrome.item)}
          onClick={() => {
            if (moveBlockAt(editor, pos, dir)) onDone();
            editor.view.focus();
          }}
        >
          <Icon size={13} {...stylex.props(styles.actionIcon)} />
          <span>{label}</span>
        </button>
      ))}
      <button
        type="button"
        {...stylex.props(chrome.button, chrome.item, styles.danger)}
        onClick={() => {
          const current = editor.state.doc.nodeAt(pos);
          if (!current) return;
          editor.commands.deleteRange({ from: pos, to: pos + current.nodeSize });
          onDone();
          editor.view.focus();
        }}
      >
        <Trash2 size={13} {...stylex.props(styles.actionIcon)} />
        <span>Delete</span>
      </button>
    </>
  );
}
