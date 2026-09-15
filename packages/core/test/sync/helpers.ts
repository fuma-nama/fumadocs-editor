import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  createSyncClient,
  type DocumentEditor,
  type SyncClient,
  type SyncClientOptions,
} from "../../src/sync/client";
import { decodeMessage, encodeMessage } from "../../src/sync/codec";
import type { ClientMessage, ServerMessage } from "../../src/sync/protocol";
import {
  createSyncServer,
  type SyncServer,
  type SyncServerOptions,
} from "../../src/sync/node/server";
import { wsTransport } from "../../src/sync/transport";

export const until = async <T>(
  poll: () => T | undefined | Promise<T | undefined>,
  ms = 4000,
): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await poll();
    if (value !== undefined) return value;
    if (Date.now() - started > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A sync server on an http server, routed like the vite plugin. `restart`
 * replaces the sync server (a new process); `drop` destroys every socket but
 * keeps the sync server.
 */
export async function serve(options: SyncServerOptions) {
  const sockets = new Set<Duplex>();
  const state = { sync: createSyncServer(options), port: 0 };
  let http: Server;

  const listen = () => {
    http = createServer((request, response) => {
      if (request.url === "/__fde_upload") return state.sync.handleUpload(request, response);
      if (request.url!.startsWith("/__fde_asset/")) {
        request.url = request.url!.slice("/__fde_asset".length);
        return state.sync.handleAsset(request, response);
      }
      response.statusCode = 404;
      response.end();
    });
    http.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    http.on("upgrade", (request, socket, head) => {
      if (request.url === "/__fde_sync") state.sync.handleUpgrade(request, socket, head);
    });
    return new Promise<void>((resolve) =>
      http.listen(state.port, () => {
        state.port = (http.address() as { port: number }).port;
        resolve();
      }),
    );
  };
  const stop = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => http.close(resolve));
  };
  await listen();

  return {
    get sync(): SyncServer {
      return state.sync;
    },
    get port() {
      return state.port;
    },
    get url() {
      return `ws://127.0.0.1:${state.port}/__fde_sync`;
    },
    async drop() {
      await stop();
      await listen();
    },
    async restart(next: SyncServerOptions = options) {
      await state.sync.close();
      await stop();
      state.sync = createSyncServer(next);
      await listen();
    },
    async close() {
      await state.sync.close();
      await stop();
    },
  };
}

export function connect(
  url: string,
  options: Omit<SyncClientOptions, "transport"> = {},
): SyncClient {
  return createSyncClient({ transport: wsTransport(url), ...options });
}

export const online = (client: SyncClient) =>
  until(() => (client.status() === "online" ? true : undefined));

/** an editor the test drives by hand: merges adopt the disk text unless `conflicts` is set */
export function textEditor(initial = "") {
  const doc = {
    text: initial,
    conflicts: [] as number[],
    merged: [] as string[],
  };
  const editor: DocumentEditor = {
    getMarkdown: () => doc.text,
    async applyExternalMarkdown(remote) {
      doc.merged.push(remote);
      if (doc.conflicts.length === 0) doc.text = remote;
      return doc.conflicts;
    },
    async setMarkdown(remote) {
      doc.text = remote;
    },
    markSaved() {},
  };
  return Object.assign(doc, { editor });
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

/** a hand-driven protocol client over a bare websocket */
export async function peer(url: string, auth?: unknown) {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const pushes: ServerMessage[] = [];
  const waiting = new Map<number, (message: ServerMessage) => void>();
  let nextId = 1;
  ws.addEventListener("message", (event) => {
    if (event.data === "") return;
    const data = event.data as string | ArrayBuffer;
    const message = decodeMessage(
      typeof data === "string" ? data : new Uint8Array(data),
    ) as ServerMessage;
    const resolve = message.id === undefined ? undefined : waiting.get(message.id);
    if (resolve) resolve(message);
    else pushes.push(message);
  });
  const closed = new Promise<void>((resolve) => ws.addEventListener("close", () => resolve()));
  await new Promise((resolve) => ws.addEventListener("open", resolve));

  const request = (message: WithoutId<ClientMessage> | Record<string, unknown>) => {
    const id = nextId++;
    ws.send(encodeMessage({ ...message, id }));
    return new Promise<ServerMessage>((resolve) => waiting.set(id, resolve));
  };
  return {
    ws,
    pushes,
    closed,
    request,
    send: (message: ClientMessage | Record<string, unknown>) => ws.send(encodeMessage(message)),
    hello: () => request({ type: "hello", protocol: 1, auth }),
    close: () => ws.close(),
  };
}
