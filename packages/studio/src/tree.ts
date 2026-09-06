import type { Dirent } from "node:fs";
import { open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { frontmatterTitle, type MetaJson, type TreeNode } from "../app/protocol";

/** what the tree is built from */
export interface WorkspaceIndex {
  /** root-relative posix path of every markdown file, to its frontmatter title */
  files: Map<string, string | undefined>;
  /** `meta.json` per directory, keyed by root-relative path (`""` = root) */
  metas: Map<string, MetaJson>;
}

export interface Workspace {
  /** the tree of the files `canRead` allows */
  tree(canRead: (path: string) => boolean): TreeNode[];
  /**
   * Apply a watcher event (chokidar's `add` / `change` / `unlink` /
   * `addDir` / `unlinkDir`) for `absolute`: re-reads what it names and
   * reports whether the tree changed. Paths outside the root are ignored.
   */
  update(event: string, absolute: string): Promise<boolean>;
}

interface Dir {
  /** page key (file name without extension) to file path */
  files: Map<string, string>;
  /** child directory names */
  dirs: Set<string>;
}

const MARKDOWN = /\.mdx?$/;
const SEPARATOR = /^---(.*)---$/;
const LINK = /^\[.*\]\(.*\)$/;
/** a dot segment or `node_modules` anywhere in the relative path */
const HIDDEN = /(?:^|\/)(?:\.[^/]*|node_modules)(?:\/|$)/;
const HEAD_BYTES = 4096;
const READ_CONCURRENCY = 32;

const byName = (a: string, b: string) =>
  Number(a !== "index") - Number(b !== "index") || a.localeCompare(b);

/**
 * Sidebar order from the `meta.json` subset Fumadocs uses: `pages` lists
 * keys, `---Label---` separators, `...` / `z...a` for the rest, `[text](url)`
 * links (skipped), `!key` (listed anyway: an editor must reach every file).
 * Unknown keys are dropped; keys `pages` does not mention are still appended
 * at the end. Without `pages`: `index` first, then by name.
 */
export function buildTree(
  { files, metas }: WorkspaceIndex,
  canRead: (path: string) => boolean = () => true,
): TreeNode[] {
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
  for (const file of files.keys()) {
    if (!canRead(file)) continue;
    const slash = file.lastIndexOf("/");
    dirOf(slash < 0 ? "" : file.slice(0, slash)).files.set(
      file.slice(slash + 1).replace(MARKDOWN, ""),
      file,
    );
  }

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
    let restDescending = false;
    if (Array.isArray(pages)) {
      for (const item of pages) {
        if (typeof item !== "string") continue;
        const separator = SEPARATOR.exec(item);
        if (separator) {
          ordered.push({ type: "separator", title: separator[1] });
          continue;
        }
        if (item === "..." || item === "z...a") {
          restAt = ordered.length;
          restDescending = item !== "...";
          continue;
        }
        if (LINK.test(item)) continue;
        const folderOnly = item.startsWith("...");
        const key = folderOnly ? item.slice(3) : item.startsWith("!") ? item.slice(1) : item;
        const found = (!folderOnly && items.get(key)) || items.get(`${key}/`);
        if (!found) continue;
        items.delete(found.type === "folder" ? `${key}/` : key);
        ordered.push(found);
      }
    }
    const rest = [...items.keys()].sort(byName);
    if (restDescending) rest.reverse();
    const nodes: TreeNode[] = [];
    for (const key of rest) nodes.push(items.get(key)!);
    if (restAt < 0) return ordered.concat(nodes);
    ordered.splice(restAt, 0, ...nodes);
    return ordered;
  };
  return build("");
}

async function readHead(file: string): Promise<string> {
  const handle = await open(file);
  try {
    const buffer = Buffer.allocUnsafe(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** runs `fn` over `items`, at most `limit` at a time; resolves true if any call did */
async function someLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<boolean>,
): Promise<boolean> {
  let next = 0;
  let any = false;
  const worker = async () => {
    while (next < items.length) if (await fn(items[next++])) any = true;
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return any;
}

/**
 * Scans `root` once, then stays current through {@link Workspace.update}.
 * Markdown files carry their frontmatter title (from a head read), each
 * `meta.json` its parsed content (invalid JSON counts as none); dot
 * segments and `node_modules` are skipped.
 */
export async function openWorkspace(root: string): Promise<Workspace> {
  root = path.resolve(root);
  const index: WorkspaceIndex = { files: new Map(), metas: new Map() };

  /** re-read one file; a missing one is dropped */
  const refresh = async (relative: string): Promise<boolean> => {
    const name = relative.slice(relative.lastIndexOf("/") + 1);
    if (name === "meta.json") {
      const dir = relative.slice(0, -"/meta.json".length);
      let meta: unknown;
      try {
        meta = JSON.parse(await readFile(path.join(root, relative), "utf8"));
      } catch {}
      if (meta && typeof meta === "object") index.metas.set(dir, meta as MetaJson);
      else index.metas.delete(dir);
      return true;
    }
    if (!MARKDOWN.test(name)) return false;
    let title: string | undefined;
    try {
      title = frontmatterTitle(await readHead(path.join(root, relative)));
    } catch {
      return index.files.delete(relative);
    }
    if (index.files.has(relative) && index.files.get(relative) === title) return false;
    index.files.set(relative, title);
    return true;
  };

  const scan = async (dir: string): Promise<boolean> => {
    let entries: Dirent[];
    try {
      entries = await readdir(path.join(root, dir), { recursive: true, withFileTypes: true });
    } catch {
      return false;
    }
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relative = path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/");
      if (!HIDDEN.test(relative)) files.push(relative);
    }
    return someLimit(files, READ_CONCURRENCY, refresh);
  };

  const drop = (prefix: string): boolean => {
    let any = false;
    for (const file of index.files.keys()) {
      if (file.startsWith(prefix)) any = index.files.delete(file);
    }
    for (const dir of index.metas.keys()) {
      if (dir.startsWith(prefix)) any = index.metas.delete(dir);
    }
    return any;
  };

  await scan("");

  return {
    tree: (canRead) => buildTree(index, canRead),
    update(event, absolute) {
      if (!absolute.startsWith(root + path.sep)) return Promise.resolve(false);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (HIDDEN.test(relative)) return Promise.resolve(false);
      if (event === "unlinkDir") return Promise.resolve(drop(`${relative}/`));
      // a moved-in directory: its files may arrive without events of their own
      if (event === "addDir") return scan(relative);
      return refresh(relative);
    },
  };
}
