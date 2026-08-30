import type { MdxAttribute, PropField } from "@fumadocs-editor/core/extensions";

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

  const index = attributes.findIndex(
    (a) => a.type === "mdxJsxAttribute" && a.name === field.name,
  );
  const next = attributes.slice();
  if (index >= 0) {
    if (attr) next[index] = attr;
    else next.splice(index, 1);
  } else if (attr) {
    next.push(attr);
  }
  return next;
}
