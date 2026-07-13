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
import { Popover } from '@base-ui/react/popover';
import { Switch } from '@base-ui/react/switch';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { PropField } from '@fumadocs-editor/core';
import type { UiComponentSpec } from './spec';
import { focusRing, itemCls, itemIndicatorCls, popupCls } from './styles';

type SpecMap = Map<string, UiComponentSpec>;

const controlBarCls =
  'pointer-events-none absolute -top-3.5 end-2.5 z-[3] flex translate-y-0.5 items-center gap-1.5 rounded-[9px] border border-fd-border bg-fd-popover px-1.5 py-1 text-fd-popover-foreground opacity-0 shadow-lg transition-[opacity,transform] group-hover/component:pointer-events-auto group-hover/component:translate-y-0 group-hover/component:opacity-100 group-focus-within/component:pointer-events-auto group-focus-within/component:translate-y-0 group-focus-within/component:opacity-100 group-data-[selected]/component:pointer-events-auto group-data-[selected]/component:opacity-100';

const propTriggerCls =
  `inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-md border border-fd-border bg-fd-background px-2 text-xs capitalize transition-colors hover:bg-fd-accent data-[popup-open]:bg-fd-accent ${focusRing}`;

const propInputCls =
  `h-7 w-full rounded-md border border-fd-border bg-fd-background px-2 text-[13px] text-fd-foreground outline-none transition-colors placeholder:text-fd-muted-foreground/60 focus-visible:border-fd-ring ${focusRing}`;

const propSelectCls =
  `inline-flex h-7 w-full cursor-pointer items-center justify-between gap-1 rounded-md border border-fd-border bg-fd-background px-2 text-[13px] capitalize text-fd-foreground transition-colors hover:bg-fd-accent ${focusRing}`;

const switchRootCls =
  `relative flex h-5 w-8 shrink-0 cursor-pointer rounded-full bg-fd-border p-0.5 transition-colors data-[checked]:bg-fd-primary ${focusRing}`;

const switchThumbCls =
  'aspect-square h-full rounded-full bg-fd-background shadow-sm transition-[translate] data-[checked]:translate-x-3';

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

/** A single labelled control inside the attributes popover. */
function PropControl({
  field,
  value,
  onChange,
}: {
  field: PropField;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = field.label ?? field.name;

  if (field.type === 'enum') {
    const items = (field.options ?? []).map((option) => ({ value: option, label: option }));
    const current = value || String(field.default ?? field.options?.[0] ?? '');
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-fd-muted-foreground">{label}</span>
        <Select.Root items={items} value={current} onValueChange={(next) => onChange(next as string)}>
          <Select.Trigger className={propSelectCls}>
            <Select.Value />
            <ChevronDown size={13} className="shrink-0 text-fd-muted-foreground" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner sideOffset={4}>
              <Select.Popup className={popupCls}>
                {items.map((item) => (
                  <Select.Item key={item.value} value={item.value} className={itemCls}>
                    <Select.ItemIndicator className={itemIndicatorCls}>
                      <Check size={14} />
                    </Select.ItemIndicator>
                    <Select.ItemText>{item.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </label>
    );
  }

  if (field.type === 'boolean') {
    const checked = value === '' ? Boolean(field.default) : value === 'true';
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-fd-muted-foreground">{label}</span>
        <Switch.Root
          className={switchRootCls}
          checked={checked}
          onCheckedChange={(next) => onChange(next ? 'true' : 'false')}
        >
          <Switch.Thumb className={switchThumbCls} />
        </Switch.Root>
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-fd-muted-foreground">{label}</span>
      <input
        className={propInputCls}
        type={field.type === 'number' ? 'number' : 'text'}
        value={value}
        placeholder={field.placeholder ?? label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

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
  // props handled in place by the renderer are hidden from the generic panel
  const fields = (spec.props ?? []).filter((field) => !field.inline);
  return (
    <div className={controlBarCls} contentEditable={false}>
      <span className="inline-flex items-center gap-1 px-0.5 font-mono text-[11px] font-semibold text-fd-muted-foreground">
        {spec.icon}
        {spec.title ?? spec.name}
      </span>
      {fields.length > 0 && (
        <Popover.Root>
          <Popover.Trigger className={propTriggerCls}>
            <SlidersHorizontal size={12} />
            <span className="normal-case">Attributes</span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={6} align="end">
              <Popover.Popup
                className={`${popupCls} flex w-64 flex-col gap-3 p-3`}
                // keep clicks inside the popover from stealing the node selection
                onMouseDown={(event) => event.stopPropagation()}
              >
                <p className="text-[11px] font-semibold tracking-wide text-fd-muted-foreground uppercase">
                  {spec.title ?? spec.name} attributes
                </p>
                {fields.map((field) => (
                  <PropControl
                    key={field.name}
                    field={field}
                    value={values[field.name] ?? ''}
                    onChange={(value) => onChange(setStringProp(attributes, field.name, value))}
                  />
                ))}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
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
        <NodeViewWrapper
          className="relative rounded-[10px] border border-dashed border-fd-border px-3 py-2.5"
          data-component={name ?? ''}
        >
          <NodeViewContent />
        </NodeViewWrapper>
      );
    }

    const Render = spec.render;
    const setProp = (propName: string, value: string) =>
      updateAttributes({ attributes: setStringProp(attributes, propName, value) });
    return (
      <NodeViewWrapper
        className="group/component relative data-[selected]:rounded-xl data-[selected]:outline-2 data-[selected]:outline-offset-2 data-[selected]:outline-fd-ring"
        data-component={name}
        data-selected={selected || undefined}
      >
        <PropsPanel
          spec={spec}
          attributes={attributes}
          onChange={(next) => updateAttributes({ attributes: next })}
        />
        <Render props={readStringProps(attributes)} selected={selected} setProp={setProp}>
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
