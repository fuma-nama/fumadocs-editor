'use client';
import { Extension as ExtensionBase, type Editor, type Extension, type Node } from '@tiptap/core';
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
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Select } from '@base-ui/react/select';
import { Popover } from '@base-ui/react/popover';
import { Switch } from '@base-ui/react/switch';
import { Check, ChevronDown, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { PropField } from '@fumadocs-editor/core';
import type { UiComponentSpec } from './spec';
import { focusRing, itemCls, itemIndicatorCls, popupCls } from './styles';

type SpecMap = Map<string, UiComponentSpec>;

const COMPONENT = 'mdxComponent';
const INLINE_REGION = 'mdxInlineRegion';

/* visibility (innermost-hovered component only) lives in css/preset.css */
const controlBarCls =
  'fde-component-bar absolute -top-3.5 end-2.5 z-[3] flex items-center gap-1 rounded-[9px] border border-fd-border bg-fd-popover px-1.5 py-1 text-fd-popover-foreground shadow-lg';

const barButtonCls =
  `inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-fd-border bg-fd-background px-1.5 text-xs transition-colors hover:bg-fd-accent data-[popup-open]:bg-fd-accent ${focusRing}`;

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

/* ---- spec helpers ---- */

function childNames(spec: UiComponentSpec | undefined): string[] {
  if (!spec?.childComponent) return [];
  return Array.isArray(spec.childComponent) ? spec.childComponent : [spec.childComponent];
}

/** child specs a container can insert via its control bar / Enter key */
function insertableChildren(spec: UiComponentSpec | undefined, specs: SpecMap): UiComponentSpec[] {
  return childNames(spec)
    .map((name) => specs.get(name))
    .filter((child): child is UiComponentSpec => Boolean(child?.insert));
}

/** put the text cursor on the first text position at/after `pos` */
function focusAt(editor: Editor, pos: number) {
  const { view } = editor;
  const tr = view.state.tr;
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
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

function ComponentBar({
  spec,
  attributes,
  childInserts,
  onChange,
  onAddChild,
  onDelete,
}: {
  spec: UiComponentSpec;
  attributes: MdxAttribute[];
  childInserts: UiComponentSpec[];
  onChange: (attributes: MdxAttribute[]) => void;
  onAddChild: (child: UiComponentSpec) => void;
  onDelete: () => void;
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
          <Popover.Trigger className={barButtonCls}>
            <SlidersHorizontal size={12} />
            <span>Attributes</span>
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
      {childInserts.map((child) => (
        <button
          key={child.name}
          type="button"
          className={barButtonCls}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onAddChild(child)}
        >
          <Plus size={12} />
          <span>{child.title ?? child.name}</span>
        </button>
      ))}
      <button
        type="button"
        aria-label={`Delete ${spec.title ?? spec.name}`}
        className={`${barButtonCls} px-1 text-fd-muted-foreground hover:text-fd-error`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onDelete}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/* ---- node views ---- */

function makeComponentView(specs: SpecMap) {
  return function ComponentNodeView(props: NodeViewProps) {
    const { node, editor, getPos, updateAttributes, deleteNode, selected } = props;
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

    const addChild = (child: UiComponentSpec) => {
      const content = child.insert?.();
      const pos = getPos();
      if (!content || pos == null) return;
      const end = pos + node.nodeSize - 1; // just before the closing token
      editor.chain().insertContentAt(end, content).run();
      focusAt(editor, end + 1);
    };

    return (
      <NodeViewWrapper
        className="relative data-[selected]:rounded-xl data-[selected]:outline-2 data-[selected]:outline-offset-2 data-[selected]:outline-fd-ring"
        data-component={name}
        data-container={spec.childComponent ? '' : undefined}
        data-selected={selected || undefined}
      >
        <ComponentBar
          spec={spec}
          attributes={attributes}
          childInserts={insertableChildren(spec, specs)}
          onChange={(next) => updateAttributes({ attributes: next })}
          onAddChild={addChild}
          onDelete={() => deleteNode()}
        />
        <Render props={readStringProps(attributes)} selected={selected} setProp={setProp}>
          <NodeViewContent className="fde-component-content" />
        </Render>
      </NodeViewWrapper>
    );
  };
}

function makeRegionView(kind: 'inline' | 'block', placeholders: Map<string, string>) {
  return function RegionView({ node, editor, getPos }: NodeViewProps) {
    const region = (node.attrs.region as string | null) ?? '';
    const empty = node.textContent.length === 0;
    // region names (title / body) repeat across components, so the placeholder
    // is keyed by the enclosing component — resolve it from the doc position
    let placeholder = '';
    try {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (typeof pos === 'number') {
        const $pos = editor.state.doc.resolve(pos);
        for (let depth = $pos.depth; depth >= 0; depth--) {
          const ancestor = $pos.node(depth);
          if (ancestor.type.name === COMPONENT) {
            placeholder = placeholders.get(`${ancestor.attrs.name}:${region}`) ?? '';
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
  }
  return map;
}

/* ---- keyboard behaviour inside inline regions ---- */

/** depth of the enclosing inline region at the cursor, or -1 */
function inlineRegionDepth($from: { depth: number; node: (d: number) => PMNode }): number {
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === INLINE_REGION) return depth;
  }
  return -1;
}

function hasComponentChild(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (child.type.name === COMPONENT) found = true;
  });
  return found;
}

/** innermost component whose range fully contains [from, to], or null */
function enclosingComponent(
  editor: Editor,
  from: number,
  to: number,
): { node: PMNode; pos: number } | null {
  const $from = editor.state.doc.resolve(from);
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== COMPONENT) continue;
    const pos = $from.before(depth);
    if (to <= pos + node.nodeSize) return { node, pos };
  }
  return null;
}

/**
 * Delete a whole leaf component when a selection wipes out all of its text at
 * once (e.g. select-all inside a Callout → Delete), instead of leaving an empty
 * shell behind. Only fires for leaf components (no child components) so a
 * cross-item selection in a container is left to the default handler.
 */
function handleClearingDelete(editor: Editor, specs: SpecMap): boolean {
  const { state } = editor;
  const { selection } = state;
  if (selection.empty) return false;

  const comp = enclosingComponent(editor, selection.from, selection.to);
  if (!comp) return false;
  const spec = specs.get(comp.node.attrs.name as string);
  if (!spec || spec.childComponent) return false;
  if (comp.node.textContent.length === 0) return false;

  // nothing textual survives on either side of the selection within the component
  const start = comp.pos;
  const end = comp.pos + comp.node.nodeSize;
  const before = state.doc.textBetween(start, selection.from, '', '');
  const after = state.doc.textBetween(selection.to, end, '', '');
  if (before !== '' || after !== '') return false;

  editor.chain().deleteRange({ from: start, to: end }).focus().run();
  return true;
}

/**
 * Enter inside an inline region never splits it (the backing attribute is a
 * single string). Behaviour depends on the component:
 *   - list-like container's own name (Folder): insert a child entry inside it;
 *   - repeated child of a list-like container (File): insert a sibling entry;
 *   - anything else (Card / Accordion title): move to the component's next
 *     editable region, matching how Tab-style field navigation reads.
 */
function handleEnter(editor: Editor, specs: SpecMap): boolean {
  const { $from } = editor.state.selection;
  const regionDepth = inlineRegionDepth($from);
  if (regionDepth === -1) return false;

  const compDepth = regionDepth - 1;
  const comp = compDepth >= 1 ? $from.node(compDepth) : null;
  if (!comp || comp.type.name !== COMPONENT) return true;
  const spec = specs.get(comp.attrs.name as string);

  // list-like container name (Folder): add the default child after the name
  if (spec?.listLike) {
    const childSpec = insertableChildren(spec, specs)[0];
    if (childSpec) {
      const insertPos = $from.after(regionDepth);
      editor.chain().insertContentAt(insertPos, childSpec.insert!()).run();
      focusAt(editor, insertPos + 1);
      return true;
    }
  }

  // repeated child of a list-like container (File): add a sibling after it
  const container = compDepth >= 1 ? $from.node(compDepth - 1) : null;
  const containerSpec =
    container?.type.name === COMPONENT ? specs.get(container.attrs.name as string) : undefined;
  if (
    containerSpec?.listLike &&
    spec?.insert &&
    childNames(containerSpec).includes(comp.attrs.name as string)
  ) {
    const insertPos = $from.after(compDepth);
    editor.chain().insertContentAt(insertPos, spec.insert()).run();
    focusAt(editor, insertPos + 1);
    return true;
  }

  // otherwise: jump to the next region in this component, if any
  const nextRegionStart = $from.after(regionDepth);
  if (nextRegionStart < $from.end(compDepth)) focusAt(editor, nextRegionStart + 1);
  return true; // never split an inline region
}

/**
 * Backspace in an empty inline region deletes the entry it names, but only for
 * a childless entry of a list-like container (a File / Folder row). Everywhere
 * else it's swallowed at the region start so a join can't damage the structure.
 */
function handleBackspace(editor: Editor, specs: SpecMap): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const regionDepth = inlineRegionDepth($from);
  if (regionDepth === -1) return false;
  if ($from.parentOffset > 0) return false;

  const region = $from.node(regionDepth);
  if (region.content.size > 0) return true; // at start of a non-empty name

  const compDepth = regionDepth - 1;
  const comp = compDepth >= 1 ? $from.node(compDepth) : null;
  if (!comp || comp.type.name !== COMPONENT) return true;

  const container = compDepth >= 1 ? $from.node(compDepth - 1) : null;
  const containerSpec =
    container?.type.name === COMPONENT ? specs.get(container.attrs.name as string) : undefined;
  const removable =
    containerSpec?.listLike &&
    childNames(containerSpec).includes(comp.attrs.name as string) &&
    !hasComponentChild(comp);
  if (!removable) return true;

  const from = $from.before(compDepth);
  const tr = state.tr.delete(from, $from.after(compDepth));
  tr.setSelection(TextSelection.near(tr.doc.resolve(from), -1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Marks the innermost component containing the caret with `data-active` so its
 * control bar can reveal on keyboard/touch focus. Necessary because the whole
 * editor is one contenteditable: putting the caret in a region focuses the
 * ProseMirror root, not the region, so `:focus-within` never reaches these
 * wrappers (only the Callout's nested contenteditable and node-selection do).
 */
const activeComponent = ExtensionBase.create({
  name: 'fdeActiveComponent',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { $from } = state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === COMPONENT) {
                const pos = $from.before(depth);
                return DecorationSet.create(state.doc, [
                  Decoration.node(pos, pos + node.nodeSize, { 'data-active': '' }),
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
  const InlineRegionView = makeRegionView('inline', placeholders);
  const BlockRegionView = makeRegionView('block', placeholders);

  return [
    MdxComponent.extend({ addNodeView: () => ReactNodeViewRenderer(ComponentView) }),
    MdxInlineRegion.extend({
      addNodeView: () => ReactNodeViewRenderer(InlineRegionView),
      addKeyboardShortcuts() {
        return {
          Enter: ({ editor }) => handleEnter(editor, map),
          'Shift-Enter': ({ editor }) => inlineRegionDepth(editor.state.selection.$from) !== -1,
          'Mod-Enter': ({ editor }) => inlineRegionDepth(editor.state.selection.$from) !== -1,
          Backspace: ({ editor }) => handleClearingDelete(editor, map) || handleBackspace(editor, map),
          Delete: ({ editor }) => handleClearingDelete(editor, map),
        };
      },
    }),
    MdxBlockRegion.extend({ addNodeView: () => ReactNodeViewRenderer(BlockRegionView) }),
    activeComponent,
  ] as unknown as Extension[];
}

export type { Node };
