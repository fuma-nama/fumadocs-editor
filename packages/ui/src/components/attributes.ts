import type { MdxAttribute } from "@fumadocs-editor/core/extensions";

export function readStringProps(attributes: MdxAttribute[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of attributes) {
    if (attr.type === "mdxJsxAttribute" && typeof attr.value === "string") {
      out[attr.name] = attr.value;
    }
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
