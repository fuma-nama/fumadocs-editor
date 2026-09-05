import type { JSONContent } from "@tiptap/core";
import type {
  BlockContent,
  DefinitionContent,
  ListItem,
  PhrasingContent,
  RootContent,
  TableRow,
} from "mdast";
import type {
  MdxJsxAttribute as MdastJsxAttribute,
  MdxJsxExpressionAttribute as MdastJsxExpressionAttribute,
} from "mdast-util-mdx-jsx";
import type { MdxAttribute } from "../extensions/mdx-nodes";
import type { Syntax, ComponentSpec } from "../components/spec";
import { createSyntax } from "../components/spec";
import { componentRegions, componentTypeName } from "../components/structure";
import { DIRECTIVE_ADMONITION } from "../syntax/directives";
import { admonitionToMdast } from "../syntax/directives/serialize";
import { inlineMathToMdast, mathToMdast } from "../syntax/math/serialize";
import { FENCE_FILES } from "../syntax/files";
import { filesFenceToMdast } from "../syntax/files/serialize";
import { appendHeadingSuffixes } from "../syntax/heading-suffixes";
import type { RawNode } from "./stringify";

const EMPTY_SYNTAX = createSyntax();

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** outer to inner; code is always innermost since it terminates recursion */
const MARK_PRIORITY = ["link", "bold", "italic", "strike", "code"];

function markEquals(a: PMMark, b: PMMark): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "link") {
    return (
      (a.attrs?.href ?? null) === (b.attrs?.href ?? null) &&
      (a.attrs?.title ?? null) === (b.attrs?.title ?? null)
    );
  }
  return true;
}

function pickMark(marks: PMMark[]): PMMark | undefined {
  for (const type of MARK_PRIORITY) {
    const found = marks.find((mark) => mark.type === type);
    if (found) return found;
  }
  return marks[0];
}

interface InlineItem {
  node: JSONContent;
  marks: PMMark[];
}

function textOf(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textOf).join("");
}

export function attributesToMdast(
  attrs: MdxAttribute[] = [],
): (MdastJsxAttribute | MdastJsxExpressionAttribute)[] {
  return attrs.map((attr) => {
    if (attr.type === "mdxJsxExpressionAttribute") {
      return { type: "mdxJsxExpressionAttribute", value: attr.value };
    }
    return {
      type: "mdxJsxAttribute",
      name: attr.name,
      value:
        attr.value == null || typeof attr.value === "string"
          ? attr.value
          : { type: "mdxJsxAttributeValueExpression", value: attr.value.value },
    };
  });
}

function leafToPhrasing(node: JSONContent): PhrasingContent {
  switch (node.type) {
    case "text":
      return { type: "text", value: node.text ?? "" };
    case "hardBreak":
      return { type: "break" };
    case "image":
      return {
        type: "image",
        url: String(node.attrs?.src ?? ""),
        alt: (node.attrs?.alt as string | null) ?? null,
        title: (node.attrs?.title as string | null) ?? null,
      };
    case "mdxTextExpression":
      return { type: "mdxTextExpression", value: String(node.attrs?.value ?? "") };
    case "mathInline":
      return inlineMathToMdast(textOf(node), node.attrs?.delimiter);
    case "mdxJsxTextElement":
      return {
        type: "mdxJsxTextElement",
        name: (node.attrs?.name as string | null) ?? null,
        attributes: attributesToMdast(node.attrs?.attributes as MdxAttribute[]),
        children: inlineToPhrasing(node.content),
      };
    case "verbatimInline":
      return { type: "raw", value: String(node.attrs?.value ?? "") } as unknown as PhrasingContent;
    default:
      throw new Error(`Cannot serialize inline node: ${node.type}`);
  }
}

function convertRun(items: InlineItem[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];
    const mark = pickMark(item.marks);

    if (!mark) {
      out.push(leafToPhrasing(item.node));
      i += 1;
      continue;
    }

    let j = i;
    while (j < items.length && items[j].marks.some((m) => markEquals(m, mark))) j += 1;
    const run = items.slice(i, j);

    if (mark.type === "code") {
      out.push({ type: "inlineCode", value: run.map((r) => textOf(r.node)).join("") });
    } else {
      const inner = convertRun(
        run.map((r) => ({ node: r.node, marks: r.marks.filter((m) => !markEquals(m, mark)) })),
      );
      switch (mark.type) {
        case "bold":
          out.push({ type: "strong", children: inner });
          break;
        case "italic":
          out.push({ type: "emphasis", children: inner });
          break;
        case "strike":
          out.push({ type: "delete", children: inner });
          break;
        case "link":
          out.push({
            type: "link",
            url: String(mark.attrs?.href ?? ""),
            title: (mark.attrs?.title as string | null) ?? null,
            children: inner,
          });
          break;
        default:
          // unknown mark (e.g. added by a plugin without a serializer): drop it
          out.push(...inner);
      }
    }
    i = j;
  }

  return out;
}

export function inlineToPhrasing(nodes: JSONContent[] = []): PhrasingContent[] {
  return convertRun(nodes.map((node) => ({ node, marks: [...(node.marks ?? [])] as PMMark[] })));
}

function listItemsToMdast(node: JSONContent, task: boolean, syntax: Syntax): ListItem[] {
  return (node.content ?? []).map((item) => ({
    type: "listItem",
    spread: false,
    checked: task ? item.attrs?.checked === true : null,
    children: (item.content ?? []).map(
      (child) => nodeToMdastBlock(child, syntax) as BlockContent | DefinitionContent,
    ),
  }));
}

function tableToMdast(node: JSONContent): RootContent {
  const rows: TableRow[] = (node.content ?? []).map((row) => ({
    type: "tableRow",
    children: (row.content ?? []).map((cell) => {
      const paragraphs = (cell.content ?? []).filter((child) => child.type === "paragraph");
      const children: PhrasingContent[] = [];
      paragraphs.forEach((paragraph, index) => {
        if (index > 0) children.push({ type: "text", value: " " });
        children.push(...inlineToPhrasing(paragraph.content));
      });
      return { type: "tableCell", children };
    }),
  }));

  return {
    type: "table",
    align: (node.attrs?.align as ("left" | "right" | "center" | null)[] | null) ?? null,
    children: rows,
  };
}

export function nodeToMdastBlock(node: JSONContent, syntax: Syntax = EMPTY_SYNTAX): RootContent {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", children: inlineToPhrasing(node.content) };
    case "heading": {
      const children = inlineToPhrasing(node.content);
      appendHeadingSuffixes(node.attrs, children);
      return {
        type: "heading",
        depth: Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1))) as 1 | 2 | 3 | 4 | 5 | 6,
        children,
      };
    }
    case "blockquote":
      return {
        type: "blockquote",
        children: (node.content ?? []).map(
          (child) => nodeToMdastBlock(child, syntax) as BlockContent | DefinitionContent,
        ),
      };
    case "bulletList":
      return {
        type: "list",
        ordered: false,
        spread: false,
        children: listItemsToMdast(node, false, syntax),
      };
    case "orderedList":
      return {
        type: "list",
        ordered: true,
        start: Number(node.attrs?.start ?? 1),
        spread: false,
        children: listItemsToMdast(node, false, syntax),
      };
    case "taskList":
      return {
        type: "list",
        ordered: false,
        spread: false,
        children: listItemsToMdast(node, true, syntax),
      };
    case "codeBlock":
      return {
        type: "code",
        lang: (node.attrs?.language as string | null) || null,
        meta: (node.attrs?.meta as string | null) || null,
        value: textOf(node),
      };
    case "horizontalRule":
      return { type: "thematicBreak" };
    case "mathBlock":
      return mathToMdast(textOf(node), node.attrs?.meta);
    case "table":
      return tableToMdast(node);
    case "mdxJsxFlowElement":
      return {
        type: "mdxJsxFlowElement",
        name: (node.attrs?.name as string | null) ?? null,
        attributes: attributesToMdast(node.attrs?.attributes as MdxAttribute[]),
        children: (node.content ?? []).map(
          (child) => nodeToMdastBlock(child, syntax) as BlockContent | DefinitionContent,
        ),
      };
    case "mdxFlowExpression":
      return { type: "mdxFlowExpression", value: String(node.attrs?.value ?? "") };
    case "mdxjsEsm":
      return { type: "mdxjsEsm", value: String(node.attrs?.value ?? "") };
    case "frontmatter":
      return { type: "yaml", value: String(node.attrs?.value ?? "") };
    case "verbatim":
      return { type: "raw", value: String(node.attrs?.value ?? "") } as unknown as RootContent;
    default:
      for (const spec of syntax.components.values()) {
        if (componentTypeName(spec) === node.type) return componentToMdast(node, spec, syntax);
      }
      throw new Error(`Cannot serialize block node: ${node.type}`);
  }
}

function regionText(node: JSONContent | undefined): string {
  if (!node) return "";
  return (node.content ?? []).map(textOf).join("");
}

/** JSX attribute exactly as an author writes it */
function jsxAttrSource(attr: MdastJsxAttribute | MdastJsxExpressionAttribute): string {
  if (attr.type === "mdxJsxExpressionAttribute") return `{${attr.value}}`;
  if (attr.value == null) return attr.name;
  if (typeof attr.value === "string") {
    return attr.value.includes('"')
      ? `${attr.name}='${attr.value.replaceAll("'", "&#39;")}'`
      : `${attr.name}="${attr.value}"`;
  }
  return `${attr.name}={${attr.value.value}}`;
}

function componentToMdast(node: JSONContent, spec: ComponentSpec, syntax: Syntax): RootContent {
  // fence trees serialize straight from the node: the generic path would
  // recurse each row into its own code block
  if (spec.name === FENCE_FILES) return filesFenceToMdast(node);
  const { name } = spec;
  const attributes = attributesToMdast(node.attrs?.attributes as MdxAttribute[]);
  const content = (node.content ?? []) as JSONContent[];
  const regions = componentRegions(spec, syntax.components);
  let mdChildren: (BlockContent | DefinitionContent)[] = [];

  for (let i = 0; i < regions.length; i++) {
    const { kind, attribute, derived } = regions[i];
    if (derived) continue;
    if (kind === "block") {
      mdChildren = (content[i]?.content ?? []).map(
        (c) => nodeToMdastBlock(c, syntax) as BlockContent | DefinitionContent,
      );
      continue;
    }
    const value = regionText(content[i]);
    // an element whose payload is its text content serializes back to the
    // tight inline form authors write. Raw, so a path like `./page.mdx`
    // never grows markdown escapes.
    if (!attribute) {
      const attrText = attributes.map(jsxAttrSource).join(" ");
      const open = attrText ? `<${name} ${attrText}>` : `<${name}>`;
      return { type: "raw", value: `${open}${value}</${name}>` } as unknown as RootContent;
    }
    // write inline-region text back into its backing attribute
    const existing = attributes.find(
      (attr): attr is MdastJsxAttribute =>
        attr.type === "mdxJsxAttribute" && attr.name === attribute,
    );
    if (existing) existing.value = value;
    else if (value) attributes.push({ type: "mdxJsxAttribute", name: attribute, value });
  }

  if (spec.childComponent) {
    const children = content.slice(regions.length);
    mdChildren = children.map((child) => nodeToMdastBlock(child, syntax) as BlockContent);
    // the derived items attribute mirrors each child's label region
    if (spec.itemsAttribute) {
      const { attribute } = spec.itemsAttribute;
      const labels = children.map((child) => JSON.stringify(regionText(child.content?.[0])));
      const value = {
        type: "mdxJsxAttributeValueExpression" as const,
        value: `[${labels.join(", ")}]`,
      };
      const existing = attributes.find(
        (attr): attr is MdastJsxAttribute =>
          attr.type === "mdxJsxAttribute" && attr.name === attribute,
      );
      if (existing) existing.value = value;
      else attributes.unshift({ type: "mdxJsxAttribute", name: attribute, value });
    }
  }

  if (name === DIRECTIVE_ADMONITION) return admonitionToMdast(attributes, mdChildren);

  return { type: "mdxJsxFlowElement", name, attributes, children: mdChildren };
}

export type { RawNode, ComponentSpec };
