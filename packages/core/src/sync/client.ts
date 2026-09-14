import type { ConnectionStatus, FileState, SyncTransport } from "./transport";
import type { WorkspaceTree } from "./tree";
import { wsTransport } from "./ws";

export interface SyncClientOptions {
  /** default: a websocket to the dev-server mount on the current host */
  transport?: SyncTransport;
  /**
   * Produces the opaque payload the connection hello carries to the server's
   * `authenticate` hook. Called on every connection, so reconnects pick up
   * fresh tokens. Cookie-based setups omit it.
   */
  auth?: () => unknown;
}

/** what the server pushes, by topic */
export interface SyncEvents {
  /** the workspace tree, whenever it changes */
  tree: WorkspaceTree;
  /** collab frames of every open document */
  binary: Uint8Array;
  /** one file's content, whenever something else writes it */
  [path: `watch:${string}`]: FileState;
}

/**
 * The mirror protocol over a {@link SyncTransport}: every connection opens
 * with a hello carrying the `auth` payload, and nothing else is sent until
 * the server acknowledges it. Requests are JSON with an id and get one
 * reply; subscriptions are registered with the server and again after
 * every reconnect. Offline requests reject with "sync offline"; a refused
 * hello closes the transport and reports "denied" for good.
 */
export interface SyncClient {
  /** one request, one reply; `type` names the operation */
  request<T>(message: { type: string } & Record<string, unknown>): Promise<T>;
  /** server pushes for a topic; the tree and watches also register with the server */
  subscribe<K extends keyof SyncEvents>(
    topic: K,
    listener: (event: SyncEvents[K]) => void,
  ): () => void;
  /** a collab frame; dropped while offline, the handshake on reconnect recovers */
  sendBinary(data: Uint8Array): void;
  status(): ConnectionStatus;
  /** fires immediately with the current state */
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  close(): void;
}

/** the registration a topic sends; `binary` needs none, collab-open covers it */
const registration = (topic: string, on: boolean): string | undefined => {
  if (topic === "tree") return JSON.stringify({ type: on ? "tree" : "untree" });
  if (topic.startsWith("watch:")) {
    return JSON.stringify({ type: on ? "watch" : "unwatch", path: topic.slice(6) });
  }
};

const HELLO_RETRY_MS = 1000;

export function createSyncClient({
  transport = wsTransport(),
  auth,
}: SyncClientOptions = {}): SyncClient {
  let nextId = 1;
  let ready = false;
  let denied = false;
  let online = true;
  /** settles once the current connection's hello has succeeded or the connection died */
  let attempt: Promise<void>;
  let settle = () => {};
  let waiting = false;
  const arm = () => {
    if (waiting) return;
    waiting = true;
    attempt = new Promise<void>((resolve) => {
      settle = () => {
        waiting = false;
        resolve();
      };
    });
  };
  arm();
  let helloRetry: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  const topics = new Map<string, Set<(event: never) => void>>();
  const statusListeners = new Set<(status: ConnectionStatus) => void>();

  const status = (): ConnectionStatus => (denied ? "denied" : ready ? "online" : "offline");
  const emitStatus = () => {
    const current = status();
    for (const listener of statusListeners) listener(current);
  };
  const emit = (topic: string, event: unknown) => {
    for (const listener of topics.get(topic) ?? []) listener(event as never);
  };

  const post = <T>(message: Record<string, unknown>): Promise<T> => {
    const id = nextId++;
    transport.send(JSON.stringify({ id, ...message }));
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: never) => void, reject });
    });
  };

  const hello = () => {
    clearTimeout(helloRetry);
    Promise.resolve()
      .then(auth)
      .then((payload) => post({ type: "hello", payload }))
      .then(
        () => {
          if (!online) return;
          ready = true;
          for (const topic of topics.keys()) {
            const message = registration(topic, true);
            if (message) transport.send(message);
          }
          settle();
          emitStatus();
        },
        (error: Error) => {
          // a rejected hello is terminal; anything else (auth() failed, the
          // connection dropped) retries while the channel stays up
          if (error.message === "access denied") {
            denied = true;
            transport.close();
            settle();
            emitStatus();
          } else if (online) {
            helloRetry = setTimeout(hello, HELLO_RETRY_MS);
          }
        },
      );
  };

  const stopMessages = transport.onMessage((data) => {
    if (typeof data !== "string") return emit("binary", data);
    const message = JSON.parse(data);
    if (message.type === "change") {
      return emit(`watch:${message.path}`, { text: message.text, version: message.version });
    }
    if (message.type === "tree") return emit("tree", { root: message.root, nodes: message.nodes });
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.result as never);
    else entry.reject(new Error(message.error));
  });

  let first = true;
  const stopTransport =
    transport.onStatus?.((up) => {
      const initial = first;
      first = false;
      online = up;
      if (up) {
        arm();
        hello();
        return;
      }
      // not connected yet: requests wait for the first connection instead
      if (initial) return;
      ready = false;
      clearTimeout(helloRetry);
      const error = new Error("sync connection lost");
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      settle();
      emitStatus();
    }) ?? (hello(), () => {});

  return {
    async request(message) {
      await attempt;
      if (!ready) throw new Error(denied ? "sync access denied" : "sync offline");
      return post(message);
    },
    subscribe(topic, listener) {
      let set = topics.get(topic);
      if (!set) {
        set = new Set();
        topics.set(topic, set);
        const message = registration(topic, true);
        if (message && ready) transport.send(message);
      }
      set.add(listener as (event: never) => void);
      return () => {
        set.delete(listener as (event: never) => void);
        if (set.size > 0) return;
        topics.delete(topic);
        const message = registration(topic, false);
        if (message && ready) transport.send(message);
      };
    },
    sendBinary(data) {
      if (ready) transport.send(data);
    },
    status,
    onStatus(listener) {
      statusListeners.add(listener);
      listener(status());
      return () => statusListeners.delete(listener);
    },
    close() {
      ready = false;
      clearTimeout(helloRetry);
      stopMessages();
      stopTransport();
      transport.close();
    },
  };
}
