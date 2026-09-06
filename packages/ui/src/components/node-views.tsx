"use client";
import * as stylex from "@stylexjs/stylex";
import { Extension, type Extensions, type NodeViewRenderer } from "@tiptap/core";
import {
  MdxBlockRegion,
  MdxInlineRegion,
  componentNodeTypes,
  componentRegions,
  isComponent,
  type MdxAttribute,
} from "@fumadocs-editor/core/extensions";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { memo } from "react";
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
const NO_ATTRIBUTES: MdxAttribute[] = [];

// an edit inside a region rebuilds the component node but keeps its `attrs`
// object, so the renderer sits out every keystroke that is not its own
const Rendered = memo(function Rendered({
  spec,
  attributes,
  selected,
  updateAttributes,
}: {
  spec: UiComponentSpec;
  attributes: MdxAttribute[];
  selected: boolean;
  updateAttributes: NodeViewProps["updateAttributes"];
}) {
  const Render = spec.render;
  return (
    <Render
      props={readStringProps(attributes)}
      literals={readLiterals(attributes)}
      selected={selected}
      setProp={(name, value) =>
        updateAttributes({ attributes: setStringProp(attributes, name, value) })
      }
      setLiteral={(name, value) =>
        updateAttributes({ attributes: setLiteralProp(attributes, name, value) })
      }
    >
      {hole}
    </Render>
  );
});

function makeComponentView(specs: SpecMap) {
  return function ComponentNodeView(props: NodeViewProps) {
    const { node, updateAttributes, selected } = props;
    const spec = specs.get(node.type.name)!;
    return (
      <NodeViewWrapper
        {...stylex.props(content.nodeWrapper)}
        data-component={spec.name}
        data-selected={isRinged(props) || undefined}
      >
        <RenderBoundary
          resetOn={node}
          fallback={<FallbackCard name={spec.name}>{hole}</FallbackCard>}
        >
          <Rendered
            spec={spec}
            attributes={(node.attrs.attributes as MdxAttribute[] | undefined) ?? NO_ATTRIBUTES}
            selected={selected}
            updateAttributes={updateAttributes}
          />
        </RenderBoundary>
      </NodeViewWrapper>
    );
  };
}

/** a plain node view: the region is its own content element, no React tree per region */
function makeRegionView(kind: "inline" | "block", specs: SpecMap): NodeViewRenderer {
  const base = stylex.props(content.region, kind === "block" && content.regionBlock).className!;
  return ({ node, editor, getPos }) => {
    const dom = document.createElement("div");
    const pos = getPos();
    const $pos = pos == null ? null : editor.state.doc.resolve(pos);
    const spec = $pos ? specs.get($pos.parent.type.name) : undefined;
    const region = spec ? componentRegions(spec, specs)[$pos!.index()] : undefined;
    const own = region && spec!.regions?.[region.region];
    dom.className = own ? `${base} ${own}` : base;
    dom.dataset.region = region?.region ?? "";
    const sync = (current: PMNode) => {
      const empty = current.textContent.length === 0;
      dom.toggleAttribute("data-empty", empty);
      if (empty && region?.placeholder) dom.dataset.placeholder = region.placeholder;
      else delete dom.dataset.placeholder;
    };
    sync(node);
    return {
      dom,
      contentDOM: dom,
      update(next) {
        if (next.type !== node.type) return false;
        sync(next);
        return true;
      },
    };
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
  const inlineRegion = makeRegionView("inline", specs);
  const blockRegion = makeRegionView("block", specs);

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
    MdxInlineRegion.extend({ addNodeView: () => inlineRegion }),
    MdxBlockRegion.extend({ addNodeView: () => blockRegion }),
    ...componentKeymap(specs),
    structureGuard(specs),
    caretPolicy,
    activeComponent,
  );
  return extensions;
}
