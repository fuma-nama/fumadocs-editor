"use client";
import * as stylex from "@stylexjs/stylex";
import { Extension as ExtensionBase, type Editor, type Extension, type Node } from "@tiptap/core";
import {
  MdxBlockRegion,
  MdxComponent,
  MdxInlineRegion,
  type MdxAttribute,
} from "@fumadocs-editor/core/extensions";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { UiComponentSpec } from "./spec";
import { FallbackCard, RenderBoundary } from "../static-mdx";
import { readLiterals, readStringProps, setLiteralProp, setStringProp } from "./attr-values";
import { caretPolicy } from "./caret-policy";
import { componentKeymap } from "./keymap";
import { nodeViewOptions } from "./node-view-options";
import { structureGuard } from "./structure";
import { content, contentClass } from "../styles/content";

type SpecMap = Map<string, UiComponentSpec>;

const COMPONENT = "mdxComponent";

/* ---- node views ---- */

const hole = <NodeViewContent {...stylex.props(content.hole)} data-fde-hole="" />;

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
        <NodeViewWrapper {...stylex.props(content.nodeWrapper)} data-component={name ?? ""}>
          <FallbackCard name={name ?? ""}>{hole}</FallbackCard>
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
        {...stylex.props(content.nodeWrapper)}
        data-component={name}
        data-selected={ringed || undefined}
      >
        <RenderBoundary
          resetOn={node}
          fallback={<FallbackCard name={spec.name}>{hole}</FallbackCard>}
        >
          <Render
            props={readStringProps(attributes)}
            literals={readLiterals(attributes)}
            selected={selected}
            setProp={setProp}
            setLiteral={setLiteral}
          >
            {hole}
          </Render>
        </RenderBoundary>
      </NodeViewWrapper>
    );
  };
}

function makeRegionView(
  kind: "inline" | "block",
  specs: SpecMap,
  placeholders: Map<string, string>,
) {
  return function RegionView({ node, editor, getPos }: NodeViewProps) {
    const region = (node.attrs.region as string | null) ?? "";
    const empty = node.textContent.length === 0;
    // region names (title / body) repeat across components, so placeholder
    // and styles are keyed by the enclosing component: resolve it from the
    // doc position
    let placeholder: string | undefined;
    let className: string | undefined;
    try {
      const pos = typeof getPos === "function" ? getPos() : null;
      if (typeof pos === "number") {
        const $pos = editor.state.doc.resolve(pos);
        for (let depth = $pos.depth; depth >= 0; depth--) {
          const ancestor = $pos.node(depth);
          if (ancestor.type.name === COMPONENT) {
            const name = ancestor.attrs.name as string;
            placeholder = placeholders.get(`${name}:${region}`);
            className = specs.get(name)?.regions?.[region];
            break;
          }
        }
      }
    } catch {
      /* getPos can throw mid-transaction; fall back to no placeholder */
    }
    const sx = stylex.props(content.region, kind === "block" && content.regionBlock);
    return (
      <NodeViewWrapper
        as="div"
        className={className ? `${sx.className} ${className}` : sx.className}
        data-region={region}
        data-empty={empty || undefined}
        data-placeholder={empty && placeholder ? placeholder : undefined}
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
      const names = Array.isArray(spec.childComponent)
        ? spec.childComponent
        : [spec.childComponent];
      for (const name of names) {
        map.set(`${name}:${spec.itemsAttribute.childRegion}`, spec.itemsAttribute.placeholder);
      }
    }
  }
  return map;
}

/**
 * Marks the innermost component containing the caret with `data-active` so
 * its control bar can reveal on keyboard/touch focus. The editor is one
 * contenteditable: putting the caret in a region focuses the PM root, not
 * the region, so `:focus-within` never reaches these wrappers.
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

const liftKey = new PluginKey<number | null>("fdeLift");

/** light the block at `pos` (none when null): the joystick's target */
export function setLifted(editor: Editor, pos: number | null): void {
  if (liftKey.getState(editor.state) === pos) return;
  editor.view.dispatch(editor.state.tr.setMeta(liftKey, pos));
}

/**
 * The block a joystick would drag, lit while its handle is hovered or held.
 * A decoration, not a class on the node's DOM: ProseMirror owns that DOM
 * and redraws it. Any edit clears it; the handle lights again on its own.
 */
const liftedBlock = ExtensionBase.create({
  name: "fdeLiftedBlock",
  addProseMirrorPlugins() {
    return [
      new Plugin<number | null>({
        key: liftKey,
        state: {
          init: () => null,
          apply(tr, pos) {
            const meta = tr.getMeta(liftKey) as number | null | undefined;
            if (meta !== undefined) return meta;
            return tr.docChanged ? null : pos;
          },
        },
        props: {
          decorations(state) {
            const pos = liftKey.getState(state);
            if (pos == null) return DecorationSet.empty;
            const node = state.doc.nodeAt(pos);
            if (!node) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.node(pos, pos + node.nodeSize, { class: contentClass.lifted }),
            ]);
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
  const InlineRegionView = makeRegionView("inline", map, placeholders);
  const BlockRegionView = makeRegionView("block", map, placeholders);

  return [
    MdxComponent.extend({
      // the wrapper is what ProseMirror marks draggable on mousedown; its
      // styles (own paint layer, insert motion) are `content.component`
      addNodeView: () =>
        ReactNodeViewRenderer(ComponentView, {
          ...nodeViewOptions,
          className: contentClass.component,
        }),
    }),
    MdxInlineRegion.extend({
      addNodeView: () => ReactNodeViewRenderer(InlineRegionView, nodeViewOptions),
    }),
    MdxBlockRegion.extend({
      addNodeView: () => ReactNodeViewRenderer(BlockRegionView, nodeViewOptions),
    }),
    ...componentKeymap(map),
    structureGuard(map),
    caretPolicy,
    activeComponent,
    liftedBlock,
  ] as unknown as Extension[];
}

export type { Node };
