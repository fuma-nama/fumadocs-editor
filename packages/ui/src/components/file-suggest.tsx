"use client";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { FileText } from "lucide-react";
import { INLINE_REGION_NODE, componentRegions } from "@fumadocs-editor/core/extensions";
import { SlashPopup, suggestionRender, type PopupProps, type SlashItem } from "../slash-menu";
import type { UiComponentSpec } from "./spec";
import type { EditorProviders, FileProvider } from "./media";

interface ActivePath {
  from: number;
  to: number;
  query: string;
}

function activePath(state: EditorState, specs: Map<string, UiComponentSpec>): ActivePath | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  for (let depth = $from.depth; depth > 1; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== INLINE_REGION_NODE) continue;
    const spec = specs.get($from.node(depth - 1).type.name)!;
    const region = componentRegions(spec, specs)[$from.index(depth - 1)];
    if (spec.filePathRegion !== region.region) return null;
    const from = $from.start(depth);
    return { from, to: from + node.content.size, query: node.textContent };
  }
  return null;
}

export function fileSuggest(
  specs: Map<string, UiComponentSpec>,
  providers: EditorProviders,
): Extension {
  return Extension.create({
    name: "fdeFileSuggest",
    addProseMirrorPlugins() {
      const editor = this.editor;
      const key = new PluginKey("fdeFileSuggest");
      let listed: FileProvider | undefined; // the provider `paths` came from
      let paths: string[] = [];
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

      const popupProps = (view: {
        coordsAtPos(pos: number): { left: number; top: number; bottom: number };
      }): PopupProps => ({
        items: items.map((path): SlashItem => ({
          title: path,
          group: "Files",
          icon: <FileText size={15} />,
          mono: true,
          run: () => apply(path),
        })),
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
              const { files } = providers;
              if (!active || !files) {
                dismissed = null;
                hide();
                return;
              }
              if (listed !== files) {
                listed = files;
                paths = [];
                void files.list().then((list) => {
                  if (editor.isDestroyed || listed !== files) return;
                  paths = list;
                  view.dispatch(view.state.tr.setMeta(key, "refresh"));
                });
              }
              if (dismissed !== null && dismissed !== active.query) dismissed = null;
              const query = active.query.toLowerCase();
              items = paths.filter((path) => path.toLowerCase().includes(query));
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
              view.dom.parentElement!.appendChild(renderer.element);
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

export function linkSuggest(providers: EditorProviders): Extension {
  let listed: FileProvider | undefined;
  let paths: string[] = [];

  const insert = (path: string) => (editor: Editor, range: Range) => {
    const name = path.replace(/^\.\//, "").replace(/\.mdx?$/, "");
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContentAt(range.from, {
        type: "text",
        text: name,
        marks: [{ type: "link", attrs: { href: path } }],
      })
      // continued typing must not extend the link
      .unsetMark("link")
      .run();
  };

  return Extension.create({
    name: "fdeLinkSuggest",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          pluginKey: new PluginKey("fdeLinkSuggest"),
          editor: this.editor,
          char: "[[",
          allow: ({ state, range }) => {
            if (!providers.files) return false;
            const $pos = state.doc.resolve(range.from);
            if (!$pos.parent.type.allowsMarkType(state.schema.marks.link)) return false;
            // attribute regions serialize to plain strings: no links there
            for (let depth = $pos.depth; depth > 0; depth--) {
              if ($pos.node(depth).type.name === INLINE_REGION_NODE) return false;
            }
            return true;
          },
          items: async ({ query }) => {
            const { files } = providers;
            if (!files) return [];
            if (listed !== files) {
              listed = files;
              paths = await files.list();
            }
            const q = query.toLowerCase();
            const matches = q ? paths.filter((path) => path.toLowerCase().includes(q)) : paths;
            return matches.map((path) => ({
              title: path,
              group: "Link to page",
              icon: <FileText size={15} />,
              mono: true,
              run: insert(path),
            }));
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: suggestionRender,
        }),
      ];
    },
  });
}
