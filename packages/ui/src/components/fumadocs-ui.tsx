'use client';
import {
  CircleCheck,
  CircleX,
  Info,
  Lightbulb,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentRenderProps, UiComponentSpec } from './spec';

/*
 * Node renderers for the fumadocs-ui MDX components. Each mirrors the real
 * component's structure so the editor is genuinely WYSIWYG; in a fumadocs-ui
 * consumer these renderers would import the actual components and drop
 * `<NodeViewContent>` into their editable slots.
 */

const CALLOUT_ICONS: Record<string, LucideIcon> = {
  info: Info,
  warn: TriangleAlert,
  warning: TriangleAlert,
  error: CircleX,
  success: CircleCheck,
  idea: Lightbulb,
};

function Callout({ props, children }: ComponentRenderProps) {
  const type = props.type ?? 'info';
  const Icon = CALLOUT_ICONS[type] ?? Info;
  return (
    <div className="fde-callout" data-type={type} contentEditable={false}>
      <Icon className="fde-callout-icon" size={18} />
      <div className="fde-callout-body" contentEditable suppressContentEditableWarning>
        {children}
      </div>
    </div>
  );
}

function Card({ props, children }: ComponentRenderProps) {
  return (
    <div className="fde-card" data-has-href={props.href ? '' : undefined}>
      {children}
    </div>
  );
}

function Cards({ children }: ComponentRenderProps) {
  return <div className="fde-cards">{children}</div>;
}

export const calloutSpec: UiComponentSpec = {
  name: 'Callout',
  title: 'Callout',
  attributeRegions: [{ attribute: 'title', region: 'title', placeholder: 'Title…' }],
  childrenRegion: { region: 'body', placeholder: 'Write the callout…' },
  props: [
    {
      name: 'type',
      label: 'Type',
      type: 'enum',
      options: ['info', 'warn', 'error', 'success', 'idea'],
      default: 'info',
    },
  ],
  render: Callout,
  insert: () => ({
    type: 'mdxComponent',
    attrs: { name: 'Callout', attributes: [{ type: 'mdxJsxAttribute', name: 'type', value: 'info' }] },
    content: [
      { type: 'mdxInlineRegion', attrs: { region: 'title' } },
      { type: 'mdxBlockRegion', attrs: { region: 'body' }, content: [{ type: 'paragraph' }] },
    ],
  }),
};

export const cardSpec: UiComponentSpec = {
  name: 'Card',
  title: 'Card',
  attributeRegions: [
    { attribute: 'title', region: 'title', placeholder: 'Card title…' },
    { attribute: 'description', region: 'description', placeholder: 'Description…' },
  ],
  childrenRegion: { region: 'body', placeholder: 'Body…' },
  props: [{ name: 'href', label: 'Link', type: 'string' }],
  render: Card,
};

export const cardsSpec: UiComponentSpec = {
  name: 'Cards',
  title: 'Cards',
  childComponent: 'Card',
  render: Cards,
  insert: () => ({
    type: 'mdxComponent',
    attrs: { name: 'Cards', attributes: [] },
    content: [
      {
        type: 'mdxComponent',
        attrs: { name: 'Card', attributes: [{ type: 'mdxJsxAttribute', name: 'title', value: '' }] },
        content: [
          { type: 'mdxInlineRegion', attrs: { region: 'title' } },
          { type: 'mdxInlineRegion', attrs: { region: 'description' } },
          { type: 'mdxBlockRegion', attrs: { region: 'body' }, content: [{ type: 'paragraph' }] },
        ],
      },
    ],
  }),
};

/** All built-in fumadocs-ui component specs. */
export const fumadocsUiComponents: UiComponentSpec[] = [calloutSpec, cardSpec, cardsSpec];
