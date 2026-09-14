import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { ComponentSpec, SyntaxOptions } from "../../components/spec";
import { CLOSE_DENIED } from "../transport";
import type { WorkspaceTree } from "../tree";
import { createDocAuthority } from "./authority";
import { createMediaHandlers, type UploadLimits } from "./media";
import { createMirror } from "./mirror";
import { createAuthorize, DENY, type Scope, type SyncAuthenticate } from "./scope";
import { openWorkspace, type Workspace } from "./workspace";

export type { SyncAuthenticate, SyncScope } from "./scope";

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
  upload?: UploadLimits;
}

export interface SyncServer {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** POST media endpoint: stores under `assets/`, requires write on the stored path */
  handleUpload(request: IncomingMessage, response: ServerResponse): void;
  /** GET asset endpoint (`/<relative>` after the mount prefix), requires read */
  handleAsset(request: IncomingMessage, response: ServerResponse): void;
  close(): Promise<void>;
}

interface Conn {
  scope?: Scope;
  /** a hello arrived and authenticate is resolving */
  authenticating?: boolean;
  watching: Set<string>;
  /** receives the workspace tree whenever it changes */
  tree?: boolean;
}

interface Request {
  id?: number;
  type: string;
  path?: unknown;
  text?: unknown;
  baseVersion?: unknown;
  components?: unknown;
  syntax?: unknown;
  title?: unknown;
  dir?: unknown;
  order?: unknown;
}

/** many files change at once (a `git pull`): one tree for the burst */
const TREE_SETTLE_MS = 100;

const str = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("malformed request");
  return value;
};

/**
 * The dev-server FS mirror over one websocket per client: JSON requests
 * (list / read / compare-and-swap write / watch / the workspace tree and
 * its commands / collab-open), binary frames for collab. A successful write
 * is broadcast to the other watchers at once and its own watcher echo is
 * swallowed: the writer already knows.
 *
 * Nothing is processed before the hello frame passes `authenticate`. Every
 * surface (media endpoints, Y update stream) is then checked against the
 * resolved scope, always with the normalized root-relative path.
 */
export function createSyncServer({
  root,
  authenticate,
  helloTimeoutMs = 10_000,
  evictAfterMs,
  upload = {},
}: SyncServerOptions): SyncServer {
  const wss = new WebSocketServer({ noServer: true });
  const conns = new Map<WebSocket, Conn>();
  const authorize = createAuthorize(authenticate);

  const broadcast = (relative: string, message: string, except?: WebSocket) => {
    for (const [client, conn] of conns) {
      if (client !== except && conn.watching.has(relative)) client.send(message);
    }
  };
  const changed = (relative: string, text: string, version: string, except?: WebSocket) =>
    broadcast(relative, JSON.stringify({ type: "change", path: relative, text, version }), except);

  const mirror = createMirror(root, {
    change(relative, state) {
      changed(relative, state.text, state.version);
      authority.diskChanged(relative, state);
    },
    event(event, relative) {
      if (!workspace) return;
      void workspace.then(async (ws) => {
        if (await ws.update(event, relative))
          treeTimer ??= setTimeout(broadcastTree, TREE_SETTLE_MS);
      });
    },
  });

  // collaboratively edited documents: one authoritative Y.Doc per open file,
  // exchanged with clients as binary frames on this same websocket. Its
  // writes reach plain mirror watchers like any other client's would.
  const authority = createDocAuthority<WebSocket>({
    read: mirror.read,
    async write(relative, text) {
      const version = await mirror.write(relative, text);
      changed(relative, text, version);
      return version;
    },
    send: (client, data) => client.send(data),
    scope: (client) => conns.get(client)?.scope ?? DENY,
    evictAfterMs,
  });

  // the sidebar's view of the directory, indexed on first request and kept
  // current by the watcher; every subscriber gets the tree its scope allows
  let workspace: Promise<Workspace> | undefined;
  let treeTimer: NodeJS.Timeout | undefined;
  const openWorkspaceOnce = () => {
    mirror.watch();
    return (workspace ??= openWorkspace(mirror.root));
  };
  const treeFor = (conn: Conn, ws: Workspace): WorkspaceTree => ({
    root: path.basename(mirror.root),
    nodes: ws.tree(conn.scope!.read),
  });
  const broadcastTree = async () => {
    clearTimeout(treeTimer);
    treeTimer = undefined;
    const ws = await workspace!;
    for (const [client, conn] of conns) {
      if (conn.tree) client.send(JSON.stringify({ type: "tree", ...treeFor(conn, ws) }));
    }
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

  async function handle(client: WebSocket, conn: Conn, message: Request): Promise<void> {
    const scope = conn.scope!;
    const reply = (result: unknown) =>
      client.send(JSON.stringify({ id: message.id, ok: true, result }));
    const readable = (relative: string) => {
      if (!scope.read(relative)) throw new Error(`read denied: ${relative}`);
      return relative;
    };
    const writable = (relative: string) => {
      if (!scope.write(relative)) throw new Error(`write denied: ${relative}`);
      return relative;
    };
    /** a workspace command: runs it, then every subscriber sees the tree before the reply lands */
    const command = async (run: (ws: Workspace) => Promise<void>) => {
      await run(await openWorkspaceOnce());
      await broadcastTree();
      reply(null);
    };
    try {
      switch (message.type) {
        case "list": {
          const files: string[] = [];
          for (const file of await mirror.list()) if (scope.read(file)) files.push(file);
          reply(files);
          return;
        }
        case "read": {
          const relative = readable(mirror.rel(str(message.path)));
          reply({
            ...(await mirror.read(relative)),
            user: scope.user,
            writable: scope.write(relative),
          });
          return;
        }
        case "write": {
          const relative = writable(mirror.rel(str(message.path)));
          const current = await mirror.read(relative).catch(() => ({ text: "", version: "" }));
          if (current.version !== message.baseVersion) {
            // the losing writer is shown the current content: that is a read
            readable(relative);
            reply({ ok: false, current });
            return;
          }
          const text = str(message.text);
          const version = await mirror.write(relative, text);
          reply({ ok: true, version });
          changed(relative, text, version, client);
          // the writer's own echo is swallowed by the mirror, so the
          // authority hears of the change here
          authority.diskChanged(relative, { text, version });
          return;
        }
        case "watch": {
          const relative = mirror.rel(str(message.path));
          mirror.watch();
          // unreadable paths are never registered, so their change
          // broadcasts never reach this client
          if (scope.read(relative)) conn.watching.add(relative);
          return;
        }
        case "unwatch":
          conn.watching.delete(mirror.rel(str(message.path)));
          return;
        case "collab-open": {
          const relative = readable(mirror.rel(str(message.path)));
          // external edits must keep flowing into the authority's Y.Doc
          mirror.watch();
          const opened = await authority.open(
            relative,
            client,
            (message.components ?? []) as ComponentSpec[],
            message.syntax as SyntaxOptions | undefined,
          );
          reply({ ...opened, user: scope.user, writable: scope.write(relative) });
          return;
        }
        case "tree":
          conn.tree = true;
          reply(treeFor(conn, await openWorkspaceOnce()));
          return;
        case "untree":
          conn.tree = false;
          return;
        case "create": {
          const relative = writable(mirror.rel(str(message.path)));
          const title = str(message.title);
          return await command((ws) => ws.create(relative, title));
        }
        case "mkdir": {
          const dir = mirror.rel(str(message.dir));
          writable(dir ? `${dir}/index.mdx` : "index.mdx");
          const title = str(message.title);
          return await command((ws) => ws.mkdir(dir, title));
        }
        case "delete": {
          const relative = writable(mirror.rel(str(message.path)));
          return await command((ws) =>
            ws.remove(relative, async () => {
              // a pending save would otherwise recreate the file
              await authority.drop(relative);
              await mirror.unlink(relative);
            }),
          );
        }
        case "order": {
          const dir = mirror.rel(str(message.dir));
          writable(dir ? `${dir}/meta.json` : "meta.json");
          const { order } = message;
          if (!Array.isArray(order)) throw new Error("malformed request");
          const entries: string[] = [];
          for (const item of order) entries.push(str(item));
          return await command((ws) => ws.order(dir, entries));
        }
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

    ...createMediaHandlers(mirror, authorize, upload),

    async close() {
      clearTimeout(treeTimer);
      await mirror.close();
      await authority.close();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
