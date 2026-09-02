"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { consts } from "./styles/consts.stylex";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEditorPortal } from "./utils/portal";
import { NodeSelection } from "@tiptap/pm/state";
import type { MdxAttribute } from "@fumadocs-editor/core";
import { Popover } from "@base-ui/react/popover";
import { ArrowDown, ArrowUp, MoreHorizontal, Trash2 } from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import { childInsertContext, focusAt, moveComponentAt } from "./components/keymap";
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

/**
 * A ⋯ handle at the active component's top-right: the resting affordance
 * while the caret sits inside a component (the bubble appears only for
 * selections). Click or Mod-. opens the panel; dragging the handle moves
 * the component.
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

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { anchorRef, container } = useEditorPortal();

  // place the handle at the active component's top-right corner
  useEffect(() => {
    const button = buttonRef.current;
    if (!button || active == null) return;
    const wrapper = button.offsetParent;
    const dom = editor.view.nodeDOM(active.pos);
    if (!wrapper || !(dom instanceof Element)) return;
    const rect = dom.getBoundingClientRect();
    const base = wrapper.getBoundingClientRect();
    button.style.top = `${rect.top - base.top + 2}px`;
    button.style.left = `${rect.right - base.left - 26}px`;
  }, [editor, active]);

  useEffect(() => {
    if (active == null) setOpen(false);
  }, [active]);

  // Mod-. opens the menu from the keyboard
  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "." && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  if (active == null) return null;
  const spec = specs.get(active.name);
  if (!spec) return null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        ref={(node: HTMLButtonElement | null) => {
          buttonRef.current = node;
          anchorRef(node);
        }}
        aria-label={`${spec.label ?? spec.name} options`}
        {...stylex.props(chrome.button, chrome.focusRing, styles.handle)}
        draggable
        // the handle lives outside ProseMirror's DOM, so its dragstart never
        // reaches the view: stage the node drag by hand
        onDragStart={(event) => {
          if (!event.dataTransfer || editor.state.doc.nodeAt(active.pos) == null) return;
          const selection = NodeSelection.create(editor.state.doc, active.pos);
          editor.view.dispatch(editor.state.tr.setSelection(selection));
          event.dataTransfer.setData("text/plain", "");
          event.dataTransfer.effectAllowed = "copyMove";
          const dom = editor.view.nodeDOM(active.pos);
          if (dom instanceof Element) event.dataTransfer.setDragImage(dom, 0, 0);
          // carry the dragged node like ProseMirror's own drags do: the drop
          // deletes by this remapped range, never by the live selection,
          // which the browser can collapse mid-drag
          editor.view.dragging = {
            slice: selection.content(),
            move: true,
            node: selection,
          } as unknown as typeof editor.view.dragging;
        }}
        // ProseMirror clears `dragging` from its own dragend handler; a drag
        // from here ends outside its DOM, so clear a cancelled one ourselves
        onDragEnd={() => {
          window.setTimeout(() => {
            editor.view.dragging = null;
          }, 50);
        }}
      >
        <MoreHorizontal size={15} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner sideOffset={6} align="end" {...stylex.props(chrome.layer)}>
          <Popover.Popup data-fde-popup="" {...stylex.props(chrome.popup, styles.panel)}>
            <BlockPanel
              editor={editor}
              specs={specs}
              active={active}
              onDone={() => setOpen(false)}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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

  const setAttributes = (next: MdxAttribute[]) => setComponentAttributes(editor, active.pos, next);

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
            if (moveComponentAt(editor, active.pos, dir)) onDone();
            editor.commands.focus();
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
          const current = editor.state.doc.nodeAt(active.pos);
          if (!current) return;
          editor
            .chain()
            .deleteRange({ from: active.pos, to: active.pos + current.nodeSize })
            .focus()
            .run();
          onDone();
        }}
      >
        <Trash2 size={13} {...stylex.props(styles.actionIcon)} />
        <span>Delete</span>
      </button>
    </>
  );
}
