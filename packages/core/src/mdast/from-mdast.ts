import type { JSONContent } from '@tiptap/core';
import type {
  BlockContent,
  DefinitionContent,
  List,
  ListItem,
  Node as MdNode,
  PhrasingContent,
  RootContent,
  Table,
} from 'mdast';
import type { MdxJsxAttribute as MdastJsxAttribute, MdxJsxExpressionAttribute as MdastJsxExpressionAttribute } from 'mdast-util-mdx-jsx';
import type { MdxAttribute } from '../extensions/mdx-nodes';

export interface FromMdastContext {
  source: string;
}

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

function sliceSource(node: MdNode, ctx: FromMdastContext): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start == null || end == null) return '';
  return ctx.source.slice(start, end);
}

function withMarks(node: JSONContent, marks: PMMark[]): JSONContent {
  if (marks.length > 0) node.marks = marks;
  return node;
}

export function cleanAttributes(
  attrs: (MdastJsxAttribute | MdastJsxExpressionAttribute)[] = [],
): MdxAttribute[] {
  return attrs.map((attr) => {
    if (attr.type === 'mdxJsxExpressionAttribute') {
      return { type: 'mdxJsxExpressionAttribute', value: attr.value };
    }
    return {
      type: 'mdxJsxAttribute',
      name: attr.name,
      value:
        attr.value == null || typeof attr.value === 'string'
          ? (attr.value ?? null)
          : { type: 'mdxJsxAttributeValueExpression', value: attr.value.value },
    };
  });
}

function phrasingToInline(
  nodes: PhrasingContent[],
  marks: PMMark[],
  ctx: FromMdastContext,
): JSONContent[] {
  const out: JSONContent[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        if (node.value) out.push(withMarks({ type: 'text', text: node.value }, marks));
        break;
      case 'strong':
        out.push(...phrasingToInline(node.children, [...marks, { type: 'bold' }], ctx));
        break;
      case 'emphasis':
        out.push(...phrasingToInline(node.children, [...marks, { type: 'italic' }], ctx));
        break;
      case 'delete':
        out.push(...phrasingToInline(node.children, [...marks, { type: 'strike' }], ctx));
        break;
      case 'inlineCode':
        if (node.value)
          out.push(withMarks({ type: 'text', text: node.value }, [...marks, { type: 'code' }]));
        break;
      case 'link':
        out.push(
          ...phrasingToInline(
            node.children,
            [...marks, { type: 'link', attrs: { href: node.url, title: node.title ?? null } }],
            ctx,
          ),
        );
        break;
      case 'image':
        out.push(
          withMarks(
            {
              type: 'image',
              attrs: { src: node.url, alt: node.alt ?? null, title: node.title ?? null },
            },
            marks,
          ),
        );
        break;
      case 'break':
        out.push(withMarks({ type: 'hardBreak' }, marks));
        break;
      case 'mdxTextExpression':
        out.push(withMarks({ type: 'mdxTextExpression', attrs: { value: node.value } }, marks));
        break;
      case 'mdxJsxTextElement':
        out.push(
          withMarks(
            {
              type: 'mdxJsxTextElement',
              attrs: { name: node.name ?? null, attributes: cleanAttributes(node.attributes) },
              content: phrasingToInline(node.children, [], ctx),
            },
            marks,
          ),
        );
        break;
      default:
        // footnoteReference, linkReference, imageReference, html, ...
        out.push(withMarks({ type: 'verbatimInline', attrs: { value: sliceSource(node, ctx) } }, marks));
    }
  }

  return out;
}

function listToNode(node: List, ctx: FromMdastContext): JSONContent {
  const isTask = node.children.some((item) => typeof item.checked === 'boolean');

  const itemToNode = (item: ListItem): JSONContent => {
    const content = item.children.map((child) => blockToNode(child, ctx));
    // taskItem/listItem content is 'paragraph block*'
    if (content.length === 0 || content[0].type !== 'paragraph') {
      content.unshift({ type: 'paragraph' });
    }
    if (isTask) {
      return { type: 'taskItem', attrs: { checked: item.checked === true }, content };
    }
    return { type: 'listItem', content };
  };

  if (isTask) {
    return { type: 'taskList', content: node.children.map(itemToNode) };
  }
  if (node.ordered) {
    return {
      type: 'orderedList',
      attrs: { start: node.start ?? 1 },
      content: node.children.map(itemToNode),
    };
  }
  return { type: 'bulletList', content: node.children.map(itemToNode) };
}

function tableToNode(node: Table, ctx: FromMdastContext): JSONContent {
  return {
    type: 'table',
    attrs: { align: node.align ?? null },
    content: node.children.map((row, rowIndex) => ({
      type: 'tableRow',
      content: row.children.map((cell) => ({
        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
        content: [
          {
            type: 'paragraph',
            content: phrasingToInline(cell.children, [], ctx),
          },
        ],
      })),
    })),
  };
}

const PHRASING_TYPES = new Set([
  'text',
  'strong',
  'emphasis',
  'delete',
  'inlineCode',
  'link',
  'image',
  'break',
  'mdxTextExpression',
  'mdxJsxTextElement',
  'footnoteReference',
  'linkReference',
  'imageReference',
]);

/**
 * JSX flow elements may contain a mix of flow and phrasing children;
 * wrap phrasing runs into paragraphs so PM block content stays valid.
 */
function mixedChildrenToBlocks(
  children: (BlockContent | DefinitionContent | PhrasingContent)[],
  ctx: FromMdastContext,
): JSONContent[] {
  const out: JSONContent[] = [];
  let run: PhrasingContent[] = [];

  const flush = () => {
    if (run.length === 0) return;
    out.push({ type: 'paragraph', content: phrasingToInline(run, [], ctx) });
    run = [];
  };

  for (const child of children) {
    if (PHRASING_TYPES.has(child.type)) {
      run.push(child as PhrasingContent);
    } else {
      flush();
      out.push(blockToNode(child as RootContent, ctx));
    }
  }
  flush();
  return out;
}

export function blockToNode(node: RootContent, ctx: FromMdastContext): JSONContent {
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', content: phrasingToInline(node.children, [], ctx) };
    case 'heading':
      return {
        type: 'heading',
        attrs: { level: node.depth },
        content: phrasingToInline(node.children, [], ctx),
      };
    case 'blockquote': {
      const content = node.children.map((child) => blockToNode(child, ctx));
      return {
        type: 'blockquote',
        content: content.length > 0 ? content : [{ type: 'paragraph' }],
      };
    }
    case 'list':
      return listToNode(node, ctx);
    case 'code':
      return {
        type: 'codeBlock',
        attrs: { language: node.lang ?? null, meta: node.meta ?? null },
        content: node.value ? [{ type: 'text', text: node.value }] : undefined,
      };
    case 'thematicBreak':
      return { type: 'horizontalRule' };
    case 'table':
      return tableToNode(node, ctx);
    case 'mdxJsxFlowElement':
      return {
        type: 'mdxJsxFlowElement',
        attrs: { name: node.name ?? null, attributes: cleanAttributes(node.attributes) },
        content: mixedChildrenToBlocks(node.children, ctx),
      };
    case 'mdxFlowExpression':
      return { type: 'mdxFlowExpression', attrs: { value: node.value } };
    case 'mdxjsEsm':
      return { type: 'mdxjsEsm', attrs: { value: node.value } };
    case 'yaml':
      return { type: 'frontmatter', attrs: { value: node.value } };
    default:
      // definition, footnoteDefinition, html, ...
      return { type: 'verbatim', attrs: { value: sliceSource(node, ctx) } };
  }
}
