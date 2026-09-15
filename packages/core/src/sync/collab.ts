import type { Extensions } from "@tiptap/core";
import { Collaboration } from "@tiptap/extension-collaboration";
import {
  CollaborationCaret,
  type CollaborationCaretOptions,
} from "@tiptap/extension-collaboration-caret";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import type { ClientMessage, ServerMessage, SyncUser } from "./protocol";

/** an update applied from the wire; local edits carry any other origin */
const REMOTE = "remote";
const GUEST_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#0891b2"];

/** how peers see this client's caret */
export interface CollabCaret {
  /** the element placed at this user's cursor on other clients */
  render?(user: SyncUser): HTMLElement;
  /** decoration attributes for this user's selection on other clients */
  selectionRender?(user: SyncUser): { class?: string; style?: string };
}

export interface CollabBinding {
  doc: Y.Doc;
  awareness: Awareness;
  /**
   * Editor extensions bound to the doc: shared editing, undo scoped to local
   * edits and, given a caret, presence for peers.
   */
  extensions(caret?: CollabCaret): Extensions;
}

type DocUpdate = Extract<ServerMessage, { type: "update"; resource: "doc" }>;
type DocAnswer = Extract<DocUpdate, { id: number }>;

export type CollabDoc = ReturnType<typeof createCollabDoc>;

export function createCollabDoc(
  send: (message: ClientMessage) => void,
  path: string,
  user: SyncUser | undefined,
) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const identity = user ?? {
    name: "Guest",
    color: GUEST_COLORS[Math.floor(Math.random() * GUEST_COLORS.length)],
  };

  /** an edit and the caret move it causes land in one tick: they leave as one message */
  let outbox: { yjs: Uint8Array[]; awareness: boolean } | undefined;
  const flush = () => {
    if (!outbox) return;
    const { yjs, awareness: moved } = outbox;
    outbox = undefined;
    send({
      type: "update",
      resource: "doc",
      path,
      ...(yjs.length > 0 ? { yjs: yjs.length === 1 ? yjs[0] : Y.mergeUpdates(yjs) } : {}),
      ...(moved ? { awareness: encodeAwarenessUpdate(awareness, [doc.clientID]) } : {}),
    });
  };
  const queue = (change: Uint8Array | "awareness") => {
    if (!outbox) {
      outbox = { yjs: [], awareness: false };
      queueMicrotask(flush);
    }
    if (change === "awareness") outbox.awareness = true;
    else outbox.yjs.push(change);
  };

  const onUpdate = (data: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) queue(data);
  };
  // renewals emit `update` too, which is what keeps presence alive on peers
  const onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const id = doc.clientID;
    if (origin === REMOTE || !(added.includes(id) || updated.includes(id) || removed.includes(id)))
      return;
    queue("awareness");
  };
  doc.on("update", onUpdate);
  awareness.on("update", onAwareness);

  const binding: CollabBinding = {
    doc,
    awareness,
    extensions(caret) {
      const list: Extensions = [Collaboration.configure({ document: doc })];
      if (caret) {
        // configure merges keys as given: an absent renderer keeps tiptap's default
        const options: Partial<CollaborationCaretOptions> = {
          provider: { awareness },
          user: identity,
        };
        if (caret.render) options.render = caret.render;
        if (caret.selectionRender) options.selectionRender = caret.selectionRender;
        list.push(CollaborationCaret.configure(options));
      }
      return list;
    },
  };

  return {
    binding,
    vector: () => Y.encodeStateVector(doc),
    join(answer: DocAnswer) {
      // diffed before applying: the server lacks none of its own structs
      if (answer.writable) {
        const missing = Y.encodeStateAsUpdate(doc, answer.vector);
        // an update carrying nothing encodes as two zero bytes
        if (missing.length > 2) queue(missing);
      }
      Y.applyUpdate(doc, answer.yjs, REMOTE);
      if (awareness.getLocalState() !== null) queue("awareness");
    },
    receive(push: Exclude<DocUpdate, DocAnswer>) {
      if (push.yjs) Y.applyUpdate(doc, push.yjs, REMOTE);
      if (push.awareness) applyAwarenessUpdate(awareness, push.awareness, REMOTE);
    },
    destroy() {
      // announce departure while the handlers are still wired
      removeAwarenessStates(awareness, [doc.clientID], "destroy");
      flush();
      doc.off("update", onUpdate);
      awareness.off("update", onAwareness);
      awareness.destroy();
    },
  };
}
