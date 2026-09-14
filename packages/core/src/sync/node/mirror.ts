import { createHash } from "node:crypto";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { MARKDOWN } from "../tree";
import type { FileState } from "../transport";

export interface MirrorListener {
  /** a markdown file changed on disk through something other than this mirror */
  change(relative: string, state: FileState): void;
  /** any event under the root (chokidar's `add` / `change` / `unlink` / `addDir` / `unlinkDir`) */
  event(event: string, relative: string): void;
}

/** the mirrored directory: safe paths, versioned reads and writes, one watcher */
export interface Mirror {
  root: string;
  /** the normalized root-relative posix form every scope predicate sees; throws on escapes */
  rel(relative: string): string;
  /** absolute path under the root; throws on escapes */
  resolve(relative: string): string;
  read(relative: string): Promise<FileState>;
  /** writes and returns the new version; the watcher does not echo it */
  write(relative: string, text: string): Promise<string>;
  unlink(relative: string): Promise<void>;
  /** every markdown file under the root, sorted */
  list(): Promise<string[]>;
  /** starts following the directory; idempotent */
  watch(): void;
  close(): Promise<void>;
}

export const hashText = (text: string) => createHash("sha1").update(text).digest("hex");

export function createMirror(root: string, listener: MirrorListener): Mirror {
  root = path.resolve(root);
  /** version we ourselves just wrote per path: the chokidar echo to swallow */
  const own = new Map<string, string>();
  let watcher: FSWatcher | undefined;

  const resolve = (relative: string): string => {
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`path escapes the sync root: ${relative}`);
    }
    return absolute;
  };
  const toPosix = (absolute: string) => path.relative(root, absolute).split(path.sep).join("/");

  const read = async (relative: string): Promise<FileState> => {
    const text = await readFile(resolve(relative), "utf-8");
    return { text, version: hashText(text) };
  };

  return {
    root,
    rel: (relative) => toPosix(resolve(relative)),
    resolve,
    read,

    async write(relative, text) {
      const version = hashText(text);
      own.set(relative, version);
      await writeFile(resolve(relative), text);
      return version;
    },

    unlink: (relative) => unlink(resolve(relative)),

    async list() {
      const entries = await readdir(root, { recursive: true, withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !MARKDOWN.test(entry.name)) continue;
        const absolute = path.join(entry.parentPath, entry.name);
        if (!absolute.includes("node_modules")) files.push(toPosix(absolute));
      }
      return files.sort();
    },

    watch() {
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
            if (own.get(relative) !== state.version) listener.change(relative, state);
          },
          () => {},
        );
      });
    },

    close: async () => {
      await watcher?.close();
    },
  };
}
