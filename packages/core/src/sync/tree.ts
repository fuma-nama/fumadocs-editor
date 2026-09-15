export interface MetaJson {
  title?: string;
  pages?: string[];
}

export type TreeNode =
  | { type: "file"; name: string; path: string; title: string }
  | { type: "folder"; name: string; path: string; title: string; children: TreeNode[] }
  | { type: "separator"; title: string; icon?: string }
  | { type: "link"; title: string; url: string; icon?: string; external?: boolean };

/** the workspace as a sidebar shows it */
export interface WorkspaceTree {
  /** basename of the mirrored directory */
  root: string;
  nodes: TreeNode[];
}

/** a change to the workspace, run through the client's `run` */
export type TreeCommand =
  /** a new page holding a frontmatter `title` */
  | { type: "create"; path: string; title: string }
  /** a new folder: `meta.json` carrying the title and an `index.mdx` */
  | { type: "mkdir"; dir: string; title: string }
  | { type: "delete"; path: string }
  /** the folder's `pages` rewritten to show `order`, entries as {@link pagesEntry} gives them */
  | { type: "order"; dir: string; order: string[] };

/** what the tree is built from */
export interface WorkspaceIndex {
  /** root-relative posix path of every markdown file, to its frontmatter title */
  files: Map<string, string | undefined>;
  /** `meta.json` per directory, keyed by root-relative path (`""` = root) */
  metas: Map<string, MetaJson>;
}

interface Dir {
  /** page key (file name without extension) to file path */
  files: Map<string, string>;
  /** child directory names */
  dirs: Set<string>;
}

export type Entry =
  | { type: "rest"; descending: boolean }
  | { type: "key"; key: string; folderOnly: boolean }
  | Extract<TreeNode, { type: "separator" | "link" }>;

export const MARKDOWN = /\.mdx?$/;
const SEPARATOR = /^---(?:\[([^\]]+)\])?(.+)---$|^---$/;
const LINK = /^(external:)?(?:\[([^\]]+)\])?\[([^\]]+)\]\(([^)]+)\)$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const TITLE = /^title:[ \t]*(.*?)[ \t]*$/m;

/** the Fumadocs grammar of one `pages` entry */
export function parseEntry(item: string): Entry {
  if (item === "..." || item === "z...a") return { type: "rest", descending: item !== "..." };
  const separator = SEPARATOR.exec(item);
  if (separator) {
    const node: Extract<TreeNode, { type: "separator" }> = {
      type: "separator",
      title: separator[2] ?? "",
    };
    if (separator[1]) node.icon = separator[1];
    return node;
  }
  const link = LINK.exec(item);
  if (link) {
    const node: Extract<TreeNode, { type: "link" }> = {
      type: "link",
      title: link[3],
      url: link[4],
    };
    if (link[2]) node.icon = link[2];
    if (link[1]) node.external = true;
    return node;
  }
  const folderOnly = item.startsWith("...");
  return {
    type: "key",
    key: folderOnly ? item.slice(3) : item.startsWith("!") ? item.slice(1) : item,
    folderOnly,
  };
}

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

export const listsKey = (pages: string[], key: string) =>
  pages.some((item) => {
    const entry = parseEntry(item);
    return entry.type === "key" && entry.key === key;
  });

/** Fumadocs' default order: `index`, then pages by name, then folders (their keys end in `/`) */
const rank = (key: string) => (key === "index" ? 0 : key.endsWith("/") ? 2 : 1);
const byName = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);
/** `z...a`: the same reversed, `index` still first */
const byNameDesc = (a: string, b: string) =>
  rank(a) === 0 || rank(b) === 0 ? rank(a) - rank(b) : byName(b, a);

/** every directory holding a readable file, and their parents up to the root */
function indexDirs(files: Iterable<string>, canRead: (path: string) => boolean): Map<string, Dir> {
  const dirs = new Map<string, Dir>();
  const dirOf = (dir: string): Dir => {
    let entry = dirs.get(dir);
    if (!entry) {
      entry = { files: new Map(), dirs: new Set() };
      dirs.set(dir, entry);
      if (dir) {
        const slash = dir.lastIndexOf("/");
        dirOf(slash < 0 ? "" : dir.slice(0, slash)).dirs.add(dir.slice(slash + 1));
      }
    }
    return entry;
  };
  dirOf("");
  for (const file of files) {
    if (!canRead(file)) continue;
    const slash = file.lastIndexOf("/");
    dirOf(slash < 0 ? "" : file.slice(0, slash)).files.set(
      file.slice(slash + 1).replace(MARKDOWN, ""),
      file,
    );
  }
  return dirs;
}

/** a folder's page and folder keys in default order; undefined when nothing is under it */
export function folderKeys({ files }: WorkspaceIndex, dir: string): string[] | undefined {
  const entry = indexDirs(files.keys(), () => true).get(dir);
  if (!entry) return;
  const sorted = [...entry.files.keys()];
  for (const name of entry.dirs) sorted.push(`${name}/`);
  sorted.sort(byName);
  const keys: string[] = [];
  for (const key of sorted) keys.push(key.endsWith("/") ? key.slice(0, -1) : key);
  return keys;
}

/**
 * Sidebar order from the `meta.json` subset Fumadocs uses: `pages` lists
 * keys (a folder wins over a page of the same name), `---Label---`
 * separators, `[text](url)` links, `...` / `z...a` for the rest,
 * `...key` (folder only), `!key` (listed anyway: an editor must reach
 * every file). Unknown keys are dropped; keys `pages` does not mention are
 * still appended at the end. Without `pages`: `index` first, then by name.
 */
export function buildTree(
  { files, metas }: WorkspaceIndex,
  canRead: (path: string) => boolean = () => true,
): TreeNode[] {
  const dirs = indexDirs(files.keys(), canRead);

  const build = (dir: string): TreeNode[] => {
    const entry = dirs.get(dir)!;
    // a folder and a file may share a key (`guides.mdx` beside `guides/`)
    const items = new Map<string, TreeNode>();
    for (const [key, file] of entry.files) {
      items.set(key, { type: "file", name: key, path: file, title: files.get(file) ?? key });
    }
    for (const name of entry.dirs) {
      const childPath = dir ? `${dir}/${name}` : name;
      const children = build(childPath);
      if (children.length === 0) continue;
      const title = metas.get(childPath)?.title;
      items.set(`${name}/`, {
        type: "folder",
        name,
        path: childPath,
        title: typeof title === "string" ? title : name,
        children,
      });
    }

    const pages = metas.get(dir)?.pages;
    const ordered: TreeNode[] = [];
    let restAt = -1;
    let descending = false;
    if (Array.isArray(pages)) {
      for (const item of pages) {
        if (typeof item !== "string") continue;
        const entry = parseEntry(item);
        if (entry.type === "rest") {
          restAt = ordered.length;
          descending = entry.descending;
          continue;
        }
        if (entry.type !== "key") {
          ordered.push(entry);
          continue;
        }
        const found =
          items.get(`${entry.key}/`) ?? (entry.folderOnly ? undefined : items.get(entry.key));
        if (!found) continue;
        items.delete(found.type === "folder" ? `${entry.key}/` : entry.key);
        ordered.push(found);
      }
    }
    const rest = [...items.keys()].sort(descending ? byNameDesc : byName);
    const nodes: TreeNode[] = [];
    for (const key of rest) nodes.push(items.get(key)!);
    if (restAt < 0) return ordered.concat(nodes);
    ordered.splice(restAt, 0, ...nodes);
    return ordered;
  };
  return build("");
}

/**
 * The `pages` that shows `order`, changed as little as possible: listed
 * entries keep their prefixes; the rest token (a folder without `pages`
 * starts from `["..."]`) stays and covers the longest run of unlisted keys
 * still in default order; entries naming nothing in `keys` stay after
 * their old neighbour. Without a rest token, unlisted keys that trail in
 * default order stay unlisted. `keys` is the folder's content in default
 * order.
 */
export function orderPages(
  pages: unknown[] | undefined,
  order: string[],
  keys: string[],
): string[] {
  const old: string[] = [];
  for (const item of pages ?? ["..."]) if (typeof item === "string") old.push(item);
  const listed = new Map<string, string>();
  let rest: Extract<Entry, { type: "rest" }> | undefined;
  for (const item of old) {
    const entry = parseEntry(item);
    if (entry.type === "rest") rest = entry;
    else if (entry.type === "key") listed.set(entry.key, item);
  }
  const ranked = keys.slice();
  if (rest?.descending) {
    ranked.reverse();
    // `z...a` reverses everything but `index`
    if (keys[0] === "index") ranked.unshift(ranked.pop()!);
  }
  const position = new Map<string, number>();
  for (let i = 0; i < ranked.length; i++) position.set(ranked[i], i);

  const out: string[] = [];
  for (const item of order) {
    const entry = parseEntry(item);
    out.push(entry.type === "key" ? (listed.get(entry.key) ?? item) : item);
  }
  /** position in default order of an unlisted key; undefined for anything else */
  const unlisted = (item: string) => {
    const entry = parseEntry(item);
    return entry.type === "key" && !listed.has(entry.key) ? position.get(entry.key) : undefined;
  };

  if (rest) {
    let best = { at: 0, length: 0 };
    for (let start = 0; start < out.length;) {
      let end = start;
      let last = -1;
      for (; end < out.length; end++) {
        const pos = unlisted(out[end]);
        if (pos === undefined || pos < last) break;
        last = pos;
      }
      if (end - start > best.length) best = { at: start, length: end - start };
      start = end > start ? end : start + 1;
    }
    if (best.length > 0) out.splice(best.at, best.length, rest.descending ? "z...a" : "...");
  } else {
    let end = out.length;
    let last = Infinity;
    while (end > 0) {
      const pos = unlisted(out[end - 1]);
      if (pos === undefined || pos > last) break;
      last = pos;
      end--;
    }
    out.length = end;
  }

  let anchor = -1;
  for (const item of old) {
    const at = out.indexOf(item);
    if (at >= 0) {
      anchor = at;
      continue;
    }
    const entry = parseEntry(item);
    if (entry.type === "rest" || (entry.type === "key" && !position.has(entry.key))) {
      out.splice(++anchor, 0, item);
    }
  }
  return out;
}
