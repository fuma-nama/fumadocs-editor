import { createHash } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { MARKDOWN } from "../tree";
import { answer, encode, str, type Connection, type Resource } from "./connection";

export interface FileState {
  text: string;
  /** content hash; the compare-and-swap token for writes */
  version: string;
}

export type Files = ReturnType<typeof createFiles>;

export const hashText = (text: string) => createHash("sha1").update(text).digest("hex");

/** the mirrored directory, and the `file` resource over it */
export function createFiles(
  root: string,
  listener: {
    /** a markdown file changed, on disk or through a client write; never for `write` */
    changed(relative: string, state: FileState): void;
    /** any watcher event under the root (chokidar's `add` / `change` / `unlink` / `addDir` / `unlinkDir`) */
    event(event: string, relative: string): void;
  },
) {
  root = path.resolve(root);
  /** version we ourselves just wrote per path: the chokidar echo to swallow */
  const own = new Map<string, string>();
  const locks = new Map<string, Promise<unknown>>();
  const subscribers = new Map<string, Set<Connection>>();
  let watcher: FSWatcher | undefined;

  const resolve = (relative: string): string => {
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`path escapes the sync root: ${relative}`);
    }
    return absolute;
  };
  const toPosix = (absolute: string) => path.relative(root, absolute).split(path.sep).join("/");
  /** the normalized form every scope predicate sees; throws on escapes */
  const rel = (relative: string) => toPosix(resolve(relative));

  const read = async (relative: string): Promise<FileState> => {
    const text = await readFile(resolve(relative), "utf-8");
    return { text, version: hashText(text) };
  };

  const push = (relative: string, state: FileState, except?: Connection) => {
    const set = subscribers.get(relative);
    if (!set) return;
    const data = encode({ resource: "file", path: relative, ...state });
    for (const conn of set) if (conn !== except) conn.send(data);
  };

  const store = async (relative: string, text: string) => {
    const version = hashText(text);
    own.set(relative, version);
    await writeFile(resolve(relative), text);
    return version;
  };

  /** an unconditional write for a caller holding the lock; subscribers hear of it */
  const write = async (relative: string, text: string) => {
    const version = await store(relative, text);
    push(relative, { text, version });
    return version;
  };

  /** runs `task` after every earlier task on the same path: disk writes never interleave */
  const lock = <T>(relative: string, task: () => Promise<T>): Promise<T> => {
    const run = (locks.get(relative) ?? Promise.resolve()).then(task);
    const tail = run.catch(() => {});
    locks.set(relative, tail);
    void tail.then(() => {
      if (locks.get(relative) === tail) locks.delete(relative);
    });
    return run;
  };

  const watch = () => {
    watcher ??= chokidarWatch(root, {
      ignoreInitial: true,
      ignored: (p) => path.basename(p).startsWith(".") || p.includes("node_modules"),
      // editors write in bursts; wait for the file to settle
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    }).on("all", (event, absolute) => {
      const relative = toPosix(absolute);
      listener.event(event, relative);
      if ((event !== "change" && event !== "add") || !MARKDOWN.test(relative)) return;
      void read(relative).then(
        (state) => {
          if (own.get(relative) === state.version) return;
          push(relative, state);
          listener.changed(relative, state);
        },
        () => {},
      );
    });
  };

  return {
    root,
    rel,
    resolve,
    read,
    lock,
    write,
    unlink: (relative: string) => lock(relative, () => unlink(resolve(relative))),
    watch,

    async subscribe(conn, message) {
      const relative = rel(str(message.path));
      if (!conn.scope.read(relative)) throw new Error(`read denied: ${relative}`);
      watch();
      const state = await read(relative);
      let set = subscribers.get(relative);
      if (!set) subscribers.set(relative, (set = new Set()));
      set.add(conn);
      answer(conn, message, {
        resource: "file",
        path: relative,
        ...state,
        writable: conn.scope.write(relative),
      });
    },

    unsubscribe(conn, message) {
      const relative = rel(str(message.path));
      const set = subscribers.get(relative);
      if (set?.delete(conn) && set.size === 0) subscribers.delete(relative);
    },

    async update(conn, message) {
      const relative = rel(str(message.path));
      if (!conn.scope.write(relative)) throw new Error(`write denied: ${relative}`);
      const text = str(message.text);
      const base = str(message.base);
      await lock(relative, async () => {
        const current = await read(relative).catch(() => ({ text: "", version: "" }));
        if (current.version !== base) {
          // the losing writer is shown the current content: that is a read
          if (!conn.scope.read(relative)) throw new Error(`read denied: ${relative}`);
          return answer(conn, message, { resource: "file", path: relative, ...current });
        }
        const version = await store(relative, text);
        // the writer first, then pushes in write order: both before the lock releases
        answer(conn, message, { resource: "file", path: relative, version });
        push(relative, { text, version }, conn);
        // the own-write echo is swallowed, so the listener hears of it here
        listener.changed(relative, { text, version });
      });
    },

    leave(conn) {
      for (const [relative, set] of subscribers) {
        if (set.delete(conn) && set.size === 0) subscribers.delete(relative);
      }
    },

    close: async () => {
      await watcher?.close();
    },
  } satisfies Resource & Record<string, unknown>;
}
