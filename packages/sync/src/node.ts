import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { WebSocketServer, type WebSocket } from "ws";
import type { ComponentSpec, SyntaxOptions } from "@fumadocs-editor/core/parse";
import { createDocAuthority } from "./authority";

export interface SyncServerOptions {
  /** directory whose `.md`/`.mdx` files are mirrored */
  root: string;
}

export interface SyncServer {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
}

const MARKDOWN = /\.mdx?$/;

export function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * The dev-server side of the FS mirror: JSON over one websocket per client
 * (list / read / compare-and-swap write / watch), chokidar for external
 * changes. A successful write is broadcast to the other watchers straight
 * away and its own chokidar echo suppressed — the writer already knows.
 */
export function createSyncServer({ root }: SyncServerOptions): SyncServer {
  root = path.resolve(root);
  const wss = new WebSocketServer({ noServer: true });
  const watching = new Map<WebSocket, Set<string>>();
  /** version we ourselves just wrote per path: chokidar echoes to swallow */
  const selfWrites = new Map<string, string>();

  const resolveSafe = (relative: string): string => {
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`path escapes the sync root: ${relative}`);
    }
    return absolute;
  };

  const readState = async (relative: string) => {
    const text = await readFile(resolveSafe(relative), "utf-8");
    return { text, version: hashText(text) };
  };

  const broadcast = (relative: string, message: string, except?: WebSocket) => {
    for (const [client, paths] of watching) {
      if (client !== except && paths.has(relative)) client.send(message);
    }
  };

  // collaboratively edited documents: one authoritative Y.Doc per open file,
  // exchanged with clients as binary frames on this same websocket. The
  // authority's writes suppress their chokidar echo and reach plain mirror
  // watchers like any other client's write would.
  const authority = createDocAuthority<WebSocket>({
    read: readState,
    async write(relative, text) {
      const version = hashText(text);
      selfWrites.set(relative, version);
      await writeFile(resolveSafe(relative), text);
      broadcast(relative, JSON.stringify({ type: "change", path: relative, text, version }));
      return version;
    },
    send: (client, data) => client.send(data),
  });

  let watcher: FSWatcher | undefined;
  const ensureWatcher = () => {
    watcher ??= chokidarWatch(root, {
      ignoreInitial: true,
      ignored: (p) => path.basename(p).startsWith(".") || p.includes("node_modules"),
      // editors write in bursts; wait for the file to settle
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    }).on("all", (event, absolute) => {
      if ((event !== "change" && event !== "add") || !MARKDOWN.test(absolute)) return;
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      void readState(relative).then(
        (state) => {
          if (selfWrites.get(relative) === state.version) return;
          broadcast(relative, JSON.stringify({ type: "change", path: relative, ...state }));
          authority.diskChanged(relative, state);
        },
        () => {},
      );
    });
  };

  wss.on("connection", (client: WebSocket) => {
    watching.set(client, new Set());
    client.on("close", () => {
      watching.delete(client);
      authority.disconnect(client);
    });
    client.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) authority.handleBinary(client, new Uint8Array(data));
      else void handle(client, JSON.parse(String(data)));
    });
  });

  async function handle(
    client: WebSocket,
    message: {
      id?: number;
      type: string;
      path?: string;
      text?: string;
      baseVersion?: string;
      components?: unknown;
      options?: unknown;
    },
  ): Promise<void> {
    const reply = (result: unknown) =>
      client.send(JSON.stringify({ id: message.id, ok: true, result }));
    try {
      switch (message.type) {
        case "list": {
          const entries = await readdir(root, { recursive: true, withFileTypes: true });
          const files = [];
          for (const entry of entries) {
            if (!entry.isFile() || !MARKDOWN.test(entry.name)) continue;
            const absolute = path.join(entry.parentPath, entry.name);
            if (absolute.includes("node_modules")) continue;
            files.push({ path: path.relative(root, absolute).split(path.sep).join("/") });
          }
          files.sort((a, b) => (a.path < b.path ? -1 : 1));
          reply(files);
          return;
        }
        case "read":
          reply(await readState(message.path!));
          return;
        case "write": {
          const relative = message.path!;
          const current = await readState(relative).catch(() => ({ text: "", version: "" }));
          if (current.version !== message.baseVersion) {
            reply({ ok: false, current });
            return;
          }
          const text = message.text!;
          const version = hashText(text);
          selfWrites.set(relative, version);
          await writeFile(resolveSafe(relative), text);
          reply({ ok: true, version });
          broadcast(
            relative,
            JSON.stringify({ type: "change", path: relative, text, version }),
            client,
          );
          // the selfWrites echo suppression also silences chokidar for the
          // authority, so feed it the change directly
          authority.diskChanged(relative, { text, version });
          return;
        }
        case "collab-open": {
          // external edits must keep flowing into the authority's Y.Doc
          ensureWatcher();
          resolveSafe(message.path!);
          reply(
            await authority.open(
              message.path!,
              client,
              (message.components ?? []) as ComponentSpec[],
              message.options as SyntaxOptions | undefined,
            ),
          );
          return;
        }
        case "watch":
          ensureWatcher();
          watching.get(client)?.add(message.path!);
          return;
        case "unwatch":
          watching.get(client)?.delete(message.path!);
          return;
        default:
          throw new Error(`unknown message type: ${message.type}`);
      }
    } catch (error) {
      if (message.id != null) {
        client.send(JSON.stringify({ id: message.id, ok: false, error: String(error) }));
      }
    }
  }

  return {
    handleUpgrade(request, socket, head) {
      wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
    },
    async close() {
      await watcher?.close();
      await authority.close();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
