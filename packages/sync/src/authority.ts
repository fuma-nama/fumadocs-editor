import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
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
  parseMdxToDoc,
  type ComponentSpec,
  type DocSnapshot,
  type Syntax,
  type SyntaxOptions,
} from "@fumadocs-editor/core/parse";
import { serializeDocToMdx, tryNormalize } from "@fumadocs-editor/core/serialize";
import { editorExtensions } from "@fumadocs-editor/core/extensions";
import { mergeRemote, type MergeOp } from "./merge";
import { MESSAGE_AWARENESS, MESSAGE_SYNC, collabFrame, readCollabFrame } from "./wire";
import type { FileState, SyncUser } from "./transport";

/** origin marker for Y transactions the authority applies from disk state */
const DISK = "disk";

const TRAILING_MS = 800;
const MAX_WAIT_MS = 5000;

export interface DocAuthorityOptions<C> {
  read(path: string): Promise<FileState>;
  /** unconditional write (the authority is the single writer); returns the new version */
  write(path: string, text: string): Promise<string>;
  send(conn: C, data: Uint8Array): void;
  /** the connection's resolved permissions; gates Y writes and pins identity */
  scope(conn: C): { user?: SyncUser; write(path: string): boolean };
}

interface DocState<C> {
  path: string;
  epoch: string;
  ydoc: Y.Doc;
  fragment: Y.XmlFragment;
  awareness: Awareness;
  syntax: Syntax;
  /** base of the last disk ⇄ Y sync; merges and byte-preservation key off it */
  snapshot: DocSnapshot;
  /** version of the disk text the snapshot corresponds to */
  diskVersion: string;
  /** connected clients and the awareness clientIDs each one announced */
  conns: Map<C, Set<number>>;
  /** disk IO runs strictly in sequence per document */
  queue: Promise<void>;
  trailing?: ReturnType<typeof setTimeout>;
  maxWait?: ReturnType<typeof setTimeout>;
}

export interface DocAuthority<C> {
  /** get-or-create the document, register the client, greet it with sync + presence */
  open(
    path: string,
    conn: C,
    components: ComponentSpec[],
    options?: SyntaxOptions,
  ): Promise<{ epoch: string }>;
  /** a binary collab frame arrived from a client */
  handleBinary(conn: C, data: Uint8Array): void;
  /** the file changed on disk (chokidar); merged into the Y.Doc block-wise */
  diskChanged(path: string, state: FileState): void;
  disconnect(conn: C): void;
  /** flush pending writes and drop every document */
  close(): Promise<void>;
}

// the PM schema is spec-independent (specs drive parse/serialize, not node
// types), so one schema serves every document
let schema: Schema | undefined;
const getDocSchema = () => (schema ??= getSchema(editorExtensions()));

/**
 * The collab side of the sync server: one authoritative Y.Doc per open
 * document. Clients exchange y-protocols sync/awareness messages with it;
 * the authority is the only writer of the file (Y → MDX, debounced,
 * byte-preserving via the snapshot), and external disk changes enter by the
 * same block merge the single-user mirror uses, applied to the Y.Doc.
 *
 * Documents are seeded from disk and never persisted as Y state — the file
 * is the document of record. A document stays alive until the server closes
 * (so briefly offline clients can deliver buffered edits); after a server
 * restart the epoch changes and clients must re-seed rather than sync.
 */
export function createDocAuthority<C>({
  read,
  write,
  send,
  scope,
}: DocAuthorityOptions<C>): DocAuthority<C> {
  const docs = new Map<string, Promise<DocState<C>>>();
  const live = new Set<DocState<C>>();

  const broadcast = (doc: DocState<C>, data: Uint8Array, except?: unknown) => {
    for (const conn of doc.conns.keys()) {
      if (conn !== except) send(conn, data);
    }
  };

  const enqueue = (doc: DocState<C>, task: () => Promise<void> | void) => {
    doc.queue = doc.queue.then(task).catch(() => {});
  };

  const flush = (doc: DocState<C>) => {
    clearTimeout(doc.trailing);
    clearTimeout(doc.maxWait);
    doc.trailing = doc.maxWait = undefined;
    enqueue(doc, () => saveTask(doc));
  };

  const scheduleSave = (doc: DocState<C>) => {
    clearTimeout(doc.trailing);
    doc.trailing = setTimeout(() => flush(doc), TRAILING_MS);
    doc.maxWait ??= setTimeout(() => flush(doc), MAX_WAIT_MS);
  };

  const docNode = (doc: DocState<C>): PMNode =>
    yXmlFragmentToProseMirrorRootNode(doc.fragment, getDocSchema());

  const saveTask = async (doc: DocState<C>) => {
    // fold in a disk change chokidar hasn't delivered yet before overwriting
    const current = await read(doc.path).catch(() => undefined);
    if (current) applyDisk(doc, current);
    const text = serializeDocToMdx(docNode(doc).toJSON(), doc.snapshot, doc.syntax);
    if (current && text === current.text) return;
    doc.diskVersion = await write(doc.path, text);
    // the just-written text is the new merge base; parsing our own output is
    // the round-trip guarantee and refreshes block sources for byte reuse
    doc.snapshot = parseMdxToDoc(text, doc.syntax).snapshot;
  };

  /** merge a new disk state into the Y.Doc; same-block conflicts keep Y */
  const applyDisk = (doc: DocState<C>, state: FileState) => {
    if (state.version === doc.diskVersion) return;
    const pmDoc = docNode(doc);
    const children: JSONContent[] = [];
    const localNormalized: string[] = [];
    pmDoc.forEach((child) => {
      const json = child.toJSON() as JSONContent;
      children.push(json);
      localNormalized.push(tryNormalize(json, doc.syntax) ?? "");
    });
    let result;
    try {
      result = mergeRemote({ base: doc.snapshot, localNormalized, remoteText: state.text });
    } catch {
      // unparseable disk text (an IDE mid-save, a bad merge): the Y.Doc stays
      // the authority and the next save rewrites the file
      scheduleSave(doc);
      return;
    }
    if (result.ops.length > 0) {
      const target = applyOps(children, result.ops);
      const next = getDocSchema().nodeFromJSON({ type: "doc", content: target });
      doc.ydoc.transact(
        () =>
          updateYFragment(doc.ydoc, doc.fragment, next, { mapping: new Map(), isOMark: new Map() }),
        DISK,
      );
    }
    doc.snapshot = result.remote.snapshot;
    doc.diskVersion = state.version;
  };

  const createDoc = async (
    path: string,
    components: ComponentSpec[],
    options?: SyntaxOptions,
  ): Promise<DocState<C>> => {
    const state = await read(path);
    // the first opener's syntax wins; every client of one app sends the same
    const syntax = createSyntax(components, options);
    const parsed = parseMdxToDoc(state.text, syntax);
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("default");
    ydoc.transact(
      () =>
        updateYFragment(ydoc, fragment, getDocSchema().nodeFromJSON(parsed.doc), {
          mapping: new Map(),
          isOMark: new Map(),
        }),
      DISK,
    );
    const awareness = new Awareness(ydoc);
    awareness.setLocalState(null);

    const doc: DocState<C> = {
      path,
      epoch: randomUUID(),
      ydoc,
      fragment,
      awareness,
      syntax,
      snapshot: parsed.snapshot,
      diskVersion: state.version,
      conns: new Map(),
      queue: Promise.resolve(),
    };

    ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      const frame = collabFrame(path, MESSAGE_SYNC);
      syncProtocol.writeUpdate(frame, update);
      broadcast(doc, encoding.toUint8Array(frame), origin);
      scheduleSave(doc);
    });

    awareness.on(
      "update",
      (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = changes.added.concat(changes.updated, changes.removed);
        const owned = doc.conns.get(origin as C);
        if (owned) {
          for (const id of changes.added) owned.add(id);
          for (const id of changes.updated) owned.add(id);
          for (const id of changes.removed) owned.delete(id);
        }
        const frame = collabFrame(path, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(frame, encodeAwarenessUpdate(awareness, changed));
        broadcast(doc, encoding.toUint8Array(frame));
      },
    );

    live.add(doc);
    return doc;
  };

  return {
    open(path, conn, components, options) {
      let entry = docs.get(path);
      if (!entry) {
        entry = createDoc(path, components, options);
        docs.set(path, entry);
        entry.catch(() => docs.delete(path));
      }
      return entry.then((doc) => {
        if (!doc.conns.has(conn)) doc.conns.set(conn, new Set());
        // greet writers with our step1 (the reply delivers their buffered
        // edits) — a read-only client's reply would only be refused — and
        // everyone with the room's presence
        if (scope(conn).write(path)) {
          const step1 = collabFrame(path, MESSAGE_SYNC);
          syncProtocol.writeSyncStep1(step1, doc.ydoc);
          send(conn, encoding.toUint8Array(step1));
        }
        const states = doc.awareness.getStates();
        if (states.size > 0) {
          const aw = collabFrame(path, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(aw, encodeAwarenessUpdate(doc.awareness, [...states.keys()]));
          send(conn, encoding.toUint8Array(aw));
        }
        return { epoch: doc.epoch };
      });
    },

    handleBinary(conn, data) {
      const frame = readCollabFrame(data);
      void docs.get(frame.path)?.then((doc) => {
        if (!doc.conns.has(conn)) return;
        if (frame.kind === MESSAGE_SYNC) {
          // step1 asks for our state (a read); step2 and update frames carry
          // client edits and are refused without write permission
          if (
            decoding.peekVarUint(frame.decoder) !== syncProtocol.messageYjsSyncStep1 &&
            !scope(conn).write(doc.path)
          ) {
            return;
          }
          const reply = collabFrame(frame.path, MESSAGE_SYNC);
          const header = encoding.length(reply);
          syncProtocol.readSyncMessage(frame.decoder, reply, doc.ydoc, conn);
          if (encoding.length(reply) > header) send(conn, encoding.toUint8Array(reply));
        } else if (frame.kind === MESSAGE_AWARENESS) {
          const update = decoding.readVarUint8Array(frame.decoder);
          const user = scope(conn).user;
          applyAwarenessUpdate(doc.awareness, user ? withUser(update, user) : update, conn);
        }
      });
    },

    diskChanged(path, state) {
      void docs.get(path)?.then((doc) => {
        enqueue(doc, () => {
          applyDisk(doc, state);
          // a conflicting block keeps the Y version without producing ops, so
          // always let a save settle disk == authority (it skips when equal)
          scheduleSave(doc);
        });
      });
    },

    disconnect(conn) {
      for (const doc of live) {
        const owned = doc.conns.get(conn);
        if (!owned) continue;
        doc.conns.delete(conn);
        if (owned.size > 0) removeAwarenessStates(doc.awareness, [...owned], null);
      }
    },

    async close() {
      for (const doc of live) flush(doc);
      for (const doc of live) {
        await doc.queue;
        doc.awareness.destroy();
        doc.ydoc.destroy();
      }
      live.clear();
      docs.clear();
    },
  };
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

/** apply block-level merge ops (indices refer to the pre-merge children) */
function applyOps(children: JSONContent[], ops: MergeOp[]): JSONContent[] {
  const replace = new Map<number, JSONContent>();
  const removed = new Set<number>();
  const inserts = new Map<number, JSONContent[]>();
  for (const op of ops) {
    if (op.type === "replace") replace.set(op.local, op.node);
    else if (op.type === "delete") removed.add(op.local);
    else {
      const list = inserts.get(op.after);
      if (list) list.push(op.node);
      else inserts.set(op.after, [op.node]);
    }
  }
  const out: JSONContent[] = inserts.get(-1) ?? [];
  for (let i = 0; i < children.length; i++) {
    if (!removed.has(i)) out.push(replace.get(i) ?? children[i]);
    const after = inserts.get(i);
    if (after) out.push(...after);
  }
  return out;
}
