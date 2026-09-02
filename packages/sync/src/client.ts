import {
  CLOSE_DENIED,
  SYNC_ENDPOINT,
  type ConnectionStatus,
  type FileState,
  type ReadResult,
  type SyncTransport,
  type WriteResult,
} from "./transport";

export interface WsTransportOptions {
  /** websocket url; defaults to the dev-server mount on the current host */
  url?: string;
  /**
   * Produces the opaque payload the connection hello carries to the server's
   * `authenticate` hook. Called on every connection attempt, so reconnects
   * pick up fresh tokens. Cookie-based setups omit it.
   */
  auth?: () => unknown;
}

export interface WsTransport extends SyncTransport {
  close(): void;
  status(): ConnectionStatus;
  /** connection state changes; fires immediately with the current state */
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  /**
   * Collab frames use this same socket as binary messages (see `wire.ts`).
   * Sends while offline are dropped. The y-protocols handshake on reconnect
   * recovers whatever was missed.
   */
  sendBinary(data: Uint8Array): void;
  onBinary(listener: (data: Uint8Array) => void): () => void;
  /** a JSON request/response call on the mirror protocol (e.g. collab-open) */
  request<T>(payload: Record<string, unknown>): Promise<T>;
}

/**
 * `SyncTransport` over one JSON websocket (the dev-server mirror). Every
 * connection opens with a hello frame carrying the `auth` payload; nothing
 * else is sent until the server acknowledges it. Offline requests reject
 * with "sync offline". Reconnect retries with backoff and re-registers
 * watches; sessions listen to `onStatus` to flush. A denied hello stops
 * retrying.
 */
export function wsTransport(options: WsTransportOptions = {}): WsTransport {
  const url =
    options.url ??
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${SYNC_ENDPOINT}`;
  let socket: WebSocket | null = null;
  let nextId = 1;
  let closed = false;
  let denied = false;
  /** the hello was acknowledged: requests, watches and binary frames may flow */
  let ready = false;
  /** settles when the current connection attempt has succeeded or died */
  let attempt = Promise.resolve();
  let backoff = 300;
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  const watchers = new Map<string, Set<(state: FileState) => void>>();
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const binaryListeners = new Set<(data: Uint8Array) => void>();

  const status = (): ConnectionStatus => (denied ? "denied" : ready ? "online" : "offline");
  const emitStatus = () => {
    const current = status();
    for (const listener of statusListeners) listener(current);
  };

  const post = <T>(ws: WebSocket, payload: Record<string, unknown>): Promise<T> => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, ...payload }));
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: never) => void, reject });
    });
  };

  const connect = () => {
    if (closed || denied) return;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    socket = ws;
    let settle!: () => void;
    attempt = new Promise((resolve) => {
      settle = resolve;
    });
    // resolve the payload while the socket handshakes; a fresh call per attempt
    const payload = Promise.resolve().then(options.auth ?? (() => undefined));
    payload.catch(() => {}); // handled in the open listener, which may never fire
    ws.addEventListener("open", () => {
      payload.then(
        (value) =>
          post(ws, { type: "hello", payload: value }).then(
            () => {
              if (socket !== ws) return;
              ready = true;
              backoff = 300;
              for (const path of watchers.keys()) ws.send(JSON.stringify({ type: "watch", path }));
              settle();
              emitStatus();
            },
            () => {},
          ), // a refused hello ends in a close; that path settles
        () => ws.close(), // auth() itself failed: retry like any dead connection
      );
    });
    ws.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        const data = new Uint8Array(event.data);
        for (const listener of binaryListeners) listener(data);
        return;
      }
      const message = JSON.parse(String(event.data));
      if (message.type === "change") {
        const state = { text: message.text as string, version: message.version as string };
        for (const listener of watchers.get(message.path) ?? []) listener(state);
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.result as never);
      else entry.reject(new Error(message.error));
    });
    ws.addEventListener("close", (event) => {
      if (socket !== ws) return;
      socket = null;
      ready = false;
      denied = (event as CloseEvent).code === CLOSE_DENIED;
      const error = new Error(denied ? "sync access denied" : "sync connection lost");
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      settle();
      emitStatus();
      if (denied) return;
      backoff = Math.min(backoff * 2, 5000);
      setTimeout(connect, backoff);
    });
    ws.addEventListener("error", () => ws.close());
  };
  connect();

  const request = async <T>(payload: Record<string, unknown>): Promise<T> => {
    await attempt;
    if (!ready || !socket) throw new Error(denied ? "sync access denied" : "sync offline");
    return post<T>(socket, payload);
  };

  return {
    list: () => request<string[]>({ type: "list" }),
    read: (path) => request<ReadResult>({ type: "read", path }),
    write: (path, text, baseVersion) =>
      request<WriteResult>({ type: "write", path, text, baseVersion }),
    watch(path, onChange) {
      let set = watchers.get(path);
      if (!set) {
        set = new Set();
        watchers.set(path, set);
        if (ready && socket) socket.send(JSON.stringify({ type: "watch", path }));
      }
      set.add(onChange);
      return () => {
        set.delete(onChange);
        if (set.size === 0) {
          watchers.delete(path);
          if (ready && socket) socket.send(JSON.stringify({ type: "unwatch", path }));
        }
      };
    },
    status,
    onStatus(listener) {
      statusListeners.add(listener);
      listener(status());
      return () => statusListeners.delete(listener);
    },
    sendBinary(data) {
      if (ready && socket) socket.send(data.buffer as ArrayBuffer);
    },
    onBinary(listener) {
      binaryListeners.add(listener);
      return () => binaryListeners.delete(listener);
    },
    request,
    close() {
      closed = true;
      ready = false;
      socket?.close();
      socket = null;
    },
  };
}
