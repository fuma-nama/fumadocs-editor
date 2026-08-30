"use client";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import { FileText } from "lucide-react";
import { COMPONENT_NODE, INLINE_REGION_NODE } from "@fumadocs-editor/core";
import { SlashPopup, type PopupProps, type SlashItem } from "../slash-menu";
import type { UiComponentSpec } from "./spec";
import type { FileProvider } from "./media";

interface ActivePath {
  /** region content range (the path text) */
  from: number;
  to: number;
  query: string;
}

/** the caret sits inside a region a spec declares as a file path */
function activePath(
  state: EditorState,
  specs: Map<string, UiComponentSpec>,
): ActivePath | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  for (let depth = $from.depth; depth > 1; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== INLINE_REGION_NODE) continue;
    const component = $from.node(depth - 1);
    if (component.type.name !== COMPONENT_NODE) return null;
    const spec = specs.get(component.attrs.name as string);
    if (!spec || spec.filePathRegion !== node.attrs.region) return null;
    const from = $from.start(depth);
    return { from, to: from + node.content.size, query: node.textContent };
  }
  return null;
}

/**
 * In-place autocomplete for file-path regions (the include path): the region
 * itself is the input. While the caret is inside one, the host's FileProvider
 * suggests matching files below it; Enter or a click replaces the region
 * text. Free-form typing is untouched — the popup only appears on matches.
 */
export function fileSuggest(
  specs: Map<string, UiComponentSpec>,
  files: FileProvider,
): Extension {
  return Extension.create({
    name: "fdeFileSuggest",
    addProseMirrorPlugins() {
      const editor = this.editor;
      const key = new PluginKey("fdeFileSuggest");
      let paths: string[] | null = null;
      let renderer: ReactRenderer<unknown, PopupProps> | null = null;
      let active: ActivePath | null = null;
      let items: string[] = [];
      let selected = 0;
      let dismissed: string | null = null; // Escape hides until the query changes

      const apply = (path: string) => {
        if (!active) return;
        const { from, to } = active;
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.replaceWith(from, to, editor.schema.text(path));
            return true;
          })
          .setTextSelection(from + path.length)
          .run();
      };

      const popupProps = (view: { coordsAtPos(pos: number): { left: number; top: number; bottom: number } }): PopupProps => ({
        items: items.map(
          (path): SlashItem => ({
            title: path,
            group: "Files",
            icon: <FileText size={15} />,
            run: () => apply(path),
          }),
        ),
        selected,
        rect: active ? view.coordsAtPos(active.from) : null,
        onSelect: (index) => apply(items[index]),
      });

      const hide = () => {
        renderer?.element.remove();
        renderer?.destroy();
        renderer = null;
      };

      return [
        new Plugin({
          key,
          view: () => ({
            update: (view) => {
              active = activePath(view.state, specs);
              if (!active) {
                dismissed = null;
                hide();
                return;
              }
              if (paths == null) {
                paths = [];
                void files.list().then((list) => {
                  paths = list;
                  // re-enter update with the loaded list
                  view.dispatch(view.state.tr.setMeta(key, "refresh"));
                });
              }
              if (dismissed !== null && dismissed !== active.query) dismissed = null;
              const query = active.query.toLowerCase();
              items = paths.filter((path) => path.toLowerCase().includes(query));
              // the exact path is already written: nothing left to suggest
              if (items.length === 1 && items[0] === active.query) items = [];
              if (items.length === 0 || dismissed !== null) {
                hide();
                return;
              }
              if (selected >= items.length) selected = 0;
              if (renderer) {
                renderer.updateProps(popupProps(view));
                return;
              }
              selected = 0;
              renderer = new ReactRenderer(SlashPopup, {
                editor,
                props: popupProps(view),
              });
              const host = view.dom.closest("[data-fde-root]") ?? document.body;
              host.appendChild(renderer.element);
            },
            destroy: hide,
          }),
          props: {
            handleKeyDown: (view, event) => {
              if (!renderer || !active) return false;
              if (event.key === "Escape") {
                dismissed = active.query;
                hide();
                return true;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const step = event.key === "ArrowDown" ? 1 : items.length - 1;
                selected = (selected + step) % items.length;
                renderer.updateProps(popupProps(view));
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                apply(items[selected]);
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  });
}
