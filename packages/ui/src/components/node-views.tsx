"use client";
import * as stylex from "@stylexjs/stylex";
import { Extension, type Extensions, type Node } from "@tiptap/core";
import {
  MdxBlockRegion,
  MdxInlineRegion,
  componentNodeTypes,
  type MdxAttribute,
} from "@fumadocs-editor/core/extensions";
import { componentRegions, isComponent, type ComponentRegion } from "@fumadocs-editor/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { UiComponentSpec } from "./spec";
import { FallbackCard, RenderBoundary } from "../static-mdx";
import { readLiterals, readStringProps, setLiteralProp, setStringProp } from "./attr-values";
import { caretPolicy } from "./caret-policy";
import { componentKeymap } from "./keymap";
import { isRinged, nodeViewOptions } from "./node-view-options";
import { structureGuard } from "./structure";
import { content, contentClass } from "../styles/content";

type SpecMap = Map<string, UiComponentSpec>;

const hole = <NodeViewContent {...stylex.props(content.hole)} data-fde-hole="" />;

function makeComponentView(specs: SpecMap) {
  return function ComponentNodeView(props: NodeViewProps) {
    const { node, updateAttributes, selected } = props;
    const spec = specs.get(node.type.name)!;
    const attributes = (node.attrs.attributes ?? []) as MdxAttribute[];
    const ringed = isRinged(props);

    const Render = spec.render;
    const setProp = (propName: string, value: string) =>
      updateAttributes({ attributes: setStringProp(attributes, propName, value) });
    const setLiteral = (propName: string, value: unknown) =>
      updateAttributes({ attributes: setLiteralProp(attributes, propName, value) });

    return (
      <NodeViewWrapper
        {...stylex.props(content.nodeWrapper)}
        data-component={spec.name}
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

function makeRegionView(kind: "inline" | "block", specs: SpecMap) {
  return function RegionView({ node, editor, getPos }: NodeViewProps) {
    const empty = node.textContent.length === 0;
    let region: ComponentRegion | undefined;
    let className: string | undefined;
    try {
      const pos = getPos();
      if (pos != null) {
        const $pos = editor.state.doc.resolve(pos);
        const spec = specs.get($pos.parent.type.name)!;
        region = componentRegions(spec, specs)[$pos.index()];
        className = spec.regions?.[region.region];
      }
    } catch {
      /* getPos can throw mid-transaction; fall back to no placeholder */
    }
    const sx = stylex.props(content.region, kind === "block" && content.regionBlock);
    return (
      <NodeViewWrapper
        as="div"
        className={className ? `${sx.className} ${className}` : sx.className}
        data-region={region?.region ?? ""}
        data-empty={empty || undefined}
        data-placeholder={empty && region?.placeholder ? region.placeholder : undefined}
      >
        <NodeViewContent as="div" />
      </NodeViewWrapper>
    );
  };
}

/**
 * Marks the innermost component containing the caret with `data-active` so
 * its control bar can reveal on keyboard/touch focus. The editor is one
 * contenteditable: putting the caret in a region focuses the PM root, not
 * the region, so `:focus-within` never reaches these wrappers.
 */
const activeComponent = Extension.create({
  name: "fdeActiveComponent",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            if (
              state.selection instanceof NodeSelection &&
              isComponent(state.selection.node.type)
            ) {
              return DecorationSet.empty;
            }
            const { $from } = state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (isComponent(node.type)) {
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

export function componentExtensions(specs: SpecMap): Extensions {
  const ComponentView = makeComponentView(specs);
  const InlineRegionView = makeRegionView("inline", specs);
  const BlockRegionView = makeRegionView("block", specs);

  const extensions: Extensions = [];
  for (const type of componentNodeTypes(specs.values())) {
    extensions.push(
      type.extend({
        // the wrapper is what ProseMirror marks draggable on mousedown; its
        // styles (own paint layer, insert motion) are `content.component`
        addNodeView: () =>
          ReactNodeViewRenderer(ComponentView, {
            ...nodeViewOptions,
            className: contentClass.component,
          }),
      }),
    );
  }
  extensions.push(
    MdxInlineRegion.extend({
      addNodeView: () => ReactNodeViewRenderer(InlineRegionView, nodeViewOptions),
    }),
    MdxBlockRegion.extend({
      addNodeView: () => ReactNodeViewRenderer(BlockRegionView, nodeViewOptions),
    }),
    ...componentKeymap(specs),
    structureGuard(specs),
    caretPolicy,
    activeComponent,
  );
  return extensions;
}

export type { Node };
