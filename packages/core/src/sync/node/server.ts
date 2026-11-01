import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { decodeMessage } from "../codec";
import { PROTOCOL } from "../protocol";
import { createDocAuthority } from "./authority";
import type { Connection, Incoming, Resource, SyncConnection } from "./connection";
import { createFiles } from "./files";
import { createMediaHandlers, type UploadLimits } from "./media";
import { createAuthorize, type SyncAuthenticate } from "./scope";
import { fsStorage, type SyncStorage } from "./storage";
import { createTreeResource } from "./workspace";
import { createWsCarrier } from "./ws";

export type { SyncConnection } from "./connection";
export type { SyncAuthenticate, SyncScope } from "./scope";
export { fsStorage, type SyncStorage } from "./storage";

export interface SyncServerOptions {
  /** the directory to sync, its pages and assets; shorthand for `storage: fsStorage(root)` */
  root?: string;
  /**
   * Where the files live, in place of `root`: a database, a bucket, or
   * `fsStorage` wrapped to do more. See {@link SyncStorage}.
   */
  storage?: SyncStorage;
  /**
   * Maps a connection or media request to a {@link SyncScope}; `null`
   * rejects. Runs once per connection (again on every reconnect, so
   * refreshed tokens apply) and once per HTTP media request. Absent =
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
  /**
   * Called with the server once it is created, whichever integration creates
   * it (the Vite plugin, Studio): the place to listen to `onChange` and keep
   * the server for `connections()`. A returned function runs last in
   * `close()`, which waits for it; the Vite plugin closes the server on
   * every dev server restart.
   */
  setup?: (sync: SyncServer) => void | (() => void | Promise<void>);
}

/** a file a connection changed */
export interface SyncChange {
  /** root-relative path of the file written or deleted */
  path: string;
  connection: SyncConnection;
}

export interface SyncServer {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** POST media endpoint: stores under `assets/`, requires write on the stored path */
  handleUpload(request: IncomingMessage, response: ServerResponse): void;
  /** GET asset endpoint (`/<relative>` after the mount prefix), requires read */
  handleAsset(request: IncomingMessage, response: ServerResponse): void;
  /** the authenticated connections, open now */
  connections(): SyncConnection[];
  /**
   * Hears every file a connection changes, once it is on disk: a save, a
   * file tree command, or a collab edit with the debounced write that
   * carries it (one change per connection whose edits it carries). Returns
   * the unsubscribe.
   */
  onChange(listener: (change: SyncChange) => void): () => void;
  close(): Promise<void>;
}

const error = (id: unknown, message: string) => JSON.stringify({ type: "error", id, message });

/**
 * The sync protocol over the dev-server directory: files, the workspace
 * tree and collab docs as resources, every one checked against the scope
 * `authenticate` resolves at the hello, always on the normalized
 * root-relative path.
 */
export function createSyncServer({
  root,
  storage,
  authenticate,
  helloTimeoutMs = 10_000,
  evictAfterMs,
  upload = {},
  setup,
}: SyncServerOptions): SyncServer {
  if (!storage) {
    if (root === undefined) throw new Error("createSyncServer needs `root` or `storage`");
    storage = fsStorage(root);
  }
  const authorize = createAuthorize(authenticate);
  const live = new Set<Connection>();
  const listeners = new Set<(change: SyncChange) => void>();
  const changed = (path: string, connection: Connection) => {
    if (listeners.size === 0) return;
    // a tick later, apart from the step that made the change: a failing listener is only logged
    const change = Promise.resolve<SyncChange>({ path, connection });
    for (const listener of listeners) void change.then(listener).catch(console.error);
  };
  const files = createFiles(storage, {
    changed: (relative, state) => docs.diskChanged(relative, state),
    event: (relative) => tree.event(relative),
    isOpen: (relative) => docs.isOpen(relative),
    wrote: changed,
  });
  const docs = createDocAuthority({ files, evictAfterMs });
  const tree = createTreeResource(files, (relative) => docs.drop(relative));
  const resources = new Map<unknown, Resource>([
    ["file", files],
    ["tree", tree],
    ["doc", docs],
  ]);

  const dispatch = (conn: Connection, message: Incoming): Promise<void> | void => {
    const resource = resources.get(message.resource);
    if (resource) {
      if (message.type === "subscribe") return resource.subscribe(conn, message);
      if (message.type === "unsubscribe") return resource.unsubscribe(conn, message);
      if (message.type === "update") return resource.update(conn, message);
    }
    throw new Error(`unknown message: ${String(message.type)} ${String(message.resource)}`);
  };

  const leave = (conn: Connection) => {
    for (const resource of resources.values()) resource.leave(conn);
  };

  const carrier = createWsCarrier((peer, request) => {
    let conn: Connection | undefined;
    let authenticating = false;
    let closed = false;
    const helloTimer = setTimeout(() => {
      if (!conn) peer.close();
    }, helloTimeoutMs);
    /** the socket closed, or the host closed the connection */
    const end = () => {
      if (closed) return;
      closed = true;
      clearTimeout(helloTimer);
      if (!conn) return;
      live.delete(conn);
      leave(conn);
    };
    // out here: a connection outlives its hello, which its closure would keep alive
    const close = () => {
      end();
      peer.close();
    };

    return {
      receive(data) {
        // closed by the host: what the client sent meanwhile is not applied
        if (closed) return;
        let message: Incoming;
        try {
          message = decodeMessage(data);
        } catch {
          return;
        }
        if (!message || typeof message !== "object") return;
        if (conn) {
          const current = conn;
          const fail = (reason: unknown) => {
            const text = reason instanceof Error ? reason.message : String(reason);
            if (typeof message.id === "number") current.send(error(message.id, text));
          };
          try {
            void dispatch(current, message)?.then(() => {
              // closed while the resource awaited IO: it registered after `leave` ran
              if (closed) leave(current);
            }, fail);
          } catch (reason) {
            fail(reason);
          }
          return;
        }
        // nothing precedes authentication: only the first hello starts the exchange
        if (message.type !== "hello" || authenticating) {
          if (typeof message.id === "number") peer.send(error(message.id, "not authenticated"));
          return;
        }
        if (message.protocol !== PROTOCOL) {
          peer.send(error(message.id, `unsupported protocol: ${String(message.protocol)}`));
          return peer.close();
        }
        authenticating = true;
        void authorize(request, message.auth).then((scope) => {
          if (closed) return;
          if (!scope) {
            peer.send(error(message.id, "access denied"));
            return peer.close();
          }
          clearTimeout(helloTimer);
          conn = {
            request,
            payload: message.auth,
            user: scope.user,
            scope,
            send: peer.send,
            close,
          };
          live.add(conn);
          peer.send(JSON.stringify({ type: "hello", id: message.id, user: scope.user }));
        });
      },
      closed: end,
    };
  });

  const sync: SyncServer = {
    handleUpgrade: carrier.handleUpgrade,

    ...createMediaHandlers(files, authorize, upload),

    connections: () => [...live],

    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async close() {
      tree.close();
      await files.close();
      await docs.close();
      carrier.close();
      // last: listeners have heard the changes the final saves made
      await cleanup?.();
    },
  };
  const cleanup = setup?.(sync);
  return sync;
}
