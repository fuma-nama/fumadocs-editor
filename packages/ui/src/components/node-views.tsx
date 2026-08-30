"use client";
import { Extension as ExtensionBase, type Extension, type Node } from "@tiptap/core";
import {
  MdxBlockRegion,
  MdxComponent,
  MdxInlineRegion,
  type MdxAttribute,
} from "@fumadocs-editor/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { UiComponentSpec } from "./spec";
import { readLiterals, readStringProps, setLiteralProp, setStringProp } from "./attributes";
import { caretPolicy } from "./caret-policy";
import { componentKeymap } from "./keymap";
import { structureGuard } from "./structure";

type SpecMap = Map<string, UiComponentSpec>;

const COMPONENT = "mdxComponent";

/**
 * TipTap's default `stopEvent` swallows any event whose target
 * `isContentEditable`, which silences keydowns from editable areas nested in
 * renderer chrome before ProseMirror sees them. Stop only events on real
 * controls and explicitly marked chrome.
 */
function stopEvent({ event }: { event: Event }): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest("input, button, select, textarea, [data-fde-chrome]") !== null
  );
}

/* ---- node views ---- */

function makeComponentView(specs: SpecMap) {
  return function ComponentNodeView(props: NodeViewProps) {
    const { node, editor, getPos, updateAttributes, selected } = props;
    const name = node.attrs.name as string | null;
    const spec = name ? specs.get(name) : undefined;
    const attributes = (node.attrs.attributes ?? []) as MdxAttribute[];
    // `selected` is true for every node view the selection covers; ring only
    // the node that is itself node-selected, or nested children stack rings
    const ringed =
      selected &&
      editor.state.selection instanceof NodeSelection &&
      editor.state.selection.from === (typeof getPos === "function" ? getPos() : -1);

    if (!spec) {
      return (
        <NodeViewWrapper
          className="relative rounded-[10px] border border-dashed border-fd-border px-3 py-2.5"
          data-component={name ?? ""}
        >
          <NodeViewContent />
        </NodeViewWrapper>
      );
    }

    const Render = spec.render;
    const setProp = (propName: string, value: string) =>
      updateAttributes({ attributes: setStringProp(attributes, propName, value) });
    const setLiteral = (propName: string, value: unknown) =>
      updateAttributes({ attributes: setLiteralProp(attributes, propName, value) });

    return (
      <NodeViewWrapper
        className="relative data-[selected]:rounded-xl data-[selected]:bg-fd-primary/10 data-[selected]:outline-2 data-[selected]:outline-offset-2 data-[selected]:outline-fd-primary/50"
        data-component={name}
        data-selected={ringed || undefined}
      >
        <Render
          props={readStringProps(attributes)}
          literals={readLiterals(attributes)}
          selected={selected}
          setProp={setProp}
          setLiteral={setLiteral}
        >
          <NodeViewContent className="fde-component-content" />
        </Render>
      </NodeViewWrapper>
    );
  };
}

function makeRegionView(kind: "inline" | "block", placeholders: Map<string, string>) {
  return function RegionView({ node, editor, getPos }: NodeViewProps) {
    const region = (node.attrs.region as string | null) ?? "";
    const empty = node.textContent.length === 0;
    // region names (title / body) repeat across components, so the placeholder
    // is keyed by the enclosing component: resolve it from the doc position
    let placeholder = "";
    try {
      const pos = typeof getPos === "function" ? getPos() : null;
      if (typeof pos === "number") {
        const $pos = editor.state.doc.resolve(pos);
        for (let depth = $pos.depth; depth >= 0; depth--) {
          const ancestor = $pos.node(depth);
          if (ancestor.type.name === COMPONENT) {
            placeholder = placeholders.get(`${ancestor.attrs.name}:${region}`) ?? "";
            break;
          }
        }
      }
    } catch {
      /* getPos can throw mid-transaction; fall back to no placeholder */
    }
    return (
      <NodeViewWrapper
        as="div"
        className={`fde-region fde-region-${kind}`}
        data-region={region}
        data-empty={empty || undefined}
        data-placeholder={placeholder}
      >
        <NodeViewContent as="div" />
      </NodeViewWrapper>
    );
  };
}

/** `${component}:${region}` → placeholder text, gathered from every spec */
function collectPlaceholders(specs: UiComponentSpec[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const spec of specs) {
    for (const region of spec.attributeRegions ?? []) {
      if (region.placeholder) map.set(`${spec.name}:${region.region}`, region.placeholder);
    }
    if (spec.childrenRegion?.placeholder) {
      map.set(`${spec.name}:${spec.childrenRegion.region}`, spec.childrenRegion.placeholder);
    }
    if (spec.contentRegion?.placeholder) {
      map.set(`${spec.name}:${spec.contentRegion.region}`, spec.contentRegion.placeholder);
    }
    if (spec.itemsAttribute?.placeholder && spec.childComponent) {
      const names = Array.isArray(spec.childComponent) ? spec.childComponent : [spec.childComponent];
      for (const name of names) {
        map.set(`${name}:${spec.itemsAttribute.childRegion}`, spec.itemsAttribute.placeholder);
      }
    }
  }
  return map;
}

/**
 * Marks the innermost component containing the caret with `data-active` so its
 * control bar can reveal on keyboard/touch focus. Necessary because the whole
 * editor is one contenteditable: putting the caret in a region focuses the
 * ProseMirror root, not the region, so `:focus-within` never reaches these
 * wrappers (only the Callout's nested contenteditable and node-selection do).
 */
const activeComponent = ExtensionBase.create({
  name: "fdeActiveComponent",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            // while a component is node-selected its ring is the one signal;
            // don't also tint the parent
            if (
              state.selection instanceof NodeSelection &&
              state.selection.node.type.name === COMPONENT
            ) {
              return DecorationSet.empty;
            }
            const { $from } = state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === COMPONENT) {
                const pos = $from.before(depth);
                return DecorationSet.create(state.doc, [
                  Decoration.node(pos, pos + node.nodeSize, { "data-active": "" }),
                ]);
              }
            }
            return DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/**
 * TipTap extensions for the component node types, each wired to a React node
 * view. Replaces the base (view-less) nodes from `editorExtensions`.
 */
export function componentExtensions(specs: UiComponentSpec[]): Extension[] {
  const map: SpecMap = new Map(specs.map((spec) => [spec.name, spec]));
  const ComponentView = makeComponentView(map);
  const placeholders = collectPlaceholders(specs);
  const InlineRegionView = makeRegionView("inline", placeholders);
  const BlockRegionView = makeRegionView("block", placeholders);

  return [
    MdxComponent.extend({ addNodeView: () => ReactNodeViewRenderer(ComponentView, { stopEvent }) }),
    MdxInlineRegion.extend({
      addNodeView: () => ReactNodeViewRenderer(InlineRegionView, { stopEvent }),
    }),
    MdxBlockRegion.extend({
      addNodeView: () => ReactNodeViewRenderer(BlockRegionView, { stopEvent }),
    }),
    ...componentKeymap(map),
    structureGuard(map),
    caretPolicy,
    activeComponent,
  ] as unknown as Extension[];
}

export type { Node };
