import type { FileEntry, FileState, SyncTransport, WriteResult } from "./transport";

export interface WsTransport extends SyncTransport {
  close(): void;
  /** connection state changes; fires immediately with the current state */
  onOnline(listener: (online: boolean) => void): () => void;
}

/**
 * `SyncTransport` over one JSON websocket (the dev-server mirror). Requests
 * made while offline reject with "sync offline"; the connection retries
 * with backoff and re-registers every watch on reconnect — sessions listen
 * to `onOnline` to flush once it returns.
 */
export function wsTransport(url: string): WsTransport {
  let socket: WebSocket | null = null;
  let nextId = 1;
  let closed = false;
  let backoff = 300;
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  const watchers = new Map<string, Set<(state: FileState) => void>>();
  const onlineListeners = new Set<(online: boolean) => void>();

  const online = () => socket?.readyState === WebSocket.OPEN;
  const emitOnline = () => {
    for (const listener of onlineListeners) listener(online());
  };

  const connect = () => {
    if (closed) return;
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener("open", () => {
      backoff = 300;
      for (const path of watchers.keys()) ws.send(JSON.stringify({ type: "watch", path }));
      emitOnline();
    });
    ws.addEventListener("message", (event) => {
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
    ws.addEventListener("close", () => {
      if (socket !== ws) return;
      socket = null;
      for (const entry of pending.values()) entry.reject(new Error("sync connection lost"));
      pending.clear();
      emitOnline();
      backoff = Math.min(backoff * 2, 5000);
      setTimeout(connect, backoff);
    });
    ws.addEventListener("error", () => ws.close());
  };
  connect();

  const request = async <T>(payload: Record<string, unknown>): Promise<T> => {
    const ws = socket;
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => {
        const done = () => {
          ws.removeEventListener("open", done);
          ws.removeEventListener("close", done);
          resolve();
        };
        ws.addEventListener("open", done);
        ws.addEventListener("close", done);
      });
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("sync offline");
    const id = nextId++;
    socket.send(JSON.stringify({ id, ...payload }));
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: never) => void, reject });
    });
  };

  return {
    list: () => request<FileEntry[]>({ type: "list" }),
    read: (path) => request<FileState>({ type: "read", path }),
    write: (path, text, baseVersion) =>
      request<WriteResult>({ type: "write", path, text, baseVersion }),
    watch(path, onChange) {
      let set = watchers.get(path);
      if (!set) {
        set = new Set();
        watchers.set(path, set);
        if (online()) socket!.send(JSON.stringify({ type: "watch", path }));
      }
      set.add(onChange);
      return () => {
        set.delete(onChange);
        if (set.size === 0) {
          watchers.delete(path);
          if (online()) socket!.send(JSON.stringify({ type: "unwatch", path }));
        }
      };
    },
    onOnline(listener) {
      onlineListeners.add(listener);
      listener(online());
      return () => onlineListeners.delete(listener);
    },
    close() {
      closed = true;
      socket?.close();
      socket = null;
    },
  };
}
