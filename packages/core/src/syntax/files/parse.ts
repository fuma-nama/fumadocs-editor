import type { MdxJsxAttribute, MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import { FENCE_FILE, FENCE_FILES, FENCE_FOLDER } from ".";

interface Entry {
  name: string;
  /** null = file; a file line still becomes a folder when a child attaches */
  children: Entry[] | null;
}

/**
 * A line's leading `tree`-drawing units, one nesting level each. Strictly the
 * canonical 4-character units `tree` prints (and fumadocs documents). A
 * fence in any looser format stays a plain code block.
 */
const UNITS = /^((?:├── |└── |│   | {4})*)(.*)$/;

/**
 * Reshape a ```files fence value as the JSX tree fumadocs' remarkMdxFiles
 * would produce, using the fence spec names so serialization re-emits fence
 * syntax. Null when the listing can't be edited structurally (kept as a code
 * block in that case): a non-canonical prefix, tree-drawing characters
 * inside a name (fumadocs' parser would mangle them), no root, more than one
 * root (fumadocs keeps only the last; bailing loses nothing), or
 * an entry with no parent to attach to.
 */
export function filesFenceAsJsx(value: string): MdxJsxFlowElement | null {
  const stack = new Map<number, Entry>();
  let root: Entry | undefined;

  for (const line of value.split("\n")) {
    const [, prefix, name] = UNITS.exec(line)!;
    if (/[│├└─]/.test(name)) return null;
    if (!name) continue;
    const depth = prefix.length / 4;
    const entry: Entry = { name, children: name.endsWith("/") ? [] : null };

    if (depth === 0) {
      if (root) return null;
      root = entry;
    } else {
      let parent: Entry | undefined;
      for (let i = depth - 1; i >= 0 && !parent; i--) parent = stack.get(i);
      if (!parent) return null;
      (parent.children ??= []).push(entry);
    }
    stack.set(depth, entry);
  }

  if (!root) return null;
  return { type: "mdxJsxFlowElement", name: FENCE_FILES, attributes: [], children: [asJsx(root)] };
}

function asJsx(entry: Entry): MdxJsxFlowElement {
  const attributes: MdxJsxAttribute[] = [
    { type: "mdxJsxAttribute", name: "name", value: entry.name },
  ];
  return entry.children
    ? {
        type: "mdxJsxFlowElement",
        name: FENCE_FOLDER,
        attributes,
        children: entry.children.map(asJsx),
      }
    : { type: "mdxJsxFlowElement", name: FENCE_FILE, attributes, children: [] };
}
