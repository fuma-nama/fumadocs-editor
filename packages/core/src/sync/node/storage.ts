import type { Dirent } from "node:fs";
import { mkdir, open, readdir, unlink, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { watch } from "chokidar";

/**
 * Where the synced files live. Paths are root-relative and use `/`
 * (`guide/intro.mdx`). The server normalizes them first: they never start
 * with `/`, leave the root, or name a dot entry or `node_modules`.
 */
export interface SyncStorage {
  /** shown above the file tree; `fsStorage` uses the directory's name */
  name?: string;
  /** every file under the `dir` folder (`""` for all), at any depth */
  list(dir: string): Promise<string[]>;
  /**
   * The file's content, as bytes or a stream of them: the server sends
   * assets as they stream and reads only the start of a page for its title.
   * `undefined` when there is no such file.
   */
  read(path: string): Promise<Uint8Array | AsyncIterable<Uint8Array> | undefined>;
  /** creates or replaces the file, with the folders it needs */
  write(path: string, data: Uint8Array): Promise<void>;
  /** removes the file, if there is one */
  delete(path: string): Promise<void>;
  /**
   * Hears what changes around the server, like an IDE save or a `git pull`:
   * `changed` gets the path of each file or folder added, edited or removed,
   * until the returned function stops it. Without `watch`, the server only
   * sees its own writes.
   */
  watch?(changed: (path: string) => void): () => void | Promise<void>;
}

/** a dot segment or `node_modules`: never synced */
export const HIDDEN = /(?:^|\/)(?:\.[^/]*|node_modules)(?:\/|$)/;

const MISSING = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code ?? "";

/** a page's title sits at its start: the first chunk is small */
const FIRST_CHUNK = 4096;
const CHUNK = 64 * 1024;

/** the file in chunks; ending the iteration early closes it */
async function* chunks(handle: FileHandle): AsyncGenerator<Uint8Array> {
  try {
    for (let size = FIRST_CHUNK; ; size = CHUNK) {
      const { bytesRead, buffer } = await handle.read(Buffer.allocUnsafe(size), 0, size, null);
      if (bytesRead === 0) return;
      yield buffer.subarray(0, bytesRead);
    }
  } finally {
    await handle.close();
  }
}

/** the files in a directory on disk, watched with chokidar: the default storage */
export function fsStorage(dir: string): SyncStorage {
  const root = path.resolve(dir);
  const toPosix = (absolute: string) => path.relative(root, absolute).split(path.sep).join("/");
  /** a guard behind the server's: nothing resolves outside the root */
  const resolve = (relative: string) => {
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`path escapes the storage root: ${relative}`);
    }
    return absolute;
  };

  return {
    name: path.basename(root),

    async list(dir) {
      const files: string[] = [];
      const walk = async (relative: string): Promise<void> => {
        let entries: Dirent[];
        try {
          entries = await readdir(resolve(relative), { withFileTypes: true });
        } catch {
          return; // missing, or a file
        }
        const folders: Promise<void>[] = [];
        for (const entry of entries) {
          // the server skips them anyway, and node_modules is large
          if (HIDDEN.test(entry.name)) continue;
          const child = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) folders.push(walk(child));
          else if (entry.isFile()) files.push(child);
        }
        await Promise.all(folders);
      };
      await walk(dir);
      return files;
    },

    async read(relative) {
      let handle: FileHandle | undefined;
      try {
        handle = await open(resolve(relative));
        // a folder opens too, but has no content
        if ((await handle.stat()).isFile()) return chunks(handle);
      } catch (error) {
        if (!MISSING.has(codeOf(error))) {
          await handle?.close();
          throw error;
        }
      }
      await handle?.close();
      return undefined;
    },

    async write(relative, data) {
      const file = resolve(relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },

    async delete(relative) {
      try {
        await unlink(resolve(relative));
      } catch (error) {
        if (codeOf(error) !== "ENOENT") throw error;
      }
    },

    watch(changed) {
      const watcher = watch(root, {
        ignoreInitial: true,
        ignored: (absolute) => HIDDEN.test(toPosix(absolute)),
        // editors write in bursts; wait for the file to settle
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
      }).on("all", (_event, absolute) => changed(toPosix(absolute)));
      return () => watcher.close();
    },
  };
}
