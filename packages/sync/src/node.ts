import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { WebSocketServer, type WebSocket } from "ws";
import type { ComponentSpec, SyntaxOptions } from "@fumadocs-editor/core/parse";
import { createDocAuthority } from "./authority";
import { AUTH_HEADER, CLOSE_DENIED, type SyncUser } from "./transport";

/**
 * What one authenticated connection may do. Document identity is the
 * root-relative posix path, so the predicates are per-document permissions;
 * they run on the message hot path and must be synchronous and cheap — async
 * policy resolves inside `authenticate` and closes over the result (changes
 * apply on reconnect).
 */
export interface SyncScope {
  /** authoritative presence identity: awareness disagreeing on it is rewritten */
  user?: SyncUser;
  /** default true */
  read?: boolean | ((path: string) => boolean);
  write: boolean | ((path: string) => boolean);
}

export type SyncAuthenticate = (ctx: {
  request: IncomingMessage;
  /**
   * The client transport's `auth()` payload, verbatim: it rides the
   * connection hello on the websocket and {@link AUTH_HEADER} on the HTTP
   * media endpoints. Cookie-based consumers ignore it and read the request.
   */
  payload?: unknown;
}) => SyncScope | null | Promise<SyncScope | null>;

export interface SyncServerOptions {
  /** directory whose `.md`/`.mdx` files are mirrored */
  root: string;
  /**
   * Maps a connection or media request to a {@link SyncScope}; `null`
   * rejects. Runs once per websocket connection (again on every reconnect,
   * so refreshed tokens apply) and once per HTTP media request. Absent =
   * allow-all with write, the zero-config dev behaviour.
   */
  authenticate?: SyncAuthenticate;
  /** how long a connection may sit without its hello before it is closed */
  helloTimeoutMs?: number;
  /** how long an open document outlives its last client before eviction (default 60s) */
  evictAfterMs?: number;
  /**
   * Upload endpoint limits, enforced before anything is stored and
   * independent of auth: an oversized body is refused with 413, a body whose
   * content-type the pattern rejects (or that has none) with 415. Defaults:
   * 10 MiB, `image/*`.
   */
  upload?: { maxBytes?: number; types?: RegExp };
}

export interface SyncServer {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** POST media endpoint: stores under `assets/`, requires write on the stored path */
  handleUpload(request: IncomingMessage, response: ServerResponse): void;
  /** GET asset endpoint (`/<relative>` after the mount prefix), requires read */
  handleAsset(request: IncomingMessage, response: ServerResponse): void;
  close(): Promise<void>;
}

const MARKDOWN = /\.mdx?$/;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** scope with the boolean shorthands resolved to predicates */
interface Scope {
  user?: SyncUser;
  read: (path: string) => boolean;
  write: (path: string) => boolean;
}

const YES = () => true;
const NO = () => false;
const ALLOW: Scope = { read: YES, write: YES };
const DENY: Scope = { read: NO, write: NO };

const rule = (value: boolean | ((path: string) => boolean)) =>
  typeof value === "function" ? value : value ? YES : NO;

const toScope = (scope: SyncScope): Scope => ({
  user: scope.user,
  read: rule(scope.read ?? true),
  write: rule(scope.write),
});

interface Conn {
  scope?: Scope;
  /** a hello arrived and authenticate is resolving */
  authenticating?: boolean;
  watching: Set<string>;
}

/**
 * The dev-server side of the FS mirror: JSON over one websocket per client
 * (list / read / compare-and-swap write / watch), chokidar for external
 * changes. A successful write is broadcast to the other watchers straight
 * away and its own chokidar echo suppressed — the writer already knows.
 *
 * Nothing is processed on a connection before its hello frame has passed
 * `authenticate`; every surface (including the media endpoints and the Y
 * update stream) is then checked against the resolved scope, always with the
 * normalized root-relative path.
 */
export function createSyncServer({
  root,
  authenticate,
  helloTimeoutMs = 10_000,
  evictAfterMs,
  upload = {},
}: SyncServerOptions): SyncServer {
  root = path.resolve(root);
  const { maxBytes = 10 * 1024 * 1024, types: uploadTypes = /^image\// } = upload;
  const wss = new WebSocketServer({ noServer: true });
  const conns = new Map<WebSocket, Conn>();
  /** version we ourselves just wrote per path: chokidar echoes to swallow */
  const selfWrites = new Map<string, string>();

  const resolveSafe = (relative: string): string => {
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`path escapes the sync root: ${relative}`);
    }
    return absolute;
  };

  /** the normalized root-relative posix form every scope predicate sees */
  const rel = (relative: string): string =>
    path.relative(root, resolveSafe(relative)).split(path.sep).join("/");

  const readState = async (relative: string) => {
    const text = await readFile(resolveSafe(relative), "utf-8");
    return { text, version: hashText(text) };
  };

  const broadcast = (relative: string, message: string, except?: WebSocket) => {
    for (const [client, conn] of conns) {
      if (client !== except && conn.watching.has(relative)) client.send(message);
    }
  };

  const authorize = async (request: IncomingMessage, payload: unknown): Promise<Scope | null> => {
    if (!authenticate) return ALLOW;
    try {
      const scope = await authenticate({ request, payload });
      return scope && toScope(scope);
    } catch {
      return null;
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
    scope: (client) => conns.get(client)?.scope ?? DENY,
    evictAfterMs,
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

  wss.on("connection", (client: WebSocket, request: IncomingMessage) => {
    const conn: Conn = { watching: new Set() };
    conns.set(client, conn);
    const helloTimer = setTimeout(() => {
      if (!conn.scope) client.close(4408, "sync: no hello");
    }, helloTimeoutMs);
    client.on("close", () => {
      clearTimeout(helloTimer);
      conns.delete(client);
      authority.disconnect(client);
    });
    client.on("message", (data: Buffer, isBinary: boolean) => {
      if (conn.scope) {
        // a malformed frame must not throw out of the ws event loop
        try {
          if (isBinary) authority.handleBinary(client, new Uint8Array(data));
          else void handle(client, conn, JSON.parse(String(data)));
        } catch {}
        return;
      }
      // nothing precedes authentication: binary frames are dropped, requests
      // refused, and only the first hello starts the exchange
      if (isBinary) return;
      let message: { id?: number; type?: string; payload?: unknown };
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message.type !== "hello" || conn.authenticating) {
        if (message.id != null) {
          client.send(JSON.stringify({ id: message.id, ok: false, error: "not authenticated" }));
        }
        return;
      }
      conn.authenticating = true;
      void authorize(request, message.payload).then((scope) => {
        if (!scope) return client.close(CLOSE_DENIED, "sync: access denied");
        clearTimeout(helloTimer);
        conn.scope = scope;
        client.send(JSON.stringify({ id: message.id, ok: true, result: { user: scope.user } }));
      });
    });
  });

  async function handle(
    client: WebSocket,
    conn: Conn,
    message: {
      id?: number;
      type: string;
      path?: string;
      text?: string;
      baseVersion?: string;
      components?: unknown;
      syntax?: unknown;
    },
  ): Promise<void> {
    const scope = conn.scope!;
    const reply = (result: unknown) =>
      client.send(JSON.stringify({ id: message.id, ok: true, result }));
    try {
      switch (message.type) {
        case "list": {
          const entries = await readdir(root, { recursive: true, withFileTypes: true });
          const files: string[] = [];
          for (const entry of entries) {
            if (!entry.isFile() || !MARKDOWN.test(entry.name)) continue;
            const absolute = path.join(entry.parentPath, entry.name);
            if (absolute.includes("node_modules")) continue;
            const relative = path.relative(root, absolute).split(path.sep).join("/");
            if (scope.read(relative)) files.push(relative);
          }
          files.sort();
          reply(files);
          return;
        }
        case "read": {
          const relative = rel(message.path!);
          if (!scope.read(relative)) throw new Error(`read denied: ${relative}`);
          reply({
            ...(await readState(relative)),
            user: scope.user,
            writable: scope.write(relative),
          });
          return;
        }
        case "write": {
          const relative = rel(message.path!);
          if (!scope.write(relative)) throw new Error(`write denied: ${relative}`);
          const current = await readState(relative).catch(() => ({ text: "", version: "" }));
          if (current.version !== message.baseVersion) {
            // the losing writer is shown the current content: that is a read
            if (!scope.read(relative)) throw new Error(`read denied: ${relative}`);
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
          const relative = rel(message.path!);
          if (!scope.read(relative)) throw new Error(`read denied: ${relative}`);
          // external edits must keep flowing into the authority's Y.Doc
          ensureWatcher();
          const opened = await authority.open(
            relative,
            client,
            (message.components ?? []) as ComponentSpec[],
            message.syntax as SyntaxOptions | undefined,
          );
          reply({ ...opened, user: scope.user, writable: scope.write(relative) });
          return;
        }
        case "watch": {
          const relative = rel(message.path!);
          ensureWatcher();
          // an unreadable path is simply never registered, so its change
          // broadcasts are withheld from this client
          if (scope.read(relative)) conn.watching.add(relative);
          return;
        }
        case "unwatch":
          conn.watching.delete(rel(message.path!));
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

  /** authenticate an HTTP media request; the payload arrives in AUTH_HEADER */
  const httpScope = async (request: IncomingMessage): Promise<Scope | null> => {
    const header = request.headers[AUTH_HEADER];
    let payload: unknown;
    if (typeof header === "string") {
      try {
        payload = JSON.parse(header);
      } catch {
        return null;
      }
    }
    return authorize(request, payload);
  };

  const refuse = (response: ServerResponse, scope: Scope | null) => {
    response.statusCode = scope ? 403 : 401;
    response.end();
  };

  return {
    handleUpgrade(request, socket, head) {
      wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
    },

    handleUpload(request, response) {
      if (request.method !== "POST") {
        response.statusCode = 405;
        return response.end();
      }
      // limits come before auth and long before the write: type from the
      // header (fetch derives it from the File), size streamed, so an
      // oversized body is refused without ever being buffered whole
      const type = request.headers["content-type"];
      if (!type || !uploadTypes.test(type)) {
        response.statusCode = 415;
        return response.end();
      }
      if (Number(request.headers["content-length"]) > maxBytes) {
        response.statusCode = 413;
        return response.end();
      }
      const original = decodeURIComponent(String(request.headers["x-filename"] ?? "upload"))
        .replace(/[^\w.-]+/g, "-")
        .replace(/^[-.]+/, "");
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        if (response.writableEnded) return;
        size += chunk.length;
        if (size > maxBytes) {
          // respond early and drain the rest; destroying the socket here
          // would truncate the status before the client reads it
          chunks.length = 0;
          response.statusCode = 413;
          response.end();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        if (response.writableEnded) return;
        void (async () => {
          const name = `${Date.now().toString(36)}-${original || "upload"}`;
          const scope = await httpScope(request);
          if (!scope || !scope.write(`assets/${name}`)) return refuse(response, scope);
          await mkdir(path.join(root, "assets"), { recursive: true });
          await writeFile(path.join(root, "assets", name), Buffer.concat(chunks));
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ src: `./assets/${name}` }));
        })().catch((error) => {
          response.statusCode = 500;
          response.end(String(error));
        });
      });
    },

    handleAsset(request, response) {
      let relative: string | undefined;
      try {
        relative = rel(decodeURIComponent((request.url ?? "/").slice(1)));
      } catch {}
      if (request.method !== "GET" || !relative) {
        response.statusCode = 404;
        return response.end();
      }
      const target = relative;
      void httpScope(request).then((scope) => {
        if (!scope || !scope.read(target)) return refuse(response, scope);
        response.setHeader(
          "content-type",
          MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream",
        );
        createReadStream(resolveSafe(target))
          .on("error", () => {
            response.statusCode = 404;
            response.end();
          })
          .pipe(response);
      });
    },

    async close() {
      await watcher?.close();
      await authority.close();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
