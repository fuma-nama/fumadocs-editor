import { describe, expect, test } from 'vitest';
import {
  createRegistry,
  parseMdxToDoc,
  serializeDocToMdx,
  type ComponentSpec,
} from '../src';
import type { JSONContent } from '@tiptap/core';

const calloutSpec: ComponentSpec = {
  name: 'Callout',
  attributeRegions: [{ attribute: 'title', region: 'title' }],
  childrenRegion: { region: 'body' },
  props: [{ name: 'type', type: 'enum', options: ['info', 'warn', 'error'] }],
};

const cardSpec: ComponentSpec = {
  name: 'Card',
  attributeRegions: [{ attribute: 'title', region: 'title' }],
  // `description` renders into the same slot as children, so it folds into body
  childrenRegion: { region: 'body', fromAttribute: 'description' },
};

const cardsSpec: ComponentSpec = { name: 'Cards', childComponent: 'Card' };

const registry = createRegistry([calloutSpec, cardSpec, cardsSpec]);

function find(node: JSONContent, type: string, region?: string): JSONContent | undefined {
  if (node.type === type && (region == null || node.attrs?.region === region)) return node;
  for (const child of node.content ?? []) {
    const found = find(child, type, region);
    if (found) return found;
  }
  return undefined;
}

describe('component regions', () => {
  test('Callout parses into title + body regions', () => {
    const source = '<Callout type="info" title="Heads up">\n  Body **text**.\n</Callout>\n';
    const { doc } = parseMdxToDoc(source, registry);

    const component = find(doc, 'mdxComponent')!;
    expect(component.attrs?.name).toBe('Callout');
    expect(find(component, 'mdxInlineRegion', 'title')?.content?.[0].text).toBe('Heads up');
    expect(find(component, 'mdxBlockRegion', 'body')).toBeTruthy();
  });

  test('unedited Callout round-trips byte-for-byte', () => {
    const source = '<Callout type="info" title="Heads up">\n  Body text.\n</Callout>\n';
    const { doc, snapshot } = parseMdxToDoc(source, registry);
    expect(serializeDocToMdx(doc, snapshot, registry)).toBe(source);
  });

  test('editing the title region rewrites only the title attribute', () => {
    const source = '<Callout type="warn" title="Old">\n  Body.\n</Callout>\n';
    const { doc, snapshot } = parseMdxToDoc(source, registry);

    const title = find(doc, 'mdxInlineRegion', 'title')!;
    title.content = [{ type: 'text', text: 'New title' }];

    const out = serializeDocToMdx(doc, snapshot, registry);
    expect(out).toContain('title="New title"');
    expect(out).toContain('type="warn"');
    expect(out).toContain('Body.');
  });

  test('Cards → Card nesting round-trips', () => {
    const source =
      '<Cards>\n  <Card title="A" href="/a">First</Card>\n  <Card title="B">Second</Card>\n</Cards>\n';
    const { doc, snapshot } = parseMdxToDoc(source, registry);

    const cards = find(doc, 'mdxComponent')!;
    const cardNodes = (cards.content ?? []).filter((c) => c.type === 'mdxComponent');
    expect(cardNodes).toHaveLength(2);
    expect(find(cardNodes[0], 'mdxInlineRegion', 'title')?.content?.[0].text).toBe('A');

    expect(serializeDocToMdx(doc, snapshot, registry)).toBe(source);
  });

  test('Card description folds into the editable body region', () => {
    const source = '<Card title="Themes" description="Add themes to your site" />\n';
    const { doc } = parseMdxToDoc(source, registry);

    const card = find(doc, 'mdxComponent')!;
    // description is edited as body text, not kept as a separate attribute
    const body = find(card, 'mdxBlockRegion', 'body')!;
    expect(find(body, 'paragraph')?.content?.[0].text).toBe('Add themes to your site');
    const attrNames = (card.attrs?.attributes as { name?: string }[]).map((a) => a.name);
    expect(attrNames).not.toContain('description');
    expect(attrNames).toContain('title');
  });

  test('unedited description Card round-trips byte-for-byte', () => {
    const source = '<Card title="Themes" description="Add themes to your site" />\n';
    const { doc, snapshot } = parseMdxToDoc(source, registry);
    expect(serializeDocToMdx(doc, snapshot, registry)).toBe(source);
  });

  test('editing a folded-description body re-emits it as children', () => {
    const source = '<Card title="Themes" description="Old copy" />\n';
    const { doc, snapshot } = parseMdxToDoc(source, registry);

    const body = find(doc, 'mdxBlockRegion', 'body')!;
    body.content = [{ type: 'paragraph', content: [{ type: 'text', text: 'New copy' }] }];

    const out = serializeDocToMdx(doc, snapshot, registry);
    expect(out).toContain('New copy');
    expect(out).not.toContain('description=');
    expect(out).toContain('title="Themes"');
  });

  test('normalized serialization is idempotent for components', () => {
    const source = '<Callout title="Hi">\nText here.\n</Callout>';
    const { doc } = parseMdxToDoc(source, registry);
    const once = serializeDocToMdx(doc, undefined, registry);
    const twice = serializeDocToMdx(parseMdxToDoc(once, registry).doc, undefined, registry);
    expect(twice).toBe(once);
  });
});
