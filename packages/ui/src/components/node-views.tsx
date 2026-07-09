'use client';
import type { Extension, Node } from '@tiptap/core';
import {
  MdxBlockRegion,
  MdxComponent,
  MdxInlineRegion,
  type MdxAttribute,
} from '@fumadocs-editor/core';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import type { UiComponentSpec } from './spec';

type SpecMap = Map<string, UiComponentSpec>;

/* ---- attribute helpers (attributes round-trip as an MdxAttribute[]) ---- */

function readStringProps(attributes: MdxAttribute[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of attributes) {
    if (attr.type === 'mdxJsxAttribute' && typeof attr.value === 'string') {
      out[attr.name] = attr.value;
    }
  }
  return out;
}

function setStringProp(attributes: MdxAttribute[], name: string, value: string): MdxAttribute[] {
  let replaced = false;
  const next = attributes.map((attr) => {
    if (attr.type === 'mdxJsxAttribute' && attr.name === name) {
      replaced = true;
      return { ...attr, value };
    }
    return attr;
  });
  if (!replaced) next.push({ type: 'mdxJsxAttribute', name, value });
  return next;
}

/* ---- props panel ---- */

function PropsPanel({
  spec,
  attributes,
  onChange,
}: {
  spec: UiComponentSpec;
  attributes: MdxAttribute[];
  onChange: (attributes: MdxAttribute[]) => void;
}) {
  const values = readStringProps(attributes);
  return (
    <div className="fde-component-toolbar" contentEditable={false}>
      <span className="fde-component-tag">{spec.title ?? spec.name}</span>
      {(spec.props ?? []).map((field) => {
        if (field.type === 'enum') {
          const items = (field.options ?? []).map((value) => ({ value, label: value }));
          const current = values[field.name] ?? String(field.default ?? field.options?.[0] ?? '');
          return (
            <Select.Root
              key={field.name}
              items={items}
              value={current}
              onValueChange={(value) => onChange(setStringProp(attributes, field.name, value as string))}
            >
              <Select.Trigger className="fde-prop-trigger">
                <Select.Value />
                <ChevronDown size={12} />
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner sideOffset={4}>
                  <Select.Popup className="fde-popup">
                    {items.map((item) => (
                      <Select.Item key={item.value} value={item.value} className="fde-item">
                        <Select.ItemIndicator className="fde-item-indicator">
                          <Check size={14} />
                        </Select.ItemIndicator>
                        <Select.ItemText>{item.label}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          );
        }
        return (
          <label key={field.name} className="fde-prop-field">
            <span>{field.label ?? field.name}</span>
            <input
              className="fde-prop-input"
              value={values[field.name] ?? ''}
              placeholder={field.label ?? field.name}
              onChange={(event) => onChange(setStringProp(attributes, field.name, event.target.value))}
            />
          </label>
        );
      })}
    </div>
  );
}

/* ---- node views ---- */

function makeComponentView(specs: SpecMap) {
  return function ComponentNodeView(props: NodeViewProps) {
    const { node, updateAttributes, selected } = props;
    const name = node.attrs.name as string | null;
    const spec = name ? specs.get(name) : undefined;
    const attributes = (node.attrs.attributes ?? []) as MdxAttribute[];

    if (!spec) {
      return (
        <NodeViewWrapper className="fde-component fde-component-generic" data-component={name ?? ''}>
          <NodeViewContent />
        </NodeViewWrapper>
      );
    }

    const Render = spec.render;
    return (
      <NodeViewWrapper
        className="fde-component"
        data-component={name}
        data-selected={selected || undefined}
      >
        {spec.props && spec.props.length > 0 ? (
          <PropsPanel
            spec={spec}
            attributes={attributes}
            onChange={(next) => updateAttributes({ attributes: next })}
          />
        ) : null}
        <Render props={readStringProps(attributes)} selected={selected}>
          <NodeViewContent className="fde-component-content" />
        </Render>
      </NodeViewWrapper>
    );
  };
}

function makeRegionView(kind: 'inline' | 'block', placeholders: Map<string, string>) {
  return function RegionView({ node }: NodeViewProps) {
    const region = (node.attrs.region as string | null) ?? '';
    const empty = node.textContent.length === 0;
    return (
      <NodeViewWrapper
        as="div"
        className={`fde-region fde-region-${kind}`}
        data-region={region}
        data-empty={empty || undefined}
        data-placeholder={placeholders.get(region) ?? ''}
      >
        <NodeViewContent as="div" />
      </NodeViewWrapper>
    );
  };
}

/** region name → placeholder text, gathered from every spec */
function collectPlaceholders(specs: UiComponentSpec[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const spec of specs) {
    for (const region of spec.attributeRegions ?? []) {
      if (region.placeholder) map.set(region.region, region.placeholder);
    }
    if (spec.childrenRegion?.placeholder) {
      map.set(spec.childrenRegion.region, spec.childrenRegion.placeholder);
    }
  }
  return map;
}

/**
 * TipTap extensions for the component node types, each wired to a React node
 * view. Replaces the base (view-less) nodes from `editorExtensions`.
 */
export function componentExtensions(specs: UiComponentSpec[]): Extension[] {
  const map: SpecMap = new Map(specs.map((spec) => [spec.name, spec]));
  const ComponentView = makeComponentView(map);
  const placeholders = collectPlaceholders(specs);
  const InlineRegionView = makeRegionView('inline', placeholders);
  const BlockRegionView = makeRegionView('block', placeholders);

  return [
    MdxComponent.extend({ addNodeView: () => ReactNodeViewRenderer(ComponentView) }),
    MdxInlineRegion.extend({ addNodeView: () => ReactNodeViewRenderer(InlineRegionView) }),
    MdxBlockRegion.extend({ addNodeView: () => ReactNodeViewRenderer(BlockRegionView) }),
  ] as unknown as Extension[];
}

export type { Node };
