"use client";
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
  SquareCode,
  TextQuote,
} from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { INLINE_REGION_NODE } from "@fumadocs-editor/core";
import type { UiComponentSpec } from "./components/spec";
import {
  childOnlyNames,
  focusAt,
  insertableChildren,
  listEntryDepth,
  type SpecMap,
} from "./components/keymap";
import { itemCls, popupCls } from "./components/styles";

export interface SlashItem {
  title: string;
  group: string;
  icon?: ReactNode;
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
];

/** every spec with an insert, minus child-only specs (File, Card, Step, …) */
function componentItems(specs: UiComponentSpec[]): SlashItem[] {
  const childOnly = childOnlyNames(specs);
  const items: SlashItem[] = [];
  for (const spec of specs) {
    if (!spec.insert || childOnly.has(spec.name)) continue;
    items.push({
      title: spec.title ?? spec.name,
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

interface PopupProps {
  items: SlashItem[];
  selected: number;
  rect: { left: number; top: number; bottom: number } | null;
  onSelect: (index: number) => void;
}

function SlashPopup({ items, selected, rect, onSelect }: PopupProps) {
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
    <div ref={ref} className={`${popupCls} fixed z-50 max-h-72 w-52 overflow-y-auto`}>
      {items.length === 0 && (
        <p className="px-2 py-1.5 text-[13px] text-fd-muted-foreground">No results</p>
      )}
      {items.map((item, index) => (
        <div key={item.title}>
          {(index === 0 || items[index - 1].group !== item.group) && (
            <p className="px-2 pt-1.5 pb-0.5 text-[10.5px] font-semibold tracking-wide text-fd-muted-foreground uppercase">
              {item.group}
            </p>
          )}
          <button
            type="button"
            data-index={index}
            className={`${itemCls} w-full`}
            data-highlighted={index === selected || undefined}
            // preserve the editor selection; select on mouseup like a menu item
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(index)}
          >
            <span className="inline-flex w-4 shrink-0 justify-center text-fd-muted-foreground">
              {item.icon}
            </span>
            <span>{item.title}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

/** the full insert list: block types plus registered top-level components */
export function insertItems(specs: UiComponentSpec[]): SlashItem[] {
  return [...BLOCKS, ...componentItems(specs)];
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
  const depth = listEntryDepth($from, specs as SpecMap);
  if (depth === -1) return null;
  const container = $from.node(depth - 1);
  const containerSpec = specs.get(container.attrs.name as string);
  const children = insertableChildren(containerSpec, specs);
  if (children.length === 0) return null;
  return children.map((spec) => ({
    title: spec.title ?? spec.name,
    group: containerSpec?.title ?? containerSpec?.name ?? "Rows",
    icon: spec.icon,
    run: (current) => {
      const { $from: $at } = current.state.selection;
      const at = listEntryDepth($at, specs as SpecMap);
      if (at === -1) return;
      const start = $at.before(at);
      const end = start + $at.node(at).nodeSize;
      current.chain().focus().insertContentAt({ from: start, to: end }, spec.insert!()).run();
      focusAt(current, start + 1);
    },
  }));
}

/** `/` in a paragraph opens the insert menu: block types plus registered components. */
export function slashMenu(specs: UiComponentSpec[]): Extension {
  const all = insertItems(specs);
  const specMap = new Map(specs.map((spec) => [spec.name, spec]));

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
              listEntryDepth($pos, specMap as SpecMap) !== -1
            );
          },
          items: ({ editor, query }) => {
            const pool = entryItems(editor, specMap) ?? all;
            const q = query.toLowerCase();
            return q ? pool.filter((item) => item.title.toLowerCase().includes(q)) : pool;
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => {
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
                document.body.appendChild(renderer.element);
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
          },
        }),
      ];
    },
  });
}
