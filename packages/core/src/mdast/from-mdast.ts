import type { JSONContent } from "@tiptap/core";
import type {
  BlockContent,
  DefinitionContent,
  List,
  ListItem,
  Node as MdNode,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";
import type {
  MdxJsxAttribute as MdastJsxAttribute,
  MdxJsxExpressionAttribute as MdastJsxExpressionAttribute,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from "mdast-util-mdx-jsx";
import type { MdxAttribute } from "../extensions/mdx-nodes";
import type { Syntax, ComponentSpec } from "../components/spec";
import {
  BLOCK_REGION_NODE,
  INLINE_REGION_NODE,
  childNames,
  childOnly,
  componentRegions,
  componentTypeName,
} from "../components/structure";
import { DIRECTIVE_ADMONITION } from "../syntax/directives";
import { admonitionAsJsx } from "../syntax/directives/parse";
import { inlineMathToNode, mathToNode } from "../syntax/math/parse";
import { FENCE_FILE, FENCE_FILES, FENCE_FOLDER, FILES_FENCE_LANG } from "../syntax/files";
import { filesFenceAsJsx } from "../syntax/files/parse";
import { extractHeadingSuffixes } from "../syntax/heading-suffixes";

export interface FromMdastContext {
  source: string;
  syntax: Syntax;
}

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

function sliceSource(node: MdNode, ctx: FromMdastContext): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start == null || end == null) return "";
  return ctx.source.slice(start, end);
}

function withMarks(node: JSONContent, marks: PMMark[]): JSONContent {
  if (marks.length > 0) node.marks = marks;
  return node;
}

/** estree node, structurally typed just enough for literal extraction */
interface EstreeNode {
  type: string;
  [key: string]: unknown;
}

/**
 * Statically evaluate a literal-only expression (strings, numbers, booleans,
 * null, arrays, plain objects). `undefined` means "not static": any
 * identifier, call, spread or computed key gives up, and the attribute stays
 * a raw expression the UI can only edit as source.
 */
function staticLiteral(node: EstreeNode | undefined): unknown {
  if (!node) return undefined;
  switch (node.type) {
    case "Literal": {
      const value = node.value;
      if (value === null) return null;
      const kind = typeof value;
      return kind === "string" || kind === "number" || kind === "boolean" ? value : undefined;
    }
    case "TemplateLiteral": {
      const expressions = node.expressions as EstreeNode[];
      if (expressions.length > 0) return undefined;
      let out = "";
      for (const quasi of node.quasis as { value: { cooked?: string } }[]) {
        if (quasi.value.cooked == null) return undefined;
        out += quasi.value.cooked;
      }
      return out;
    }
    case "UnaryExpression": {
      if (node.operator !== "-") return undefined;
      const value = staticLiteral(node.argument as EstreeNode);
      return typeof value === "number" ? -value : undefined;
    }
    case "ArrayExpression": {
      const out: unknown[] = [];
      for (const element of node.elements as (EstreeNode | null)[]) {
        if (!element || element.type === "SpreadElement") return undefined;
        const value = staticLiteral(element);
        if (value === undefined) return undefined;
        out.push(value);
      }
      return out;
    }
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const prop of node.properties as EstreeNode[]) {
        if (prop.type !== "Property" || prop.computed || prop.kind !== "init") return undefined;
        const key = prop.key as EstreeNode;
        const name =
          key.type === "Identifier"
            ? (key.name as string)
            : key.type === "Literal" && typeof key.value === "string"
              ? key.value
              : undefined;
        if (name === undefined) return undefined;
        const value = staticLiteral(prop.value as EstreeNode);
        if (value === undefined) return undefined;
        out[name] = value;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** the parsed expression inside `data.estree` (a one-statement Program) */
function attributeExpression(value: { data?: unknown }): EstreeNode | undefined {
  const program = (value.data as { estree?: EstreeNode } | undefined)?.estree;
  const body = program?.body as EstreeNode[] | undefined;
  const statement = body?.[0];
  return statement?.type === "ExpressionStatement"
    ? (statement.expression as EstreeNode)
    : undefined;
}

export function cleanAttributes(
  attrs: (MdastJsxAttribute | MdastJsxExpressionAttribute)[] = [],
): MdxAttribute[] {
  return attrs.map((attr) => {
    if (attr.type === "mdxJsxExpressionAttribute") {
      return { type: "mdxJsxExpressionAttribute", value: attr.value };
    }
    if (attr.value == null || typeof attr.value === "string") {
      return { type: "mdxJsxAttribute", name: attr.name, value: attr.value ?? null };
    }
    const literal = staticLiteral(attributeExpression(attr.value));
    return {
      type: "mdxJsxAttribute",
      name: attr.name,
      value: {
        type: "mdxJsxAttributeValueExpression",
        value: attr.value.value,
        ...(literal !== undefined && { literal }),
      },
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
      case "text":
        // a soft line wrap is whitespace, not content: fold it to a space so
        // the editor's DOM read-back never upgrades it to a hard break (`\`)
        if (node.value)
          out.push(withMarks({ type: "text", text: node.value.replace(/ *\n */g, " ") }, marks));
        break;
      case "strong":
        out.push(...phrasingToInline(node.children, [...marks, { type: "bold" }], ctx));
        break;
      case "emphasis":
        out.push(...phrasingToInline(node.children, [...marks, { type: "italic" }], ctx));
        break;
      case "delete":
        out.push(...phrasingToInline(node.children, [...marks, { type: "strike" }], ctx));
        break;
      case "inlineCode":
        if (node.value)
          out.push(withMarks({ type: "text", text: node.value }, [...marks, { type: "code" }]));
        break;
      case "link":
        out.push(
          ...phrasingToInline(
            node.children,
            [...marks, { type: "link", attrs: { href: node.url, title: node.title ?? null } }],
            ctx,
          ),
        );
        break;
      case "image":
        out.push(
          withMarks(
            {
              type: "image",
              attrs: { src: node.url, alt: node.alt ?? null, title: node.title ?? null },
            },
            marks,
          ),
        );
        break;
      case "break":
        out.push(withMarks({ type: "hardBreak" }, marks));
        break;
      case "inlineMath":
        out.push(withMarks(inlineMathToNode(node.value, sliceSource(node, ctx)), marks));
        break;
      case "mdxTextExpression":
        out.push(withMarks({ type: "mdxTextExpression", attrs: { value: node.value } }, marks));
        break;
      case "mdxJsxTextElement":
        out.push(
          withMarks(
            {
              type: "mdxJsxTextElement",
              attrs: { name: node.name ?? null, attributes: cleanAttributes(node.attributes) },
              content: phrasingToInline(node.children, [], ctx),
            },
            marks,
          ),
        );
        break;
      default:
        // footnoteReference, linkReference, imageReference, html, ...
        out.push(
          withMarks({ type: "verbatimInline", attrs: { value: sliceSource(node, ctx) } }, marks),
        );
    }
  }

  return out;
}

function listToNode(node: List, ctx: FromMdastContext): JSONContent {
  const isTask = node.children.some((item) => typeof item.checked === "boolean");

  const itemToNode = (item: ListItem): JSONContent => {
    const content = item.children.map((child) => blockToNode(child, ctx));
    // taskItem/listItem content is 'paragraph block*'
    if (content.length === 0 || content[0].type !== "paragraph") {
      content.unshift({ type: "paragraph" });
    }
    if (isTask) {
      return { type: "taskItem", attrs: { checked: item.checked === true }, content };
    }
    return { type: "listItem", content };
  };

  if (isTask) {
    return { type: "taskList", content: node.children.map(itemToNode) };
  }
  if (node.ordered) {
    return {
      type: "orderedList",
      attrs: { start: node.start ?? 1 },
      content: node.children.map(itemToNode),
    };
  }
  return { type: "bulletList", content: node.children.map(itemToNode) };
}

function tableToNode(node: Table, ctx: FromMdastContext): JSONContent {
  return {
    type: "table",
    attrs: { align: node.align ?? null },
    content: node.children.map((row, rowIndex) => ({
      type: "tableRow",
      content: row.children.map((cell) => ({
        type: rowIndex === 0 ? "tableHeader" : "tableCell",
        content: [
          {
            type: "paragraph",
            content: phrasingToInline(cell.children, [], ctx),
          },
        ],
      })),
    })),
  };
}

const PHRASING_TYPES = new Set([
  "text",
  "strong",
  "emphasis",
  "delete",
  "inlineCode",
  "link",
  "image",
  "break",
  "mdxTextExpression",
  "mdxJsxTextElement",
  "footnoteReference",
  "linkReference",
  "imageReference",
  "textDirective",
  "inlineMath",
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
    out.push({ type: "paragraph", content: phrasingToInline(run, [], ctx) });
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
    case "paragraph": {
      // a registered element written inline on its own line (MDX parses
      // `<include>./x.mdx</include>` as a paragraph around a text element)
      // is the component, not prose around it
      const only = node.children.length === 1 ? node.children[0] : undefined;
      if (only?.type === "mdxJsxTextElement") {
        const component = blockComponentToNode(only, ctx);
        if (component) return component;
      }
      return { type: "paragraph", content: phrasingToInline(node.children, [], ctx) };
    }
    case "heading": {
      const content = phrasingToInline(node.children, [], ctx);
      const attrs: Record<string, unknown> = { level: node.depth };
      if (ctx.syntax.options.headingSuffixes !== false) extractHeadingSuffixes(content, attrs);
      return { type: "heading", attrs, content };
    }
    case "blockquote": {
      const content = node.children.map((child) => blockToNode(child, ctx));
      return {
        type: "blockquote",
        content: content.length > 0 ? content : [{ type: "paragraph" }],
      };
    }
    case "list":
      return listToNode(node, ctx);
    case "code": {
      // a ```files tree listing becomes an editable Files tree when the whole
      // fence spec set is registered (a partial set would drop rows)
      const specs = ctx.syntax.components;
      if (
        node.lang === FILES_FENCE_LANG &&
        specs.has(FENCE_FILES) &&
        specs.has(FENCE_FOLDER) &&
        specs.has(FENCE_FILE)
      ) {
        const jsx = node.value ? filesFenceAsJsx(node.value) : null;
        const component = jsx && componentToNode(jsx, specs.get(FENCE_FILES)!, ctx);
        if (component) return component;
      }
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null, meta: node.meta ?? null },
        content: node.value ? [{ type: "text", text: node.value }] : undefined,
      };
    }
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "math":
      return mathToNode(node);
    case "table":
      return tableToNode(node, ctx);
    case "mdxJsxFlowElement": {
      const component = blockComponentToNode(node, ctx);
      if (component) return component;
      return {
        type: "mdxJsxFlowElement",
        attrs: { name: node.name ?? null, attributes: cleanAttributes(node.attributes) },
        content: mixedChildrenToBlocks(node.children, ctx),
      };
    }
    case "containerDirective": {
      const spec = ctx.syntax.components.get(DIRECTIVE_ADMONITION);
      const jsx = spec && admonitionAsJsx(node);
      const component = jsx ? componentToNode(jsx, spec!, ctx) : null;
      if (component) return component;
      return { type: "verbatim", attrs: { value: sliceSource(node, ctx) } };
    }
    case "mdxFlowExpression":
      return { type: "mdxFlowExpression", attrs: { value: node.value } };
    case "mdxjsEsm":
      return { type: "mdxjsEsm", attrs: { value: node.value } };
    case "yaml":
      return { type: "frontmatter", attrs: { value: node.value } };
    default:
      // definition, footnoteDefinition, html, ...
      return { type: "verbatim", attrs: { value: sliceSource(node, ctx) } };
  }
}

type JsxElement = MdxJsxFlowElement | MdxJsxTextElement;

/**
 * Collect child JSX elements (flow or inline) whose tag matches one of `names`,
 * looking inside paragraphs: MDX wraps adjacent inline elements (e.g. `<Card>`
 * on separate lines) into a paragraph of `mdxJsxTextElement`s.
 */
function collectChildElements(children: JsxElement["children"], names: string[]): JsxElement[] {
  const out: JsxElement[] = [];
  for (const child of children) {
    if (
      (child.type === "mdxJsxFlowElement" || child.type === "mdxJsxTextElement") &&
      child.name != null &&
      names.includes(child.name)
    ) {
      out.push(child);
    } else if (child.type === "paragraph") {
      out.push(...collectChildElements(child.children as JsxElement["children"], names));
    }
  }
  return out;
}

/** every text descendant of an mdast subtree, in order */
function mdastText(nodes: { type: string; value?: string; children?: unknown[] }[]): string {
  let out = "";
  for (const node of nodes) {
    if (typeof node.value === "string") out += node.value;
    else if (node.children) out += mdastText(node.children as typeof nodes);
  }
  return out;
}

/**
 * Parse a string-array expression (`["a", 'b']`) into its entries; null when
 * the expression is anything else (kept verbatim in that case).
 */
export function parseStringArray(expression: string): string[] | null {
  const trimmed = expression.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1);
  const out: string[] = [];
  const item = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*(,|$)/y;
  let at = 0;
  while (at < inner.length) {
    item.lastIndex = at;
    const match = item.exec(inner);
    if (!match) return null;
    const raw = match[1] ?? match[2];
    out.push(raw.replace(/\\(.)/g, "$1"));
    at = item.lastIndex;
  }
  return out;
}

/**
 * A registered element as a component node where a block is expected; null
 * (kept generic) for unregistered names and for child-only components, which
 * the schema admits only inside their parent.
 */
function blockComponentToNode(node: JsxElement, ctx: FromMdastContext): JSONContent | null {
  const spec = node.name != null ? ctx.syntax.components.get(node.name) : undefined;
  if (!spec || childOnly(spec, ctx.syntax.components)) return null;
  return componentToNode(node, spec, ctx);
}

function stringAttribute(node: JsxElement, name: string): string {
  const attr = node.attributes.find(
    (candidate) => candidate.type === "mdxJsxAttribute" && candidate.name === name,
  );
  return attr && typeof attr.value === "string" ? attr.value : "";
}

function inlineRegion(text: string): JSONContent {
  return { type: INLINE_REGION_NODE, content: text ? [{ type: "text", text }] : undefined };
}

/**
 * Convert a registered component's JSX element into its node: regions in
 * `componentRegions` order, then child components. `label` fills the region
 * a parent's `itemsAttribute` derives. Returns null when the element can't be
 * edited structurally (e.g. an items expression that isn't a literal string
 * array). The caller keeps it generic.
 */
function componentToNode(
  node: JsxElement,
  spec: ComponentSpec,
  ctx: FromMdastContext,
  label = "",
): JSONContent | null {
  const specs = ctx.syntax.components;
  const content: JSONContent[] = [];
  // attributes edited as region text are dropped from the stored attributes
  // and re-emitted from the regions on save
  const consumed: string[] = [];

  for (const region of componentRegions(spec, specs)) {
    if (region.derived) {
      content.push(inlineRegion(label));
    } else if (region.attribute) {
      content.push(inlineRegion(stringAttribute(node, region.attribute)));
    } else if (region.kind === "inline") {
      content.push(inlineRegion(mdastText(node.children as Parameters<typeof mdastText>[0])));
    } else {
      const blocks = mixedChildrenToBlocks(node.children, ctx);
      const folded = region.fromAttribute ? stringAttribute(node, region.fromAttribute) : "";
      if (folded) {
        consumed.push(region.fromAttribute!);
        blocks.unshift({ type: "paragraph", content: [{ type: "text", text: folded }] });
      }
      content.push({
        type: BLOCK_REGION_NODE,
        content: blocks.length > 0 ? blocks : [{ type: "paragraph" }],
      });
    }
  }

  if (spec.childComponent) {
    let items: string[] | null = null;
    if (spec.itemsAttribute) {
      const attr = node.attributes.find(
        (a) => a.type === "mdxJsxAttribute" && a.name === spec.itemsAttribute!.attribute,
      );
      if (attr && attr.type === "mdxJsxAttribute" && attr.value != null) {
        items = typeof attr.value === "string" ? [attr.value] : parseStringArray(attr.value.value);
        // an items expression we can't read as labels (a variable, computed
        // values) makes the labels uneditable: keep the whole element generic
        if (items == null) return null;
      }
      consumed.push(spec.itemsAttribute.attribute);
    }

    const children = collectChildElements(node.children, childNames(spec));
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childNode = componentToNode(child, specs.get(child.name!)!, ctx, items?.[i] ?? "");
      if (childNode == null) return null;
      content.push(childNode);
    }
  }

  const attributes = cleanAttributes(node.attributes).filter(
    (a) => !(a.type === "mdxJsxAttribute" && consumed.includes(a.name)),
  );
  return {
    type: componentTypeName(spec),
    attrs: { attributes },
    content: content.length > 0 ? content : undefined,
  };
}
