import type { Extensions } from "@tiptap/core";
import { Collaboration } from "@tiptap/extension-collaboration";
import {
  CollaborationCaret,
  type CollaborationCaretOptions,
} from "@tiptap/extension-collaboration-caret";
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
import { componentSpecData, type ComponentSpec, type SyntaxOptions } from "../components/spec";
import { MESSAGE_AWARENESS, MESSAGE_SYNC, collabFrame, readCollabFrame } from "./wire";
import type { WsTransport } from "./client";
import type { SyncUser } from "./transport";

/** an update applied from the wire; local edits carry any other origin */
const REMOTE = "remote";

export interface CollabSessionOptions {
  transport: WsTransport;
  path: string;
  /**
   * The syntax the document is edited with. Only the data fields of each
   * spec cross the wire ({@link componentSpecData}). The server parses and
   * serializes with them; renderers stay client-side.
   */
  components: ComponentSpec[];
  /** dialect switches beyond the component specs (math, directives…) */
  syntax?: SyntaxOptions;
  /**
   * The server re-seeded this document since we first synced (it restarted):
   * our Y history no longer shares an origin with its doc, so syncing would
   * duplicate the whole document. The owner must discard this session and
   * start a fresh one; local edits not yet delivered are lost with it.
   */
  onReset?: () => void;
  /** for tests: adopt an existing doc instead of creating one */
  doc?: Y.Doc;
}

/** presence shown to peers; without one the session syncs edits only */
export interface CollabCaret {
  /** announced to peers as this client's identity */
  user: SyncUser;
  /** the element placed at this user's cursor on other clients */
  render?(user: SyncUser): HTMLElement;
  /** decoration attributes for this user's selection on other clients */
  selectionRender?(user: SyncUser): { class?: string; style?: string };
}

export interface CollabSession {
  doc: Y.Doc;
  awareness: Awareness;
  /**
   * Editor extensions bound to this session: shared editing on the doc, undo
   * scoped to local edits and, given a caret, presence for peers.
   */
  extensions(caret?: CollabCaret): Extensions;
  /** resolves once the first server sync lands and the doc holds the document */
  whenSynced: Promise<void>;
  /**
   * Scope-derived data from the doc-open handshake, set before `whenSynced`
   * resolves. The session never acts on it; consumers wire it into their
   * own props (e.g. `writable` into the editor's `editable`).
   */
  access?: { user?: SyncUser; writable: boolean };
  destroy(): void;
}

/**
 * One collaboratively edited document over the mirror websocket: a Y.Doc
 * kept in sync with the server's authoritative copy, plus presence. The
 * transport owns the connection; on every (re)connect the session re-opens
 * the document and runs the y-protocols handshake, which also delivers any
 * edits buffered while offline.
 */
export function createCollabSession(options: CollabSessionOptions): CollabSession {
  const { transport, path, components, syntax, onReset } = options;
  const doc = options.doc ?? new Y.Doc();
  const awareness = new Awareness(doc);
  let epoch: string | undefined;
  let destroyed = false;

  let synced!: () => void;
  const whenSynced = new Promise<void>((resolve) => {
    synced = resolve;
  });

  const send = (frame: encoding.Encoder) => transport.sendBinary(encoding.toUint8Array(frame));

  const stopBinary = transport.onBinary((data) => {
    const frame = readCollabFrame(data);
    if (frame.path !== path) return;
    if (frame.kind === MESSAGE_SYNC) {
      const reply = collabFrame(path, MESSAGE_SYNC);
      const header = encoding.length(reply);
      const type = syncProtocol.readSyncMessage(frame.decoder, reply, doc, REMOTE);
      if (encoding.length(reply) > header) send(reply);
      if (type === syncProtocol.messageYjsSyncStep2) synced();
    } else if (frame.kind === MESSAGE_AWARENESS) {
      applyAwarenessUpdate(awareness, decoding.readVarUint8Array(frame.decoder), REMOTE);
    }
  });

  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    const frame = collabFrame(path, MESSAGE_SYNC);
    syncProtocol.writeUpdate(frame, update);
    send(frame);
  };
  doc.on("update", onDocUpdate);

  // forward every awareness change (including our periodic renewal); stale
  // clocks are ignored on receipt, and this is what keeps presence alive
  const onAwarenessUpdate = (changes: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const changed = changes.added.concat(changes.updated, changes.removed);
    const frame = collabFrame(path, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(frame, encodeAwarenessUpdate(awareness, changed));
    send(frame);
  };
  awareness.on("update", onAwarenessUpdate);

  const hello = async () => {
    try {
      const reply = await transport.request<{
        epoch: string;
        user?: SyncUser;
        writable?: boolean;
      }>({
        type: "collab-open",
        path,
        components: components.map(componentSpecData),
        syntax,
      });
      if (destroyed) return;
      if (epoch !== undefined && reply.epoch !== epoch) {
        onReset?.();
        return;
      }
      epoch = reply.epoch;
      session.access = { user: reply.user, writable: reply.writable ?? true };
      const frame = collabFrame(path, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(frame, doc);
      send(frame);
      if (awareness.getLocalState() !== null)
        onAwarenessUpdate({ added: [doc.clientID], updated: [], removed: [] });
    } catch {
      // offline or connection lost mid-open; retried on reconnect
    }
  };
  const session: CollabSession = {
    doc,
    awareness,
    extensions(caret) {
      const list: Extensions = [Collaboration.configure({ document: doc })];
      if (caret) {
        // configure merges keys as given: an absent renderer keeps tiptap's default
        const options: Partial<CollaborationCaretOptions> = {
          provider: { awareness },
          user: caret.user,
        };
        if (caret.render) options.render = caret.render;
        if (caret.selectionRender) options.selectionRender = caret.selectionRender;
        list.push(CollaborationCaret.configure(options));
      }
      return list;
    },
    whenSynced,
    destroy() {
      destroyed = true;
      // announce departure while the handlers are still wired
      removeAwarenessStates(awareness, [doc.clientID], "destroy");
      stopBinary();
      stopStatus();
      awareness.off("update", onAwarenessUpdate);
      awareness.destroy();
      doc.off("update", onDocUpdate);
    },
  };

  // fires immediately with the current state, so this is also the first open
  const stopStatus = transport.onStatus((status) => {
    if (status === "online") void hello();
  });

  return session;
}
