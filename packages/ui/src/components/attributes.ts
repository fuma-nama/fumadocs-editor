import type { Editor } from "@tiptap/core";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { COMPONENT_NODE, type MdxAttribute, type PropField } from "@fumadocs-editor/core";

/**
 * The component that is node-selected or contains the caret. Panels render
 * from this snapshot — `attributes` must be part of it, or `useEditorState`
 * won't re-render on attribute edits and React resets the controlled
 * inputs' caret on every keystroke.
 */
export function activeComponent(
  state: EditorState,
): { pos: number; name: string; attributes: MdxAttribute[] } | null {
  const selection = state.selection;
  if (selection instanceof NodeSelection) {
    const node = selection.node;
    if (node.type.name !== COMPONENT_NODE) return null;
    return {
      pos: selection.from,
      name: node.attrs.name as string,
      attributes: node.attrs.attributes as MdxAttribute[],
    };
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === COMPONENT_NODE) {
      return {
        pos: $from.before(depth),
        name: node.attrs.name as string,
        attributes: node.attrs.attributes as MdxAttribute[],
      };
    }
  }
  return null;
}

/**
 * Write a component's attributes without losing a NodeSelection on it:
 * `setNodeMarkup` fully replaces a CHILDLESS node (there is no gap to
 * preserve), which degrades the NodeSelection to a text selection — the
 * panel anchored to it would unmount after the first keystroke.
 */
export function setComponentAttributes(
  editor: Editor,
  pos: number,
  attributes: MdxAttribute[],
): void {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, attributes });
  if (state.selection instanceof NodeSelection && state.selection.from === pos) {
    tr.setSelection(NodeSelection.create(tr.doc, pos));
  }
  editor.view.dispatch(tr);
}

/** update a (possibly node-selected) atom's attrs, keeping the selection */
export function updateAtomAttributes(
  editor: Editor,
  type: string,
  attrs: Record<string, unknown>,
): void {
  const selection = editor.state.selection;
  const chain = editor.chain().updateAttributes(type, attrs);
  if (selection instanceof NodeSelection) {
    chain.command(({ tr }) => {
      const at = tr.mapping.map(selection.from, -1);
      if (tr.doc.nodeAt(at)) tr.setSelection(NodeSelection.create(tr.doc, at));
      return true;
    });
  }
  chain.run();
}

export function readStringProps(attributes: MdxAttribute[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of attributes) {
    if (attr.type !== "mdxJsxAttribute") continue;
    if (typeof attr.value === "string") out[attr.name] = attr.value;
    else if (attr.value != null) out[attr.name] = attr.value.value; // expression source
  }
  return out;
}

export function setStringProp(
  attributes: MdxAttribute[],
  name: string,
  value: string,
): MdxAttribute[] {
  let replaced = false;
  const next = attributes.map((attr) => {
    if (attr.type === "mdxJsxAttribute" && attr.name === name) {
      replaced = true;
      return { ...attr, value };
    }
    return attr;
  });
  if (!replaced) next.push({ type: "mdxJsxAttribute", name, value });
  return next;
}

/** static values of expression props, keyed by prop name (parse-time extract) */
export function readLiterals(attributes: MdxAttribute[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attr of attributes) {
    if (attr.type !== "mdxJsxAttribute" || typeof attr.value !== "object" || attr.value === null)
      continue;
    if ("literal" in attr.value) out[attr.name] = attr.value.literal;
  }
  return out;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** JS object-literal source for a JSON-safe value, fumadocs-style formatting */
export function emitExpression(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent + 1);
  const close = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const rows = entries.map(([key, entry]) => {
      const name = IDENT.test(key) ? key : JSON.stringify(key);
      return `${pad}${name}: ${emitExpression(entry, indent + 1)},`;
    });
    return `{\n${rows.join("\n")}\n${close}}`;
  }
  return JSON.stringify(value);
}

/** write an expression prop from its literal value (source is derived) */
export function setLiteralProp(
  attributes: MdxAttribute[],
  name: string,
  literal: unknown,
): MdxAttribute[] {
  const attr: MdxAttribute = {
    type: "mdxJsxAttribute",
    name,
    // indent 1: the source sits inside `name={…}`, itself indented one level
    value: { type: "mdxJsxAttributeValueExpression", value: emitExpression(literal, 1), literal },
  };
  const index = attributes.findIndex((a) => a.type === "mdxJsxAttribute" && a.name === name);
  const next = attributes.slice();
  if (index >= 0) next[index] = attr;
  else next.push(attr);
  return next;
}

/** The panel's view of one prop, as a string in the field's own notation. */
export function readPropValue(attributes: MdxAttribute[], field: PropField): string {
  const attr = attributes.find((a) => a.type === "mdxJsxAttribute" && a.name === field.name);
  if (!attr || attr.type !== "mdxJsxAttribute") return "";
  if (attr.value == null) return field.type === "boolean" ? "true" : "";
  if (typeof attr.value === "string") return attr.value;
  return attr.value.value;
}

/**
 * Write one prop back in author style: booleans become a bare attribute when
 * true and disappear when false; expressions keep their `{…}` value; strings
 * stay strings.
 */
export function setPropValue(
  attributes: MdxAttribute[],
  field: PropField,
  value: string,
): MdxAttribute[] {
  if (field.type !== "boolean" && field.type !== "expression") {
    return setStringProp(attributes, field.name, value);
  }
  const attr: MdxAttribute | null =
    field.type === "boolean"
      ? value === "true"
        ? { type: "mdxJsxAttribute", name: field.name, value: null }
        : null
      : value.trim()
        ? {
            type: "mdxJsxAttribute",
            name: field.name,
            value: { type: "mdxJsxAttributeValueExpression", value },
          }
        : null;

  const index = attributes.findIndex((a) => a.type === "mdxJsxAttribute" && a.name === field.name);
  const next = attributes.slice();
  if (index >= 0) {
    if (attr) next[index] = attr;
    else next.splice(index, 1);
  } else if (attr) {
    next.push(attr);
  }
  return next;
}
