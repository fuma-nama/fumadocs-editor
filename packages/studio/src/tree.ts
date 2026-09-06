import { open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { frontmatterTitle, type MetaJson, type TreeNode } from "../app/protocol";

export interface TreeInput {
  /** root-relative posix paths of the markdown files */
  files: string[];
  /** `meta.json` per directory, keyed by root-relative path (`""` = root) */
  metas: Record<string, MetaJson | undefined>;
  /** frontmatter title per file path */
  titles: Record<string, string | undefined>;
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

const byName = (a: string, b: string) =>
  Number(a !== "index") - Number(b !== "index") || a.localeCompare(b);

/**
 * Sidebar order from the `meta.json` subset Fumadocs uses: `pages` lists
 * keys, `---Label---` separators, `...` / `z...a` for the rest, `[text](url)`
 * links (skipped), `!key` (listed anyway: an editor must reach every file).
 * Unknown keys are dropped; keys `pages` does not mention are still appended
 * at the end. Without `pages`: `index` first, then by name.
 */
export function buildTree({ files, metas, titles }: TreeInput): TreeNode[] {
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
      items.set(key, { type: "file", name: key, path: file, title: titles[file] ?? key });
    }
    for (const name of entry.dirs) {
      const childPath = dir ? `${dir}/${name}` : name;
      const children = build(childPath);
      if (children.length === 0) continue;
      const title = metas[childPath]?.title;
      items.set(`${name}/`, {
        type: "folder",
        name,
        path: childPath,
        title: typeof title === "string" ? title : name,
        children,
      });
    }

    const pages = metas[dir]?.pages;
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

/**
 * The tree of `root`: markdown files the scope may read, `meta.json` per
 * directory (invalid JSON counts as none), titles from each file's head.
 */
export async function readTree(
  root: string,
  canRead: (path: string) => boolean,
): Promise<TreeNode[]> {
  root = path.resolve(root);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  const metaFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const relative = path
      .relative(root, path.join(entry.parentPath, entry.name))
      .split(path.sep)
      .join("/");
    if (HIDDEN.test(relative)) continue;
    if (entry.name === "meta.json") metaFiles.push(relative);
    else if (MARKDOWN.test(entry.name) && canRead(relative)) files.push(relative);
  }
  const metas: TreeInput["metas"] = {};
  const titles: TreeInput["titles"] = {};
  const reads: Promise<void>[] = [];
  for (const file of metaFiles) {
    reads.push(
      readFile(path.join(root, file), "utf8").then(
        (json) => {
          try {
            metas[path.posix.dirname(file).replace(/^\.$/, "")] = JSON.parse(json);
          } catch {}
        },
        () => {},
      ),
    );
  }
  for (const file of files) {
    reads.push(
      readHead(path.join(root, file)).then(
        (head) => {
          titles[file] = frontmatterTitle(head);
        },
        () => {},
      ),
    );
  }
  await Promise.all(reads);
  return buildTree({ files, metas, titles });
}
