import { createHash } from "node:crypto";
import path from "node:path";
import { MARKDOWN } from "../tree";
import { answer, encode, str, type Connection, type Resource } from "./connection";
import { HIDDEN, type SyncStorage } from "./storage";

export interface FileState {
  text: string;
  /** content hash; the compare-and-swap token for writes */
  version: string;
}

export type Files = ReturnType<typeof createFiles>;

export const hashText = (text: string) => createHash("sha1").update(text).digest("hex");

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const NOBODY: ReadonlySet<Connection> = new Set();

/** the text of what the storage read, its first `length` bytes or a little more */
async function decode(data: Uint8Array | AsyncIterable<Uint8Array>, length = Infinity) {
  if (data instanceof Uint8Array) return decoder.decode(data.subarray(0, length));
  const stream = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of data) {
    text += stream.decode(chunk, { stream: true });
    // leaving the loop ends the read: the rest is never fetched
    if ((size += chunk.length) >= length) break;
  }
  return text + stream.decode();
}

/**
 * The server's side of the storage: normalized paths, versions, one lock per
 * path, its own writes told apart from changes made around it, every write
 * reported with the clients it was for, and the `file` resource.
 */
export function createFiles(
  storage: SyncStorage,
  listener: {
    /** a markdown file holds new text: changed around the server, or saved by a client */
    changed(relative: string, state: FileState): void;
    /** a file or folder changed around the server */
    event(relative: string): void;
    /** a collab document holds the file: what changes in it is merged */
    isOpen(relative: string): boolean;
    /** the server wrote or deleted the file for `by` */
    wrote(relative: string, by: Connection): void;
  },
) {
  /** the version we last wrote per path, until the watcher sees another: its echoes are swallowed */
  const own = new Map<string, string>();
  const locks = new Map<string, Promise<unknown>>();
  const subscribers = new Map<string, Set<Connection>>();
  let unwatch: (() => void | Promise<void>) | undefined;

  /** the form every scope predicate and the storage see; anything else throws */
  const rel = (relative: string): string => {
    const normalized = path.posix.normalize(relative).replace(/\/$/, "");
    if (normalized === "." || normalized === "") return "";
    // `..` is a hidden segment too; Windows reads a backslash as a separator
    if (normalized.startsWith("/") || HIDDEN.test(normalized) || /[\\\0]/.test(normalized)) {
      throw new Error(`not a sync path: ${relative}`);
    }
    return normalized;
  };

  /** the files under `dir` that are synced */
  const list = async (dir: string) => {
    const paths: string[] = [];
    for (const listed of await storage.list(dir)) {
      try {
        paths.push(rel(listed));
      } catch {}
    }
    return paths;
  };

  /** read under `lock` unless holding it: a write of ours is never seen half done */
  const read = async (relative: string): Promise<FileState | undefined> => {
    const data = await storage.read(relative);
    if (data === undefined) return undefined;
    const text = await decode(data);
    return { text, version: hashText(text) };
  };

  /** the start of a file, `length` bytes or a little more: what a title needs */
  const head = async (relative: string, length: number) => {
    const data = await storage.read(relative);
    return data && decode(data, length);
  };

  const push = (relative: string, state: FileState, except: ReadonlySet<Connection>) => {
    const set = subscribers.get(relative);
    if (!set) return;
    const data = encode({ resource: "file", path: relative, ...state });
    for (const conn of set) if (!except.has(conn)) conn.send(data);
  };

  /** for a caller holding the lock: the subscribers other than `by` hear of it */
  const write = async (relative: string, text: string, by = NOBODY) => {
    const version = hashText(text);
    own.set(relative, version);
    await storage.write(relative, encoder.encode(text));
    push(relative, { text, version }, by);
    for (const conn of by) listener.wrote(relative, conn);
    return version;
  };

  /** for a caller holding the lock */
  const remove = async (relative: string, by = NOBODY) => {
    await storage.delete(relative);
    for (const conn of by) listener.wrote(relative, conn);
  };

  /** runs `task` after every earlier task on the same path: reads and writes never interleave */
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
    unwatch ??=
      storage.watch?.((changed) => {
        let relative: string;
        try {
          relative = rel(changed);
        } catch {
          return;
        }
        listener.event(relative);
        if (!MARKDOWN.test(relative)) return;
        // nobody holds it open: nothing to push or merge, and a large file stays unread
        if (!subscribers.has(relative) && !listener.isOpen(relative)) {
          own.delete(relative);
          return;
        }
        void lock(relative, () => read(relative)).then(
          (state) => {
            // our write, as often as the watcher repeats it
            if (own.get(relative) === state?.version) return;
            // then anything is someone else's, our text again included (an undo in an IDE)
            own.delete(relative);
            if (!state) return;
            push(relative, state, NOBODY);
            listener.changed(relative, state);
          },
          () => {},
        );
      }) ?? (() => {});
  };

  return {
    /** the workspace's name */
    name: storage.name ?? "",
    storage,
    rel,
    list,
    read,
    head,
    lock,
    write,
    delete: remove,
    watch,

    async subscribe(conn, message) {
      const relative = rel(str(message.path));
      if (!conn.scope.read(relative)) throw new Error(`read denied: ${relative}`);
      watch();
      const state = await lock(relative, () => read(relative));
      if (!state) throw new Error(`no such file: ${relative}`);
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
        const current = (await read(relative)) ?? { text: "", version: "" };
        if (current.version !== base) {
          // the losing writer is shown the current content: that is a read
          if (!conn.scope.read(relative)) throw new Error(`read denied: ${relative}`);
          return answer(conn, message, { resource: "file", path: relative, ...current });
        }
        // pushes and the answer leave before the lock releases: in write order
        const version = await write(relative, text, new Set([conn]));
        answer(conn, message, { resource: "file", path: relative, version });
        // the own-write echo is swallowed, so the listener hears of it here
        listener.changed(relative, { text, version });
      });
    },

    leave(conn) {
      for (const [relative, set] of subscribers) {
        if (set.delete(conn) && set.size === 0) subscribers.delete(relative);
      }
    },

    async close() {
      await unwatch?.();
    },
  } satisfies Resource & Record<string, unknown>;
}
