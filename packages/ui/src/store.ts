import type { DocSnapshot, ParsedDoc, SyntaxOptions } from "@fumadocs-editor/core/parse";
import type { MergeOp } from "@fumadocs-editor/core/serialize";
import type {
  FileSession,
  ReadResult,
  SessionStatus,
  SyncTransport,
  WsTransport,
} from "@fumadocs-editor/core/sync";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorCollab } from "./collab";
import type { FileProvider, MediaProvider } from "./components/media";
import { specsByType, type UiComponentSpec } from "./components/spec";
import { parseDocCached } from "./doc-cache";

export interface MdxEditorRef {
  /** serialize; unedited blocks are byte-identical */
  getMarkdown: () => string;
  /**
   * Merge on-disk markdown into the document. Disk-only block changes apply
   * in place; the caret stays put. Blocks edited on both sides keep local.
   * Returns conflicting local child indices (`-1` = whole document, e.g. the
   * source does not parse right now).
   */
  applyExternalMarkdown: (text: string) => Promise<number[]>;
  /** replace the document (e.g. conflict: take disk) */
  setMarkdown: (text: string) => Promise<void>;
  /**
   * Saved as `text`: adopt it as the merge base, do not touch the live
   * document. `FileSession` calls this after every write.
   */
  markSaved: (text: string) => void;
  /** the preset's current surface */
  getMode: () => EditorMode;
  /** switch the preset's surface; refused while the source does not parse */
  setMode: (mode: EditorMode) => void;
}

export type EditorMode = "visual" | "source";

/** presence identity shown at a user's caret on other clients */
export interface CollabUser {
  name: string;
  color: string;
}

export interface MdxEditorSync {
  /** root-relative path on the sync server */
  path: string;
  /**
   * Sync transport. Default: one shared websocket to the current host
   * (`wsTransport()`). Pass your own for auth or a custom backend.
   */
  transport?: SyncTransport;
  /**
   * Collaborative editing. The server holds the document (single writer),
   * peer carets show live, undo is your edits only. `true` joins as a
   * guest; pass `user` for presence. Needs the websocket transport.
   */
  collab?: boolean | { user?: CollabUser };
  /** also shown by `MdxEditor.Status`; use this to mirror it elsewhere */
  onStatus?: (status: SessionStatus) => void;
  /**
   * File was read: text plus scope data. Does not change editor behavior;
   * wire `writable` into `editable` yourself.
   */
  onOpen?: (result: ReadResult) => void;
}

export interface CollabLink {
  transport: WsTransport;
  path: string;
  user: CollabUser;
}

export type SerializeFn = (doc: PMNode, snapshot?: DocSnapshot) => string;

/** the root's props the store reads when it acts */
export interface DocumentOptions {
  defaultValue: string;
  sync?: MdxEditorSync;
  cacheKey?: string;
  onChange?: (markdown: string) => void;
}

export interface DocumentState {
  /** the parsed document: the static paint, and what a live editor mounts with */
  content: JSONContent | null;
  /** static paint, then the live editor mounting behind it, then live */
  stage: "static" | "mounting" | "live";
  mode: EditorMode;
  /** the document as text; while a source draft does not parse, the draft */
  text: string;
  sourceError: string | null;
  /** null without `sync` */
  status: SessionStatus | null;
  collab: EditorCollab | null;
  /** bumps when the document is replaced wholesale: another file, a collab re-seed */
  generation: number;
}

const SOURCE_PARSE_MS = 300;
const SERIALIZE_MS = 250;
const GUEST_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#0891b2"];

let sharedTransport: WsTransport | undefined;

const noop = () => {};

function initialState(options: DocumentOptions, generation: number): DocumentState {
  return {
    content: null,
    stage: "static",
    mode: "visual",
    text: options.sync ? "" : options.defaultValue,
    sourceError: null,
    status: options.sync ? "synced" : null,
    collab: null,
    generation,
  };
}

/** the merge ops applied to a JSON document: index-addressed, so one pass */
function applyOps(doc: JSONContent, ops: MergeOp[]): JSONContent {
  const content = doc.content ?? [];
  const replaced = new Map<number, JSONContent>();
  const deleted = new Set<number>();
  const inserted = new Map<number, JSONContent[]>();
  for (const op of ops) {
    if (op.type === "replace") replaced.set(op.local, op.node);
    else if (op.type === "delete") deleted.add(op.local);
    else {
      const list = inserted.get(op.after);
      if (list) list.push(op.node);
      else inserted.set(op.after, [op.node]);
    }
  }
  const next: JSONContent[] = inserted.get(-1) ?? [];
  for (let i = 0; i < content.length; i++) {
    if (!deleted.has(i)) next.push(replaced.get(i) ?? content[i]);
    const after = inserted.get(i);
    if (after) for (const node of after) next.push(node);
  }
  return { ...doc, content: next };
}

/**
 * The document behind a root: parsed content, its snapshot, the live editor
 * once one attaches, the sync session and collab. React reads `state`
 * through `subscribe`; everything else is imperative.
 */
export class DocumentStore {
  readonly components: UiComponentSpec[];
  readonly specs: Map<string, UiComponentSpec>;
  readonly syntax: SyntaxOptions | undefined;
  /** the root's latest props */
  options: DocumentOptions;
  media: MediaProvider | undefined;
  files: FileProvider | undefined;
  state: DocumentState;
  readonly handle: MdxEditorRef;

  private live: { editor: Editor; serialize: SerializeFn } | null = null;
  private snapshot: DocSnapshot | undefined;
  /** the document as text while no editor holds it; always parses */
  private markdown: string;
  private readonly listeners = new Set<() => void>();
  private session: FileSession | undefined;
  private collab: EditorCollab | null = null;
  private stopSync = noop;
  private cancelIdle = noop;
  private parseTimer: number | undefined;
  /** bumps on every open and close so stale async work is dropped */
  private token = 0;

  constructor(
    components: UiComponentSpec[],
    syntax: SyntaxOptions | undefined,
    options: DocumentOptions,
  ) {
    this.components = components;
    this.specs = specsByType(components);
    this.syntax = syntax;
    this.options = options;
    this.state = initialState(options, 0);
    this.markdown = this.state.text;
    this.handle = {
      getMarkdown: this.getMarkdown,
      applyExternalMarkdown: this.applyExternalMarkdown,
      setMarkdown: this.setMarkdown,
      markSaved: this.markSaved,
      getMode: () => this.state.mode,
      setMode: this.setMode,
    };
  }

  get editor(): Editor | null {
    return this.live?.editor ?? null;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private set(patch: Partial<DocumentState>) {
    for (const key of Object.keys(patch) as (keyof DocumentState)[]) {
      if (patch[key] !== this.state[key]) {
        this.state = { ...this.state, ...patch };
        for (const listener of this.listeners) listener();
        return;
      }
    }
  }

  private parse(source: string) {
    const { cacheKey, sync } = this.options;
    return parseDocCached(cacheKey ?? sync?.path, source, this.components, this.syntax);
  }

  /** read the file (or take `defaultValue`), parse it, start sync and collab */
  open() {
    const token = ++this.token;
    const { sync, defaultValue } = this.options;
    if (token > 1) this.set(initialState(this.options, this.state.generation + 1));
    this.snapshot = undefined;
    this.scheduleLive();
    if (!sync) {
      this.load(defaultValue, token);
      return;
    }
    const { path } = sync;
    const collabOn = Boolean(sync.collab);
    void import("@fumadocs-editor/core/sync").then((mod) => {
      if (token !== this.token) return;
      const transport = sync.transport ?? (sharedTransport ??= mod.wsTransport());
      const report = (status: SessionStatus) => {
        if (token !== this.token) return;
        this.set({ status });
        this.options.sync?.onStatus?.(status);
      };
      let read: Promise<ReadResult>;
      if (collabOn) {
        if (!("sendBinary" in transport)) throw new Error("collab needs the websocket transport");
        const ws = transport as WsTransport;
        this.stopSync = ws.onStatus((next) => report(next === "online" ? "synced" : next));
        read = ws.read(path);
      } else {
        const session = mod.createFileSession({
          transport,
          path,
          document: this.handle,
          onStatus: report,
        });
        const flush = () => void session.flush();
        window.addEventListener("blur", flush);
        window.addEventListener("beforeunload", flush);
        this.session = session;
        this.stopSync = () => {
          window.removeEventListener("blur", flush);
          window.removeEventListener("beforeunload", flush);
          void session.flush();
          session.close();
          this.session = undefined;
        };
        read = session.open();
      }
      read.then(
        (result) => {
          if (token !== this.token) return;
          const { sync: current } = this.options;
          current?.onOpen?.(result);
          this.load(result.text, token);
          if (!collabOn) return;
          const user = (typeof current?.collab === "object" && current.collab.user) || {
            name: "Guest",
            color: GUEST_COLORS[Math.floor(Math.random() * GUEST_COLORS.length)],
          };
          this.startCollab({ transport: transport as WsTransport, path, user }, token);
        },
        () => {
          if (token === this.token) this.load(this.options.defaultValue, token);
        },
      );
    });
  }

  close() {
    this.token++;
    this.cancelIdle();
    clearTimeout(this.parseTimer);
    this.stopSync();
    this.stopSync = noop;
    this.collab?.destroy();
    this.collab = null;
    this.live = null;
  }

  private load(text: string, token: number) {
    this.markdown = text;
    this.set({ text });
    this.parse(text).then(
      (result) => {
        if (token !== this.token) return;
        this.snapshot = result.snapshot;
        this.set({ content: result.doc });
      },
      (error: unknown) => {
        if (token === this.token) this.set({ sourceError: String(error), mode: "source" });
      },
    );
  }

  private startCollab(link: CollabLink, token: number) {
    void import("./collab").then((mod) => {
      if (token !== this.token) return;
      const session = mod.startCollab(link, this.components, this.syntax, () => {
        // the server re-seeded: Y history cannot merge, so the document starts over
        if (token !== this.token) return;
        session.destroy();
        this.set({ collab: null, stage: "mounting", generation: this.state.generation + 1 });
        this.startCollab(link, token);
      });
      this.collab = session;
      this.set({ collab: session });
    });
  }

  /** the live editor mounts on idle; interaction with the static paint brings it in sooner */
  private scheduleLive() {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(this.beginLive, { timeout: 1500 });
      this.cancelIdle = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(this.beginLive, 200);
      this.cancelIdle = () => clearTimeout(id);
    }
  }

  beginLive = () => {
    this.cancelIdle();
    this.cancelIdle = noop;
    if (this.state.stage === "static") this.set({ stage: "mounting" });
  };

  /** a live editor is up: it is the document from here until it is destroyed */
  attachEditor = (editor: Editor, serialize: SerializeFn) => {
    const live = { editor, serialize };
    this.live = live;
    let timer: number | undefined;
    const flush = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      if (this.live === live) this.changed(serialize(editor.state.doc, this.snapshot));
    };
    editor.on("update", () => {
      clearTimeout(timer);
      timer = window.setTimeout(flush, SERIALIZE_MS);
    });
    editor.on("blur", flush);
    editor.on("destroy", () => {
      flush();
      if (this.live !== live) return;
      this.live = null;
      this.set({ content: editor.state.doc.toJSON(), stage: "mounting" });
    });
    this.set({ stage: "live" });
  };

  /** an edit reached the text: the source follows, the session and the host hear of it */
  private changed(markdown: string) {
    clearTimeout(this.parseTimer);
    this.markdown = markdown;
    this.set({ text: markdown, sourceError: null });
    this.session?.changed();
    this.options.onChange?.(markdown);
  }

  /** a parsed document replaces the current one; not an edit */
  private replace(result: ParsedDoc, text: string) {
    this.snapshot = result.snapshot;
    this.markdown = text;
    const patch: Partial<DocumentState> = { text, sourceError: null };
    // no update event, so the session does not save it back
    if (this.live) this.live.editor.commands.setContent(result.doc, { emitUpdate: false });
    else patch.content = result.doc;
    this.set(patch);
  }

  setSourceText = (value: string) => {
    this.set({ text: value });
    clearTimeout(this.parseTimer);
    this.parseTimer = window.setTimeout(() => {
      this.parse(value).then(
        (result) => {
          if (this.state.text !== value) return;
          this.replace(result, value);
          this.session?.changed();
          this.options.onChange?.(value);
        },
        (error: unknown) => {
          if (this.state.text === value) this.set({ sourceError: String(error) });
        },
      );
    }, SOURCE_PARSE_MS);
  };

  setMode = (mode: EditorMode) => {
    if (mode === "visual" && this.state.sourceError !== null) return;
    this.set({ mode });
  };

  getMarkdown = (): string =>
    this.live ? this.live.serialize(this.live.editor.state.doc, this.snapshot) : this.markdown;

  setMarkdown = async (text: string) => {
    clearTimeout(this.parseTimer);
    this.replace(await this.parse(text), text);
  };

  markSaved = (text: string) => {
    void this.parse(text).then((result) => {
      this.snapshot = result.snapshot;
    });
  };

  applyExternalMarkdown = async (remote: string): Promise<number[]> => {
    if (this.state.sourceError !== null) return [-1];
    const base = this.snapshot;
    if (!base) {
      this.replace(await this.parse(remote), remote);
      return [];
    }
    const { mergeRemote, serializeDocToMdx } = await import("@fumadocs-editor/core/serialize");
    if (this.live) {
      const { editor } = this.live;
      const { doc } = editor.state;
      const result = mergeRemote({ base, local: doc.toJSON(), remoteText: remote });
      if (result.ops.length > 0) {
        const starts: number[] = [];
        const ends: number[] = [];
        doc.forEach((child, offset) => {
          starts.push(offset);
          ends.push(offset + child.nodeSize);
        });
        // pre-merge positions via mapping; bias 1 keeps successive inserts in order
        const tr = editor.state.tr;
        for (const op of result.ops) {
          if (op.type === "insert") {
            const at = tr.mapping.map(op.after < 0 ? 0 : ends[op.after], 1);
            tr.insert(at, editor.schema.nodeFromJSON(op.node));
          } else {
            const from = tr.mapping.map(starts[op.local], 1);
            const to = tr.mapping.map(ends[op.local], -1);
            if (op.type === "replace")
              tr.replaceWith(from, to, editor.schema.nodeFromJSON(op.node));
            else tr.delete(from, to);
          }
        }
        tr.setMeta("addToHistory", false);
        editor.view.dispatch(tr);
      }
      this.snapshot = result.remote.snapshot;
      return result.conflicts;
    }
    const local = this.state.content!;
    const result = mergeRemote({ base, local, remoteText: remote });
    this.snapshot = result.remote.snapshot;
    if (result.ops.length > 0) {
      const merged = applyOps(local, result.ops);
      this.markdown = serializeDocToMdx(merged, result.remote.snapshot);
      this.set({ content: merged, text: this.markdown });
    }
    return result.conflicts;
  };

  keepMine = () => void this.session?.keepMine();
  takeDisk = () => void this.session?.takeDisk();
  flush = () => void this.session?.flush();
}
