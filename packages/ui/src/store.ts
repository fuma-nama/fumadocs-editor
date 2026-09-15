import type { DocSnapshot, ParsedDoc, SyntaxOptions } from "@fumadocs-editor/core/parse";
import type {
  CollabBinding,
  DocumentStatus,
  SyncClient,
  SyncDocument,
} from "@fumadocs-editor/core/sync";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { loadSync, sharedClient } from "./client";
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
   * document. The sync document calls this after every write.
   */
  markSaved: (text: string) => void;
  /** the preset's current surface */
  getMode: () => EditorMode;
  /** switch the preset's surface; refused while the source does not parse */
  setMode: (mode: EditorMode) => void;
}

export type EditorMode = "visual" | "source";

export interface MdxEditorSync {
  /** root-relative path on the sync server */
  path: string;
  /**
   * The sync client. Default: one shared client connected to the current
   * host. Pass your own for auth, another server, or collab.
   */
  client?: SyncClient;
  /** also shown by `MdxEditor.Status`; use this to mirror it elsewhere */
  onStatus?: (status: DocumentStatus) => void;
  /**
   * File was read: text plus scope data. Does not change editor behavior;
   * wire `writable` into `editable` yourself.
   */
  onOpen?: (result: { text: string; writable: boolean }) => void;
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
  status: DocumentStatus | null;
  collab: CollabBinding | null;
  /** bumps when the document is replaced wholesale: another file, a collab re-seed */
  generation: number;
}

const SOURCE_PARSE_MS = 300;
const SERIALIZE_MS = 250;

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

/**
 * The document behind a root: parsed content, its snapshot, the live editor
 * once one attaches, the sync document and collab. React reads `state`
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
  private doc: SyncDocument | undefined;
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

  /** the document is a shared doc on the server: no source surface of its own */
  get collabOn(): boolean {
    return this.options.sync?.client?.collab === true;
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
    void loadSync().then((mod) => {
      if (token !== this.token) return;
      const client = sync.client ?? sharedClient(mod);
      const doc = client.open(path, {
        editor: this.handle,
        components: this.components,
        syntax: this.syntax,
      });
      let reported = this.state.status;
      const update = () => {
        if (token !== this.token) return;
        const status = doc.status();
        // a re-seeded collab doc passes through null, which remounts the editor
        this.set({ status, collab: doc.collab() });
        if (status === reported) return;
        reported = status;
        this.options.sync?.onStatus?.(status);
      };
      const stop = doc.subscribe(update);
      const flush = () => void doc.flush();
      window.addEventListener("blur", flush);
      window.addEventListener("beforeunload", flush);
      this.doc = doc;
      this.stopSync = () => {
        window.removeEventListener("blur", flush);
        window.removeEventListener("beforeunload", flush);
        stop();
        void doc.flush();
        doc.close();
        this.doc = undefined;
      };
      update();
      doc.opened.then(
        (result) => {
          if (token !== this.token) return;
          this.options.sync?.onOpen?.(result);
          this.load(result.text, token);
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

  /** an edit reached the text: the source follows, the sync document and the host hear of it */
  private changed(markdown: string) {
    clearTimeout(this.parseTimer);
    this.markdown = markdown;
    this.set({ text: markdown, sourceError: null });
    this.doc?.changed();
    this.options.onChange?.(markdown);
  }

  /** a parsed document replaces the current one; not an edit */
  private replace(result: ParsedDoc, text: string) {
    this.snapshot = result.snapshot;
    this.markdown = text;
    const patch: Partial<DocumentState> = { text, sourceError: null };
    // no update event, so the sync document does not save it back
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
          this.doc?.changed();
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
    const { applyMergeOps, mergeRemote, serializeDocToMdx } =
      await import("@fumadocs-editor/core/serialize");
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
      const merged = { ...local, content: applyMergeOps(local.content ?? [], result.ops) };
      this.markdown = serializeDocToMdx(merged, result.remote.snapshot);
      this.set({ content: merged, text: this.markdown });
    }
    return result.conflicts;
  };

  keepMine = () => void this.doc?.keepMine();
  takeDisk = () => void this.doc?.takeDisk();
  flush = () => void this.doc?.flush();
}
