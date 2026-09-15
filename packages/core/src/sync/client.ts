import { componentSpecData, type ComponentSpec, type SyntaxOptions } from "../components/spec";
import type { CollabBinding, CollabDoc } from "./collab";
import {
  PROTOCOL,
  type ClientMessage,
  type Resource,
  type ServerMessage,
  type SyncUser,
} from "./protocol";
import type { TreeCommand, WorkspaceTree } from "./tree";
import { wsTransport, type SyncTransport, type TransportConnection } from "./transport";

/** `connecting` until the first connection settles; `denied` is final */
export type ConnectionStatus = "connecting" | "online" | "offline" | "denied";

export type DocumentStatus = "synced" | "dirty" | "saving" | "conflict" | "offline" | "denied";

export interface SyncClientOptions {
  /** default: {@link wsTransport} to the dev-server mount on the current host */
  transport?: SyncTransport;
  /**
   * Produces the opaque payload the hello carries to the server's
   * `authenticate` hook. Called on every connection, so reconnects pick up
   * fresh tokens. Cookie-based setups omit it.
   */
  auth?: () => unknown;
  /**
   * Open documents as shared Yjs documents held by the server: peer carets,
   * undo scoped to your own edits. `user` is the presence identity; a server
   * scope user overrides its name. Yjs loads on the first `open`.
   */
  collab?: boolean | { user?: SyncUser };
}

/** the editor a file document merges into and saves from; `MdxEditorRef` satisfies it */
export interface DocumentEditor {
  /** the current markdown, read at save time */
  getMarkdown(): string;
  /** merge disk text in; resolves with the conflicting block indices */
  applyExternalMarkdown(text: string): Promise<number[]>;
  /** replace the document with disk text (conflict: take disk) */
  setMarkdown(text: string): Promise<void>;
  /**
   * The disk now holds `text`, written from this editor: adopt it as the
   * base later external changes merge against. Edits made since stay local.
   */
  markSaved(text: string): void;
}

export interface OpenOptions {
  /** used by file documents; under collab the Yjs doc is the document */
  editor: DocumentEditor;
  /** the syntax a collab doc is parsed and serialized with on the server */
  components?: ComponentSpec[];
  syntax?: SyntaxOptions;
}

/** one synced file: autosave and live merge, or a shared Yjs doc under collab */
export interface SyncDocument {
  /** the file as first received; rejects when the server refuses it or the client is offline first */
  opened: Promise<{ text: string; writable: boolean }>;
  status(): DocumentStatus;
  /** the shared document under collab, once synced; null while the server re-seeds it */
  collab(): CollabBinding | null;
  /** fires when `status()` or `collab()` may have changed */
  subscribe(listener: () => void): () => void;
  /** the editor changed: schedules an autosave */
  changed(): void;
  /** save now if there is anything to save (blur / beforeunload / Cmd-S) */
  flush(): Promise<void>;
  /** resolve a conflict by overwriting the disk with the local document */
  keepMine(): Promise<void>;
  /** resolve a conflict by dropping local edits for the disk version */
  takeDisk(): Promise<void>;
  close(): void;
}

export interface SyncClient {
  readonly collab: boolean;
  status(): ConnectionStatus;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  /** the workspace tree; null until the server answers an `onTree` subscription */
  tree(): WorkspaceTree | null;
  /** follows the tree while at least one listener is attached */
  onTree(listener: (tree: WorkspaceTree) => void): () => void;
  /** creates, deletes and reorders; rejects with the server's reason */
  run(command: TreeCommand): Promise<void>;
  /** the client holds one document per path: opening an open one throws */
  open(path: string, options: OpenOptions): SyncDocument;
  close(): void;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
type Update = Extract<ServerMessage, { type: "update" }>;
type Opened = { text: string; writable: boolean };
type FileState = { text: string; version: string };

/** a subscription the client renews after every reconnect */
interface Entry {
  target: Resource;
  subscribe(): WithoutId<Extract<ClientMessage, { type: "subscribe" }>>;
  update(message: Update): void;
  error(message: string): void;
}

const MIN_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 5000;
const TRAILING_MS = 800;
const MAX_WAIT_MS = 5000;
/** `Y.encodeStateVector` of an empty doc */
const EMPTY_VECTOR = new Uint8Array([0]);

const keyOf = (target: Resource) =>
  target.resource === "tree" ? "tree" : `${target.resource}:${target.path}`;

/**
 * The client side of the sync protocol: one connection (hello, reconnect
 * with backoff, subscriptions renewed after every reconnect) and the state
 * synced over it, the tree and the open documents.
 */
export function createSyncClient({
  transport = wsTransport(),
  auth,
  collab = false,
}: SyncClientOptions = {}): SyncClient {
  const user = typeof collab === "object" ? collab.user : undefined;
  let status: ConnectionStatus = "connecting";
  let connection: TransportConnection | undefined;
  let nextId = 1;
  let backoff = MIN_BACKOFF_MS;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const pending = new Map<number, (answer: ServerMessage | undefined) => void>();
  const entries = new Map<string, Entry>();
  const statusListeners = new Set<(status: ConnectionStatus) => void>();

  const setStatus = (next: ConnectionStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of statusListeners) listener(next);
  };
  const onStatus = (listener: (status: ConnectionStatus) => void) => {
    statusListeners.add(listener);
    return () => void statusListeners.delete(listener);
  };

  const post = (
    message: WithoutId<ClientMessage>,
    onAnswer: (answer: ServerMessage | undefined) => void,
  ) => {
    const id = nextId++;
    pending.set(id, onAnswer);
    connection!.send({ ...message, id } as ClientMessage);
  };

  const subscribe = (entry: Entry) =>
    post(entry.subscribe(), (answer) => {
      if (!answer || entries.get(keyOf(entry.target)) !== entry) return;
      if (answer.type === "error") entry.error(answer.message);
      else if (answer.type === "update") entry.update(answer);
    });

  /** subscribes now if online and after every reconnect; returns the unsubscribe */
  const register = (entry: Entry) => {
    const key = keyOf(entry.target);
    if (entries.has(key)) throw new Error(`already open: ${key}`);
    entries.set(key, entry);
    if (status === "online") subscribe(entry);
    return () => {
      entries.delete(key);
      if (status === "online") connection?.send({ type: "unsubscribe", ...entry.target });
    };
  };

  const request = (message: WithoutId<Extract<ClientMessage, { type: "update" }>>) =>
    new Promise<Update>((resolve, reject) => {
      if (status !== "online") return reject(new Error(`sync ${status}`));
      post(message, (answer) => {
        if (answer?.type === "update") resolve(answer);
        else reject(new Error(answer?.type === "error" ? answer.message : "sync connection lost"));
      });
    });

  const send = (message: ClientMessage) => {
    if (status === "online") connection?.send(message);
  };

  const connect = () => {
    const current: TransportConnection = transport.connect({
      open() {
        Promise.resolve()
          .then(auth)
          .then(
            (payload) => {
              if (connection !== current) return;
              post({ type: "hello", protocol: PROTOCOL, auth: payload }, (answer) => {
                if (answer?.type === "error") {
                  setStatus("denied");
                  current.close();
                } else if (answer?.type === "hello") {
                  backoff = MIN_BACKOFF_MS;
                  setStatus("online");
                  for (const entry of entries.values()) subscribe(entry);
                }
              });
            },
            () => current.close(),
          );
      },
      message(message) {
        if (connection !== current) return;
        if (message.id !== undefined) {
          const onAnswer = pending.get(message.id);
          pending.delete(message.id);
          onAnswer?.(message);
        } else if (message.type === "update") {
          entries.get(keyOf(message))?.update(message);
        }
      },
      close() {
        if (connection !== current) return;
        connection = undefined;
        const lost = [...pending.values()];
        pending.clear();
        for (const onAnswer of lost) onAnswer(undefined);
        if (status === "denied") return;
        setStatus("offline");
        if (closed) return;
        retry = setTimeout(connect, backoff * (0.5 + Math.random()));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      },
    });
    connection = current;
  };

  /**
   * What both kinds of document share: `opened`, listeners, the registration.
   * `opened` also settles when the client is offline or denied first: the
   * editor falls back to its own content, and a later answer merges in.
   */
  const createDocument = (
    target: Resource,
    entry: Omit<Entry, "target" | "error">,
    statusChanged?: () => void,
  ) => {
    const listeners = new Set<() => void>();
    let settle!: { resolve(opened: Opened): void; reject(error: Error): void };
    const doc = {
      /** the first state arrived, or the client went offline or denied before it did */
      open: false,
      opened: new Promise<Opened>((resolve, reject) => (settle = { resolve, reject })),
      emit() {
        for (const listener of listeners) listener();
      },
      settle(result: Opened | Error) {
        if (doc.open) return;
        doc.open = true;
        if (result instanceof Error) settle.reject(result);
        else settle.resolve(result);
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      stop() {
        stopStatus();
        unregister();
        listeners.clear();
      },
    };
    // callers that never await `opened` must not see an unhandled rejection
    doc.opened.catch(() => {});
    const unregister = register({ target, ...entry, error: (e) => doc.settle(new Error(e)) });
    const stopStatus = onStatus((next) => {
      if (next === "offline" || next === "denied") doc.settle(new Error(`sync ${next}`));
      doc.emit();
      statusChanged?.();
    });
    return doc;
  };

  /**
   * Autosave with compare-and-swap writes, external changes merged in as
   * they land, and same-block conflicts pausing writes until the user picks
   * a side.
   */
  const openFile = (path: string, editor: DocumentEditor): SyncDocument => {
    let base: FileState = { text: "", version: "" };
    /** the disk state conflicting with local edits, kept current while unresolved */
    let conflict: FileState | undefined;
    let dirty = false;
    let saving = false;
    let closed = false;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    let maxWait: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      clearTimeout(trailing);
      clearTimeout(maxWait);
      trailing = maxWait = undefined;
    };
    const schedule = () => {
      clearTimeout(trailing);
      trailing = setTimeout(save, TRAILING_MS);
      maxWait ??= setTimeout(save, MAX_WAIT_MS);
    };

    const incoming = async (state: FileState) => {
      if (conflict) return void (conflict = state);
      if (state.version === base.version) return;
      base = state;
      if ((await editor.applyExternalMarkdown(state.text)).length > 0) {
        conflict = state;
      } else {
        dirty = editor.getMarkdown() !== state.text;
        if (dirty) schedule();
      }
      doc.emit();
    };

    const save = async (): Promise<void> => {
      clearTimers();
      if (closed || conflict || saving || !dirty || status !== "online") return;
      const text = editor.getMarkdown();
      if (text === base.text) {
        dirty = false;
        return doc.emit();
      }
      saving = true;
      doc.emit();
      try {
        const answer = await request({
          type: "update",
          resource: "file",
          path,
          text,
          base: base.version,
        });
        if (answer.resource !== "file") return;
        // text back means the write lost a race: merge what the disk holds
        if ("text" in answer) return await incoming(answer);
        base = { text, version: answer.version };
        editor.markSaved(text);
        dirty = editor.getMarkdown() !== text;
      } catch {
        // offline or connection lost mid-save; retried on reconnect
      } finally {
        saving = false;
        doc.emit();
        if (dirty && !conflict && status === "online") schedule();
      }
    };

    const doc = createDocument(
      { resource: "file", path },
      {
        subscribe: () => ({ type: "subscribe", resource: "file", path }),
        update(message) {
          if (closed || message.resource !== "file" || !("text" in message)) return;
          if (doc.open) return void incoming(message);
          if (message.id === undefined) return;
          base = message;
          doc.settle({ text: message.text, writable: message.writable ?? true });
          doc.emit();
        },
      },
      () => {
        if (status === "online" && dirty && !conflict) schedule();
      },
    );

    return {
      opened: doc.opened,
      status() {
        if (conflict) return "conflict";
        if (status === "offline" || status === "denied") return status;
        return saving ? "saving" : dirty ? "dirty" : "synced";
      },
      collab: () => null,
      subscribe: doc.subscribe,
      changed() {
        if (closed || conflict) return;
        // a change landing back on the synced text (a clean merge's own
        // update event, or an undo) never reports dirty
        dirty = editor.getMarkdown() !== base.text;
        doc.emit();
        if (dirty) schedule();
      },
      flush: save,
      async keepMine() {
        if (!conflict) return;
        base = conflict;
        conflict = undefined;
        dirty = true;
        doc.emit();
        await save();
      },
      async takeDisk() {
        if (!conflict) return;
        const disk = conflict;
        await editor.setMarkdown(disk.text);
        base = disk;
        conflict = undefined;
        dirty = false;
        doc.emit();
      },
      close() {
        closed = true;
        clearTimers();
        doc.stop();
      },
    };
  };

  /**
   * The server holds the document; this side keeps a Yjs copy in sync. The
   * subscription starts before Yjs has loaded so the answer's text can paint
   * early; messages then apply in order once the collab chunk is in.
   */
  const openDoc = (path: string, { components = [], syntax }: OpenOptions): SyncDocument => {
    const specs = components.map(componentSpecData);
    const load = import("./collab");
    let queue = Promise.resolve();
    let closed = false;
    let yjs: CollabDoc | undefined;
    let epoch: string | undefined;

    const doc = createDocument(
      { resource: "doc", path },
      {
        subscribe: () => ({
          type: "subscribe",
          resource: "doc",
          path,
          vector: yjs?.vector() ?? EMPTY_VECTOR,
          components: specs,
          syntax,
        }),
        update(message) {
          if (message.resource !== "doc") return;
          if (message.id !== undefined)
            doc.settle({ text: message.text, writable: message.writable });
          queue = queue
            .then(async () => {
              if (closed) return;
              if (message.id === undefined) return yjs?.receive(message);
              if (yjs && message.epoch !== epoch) {
                // the server re-seeded: this history shares no origin with its doc anymore
                yjs.destroy();
                yjs = epoch = undefined;
                doc.emit();
                if (status === "online") subscribe(entries.get(`doc:${path}`)!);
                return;
              }
              epoch = message.epoch;
              if (yjs) return yjs.join(message);
              yjs = (await load).createCollabDoc(send, path, user);
              yjs.join(message);
              doc.emit();
            })
            // one broken message must not stall every later one
            .catch(() => {});
        },
      },
    );

    return {
      opened: doc.opened,
      status: () => (status === "offline" || status === "denied" ? status : "synced"),
      collab: () => yjs?.binding ?? null,
      subscribe: doc.subscribe,
      changed() {},
      flush: async () => {},
      keepMine: async () => {},
      takeDisk: async () => {},
      close() {
        closed = true;
        doc.stop();
        yjs?.destroy();
        yjs = undefined;
      },
    };
  };

  let tree: WorkspaceTree | null = null;
  let stopTree: (() => void) | undefined;
  const treeListeners = new Set<(tree: WorkspaceTree) => void>();
  const treeEntry: Entry = {
    target: { resource: "tree" },
    subscribe: () => ({ type: "subscribe", resource: "tree" }),
    update(message) {
      if (message.resource !== "tree") return;
      tree = message.tree;
      for (const listener of treeListeners) listener(message.tree);
    },
    // a backend without a tree: it stays null
    error() {},
  };

  connect();

  return {
    collab: collab !== false,
    status: () => status,
    onStatus,
    tree: () => tree,
    onTree(listener) {
      treeListeners.add(listener);
      stopTree ??= register(treeEntry);
      return () => {
        treeListeners.delete(listener);
        if (treeListeners.size > 0 || !stopTree) return;
        stopTree();
        stopTree = undefined;
        tree = null;
      };
    },
    async run(command) {
      const answer = await request({ type: "update", resource: "tree", command });
      if (stopTree) treeEntry.update(answer);
    },
    open: (path, options) =>
      collab === false ? openFile(path, options.editor) : openDoc(path, options),
    close() {
      closed = true;
      clearTimeout(retry);
      connection?.close();
    },
  };
}
