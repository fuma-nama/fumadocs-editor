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
import { answer, encode, str, type Connection, type Incoming, type Resource } from "./connection";
import type { Files } from "./files";
import { HIDDEN } from "./storage";

/** the clients a change is made for: each file it writes is reported with them */
type By = ReadonlySet<Connection>;

export interface Workspace {
  /** the tree of the files `canRead` allows */
  tree(canRead: (path: string) => boolean): TreeNode[];
  /**
   * Something at `relative` changed around the server, a file or a folder,
   * added, edited or removed: re-reads it and reports whether the tree
   * changed.
   */
  update(relative: string): Promise<boolean>;
  /**
   * Writes a page holding only a frontmatter `title`. A folder listing its
   * pages explicitly (no `...`) gets the key appended, so the page shows
   * up in the Fumadocs sidebar too.
   */
  create(path: string, title: string, by?: By): Promise<void>;
  /** writes `dir/meta.json` with the title and `dir/index.mdx`; listed in the parent like a page */
  mkdir(dir: string, title: string, by?: By): Promise<void>;
  /** deletes a page and drops its `pages` entry unless a folder still answers to the key */
  remove(path: string, by?: By): Promise<void>;
  /** rewrites the folder's `pages` so the tree shows `order`, see {@link orderPages} */
  order(dir: string, order: string[], by?: By): Promise<void>;
}

/** a YAML plain scalar that reads back as written */
const PLAIN = /^[\p{L}\p{N}][^:#"'\\]*$/u;
/** frontmatter sits at the start of a page */
const HEAD_BYTES = 4096;
const READ_CONCURRENCY = 32;

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

const frontmatter = (title: string) =>
  `---\ntitle: ${PLAIN.test(title) && title.trim() === title ? title : JSON.stringify(title)}\n---\n`;

/**
 * Indexes the files once, then stays current through
 * {@link Workspace.update}. Markdown files carry their frontmatter title,
 * each `meta.json` its parsed content (invalid JSON counts as none). Every
 * write goes through `files`, under the lock of the file it writes.
 */
export async function openWorkspace(files: Files): Promise<Workspace> {
  const index: WorkspaceIndex = { files: new Map(), metas: new Map() };

  /** re-read one file; a missing one is dropped */
  const refresh = async (relative: string): Promise<boolean> => {
    const name = relative.slice(relative.lastIndexOf("/") + 1);
    if (name === "meta.json") {
      const dir = relative.slice(0, -"/meta.json".length);
      let meta: unknown;
      try {
        meta = JSON.parse((await files.read(relative))?.text ?? "");
      } catch {}
      const previous = index.metas.get(dir);
      if (meta && typeof meta === "object") index.metas.set(dir, meta as MetaJson);
      else index.metas.delete(dir);
      return JSON.stringify(previous) !== JSON.stringify(index.metas.get(dir));
    }
    if (!MARKDOWN.test(name)) return false;
    const head = await files.head(relative, HEAD_BYTES).catch(() => undefined);
    if (head === undefined) return index.files.delete(relative);
    const title = frontmatterTitle(head);
    if (index.files.has(relative) && index.files.get(relative) === title) return false;
    index.files.set(relative, title);
    return true;
  };

  /**
   * Re-reads what is under `dir` now and what the index holds there: an
   * entry goes only once its file is gone, so a command never finds a folder
   * half indexed.
   */
  const scan = async (dir: string): Promise<boolean> => {
    const listed = await files.list(dir).catch(() => undefined);
    if (!listed) return false;
    const prefix = dir ? `${dir}/` : "";
    const known = new Set<string>();
    for (const file of index.files.keys()) if (file.startsWith(prefix)) known.add(file);
    for (const key of index.metas.keys()) {
      if (key === dir || key.startsWith(prefix)) known.add(key ? `${key}/meta.json` : "meta.json");
    }
    for (const file of listed) known.delete(file);
    return someLimit([...listed, ...known], READ_CONCURRENCY, refresh);
  };

  /** writes a new file; one already there is left alone */
  const add = (relative: string, text: string, by?: By) =>
    files.lock(relative, async () => {
      if (await files.read(relative)) throw new Error(`${relative} already exists`);
      await files.write(relative, text, by);
    });

  /** the folder's `meta.json` with `pages` replaced; other fields and their order survive */
  const writeMeta = (dir: string, pages: string[], by?: By) => {
    const relative = dir ? `${dir}/meta.json` : "meta.json";
    // a save of the same file waits for the read and the write
    return files.lock(relative, async () => {
      const current = await files.read(relative);
      let meta: unknown = {};
      try {
        if (current) meta = JSON.parse(current.text);
      } catch {
        meta = undefined;
      }
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        throw new Error(`${relative} is not a JSON object`);
      }
      (meta as MetaJson).pages = pages;
      await files.write(relative, `${JSON.stringify(meta, null, 2)}\n`, by);
      await refresh(relative);
    });
  };

  /** a folder listing its pages explicitly (no `...`) gets `key` appended */
  const list = async (dir: string, key: string, by?: By) => {
    const pages = index.metas.get(dir)?.pages;
    if (
      Array.isArray(pages) &&
      !pages.some((item) => parseEntry(item).type === "rest") &&
      !listsKey(pages, key)
    ) {
      await writeMeta(dir, pages.concat(key), by);
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

    async update(relative) {
      if (HIDDEN.test(relative)) return false;
      const name = relative.slice(relative.lastIndexOf("/") + 1);
      if (name === "meta.json" || MARKDOWN.test(name)) return refresh(relative);
      // a folder, added or removed
      return scan(relative);
    },

    async create(relative, title, by) {
      if (!MARKDOWN.test(relative)) throw new Error(`not a page path: ${relative}`);
      await add(relative, frontmatter(title), by);
      const { dir, key } = split(relative);
      await list(dir, key, by);
      await refresh(relative);
    },

    async mkdir(dir, title, by) {
      if (!dir || (await files.list(dir)).length > 0) {
        throw new Error(`${dir || "the root"} already exists`);
      }
      await add(`${dir}/meta.json`, `${JSON.stringify({ title }, null, 2)}\n`, by);
      await add(`${dir}/index.mdx`, frontmatter(title), by);
      const { dir: parent, key } = split(dir);
      await list(parent, key, by);
      await scan(dir);
    },

    async remove(relative, by) {
      if (!index.files.has(relative)) throw new Error(`no page at ${relative}`);
      await files.lock(relative, () => files.delete(relative, by));
      index.files.delete(relative);
      const { dir, key } = split(relative);
      const pages = index.metas.get(dir)?.pages;
      if (Array.isArray(pages) && listsKey(pages, key) && !folderKeys(index, dir)?.includes(key)) {
        const kept: string[] = [];
        for (const item of pages) {
          const entry = parseEntry(item);
          if (entry.type !== "key" || entry.key !== key) kept.push(item);
        }
        await writeMeta(dir, kept, by);
      }
    },

    async order(dir, order, by) {
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
      const same = JSON.stringify(next) === JSON.stringify(Array.isArray(pages) ? pages : ["..."]);
      if (!same) await writeMeta(dir, next, by);
    },
  };
}

/** many files change at once (a `git pull`): one tree for the burst */
const TREE_SETTLE_MS = 100;

/**
 * The `tree` resource: the workspace indexed on first use, every subscriber
 * sent the tree its scope may read, commands run one at a time.
 */
export function createTreeResource(
  files: Files,
  /** forgets the collab doc of a file: a save of it would bring the file back */
  drop: (relative: string) => Promise<void>,
) {
  const subscribers = new Set<Connection>();
  let workspace: Promise<Workspace> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let queue = Promise.resolve();

  const open = () => {
    files.watch();
    return (workspace ??= openWorkspace(files));
  };
  const treeFor = (conn: Connection, ws: Workspace) => ({
    root: files.name,
    nodes: ws.tree(conn.scope.read),
  });
  const push = async (except?: Connection) => {
    clearTimeout(timer);
    timer = undefined;
    const ws = await workspace!;
    // subscribers sharing a `read` rule (the default one, say) share its tree and encoding
    const sent = new Map<Connection["scope"]["read"], ReturnType<typeof encode>>();
    for (const conn of subscribers) {
      if (conn === except) continue;
      let data = sent.get(conn.scope.read);
      if (!data) {
        data = encode({ resource: "tree", tree: treeFor(conn, ws) });
        sent.set(conn.scope.read, data);
      }
      conn.send(data);
    }
  };

  /** validates a command against the scope; the returned task changes the workspace */
  const command = (conn: Connection, value: unknown): ((ws: Workspace) => Promise<void>) => {
    if (!value || typeof value !== "object") throw new Error("malformed message");
    const body = value as Incoming;
    const writable = (relative: string) => {
      if (!conn.scope.write(relative)) throw new Error(`write denied: ${relative}`);
      return relative;
    };
    const by = new Set([conn]);
    switch (body.type) {
      case "create": {
        const relative = writable(files.rel(str(body.path)));
        const title = str(body.title);
        return (ws) => ws.create(relative, title, by);
      }
      case "mkdir": {
        const dir = files.rel(str(body.dir));
        writable(dir ? `${dir}/meta.json` : "meta.json");
        writable(dir ? `${dir}/index.mdx` : "index.mdx");
        const title = str(body.title);
        return (ws) => ws.mkdir(dir, title, by);
      }
      case "delete": {
        const relative = writable(files.rel(str(body.path)));
        return async (ws) => {
          await drop(relative);
          await ws.remove(relative, by);
          // a doc opened while the file was going would save it back
          await drop(relative);
        };
      }
      case "order": {
        const dir = files.rel(str(body.dir));
        writable(dir ? `${dir}/meta.json` : "meta.json");
        if (!Array.isArray(body.order)) throw new Error("malformed message");
        const entries: string[] = [];
        for (const item of body.order) entries.push(str(item));
        return (ws) => ws.order(dir, entries, by);
      }
      default:
        throw new Error(`unknown command: ${String(body.type)}`);
    }
  };

  return {
    /** a change around the server; the tree follows once the workspace is open */
    event(relative: string) {
      if (!workspace) return;
      void workspace.then(async (ws) => {
        if (await ws.update(relative)) timer ??= setTimeout(push, TREE_SETTLE_MS);
      });
    },

    async subscribe(conn, message) {
      const ws = await open();
      subscribers.add(conn);
      answer(conn, message, { resource: "tree", tree: treeFor(conn, ws) });
    },

    unsubscribe(conn) {
      subscribers.delete(conn);
    },

    async update(conn, message) {
      const task = command(conn, message.command);
      const ws = await open();
      // commands read and rewrite meta.json: two at once would lose an entry
      const run = queue.then(() => task(ws));
      queue = run.catch(() => {});
      await run;
      await push(conn);
      answer(conn, message, { resource: "tree", tree: treeFor(conn, ws) });
    },

    leave(conn) {
      subscribers.delete(conn);
    },

    close() {
      clearTimeout(timer);
    },
  } satisfies Resource & Record<string, unknown>;
}
