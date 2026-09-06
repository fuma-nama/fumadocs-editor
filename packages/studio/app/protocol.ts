// shared by the shipped app and the server; `src/` bundles it, the app
// imports it at runtime (only `app/` and `dist/` are published)

export const TREE_ENDPOINT = "/__fde_studio/tree";

export interface MetaJson {
  title?: string;
  pages?: string[];
}

export type TreeNode =
  | { type: "file"; name: string; path: string; title: string }
  | { type: "folder"; name: string; path: string; title: string; children: TreeNode[] }
  | { type: "separator"; title: string };

export interface TreeResponse {
  /** basename of the content directory */
  root: string;
  tree: TreeNode[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const TITLE = /^title:[ \t]*(.*?)[ \t]*$/m;

/** the frontmatter `title`, quotes stripped; block scalars are not read */
export function frontmatterTitle(text: string): string | undefined {
  const block = FRONTMATTER.exec(text)?.[1];
  if (block === undefined) return;
  const value = TITLE.exec(block)?.[1];
  if (!value) return;
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    return value.length > 1 && value.endsWith(quote) ? value.slice(1, -1) : undefined;
  }
  return quote === "|" || quote === ">" ? undefined : value;
}
