import type { MdxAttribute, PropField } from "@fumadocs-editor/core";

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

export function readPropValue(attributes: MdxAttribute[], field: PropField): string {
  const attr = attributes.find((a) => a.type === "mdxJsxAttribute" && a.name === field.name);
  if (!attr || attr.type !== "mdxJsxAttribute") return "";
  if (attr.value == null) return field.type === "boolean" ? "true" : "";
  if (typeof attr.value === "string") return attr.value;
  return attr.value.value;
}

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
