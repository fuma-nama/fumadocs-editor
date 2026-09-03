"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import { consts } from "./styles/consts.stylex";
// side-effect imports: register the extension packages' command typings
import "@tiptap/starter-kit";
import "@tiptap/extension-list";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Radical,
  Sigma,
  SquareCode,
  TextQuote,
  ImageIcon,
  Table2,
} from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { INLINE_REGION_NODE } from "@fumadocs-editor/core";
import type { UiComponentSpec } from "./components/spec";
import { childOnlyNames, focusAt, insertableChildren, listEntryDepth } from "./components/keymap";
import "@tiptap/extension-table";
import { chrome } from "./styles/shared";
import { insertImages } from "./components/image-view";
import type { MediaProvider } from "./components/media";

const muted = tokens.mutedForeground;

const styles = stylex.create({
  /** placed by hand against the caret rect, so fixed and never in flow */
  popup: { position: "fixed", maxHeight: "18rem", width: "13rem", overflowY: "auto" },
  empty: {
    margin: 0,
    paddingInline: "0.5rem",
    paddingBlock: "0.375rem",
    fontSize: 13,
    color: muted,
  },
  group: {
    margin: 0,
    paddingInline: "0.5rem",
    paddingTop: "0.375rem",
    paddingBottom: "0.125rem",
    fontSize: 11.5,
    fontWeight: 500,
    color: muted,
  },
  item: { width: "100%" },
  title: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  mono: {
    fontFamily: consts.mono,
    fontSize: 12,
  },
});

export interface SlashItem {
  title: string;
  group: string;
  icon?: ReactNode;
  /** file paths render in the code face */
  mono?: boolean;
  run: (editor: Editor, range: Range) => void;
}

const block = (
  title: string,
  icon: ReactNode,
  run: (editor: Editor, range: Range) => void,
): SlashItem => ({ title, group: "Blocks", icon, run });

const BLOCKS: SlashItem[] = [
  block("Heading 1", <Heading1 size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run(),
  ),
  block("Heading 2", <Heading2 size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run(),
  ),
  block("Heading 3", <Heading3 size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run(),
  ),
  block("Bullet list", <List size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).toggleBulletList().run(),
  ),
  block("Numbered list", <ListOrdered size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  ),
  block("Task list", <ListTodo size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).toggleTaskList().run(),
  ),
  block("Quote", <TextQuote size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  ),
  block("Code block", <SquareCode size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  ),
  block("Divider", <Minus size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  ),
  block("Table", <Table2 size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  ),
];

/** offered only while the math dialect is on: the nodes have no MDX form
 * otherwise */
const MATH_ITEMS: SlashItem[] = [
  block("Math block", <Sigma size={15} />, (e, r) =>
    e.chain().focus().deleteRange(r).setNode("mathBlock").run(),
  ),
  block("Inline math", <Radical size={15} />, (e, r) =>
    e
      .chain()
      .focus()
      .deleteRange(r)
      .insertContentAt(r.from, { type: "mathInline" })
      .setTextSelection(r.from + 1)
      .run(),
  ),
];

/** Image: pick + upload with a provider, otherwise a source-less node the
 * bubble fills in. */
function imageItem(media: MediaProvider | undefined): SlashItem {
  return block("Image", <ImageIcon size={15} />, (e, r) => {
    if (media) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        e.chain().focus().deleteRange(r).run();
        if (file) void insertImages(e, media, [file], r.from);
      };
      input.click();
      return;
    }
    e.chain()
      .focus()
      .deleteRange(r)
      .insertContentAt(r.from, { type: "image", attrs: { src: "" } })
      .run();
    e.commands.setNodeSelection(r.from);
  });
}

/** every spec with an insert, minus child-only specs (File, Card, Step, …) */
function componentItems(specs: UiComponentSpec[]): SlashItem[] {
  const childOnly = childOnlyNames(specs);
  const items: SlashItem[] = [];
  for (const spec of specs) {
    if (!spec.insert || childOnly.has(spec.name)) continue;
    items.push({
      title: spec.label ?? spec.name,
      group: "Components",
      icon: spec.icon,
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).insertContentAt(range.from, spec.insert!()).run();
        focusAt(editor, range.from + 1);
      },
    });
  }
  return items;
}

export interface PopupProps {
  items: SlashItem[];
  selected: number;
  rect: { left: number; top: number; bottom: number } | null;
  onSelect: (index: number) => void;
}

/** shared suggestion list: the slash menu and the file-path suggest */
export function SlashPopup({ items, selected, rect, onSelect }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top =
      rect.bottom + 4 + height > window.innerHeight - 8
        ? Math.max(8, rect.top - height - 4)
        : rect.bottom + 4;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [rect, items.length]);
  useLayoutEffect(() => {
    ref.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div ref={ref} {...stylex.props(chrome.popup, styles.popup)}>
      {items.length === 0 && <p {...stylex.props(styles.empty)}>No results</p>}
      {items.map((item, index) => (
        <div key={item.title}>
          {(index === 0 || items[index - 1].group !== item.group) && (
            <p {...stylex.props(styles.group)}>{item.group}</p>
          )}
          <button
            type="button"
            data-index={index}
            {...stylex.props(chrome.button, chrome.item, styles.item)}
            data-highlighted={index === selected || undefined}
            // preserve the editor selection; select on mouseup like a menu item
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(index)}
          >
            <span {...stylex.props(chrome.itemIcon)}>{item.icon}</span>
            <span {...stylex.props(styles.title, item.mono && styles.mono)}>{item.title}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

export function suggestionRender(): {
  onStart: (props: SuggestionProps<SlashItem, SlashItem>) => void;
  onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => void;
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
  onExit: () => void;
} {
  let renderer: ReactRenderer<unknown, PopupProps> | null = null;
  let selected = 0;
  let hidden = false;
  let current: SuggestionProps<SlashItem, SlashItem> | null = null;

  const popupProps = (): PopupProps => ({
    items: current?.items ?? [],
    selected,
    rect: current?.clientRect?.() ?? null,
    onSelect: (index) => {
      const item = current?.items[index];
      if (item) current?.command(item);
    },
  });

  return {
    onStart(props) {
      current = props;
      selected = 0;
      hidden = false;
      renderer = new ReactRenderer(SlashPopup, {
        editor: props.editor,
        props: popupProps(),
      });
      const host = props.editor.view.dom.closest("[data-fde-root]") ?? document.body;
      host.appendChild(renderer.element);
    },
    onUpdate(props) {
      current = props;
      if (selected >= props.items.length) selected = 0;
      renderer?.updateProps(popupProps());
    },
    onKeyDown({ event }) {
      if (!current || hidden) return false;
      const count = current.items.length;
      if (event.key === "Escape") {
        hidden = true;
        renderer?.element.setAttribute("hidden", "");
        return true;
      }
      if (count === 0) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        selected = (selected + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
        renderer?.updateProps(popupProps());
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        current.command(current.items[selected]);
        return true;
      }
      return false;
    },
    onExit() {
      renderer?.element.remove();
      renderer?.destroy();
      renderer = null;
      current = null;
    },
  };
}

/** the full insert list: block types plus registered top-level components */
export function insertItems(
  specs: UiComponentSpec[],
  media?: MediaProvider,
  math?: boolean,
): SlashItem[] {
  return [...BLOCKS, ...(math ? MATH_ITEMS : []), imageItem(media), ...componentItems(specs)];
}

/**
 * `/` at the start of an empty list-entry name offers the container's row
 * types instead (File, Folder): selecting one replaces the entry, so
 * Enter → `/` → Folder turns a fresh row into a folder.
 */
export function entryItems(
  editor: Editor,
  specs: Map<string, UiComponentSpec>,
): SlashItem[] | null {
  const { $from } = editor.state.selection;
  const depth = listEntryDepth($from, specs);
  if (depth === -1) return null;
  const container = $from.node(depth - 1);
  const containerSpec = specs.get(container.attrs.name as string);
  const children = insertableChildren(containerSpec, specs);
  if (children.length === 0) return null;
  return children.map((spec) => ({
    title: spec.label ?? spec.name,
    group: containerSpec?.label ?? containerSpec?.name ?? "Rows",
    icon: spec.icon,
    run: (current) => {
      const { $from: $at } = current.state.selection;
      const at = listEntryDepth($at, specs);
      if (at === -1) return;
      const start = $at.before(at);
      const end = start + $at.node(at).nodeSize;
      current.chain().focus().insertContentAt({ from: start, to: end }, spec.insert!()).run();
      focusAt(current, start + 1);
    },
  }));
}

/** `/` in a paragraph opens the insert menu: block types plus registered components. */
export function slashMenu(
  components: UiComponentSpec[],
  specMap: Map<string, UiComponentSpec>,
  media?: MediaProvider,
  math?: boolean,
): Extension {
  const all = insertItems(components, media, math);

  return Extension.create({
    name: "fdeSlashMenu",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          pluginKey: new PluginKey("fdeSlash"),
          editor: this.editor,
          char: "/",
          allow: ({ state, range }) => {
            const $pos = state.doc.resolve(range.from);
            if ($pos.parent.type.name === "paragraph") return true;
            // an otherwise-empty list-entry name: offer the row types
            return (
              $pos.parent.type.name === INLINE_REGION_NODE &&
              $pos.parentOffset === 0 &&
              range.to - range.from === $pos.parent.content.size &&
              listEntryDepth($pos, specMap) !== -1
            );
          },
          items: ({ editor, query }) => {
            const pool = entryItems(editor, specMap) ?? all;
            const q = query.toLowerCase();
            return q ? pool.filter((item) => item.title.toLowerCase().includes(q)) : pool;
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: suggestionRender,
        }),
      ];
    },
  });
}
