import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

/** one transport connection, before and after its hello */
export interface Peer {
  send(data: string | Uint8Array): void;
  close(): void;
}

export interface PeerHandler {
  receive(data: string | Uint8Array): void;
  closed(): void;
}

/** hidden tabs throttle the client's 20 s heartbeat to about once a minute */
const SILENT_MS = 90_000;
/** Node's WebSocket client drops a compressed message that inflates past 4 MiB */
const MAX_COMPRESSED = 4 * 1024 * 1024;

const loopback = (address = "") =>
  address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");

/**
 * The websocket end of `wsTransport`: one message per frame, empty text
 * frames echoed as the heartbeat, and a connection silent past the window
 * terminated, since a half-open socket never fires `close`.
 */
export function createWsCarrier(accept: (peer: Peer, request: IncomingMessage) => PeerHandler) {
  // compression trades CPU for bytes: over loopback the bytes cost nothing
  const plain = new WebSocketServer({ noServer: true });
  const deflate = new WebSocketServer({ noServer: true, perMessageDeflate: true });
  const seen = new Map<WebSocket, number>();
  const sweep = setInterval(() => {
    const deadline = Date.now() - SILENT_MS;
    for (const [socket, last] of seen) if (last < deadline) socket.terminate();
  }, SILENT_MS / 3);
  sweep.unref();

  return {
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      const wss = loopback(request.socket.remoteAddress) ? plain : deflate;
      wss.handleUpgrade(request, socket, head, (ws) => {
        seen.set(ws, Date.now());
        const handler = accept(
          {
            send: (data) => ws.send(data, { compress: data.length <= MAX_COMPRESSED }),
            close: () => ws.close(),
          },
          request,
        );
        ws.on("message", (data: Buffer, isBinary: boolean) => {
          seen.set(ws, Date.now());
          if (isBinary) handler.receive(new Uint8Array(data.buffer, data.byteOffset, data.length));
          else if (data.length === 0) ws.send("");
          else handler.receive(String(data));
        });
        ws.on("close", () => {
          seen.delete(ws);
          handler.closed();
        });
      });
    },
    close() {
      clearInterval(sweep);
      for (const ws of seen.keys()) ws.terminate();
      plain.close();
      deflate.close();
    },
  };
}
