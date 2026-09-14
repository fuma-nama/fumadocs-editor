// shared by the shipped app and the server; `src/` bundles it, the app
// imports it at runtime (only `app/` and `dist/` are published)

export const TREE_ENDPOINT = "/__fde_studio/tree";
/** HMR event: the tree changed on disk, fetch it again */
export const TREE_EVENT = "fumadocs-studio:tree";

export interface MetaJson {
  title?: string;
  pages?: string[];
}

export type TreeNode =
  | { type: "file"; name: string; path: string; title: string }
  | { type: "folder"; name: string; path: string; title: string; children: TreeNode[] }
  | { type: "separator"; title: string; icon?: string }
  | { type: "link"; title: string; url: string; icon?: string; external?: boolean };

export interface TreeResponse {
  /** basename of the content directory */
  root: string;
  tree: TreeNode[];
}

/** `POST` body of the tree endpoint; the reply is the tree after the change */
export type TreeCommand =
  /** a new page holding a frontmatter `title` */
  | { type: "create"; path: string; title: string }
  /** a new folder: `meta.json` carrying the title and an `index.mdx` */
  | { type: "mkdir"; dir: string; title: string }
  | { type: "delete"; path: string }
  /** the folder's `pages` rewritten to show `order`, entries as {@link pagesEntry} gives them */
  | { type: "order"; dir: string; order: string[] };

/** the `meta.json` `pages` entry that produces `node` in its folder */
export function pagesEntry(node: TreeNode): string {
  switch (node.type) {
    case "separator": {
      if (!node.title && !node.icon) return "---";
      return `---${node.icon ? `[${node.icon}]` : ""}${node.title}---`;
    }
    case "link": {
      const icon = node.icon ? `[${node.icon}]` : "";
      return `${node.external ? "external:" : ""}${icon}[${node.title}](${node.url})`;
    }
    default:
      return node.name;
  }
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
