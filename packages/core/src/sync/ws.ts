import { SYNC_ENDPOINT, type SyncTransport } from "./transport";

/**
 * `SyncTransport` over one websocket, reconnecting with backoff until
 * closed. Defaults to the dev-server mount on the current host.
 */
export function wsTransport(url?: string): SyncTransport {
  url ??= `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${SYNC_ENDPOINT}`;
  let socket: WebSocket | null = null;
  let closed = false;
  let backoff = 300;
  const messageListeners = new Set<(data: string | Uint8Array) => void>();
  const statusListeners = new Set<(online: boolean) => void>();

  const connect = () => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => {
      socket = ws;
      backoff = 300;
      for (const listener of statusListeners) listener(true);
    });
    ws.addEventListener("message", (event) => {
      const data =
        event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : String(event.data);
      for (const listener of messageListeners) listener(data);
    });
    ws.addEventListener("close", () => {
      const wasOpen = socket === ws;
      socket = null;
      if (wasOpen) for (const listener of statusListeners) listener(false);
      if (closed) return;
      backoff = Math.min(backoff * 2, 5000);
      setTimeout(connect, backoff);
    });
    ws.addEventListener("error", () => ws.close());
  };
  connect();

  return {
    send(data) {
      socket?.send(typeof data === "string" ? data : (data.buffer as ArrayBuffer));
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      listener(socket !== null);
      return () => statusListeners.delete(listener);
    },
    close() {
      closed = true;
      socket?.close();
    },
  };
}
