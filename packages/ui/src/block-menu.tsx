"use client";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { COMPONENT_NODE, type MdxAttribute } from "@fumadocs-editor/core";
import { Popover } from "@base-ui/react/popover";
import { ArrowDown, ArrowUp, MoreHorizontal, Trash2 } from "lucide-react";
import type { UiComponentSpec } from "./components/spec";
import { childInsertContext, focusAt, moveComponentAt } from "./components/keymap";
import { PropControl } from "./attributes-panel";
import { readPropValue, setPropValue } from "./components/attributes";
import { focusRing, itemCls, popupCls } from "./components/styles";

/**
 * A quiet ⋯ handle at the active component's top-right corner: the resting
 * affordance while the caret merely sits inside a component (the bubble menu
 * appears only for selections). Click or Mod-. opens the panel; dragging the
 * handle moves the component.
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
    selector: ({ editor: current }) => {
      if (!current) return null;
      const selection = current.state.selection;
      if (selection instanceof NodeSelection) {
        if (selection.node.type.name !== COMPONENT_NODE) return null;
        return { pos: selection.from, name: selection.node.attrs.name as string };
      }
      const { $from } = selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === COMPONENT_NODE) {
          return { pos: $from.before(depth), name: $from.node(depth).attrs.name as string };
        }
      }
      return null;
    },
  });

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
        ref={buttonRef}
        aria-label={`${spec.title ?? spec.name} options`}
        className={`fde-block-handle absolute z-[3] inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground data-[popup-open]:bg-fd-accent ${focusRing}`}
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
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-50">
          <Popover.Popup className={`${popupCls} flex w-56 flex-col`}>
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
  active: { pos: number; name: string };
  onDone: () => void;
}) {
  const spec = specs.get(active.name);
  if (!spec) return null;

  const node = editor.state.doc.nodeAt(active.pos);
  const attributes = (node?.attrs.attributes ?? []) as MdxAttribute[];
  const fields = (spec.props ?? []).filter((field) => !field.inline);
  const inserts = childInsertContext(editor.state, active.pos, specs);

  const setAttributes = (next: MdxAttribute[]) => {
    const tr = editor.state.tr;
    const current = editor.state.doc.nodeAt(active.pos);
    if (!current) return;
    tr.setNodeMarkup(active.pos, undefined, { ...current.attrs, attributes: next });
    editor.view.dispatch(tr);
  };

  return (
    <>
      <p className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 font-mono text-[11px] font-semibold text-fd-muted-foreground">
        {spec.icon}
        {spec.title ?? spec.name}
      </p>
      {fields.length > 0 && (
        <div className="flex flex-col gap-2 px-1 pb-1.5">
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
      {/* not an <hr>: the panel can render inside `.fde-content`, whose
          document styles give hr elements 2em margins */}
      <div role="separator" className="-mx-1 mb-1 h-px bg-fd-border" />
      {inserts?.children.map((child) => (
        <button
          key={child.name}
          type="button"
          className={itemCls}
          onClick={() => {
            const content = child.insert?.();
            if (!content) return;
            editor.chain().insertContentAt(inserts.insertAt, content).run();
            onDone();
            focusAt(editor, inserts.insertAt + 1);
          }}
        >
          <span className="inline-flex w-4 shrink-0 justify-center text-fd-muted-foreground">
            {child.icon}
          </span>
          <span>Add {child.title ?? child.name}</span>
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
          className={itemCls}
          onClick={() => {
            if (moveComponentAt(editor, active.pos, dir)) onDone();
            editor.commands.focus();
          }}
        >
          <Icon size={13} className="w-4 shrink-0" />
          <span>{label}</span>
        </button>
      ))}
      <button
        type="button"
        className={`${itemCls} text-fd-muted-foreground hover:text-fd-error`}
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
        <Trash2 size={13} className="w-4 shrink-0" />
        <span>Delete</span>
      </button>
    </>
  );
}
