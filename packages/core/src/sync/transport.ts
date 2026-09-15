import { decodeMessage, encodeMessage } from "./codec";
import { SYNC_ENDPOINT, type ClientMessage, type ServerMessage } from "./protocol";

export interface TransportListener {
  open(): void;
  message(message: ServerMessage): void;
  /** fires once per connection, also after `close()` */
  close(): void;
}

export interface TransportConnection {
  /** dropped unless the connection is open */
  send(message: ClientMessage): void;
  close(): void;
}

/**
 * Carries protocol messages. Each `connect` opens one connection; the client
 * reconnects by calling it again. Listener callbacks never fire
 * synchronously inside `connect`.
 */
export interface SyncTransport {
  connect(listener: TransportListener): TransportConnection;
}

const HEARTBEAT_MS = 20_000;

/**
 * `SyncTransport` over a websocket, one message per frame (see `codec.ts`);
 * defaults to the dev-server mount on the current host. Empty text frames
 * are the heartbeat: sent every 20 s and echoed by the server, since a
 * half-open socket never fires `close`.
 */
export function wsTransport(url?: string): SyncTransport {
  return {
    connect(listener) {
      const ws = new WebSocket(
        url ??
          `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${SYNC_ENDPOINT}`,
      );
      ws.binaryType = "arraybuffer";
      let done = false;
      let waiting = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const close = () => {
        if (done) return;
        done = true;
        clearInterval(heartbeat);
        ws.close();
        listener.close();
      };
      ws.addEventListener("open", () => {
        heartbeat = setInterval(() => {
          if (waiting) return close();
          waiting = true;
          ws.send("");
        }, HEARTBEAT_MS);
        listener.open();
      });
      ws.addEventListener("message", (event) => {
        waiting = false;
        const data = event.data as string | ArrayBuffer;
        if (data === "") return;
        listener.message(
          decodeMessage(typeof data === "string" ? data : new Uint8Array(data)) as ServerMessage,
        );
      });
      ws.addEventListener("close", close);
      ws.addEventListener("error", close);
      return {
        send(message) {
          if (!done && ws.readyState === WebSocket.OPEN) ws.send(encodeMessage(message));
        },
        close,
      };
    },
  };
}
