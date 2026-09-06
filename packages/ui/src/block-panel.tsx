"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { consts } from "./styles/consts.stylex";
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import type { MdxAttribute } from "@fumadocs-editor/core";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowDown,
  ArrowUp,
  BoxSelect,
  ChevronDown,
  IndentDecrease,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isComponent } from "@fumadocs-editor/core/extensions";
import type { UiComponentSpec } from "./components/spec";
import {
  childInsertContext,
  deleteBlocks,
  entryParentFolder,
  entryToggleTarget,
  focusAt,
  moveBlocks,
  outdentEntry,
  parentBlock,
  selectNode,
  toggleEntryType,
  type BlockRange,
} from "./components/keymap";
import { PropControl } from "./attributes-panel";
import { setComponentAttributes } from "./components/attributes";
import { readPropValue, setPropValue } from "./components/attr-values";
import { OPEN_COMPONENT_MENU } from "./components/caret-policy";
import { chrome } from "./styles/shared";

const muted = tokens.mutedForeground;

const styles = stylex.create({
  panel: { display: "flex", width: "14rem", flexDirection: "column" },
  chipIcon: { display: "inline-flex", color: muted },
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

export interface ActiveComponent {
  pos: number;
  /** node type name: the key into the specs map */
  type: string;
  attributes: MdxAttribute[];
}

export function useBlockMenuOpen(
  editor: Editor,
  pos: number | undefined,
): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (pos == null) setOpen(false);
  }, [pos]);
  useEffect(() => {
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(OPEN_COMPONENT_MENU)) setOpen(true);
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);
  return [open, setOpen];
}

export function BlockMenu({
  editor,
  specs,
  active,
  range,
  open,
  onOpenChange,
  container,
  align,
  chipCls,
  iconCls,
  touch,
}: {
  editor: Editor;
  specs: Map<string, UiComponentSpec>;
  active: ActiveComponent | null;
  range: BlockRange | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: HTMLElement | undefined;
  align: "start" | "end";
  chipCls: string;
  iconCls: string;
  /** a touch surface: the popup must not raise the keyboard */
  touch?: boolean;
}) {
  const spec = active ? specs.get(active.type) : undefined;
  const pos = active ? active.pos : range?.from;
  if (pos == null) return null;
  const label = spec ? (spec.label ?? spec.name) : null;
  const close = () => onOpenChange(false);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={label ? `${label} options` : "Block options"}
        className={label ? chipCls : iconCls}
      >
        {label ? (
          <>
            <span {...stylex.props(styles.chipIcon)}>{spec!.icon}</span>
            {label}
            <ChevronDown size={12} {...stylex.props(styles.chipIcon)} />
          </>
        ) : (
          <MoreHorizontal size={15} />
        )}
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner
          positionMethod="fixed"
          sideOffset={6}
          align={align}
          {...stylex.props(chrome.layer)}
        >
          <Popover.Popup
            data-fde-popup=""
            initialFocus={touch ? false : undefined}
            finalFocus={touch ? false : undefined}
            {...stylex.props(chrome.popup, styles.panel)}
          >
            {active && spec ? (
              <BlockPanel editor={editor} specs={specs} active={active} onDone={close} />
            ) : (
              range && <BlockActions editor={editor} range={range} onDone={close} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BlockPanel({
  editor,
  specs,
  active,
  onDone,
}: {
  editor: Editor;
  specs: Map<string, UiComponentSpec>;
  active: ActiveComponent;
  onDone: () => void;
}) {
  const spec = specs.get(active.type)!;
  const attributes = active.attributes;
  const fields = (spec.props ?? []).filter((field) => !field.inline);
  const inserts = childInsertContext(editor.state, active.pos, specs);
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
            editor.chain().insertContentAt(inserts.insertAt, child.insert!(specs)).run();
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
      <BlockActions
        editor={editor}
        range={() => {
          const node = editor.state.doc.nodeAt(active.pos);
          return node && { from: active.pos, to: active.pos + node.nodeSize };
        }}
        onDone={onDone}
      />
    </>
  );
}

/** "bulletList" reads as "bullet list"; a component goes by its type name */
function blockLabel(node: PMNode): string {
  if (isComponent(node.type)) return node.type.name;
  return node.type.name.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
}

export function BlockActions({
  editor,
  range: at,
  onDone,
  itemLook,
}: {
  editor: Editor;
  /** a node view passes a getter: an edit above it shifts the range without a re-render */
  range: BlockRange | (() => BlockRange | null | undefined);
  onDone: () => void;
  itemLook?: stylex.StyleXStyles;
}) {
  const range = () => (typeof at === "function" ? at() : at);
  const current = range();
  const parent = current ? parentBlock(editor.state.doc, current.from) : null;
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
          {...stylex.props(chrome.button, chrome.item, itemLook)}
          onClick={() => {
            const blocks = range();
            if (blocks && moveBlocks(editor, blocks, dir)) onDone();
            editor.view.focus();
          }}
        >
          <Icon size={13} {...stylex.props(styles.actionIcon)} />
          <span>{label}</span>
        </button>
      ))}
      {parent && (
        <button
          type="button"
          {...stylex.props(chrome.button, chrome.item, itemLook)}
          onClick={() => {
            const blocks = range();
            const target = blocks && parentBlock(editor.state.doc, blocks.from);
            if (target) selectNode(editor, target.from);
            onDone();
            editor.view.focus();
          }}
        >
          <BoxSelect size={13} {...stylex.props(styles.actionIcon)} />
          <span>Select {blockLabel(parent.node)}</span>
        </button>
      )}
      <button
        type="button"
        {...stylex.props(chrome.button, chrome.item, styles.danger, itemLook)}
        onClick={() => {
          const blocks = range();
          if (!blocks) return;
          editor.view.dispatch(deleteBlocks(editor.state.tr, blocks).scrollIntoView());
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
