import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { getSchema, type JSONContent } from "@tiptap/core";
import type { Schema, Node as PMNode } from "@tiptap/pm/model";
import {
  createSyntax,
  type ComponentSpec,
  type Syntax,
  type SyntaxOptions,
} from "../../components/spec";
import { parseMdxToDoc, type DocSnapshot } from "../../document";
import { assembleSnapshot, snapshotText, tryNormalize } from "../../serializer";
import { editorExtensions } from "../../extensions/kit";
import { applyMergeOps, mergeRemote } from "../../merge";
import type { SyncUser } from "../protocol";
import { answer, bytes, encode, str, type Connection, type Resource } from "./connection";
import type { FileState, Files } from "./files";

/** origin marker for Y transactions the authority applies from disk state */
const DISK = "disk";

const TRAILING_MS = 800;
const MAX_WAIT_MS = 5000;

interface DocState {
  path: string;
  epoch: string;
  ydoc: Y.Doc;
  fragment: Y.XmlFragment;
  awareness: Awareness;
  syntax: Syntax;
  /** node types follow the registered components, so the schema is per document */
  schema: Schema;
  /** base of the last disk ⇄ Y sync; merges and byte-preservation key off it */
  snapshot: DocSnapshot;
  /** the disk text the snapshot corresponds to, and its version */
  diskText: string;
  diskVersion: string;
  /** normalized text per top-level element, dropped when anything inside it changes */
  normalized: WeakMap<object, string>;
  /** connected clients and the awareness clientIDs each one announced */
  conns: Map<Connection, Set<number>>;
  /** changes waiting for the end of the tick, grouped by the connection they came from */
  outbox: Map<unknown, { yjs: Uint8Array[]; awareness: Set<number> }>;
  /** disk IO runs strictly in sequence per document */
  queue: Promise<void>;
  trailing?: ReturnType<typeof setTimeout>;
  maxWait?: ReturnType<typeof setTimeout>;
  /** pending eviction, armed while the doc has no clients */
  evict?: ReturnType<typeof setTimeout>;
}

/**
 * One Y.Doc per open file. This process is the only writer (Y → MDX,
 * debounced, byte-preserving); disk changes merge in the same way as a file
 * session's.
 *
 * Seeded from disk, never stored as Y state. After the last client leaves,
 * flush then evict after a grace (reload shouldn't drop Y history). A later
 * reopen re-seeds via a new epoch, like a restart.
 */
export function createDocAuthority({
  files,
  evictAfterMs = 60_000,
}: {
  files: Files;
  /** grace period after the last client leaves before the doc is evicted */
  evictAfterMs?: number;
}) {
  const docs = new Map<string, Promise<DocState>>();
  /** the documents past seeding, by path: the per-message lookup stays synchronous */
  const live = new Map<string, DocState>();

  const broadcast = (doc: DocState, data: string | Uint8Array, except?: unknown) => {
    for (const conn of doc.conns.keys()) {
      if (conn !== except) conn.send(data);
    }
  };

  /** an edit and the caret move it causes arrive in one tick: they leave as one push */
  const relay = (doc: DocState, origin: unknown, change: Uint8Array | number[]) => {
    let batch = doc.outbox.get(origin);
    if (!batch) {
      if (doc.outbox.size === 0) queueMicrotask(() => deliver(doc));
      doc.outbox.set(origin, (batch = { yjs: [], awareness: new Set() }));
    }
    if (change instanceof Uint8Array) batch.yjs.push(change);
    else for (const id of change) batch.awareness.add(id);
  };

  const deliver = (doc: DocState) => {
    for (const [origin, { yjs, awareness }] of doc.outbox) {
      const push = encode({
        resource: "doc",
        path: doc.path,
        ...(yjs.length > 0 ? { yjs: yjs.length === 1 ? yjs[0] : Y.mergeUpdates(yjs) } : {}),
        ...(awareness.size > 0
          ? { awareness: encodeAwarenessUpdate(doc.awareness, [...awareness]) }
          : {}),
      });
      broadcast(doc, push, origin);
    }
    doc.outbox.clear();
  };

  const enqueue = (doc: DocState, task: () => Promise<void> | void) => {
    doc.queue = doc.queue.then(task).catch(() => {});
  };

  const flush = (doc: DocState) => {
    clearTimeout(doc.trailing);
    clearTimeout(doc.maxWait);
    doc.trailing = doc.maxWait = undefined;
    enqueue(doc, () => files.lock(doc.path, () => saveTask(doc)));
  };

  const scheduleSave = (doc: DocState) => {
    clearTimeout(doc.trailing);
    doc.trailing = setTimeout(() => flush(doc), TRAILING_MS);
    doc.maxWait ??= setTimeout(() => flush(doc), MAX_WAIT_MS);
  };

  const docNode = (doc: DocState): PMNode =>
    yXmlFragmentToProseMirrorRootNode(doc.fragment, doc.schema);

  /** the Y.Doc laid out against the snapshot: the text to write and the next merge base */
  const layout = (doc: DocState): DocSnapshot => {
    const node = docNode(doc);
    // read after converting: y-tiptap deletes the elements the schema rejects
    const elements = doc.fragment.toArray();
    const normalized: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      let text = doc.normalized.get(elements[i]);
      if (text === undefined) {
        text = tryNormalize(node.child(i).toJSON(), doc.syntax) ?? "";
        doc.normalized.set(elements[i], text);
      }
      normalized.push(text);
    }
    return assembleSnapshot(normalized, doc.snapshot, doc.syntax);
  };

  const saveTask = async (doc: DocState) => {
    // fold in a disk change chokidar hasn't delivered yet before overwriting
    const current = await files.read(doc.path).catch(() => undefined);
    if (current) applyDisk(doc, current);
    const snapshot = layout(doc);
    const text = snapshotText(snapshot);
    if (current && text === current.text) return;
    doc.diskVersion = await files.write(doc.path, text);
    doc.diskText = text;
    doc.snapshot = snapshot;
  };

  /** merge a new disk state into the Y.Doc; same-block conflicts keep Y */
  const applyDisk = (doc: DocState, state: FileState) => {
    if (state.version === doc.diskVersion) return;
    const local = docNode(doc).toJSON() as JSONContent;
    let result;
    try {
      result = mergeRemote({ base: doc.snapshot, local, remoteText: state.text });
    } catch {
      // unparseable disk text (an IDE mid-save, a bad merge): the Y.Doc stays
      // the authority and the next save rewrites the file
      scheduleSave(doc);
      return;
    }
    if (result.ops.length > 0) {
      const target = applyMergeOps(local.content ?? [], result.ops);
      const next = doc.schema.nodeFromJSON({ type: "doc", content: target });
      doc.ydoc.transact(
        () =>
          updateYFragment(doc.ydoc, doc.fragment, next, { mapping: new Map(), isOMark: new Map() }),
        DISK,
      );
    }
    doc.snapshot = result.remote.snapshot;
    doc.diskText = state.text;
    doc.diskVersion = state.version;
  };

  const createDoc = async (
    path: string,
    components: ComponentSpec[],
    options?: SyntaxOptions,
  ): Promise<DocState> => {
    const state = await files.read(path);
    // the first opener's syntax wins; every client of one app sends the same
    const syntax = createSyntax(components, options);
    const schema = getSchema(editorExtensions({ components }));
    const parsed = parseMdxToDoc(state.text, syntax);
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("default");
    ydoc.transact(
      () =>
        updateYFragment(ydoc, fragment, schema.nodeFromJSON(parsed.doc), {
          mapping: new Map(),
          isOMark: new Map(),
        }),
      DISK,
    );
    const awareness = new Awareness(ydoc);
    awareness.setLocalState(null);

    const doc: DocState = {
      path,
      epoch: randomUUID(),
      ydoc,
      fragment,
      awareness,
      syntax,
      schema,
      snapshot: parsed.snapshot,
      diskText: state.text,
      diskVersion: state.version,
      normalized: new WeakMap(),
      conns: new Map(),
      outbox: new Map(),
      queue: Promise.resolve(),
    };

    ydoc.on("afterTransaction", (transaction: Y.Transaction) => {
      for (const type of transaction.changedParentTypes.keys()) doc.normalized.delete(type);
    });

    ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      relay(doc, origin, update);
      scheduleSave(doc);
    });

    awareness.on(
      "update",
      (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const owned = doc.conns.get(origin as Connection);
        if (owned) {
          for (const id of changes.added) owned.add(id);
          for (const id of changes.updated) owned.add(id);
          for (const id of changes.removed) owned.delete(id);
        }
        relay(doc, origin, changes.added.concat(changes.updated, changes.removed));
      },
    );

    live.set(path, doc);
    return doc;
  };

  const evict = (doc: DocState) => {
    if (doc.conns.size > 0) return;
    docs.delete(doc.path);
    live.delete(doc.path);
    // a disk change during the grace may have re-armed the save debounce
    flush(doc);
    enqueue(doc, () => {
      doc.awareness.destroy();
      doc.ydoc.destroy();
    });
  };

  const open = (
    path: string,
    components: ComponentSpec[],
    options?: SyntaxOptions,
  ): Promise<DocState> => {
    let entry = docs.get(path);
    if (!entry) {
      entry = createDoc(path, components, options);
      docs.set(path, entry);
      entry.catch(() => docs.delete(path));
    }
    return entry.then((doc) =>
      // evicted between lookup and resolution: start over with a fresh doc
      live.get(path) === doc ? doc : open(path, components, options),
    );
  };

  const leaveDoc = (doc: DocState, conn: Connection) => {
    const owned = doc.conns.get(conn);
    if (!owned) return;
    doc.conns.delete(conn);
    if (owned.size > 0) removeAwarenessStates(doc.awareness, [...owned], null);
    if (doc.conns.size === 0) {
      flush(doc);
      doc.evict = setTimeout(() => evict(doc), evictAfterMs);
    }
  };

  return {
    async subscribe(conn, message) {
      const relative = files.rel(str(message.path));
      if (!conn.scope.read(relative)) throw new Error(`read denied: ${relative}`);
      const vector = bytes(message.vector);
      const components = Array.isArray(message.components)
        ? (message.components as ComponentSpec[])
        : [];
      // external edits must keep flowing into the Y.Doc
      files.watch();
      const doc = await open(relative, components, message.syntax as SyntaxOptions | undefined);
      const update = Y.encodeStateAsUpdate(doc.ydoc, vector);
      clearTimeout(doc.evict);
      doc.evict = undefined;
      if (!doc.conns.has(conn)) doc.conns.set(conn, new Set());
      answer(conn, message, {
        resource: "doc",
        path: relative,
        text: doc.diskText,
        epoch: doc.epoch,
        writable: conn.scope.write(relative),
        vector: Y.encodeStateVector(doc.ydoc),
        yjs: update,
      });
      const states = doc.awareness.getStates();
      if (states.size > 0) {
        const presence = encodeAwarenessUpdate(doc.awareness, [...states.keys()]);
        conn.send(encode({ resource: "doc", path: relative, awareness: presence }));
      }
    },

    unsubscribe(conn, message) {
      const doc = docs.get(files.rel(str(message.path)));
      void doc?.then((state) => leaveDoc(state, conn));
    },

    async update(conn, message) {
      const path = str(message.path);
      // keys are normalized paths: a match needs no resolving on every keystroke
      const doc = live.get(path) ?? live.get(files.rel(path));
      if (!doc?.conns.has(conn)) return;
      // client edits are refused without write permission; presence is not
      if (message.yjs !== undefined && conn.scope.write(doc.path)) {
        Y.applyUpdate(doc.ydoc, bytes(message.yjs), conn);
      }
      if (message.awareness !== undefined) {
        const update = bytes(message.awareness);
        const user = conn.scope.user;
        applyAwarenessUpdate(doc.awareness, user ? withUser(update, user) : update, conn);
      }
    },

    leave(conn) {
      for (const doc of live.values()) leaveDoc(doc, conn);
    },

    /** the file changed on disk or through a client write; merged into the Y.Doc block-wise */
    diskChanged(path: string, state: FileState) {
      void docs.get(path)?.then((doc) => {
        enqueue(doc, () => {
          applyDisk(doc, state);
          // a conflicting block keeps the Y version without producing ops, so
          // always let a save settle disk == authority (it skips when equal)
          scheduleSave(doc);
        });
      });
    },

    /** forget the document: unsaved edits are discarded, a running save completes first */
    async drop(path: string) {
      const entry = docs.get(path);
      if (!entry) return;
      docs.delete(path);
      const doc = await entry.catch(() => undefined);
      if (!doc || live.get(path) !== doc) return;
      live.delete(path);
      // a save in flight may merge disk state, which re-arms the debounce
      // and can enqueue once more: drain until the queue stands still
      let queue: Promise<void>;
      do {
        clearTimeout(doc.trailing);
        clearTimeout(doc.maxWait);
        clearTimeout(doc.evict);
        queue = doc.queue;
        await queue;
      } while (queue !== doc.queue);
      doc.awareness.destroy();
      doc.ydoc.destroy();
    },

    /** flush pending writes and drop every document */
    async close() {
      for (const doc of live.values()) {
        clearTimeout(doc.evict);
        flush(doc);
      }
      for (const doc of live.values()) {
        await doc.queue;
        doc.awareness.destroy();
        doc.ydoc.destroy();
      }
      live.clear();
      docs.clear();
    },
  } satisfies Resource & Record<string, unknown>;
}

/**
 * Rewrite every state in an awareness update to carry the authenticated
 * identity: a scope user is authoritative, so a spoofed name never reaches
 * peers (client-chosen cosmetic fields the scope doesn't pin, like a colour,
 * survive). Wire format per y-protocols/awareness: entry count, then
 * (clientID, clock, JSON state) per entry.
 */
function withUser(update: Uint8Array, user: SyncUser): Uint8Array {
  const decoder = decoding.createDecoder(update);
  const encoder = encoding.createEncoder();
  const count = decoding.readVarUint(decoder);
  encoding.writeVarUint(encoder, count);
  for (let i = 0; i < count; i++) {
    encoding.writeVarUint(encoder, decoding.readVarUint(decoder));
    encoding.writeVarUint(encoder, decoding.readVarUint(decoder));
    const raw = decoding.readVarString(decoder);
    const state = JSON.parse(raw) as Record<string, unknown> | null;
    encoding.writeVarString(
      encoder,
      state === null
        ? raw
        : JSON.stringify({ ...state, user: { ...(state.user as object), ...user } }),
    );
  }
  return encoding.toUint8Array(encoder);
}
