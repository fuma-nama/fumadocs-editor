import type { Dirent } from "node:fs";
import { mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { frontmatterTitle, type MetaJson, type TreeNode } from "../app/protocol";

/** what the tree is built from */
export interface WorkspaceIndex {
  /** root-relative posix path of every markdown file, to its frontmatter title */
  files: Map<string, string | undefined>;
  /** `meta.json` per directory, keyed by root-relative path (`""` = root) */
  metas: Map<string, MetaJson>;
}

/** a refused command, with the HTTP status it maps to */
export class CommandError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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
  /**
   * Writes a page holding only a frontmatter `title`. A folder listing its
   * pages explicitly (no `...`) gets the key appended, so the page shows
   * up in the Fumadocs sidebar too.
   */
  create(path: string, title: string): Promise<void>;
  /** writes `dir/meta.json` with the title and `dir/index.mdx`; listed in the parent like a page */
  mkdir(dir: string, title: string): Promise<void>;
  /**
   * Deletes a page through `unlink` (the sync server's, so no pending save
   * recreates it) and drops its `pages` entry unless a folder still
   * answers to the key.
   */
  remove(path: string, unlink: () => Promise<void>): Promise<void>;
  /** rewrites the folder's `pages` so the tree shows `order`, see {@link orderPages} */
  order(dir: string, order: string[]): Promise<void>;
}

interface Dir {
  /** page key (file name without extension) to file path */
  files: Map<string, string>;
  /** child directory names */
  dirs: Set<string>;
}

type Entry =
  | { type: "rest"; descending: boolean }
  | { type: "key"; key: string; folderOnly: boolean }
  | Extract<TreeNode, { type: "separator" | "link" }>;

const MARKDOWN = /\.mdx?$/;
const SEPARATOR = /^---(?:\[([^\]]+)\])?(.+)---$|^---$/;
const LINK = /^(external:)?(?:\[([^\]]+)\])?\[([^\]]+)\]\(([^)]+)\)$/;
/** a dot segment or `node_modules` anywhere in the relative path */
const HIDDEN = /(?:^|\/)(?:\.[^/]*|node_modules)(?:\/|$)/;
/** a YAML plain scalar that reads back as written */
const PLAIN = /^[\p{L}\p{N}][^:#"'\\]*$/u;
const HEAD_BYTES = 4096;
const READ_CONCURRENCY = 32;

/** the Fumadocs grammar of one `pages` entry */
function parseEntry(item: string): Entry {
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

const listsKey = (pages: string[], key: string) =>
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
function folderKeys({ files }: WorkspaceIndex, dir: string): string[] | undefined {
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

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** the path's segments, refused when one would leave the root or hide the file */
function segmentsOf(relative: string): string[] {
  const segments = relative.split("/");
  if (
    HIDDEN.test(relative) ||
    segments.some((s) => !s || s === "." || s === ".." || s.includes("\\"))
  ) {
    throw new CommandError(400, `not a workspace path: ${relative}`);
  }
  return segments;
}

const frontmatter = (title: string) =>
  `---\ntitle: ${PLAIN.test(title) && title.trim() === title ? title : JSON.stringify(title)}\n---\n`;

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
      const previous = index.metas.get(dir);
      if (meta && typeof meta === "object") index.metas.set(dir, meta as MetaJson);
      else index.metas.delete(dir);
      return JSON.stringify(previous) !== JSON.stringify(index.metas.get(dir));
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

  /** the folder's `meta.json` with `pages` replaced; other fields and their order survive */
  const writeMeta = async (dir: string, pages: string[]) => {
    const relative = dir ? `${dir}/meta.json` : "meta.json";
    let meta: unknown = {};
    try {
      meta = JSON.parse(await readFile(path.join(root, relative), "utf8"));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") meta = undefined;
    }
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      throw new CommandError(409, `${relative} is not a JSON object`);
    }
    (meta as MetaJson).pages = pages;
    await writeFile(path.join(root, relative), `${JSON.stringify(meta, null, 2)}\n`);
    await refresh(relative);
  };

  /** a folder listing its pages explicitly (no `...`) gets `key` appended */
  const list = async (dir: string, key: string) => {
    const pages = index.metas.get(dir)?.pages;
    if (
      Array.isArray(pages) &&
      !pages.some((item) => parseEntry(item).type === "rest") &&
      !listsKey(pages, key)
    ) {
      await writeMeta(dir, pages.concat(key));
    }
  };

  const split = (relative: string) => {
    const slash = relative.lastIndexOf("/");
    return {
      dir: slash < 0 ? "" : relative.slice(0, slash),
      key: relative.slice(slash + 1).replace(MARKDOWN, ""),
    };
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

    async create(relative, title) {
      if (!MARKDOWN.test(relative)) throw new CommandError(400, `not a page path: ${relative}`);
      const absolute = path.join(root, ...segmentsOf(relative));
      await mkdir(path.dirname(absolute), { recursive: true });
      try {
        await writeFile(absolute, frontmatter(title), { flag: "wx" });
      } catch (error) {
        if (errorCode(error) === "EEXIST")
          throw new CommandError(409, `${relative} already exists`);
        throw error;
      }
      const { dir, key } = split(relative);
      await list(dir, key);
      await refresh(relative);
    },

    async mkdir(dir, title) {
      const absolute = path.join(root, ...segmentsOf(dir));
      if (
        await stat(absolute).then(
          () => true,
          () => false,
        )
      ) {
        throw new CommandError(409, `${dir} already exists`);
      }
      await mkdir(absolute, { recursive: true });
      await writeFile(path.join(absolute, "meta.json"), `${JSON.stringify({ title }, null, 2)}\n`);
      await writeFile(path.join(absolute, "index.mdx"), frontmatter(title));
      const { dir: parent, key } = split(dir);
      await list(parent, key);
      await scan(dir);
    },

    async remove(relative, unlink) {
      if (!index.files.has(relative)) throw new CommandError(404, `no page at ${relative}`);
      await unlink();
      index.files.delete(relative);
      const { dir, key } = split(relative);
      const pages = index.metas.get(dir)?.pages;
      if (Array.isArray(pages) && listsKey(pages, key) && !folderKeys(index, dir)?.includes(key)) {
        const kept: string[] = [];
        for (const item of pages) {
          const entry = parseEntry(item);
          if (entry.type !== "key" || entry.key !== key) kept.push(item);
        }
        await writeMeta(dir, kept);
      }
    },

    async order(dir, order) {
      const keys = folderKeys(index, dir);
      if (!keys) throw new CommandError(404, `no pages under ${dir || "the root"}`);
      const known = new Set(keys);
      for (const item of order) {
        const entry = parseEntry(item);
        if (entry.type === "rest") throw new CommandError(400, `not an entry to place: ${item}`);
        if (entry.type === "key" && !known.has(entry.key)) {
          throw new CommandError(409, `${entry.key} is no longer under ${dir || "the root"}`);
        }
      }
      const pages = index.metas.get(dir)?.pages;
      const next = orderPages(pages, order, keys);
      if (JSON.stringify(next) === JSON.stringify(Array.isArray(pages) ? pages : ["..."])) return;
      await writeMeta(dir, next);
    },
  };
}
