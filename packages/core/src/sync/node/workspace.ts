import type { Dirent } from "node:fs";
import { mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MARKDOWN,
  buildTree,
  folderKeys,
  frontmatterTitle,
  listsKey,
  orderPages,
  parseEntry,
  type MetaJson,
  type TreeNode,
  type WorkspaceIndex,
} from "../tree";

export interface Workspace {
  /** the tree of the files `canRead` allows */
  tree(canRead: (path: string) => boolean): TreeNode[];
  /**
   * Apply a watcher event (chokidar's `add` / `change` / `unlink` /
   * `addDir` / `unlinkDir`) for the root-relative `relative`: re-reads what
   * it names and reports whether the tree changed.
   */
  update(event: string, relative: string): Promise<boolean>;
  /**
   * Writes a page holding only a frontmatter `title`. A folder listing its
   * pages explicitly (no `...`) gets the key appended, so the page shows
   * up in the Fumadocs sidebar too.
   */
  create(path: string, title: string): Promise<void>;
  /** writes `dir/meta.json` with the title and `dir/index.mdx`; listed in the parent like a page */
  mkdir(dir: string, title: string): Promise<void>;
  /**
   * Deletes a page through `unlink` and drops its `pages` entry unless a
   * folder still answers to the key.
   */
  remove(path: string, unlink: () => Promise<void>): Promise<void>;
  /** rewrites the folder's `pages` so the tree shows `order`, see {@link orderPages} */
  order(dir: string, order: string[]): Promise<void>;
}

/** a dot segment or `node_modules` anywhere in the relative path */
const HIDDEN = /(?:^|\/)(?:\.[^/]*|node_modules)(?:\/|$)/;
/** a YAML plain scalar that reads back as written */
const PLAIN = /^[\p{L}\p{N}][^:#"'\\]*$/u;
const HEAD_BYTES = 4096;
const READ_CONCURRENCY = 32;

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
    throw new Error(`not a workspace path: ${relative}`);
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
      throw new Error(`${relative} is not a JSON object`);
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

    update(event, relative) {
      if (HIDDEN.test(relative)) return Promise.resolve(false);
      if (event === "unlinkDir") return Promise.resolve(drop(`${relative}/`));
      // a moved-in directory: its files may arrive without events of their own
      if (event === "addDir") return scan(relative);
      return refresh(relative);
    },

    async create(relative, title) {
      if (!MARKDOWN.test(relative)) throw new Error(`not a page path: ${relative}`);
      const absolute = path.join(root, ...segmentsOf(relative));
      await mkdir(path.dirname(absolute), { recursive: true });
      try {
        await writeFile(absolute, frontmatter(title), { flag: "wx" });
      } catch (error) {
        if (errorCode(error) === "EEXIST") throw new Error(`${relative} already exists`);
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
        throw new Error(`${dir} already exists`);
      }
      await mkdir(absolute, { recursive: true });
      await writeFile(path.join(absolute, "meta.json"), `${JSON.stringify({ title }, null, 2)}\n`);
      await writeFile(path.join(absolute, "index.mdx"), frontmatter(title));
      const { dir: parent, key } = split(dir);
      await list(parent, key);
      await scan(dir);
    },

    async remove(relative, unlink) {
      if (!index.files.has(relative)) throw new Error(`no page at ${relative}`);
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
      if (!keys) throw new Error(`no pages under ${dir || "the root"}`);
      const known = new Set(keys);
      for (const item of order) {
        const entry = parseEntry(item);
        if (entry.type === "rest") throw new Error(`not an entry to place: ${item}`);
        if (entry.type === "key" && !known.has(entry.key)) {
          throw new Error(`${entry.key} is no longer under ${dir || "the root"}`);
        }
      }
      const pages = index.metas.get(dir)?.pages;
      const next = orderPages(pages, order, keys);
      if (JSON.stringify(next) === JSON.stringify(Array.isArray(pages) ? pages : ["..."])) return;
      await writeMeta(dir, next);
    },
  };
}
