"use client";
import type { DocSnapshot, ParsedDoc, SyntaxOptions } from "@fumadocs-editor/core/parse";
import type { Editor } from "@tiptap/core";
import { Tabs } from "@base-ui/react/tabs";
import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { StaticMdx } from "./static-mdx";
import { parseDocCached, sameOptions } from "./doc-cache";
import type { EditorCollab } from "./collab";
import type { SerializeFn } from "./live-editor";
import type {
  FileSession,
  ReadResult,
  SessionStatus,
  SyncTransport,
  WsTransport,
} from "@fumadocs-editor/sync";
import type { FileProvider, MediaProvider } from "./components/media";
import { ProvidersContext } from "./components/providers";
import type { UiComponentSpec } from "./components/spec";
import { fumadocsUiComponents } from "./components/fumadocs-ui";
import { focusRing } from "./components/styles";
import { useEditorTheme, type EditorTheme } from "./theme";
import { cn } from "./utils/cn";

// the editor runtime (TipTap + ProseMirror + node views + chrome) is its own
// chunk, fetched at idle or first intent; the static paint never waits on it
const LiveEditor = lazy(() => import("./live-editor").then((m) => ({ default: m.LiveEditor })));

export interface MdxEditorRef {
  /** serialize the current document; unedited blocks come back byte-identical */
  getMarkdown: () => string;
  /**
   * Merge new on-disk markdown into the live document. Remote-only block
   * changes apply as one non-undoable transaction that replaces just those
   * top-level blocks — the caret is untouched. Blocks edited on both sides
   * keep the local version; their local child indices are returned as
   * conflicts (-1 = whole document, e.g. while in raw-source mode).
   */
  applyExternalMarkdown: (text: string) => Promise<number[]>;
  /** replace the document outright (e.g. resolving a conflict as "take disk") */
  setMarkdown: (text: string) => Promise<void>;
  /**
   * The document was saved as `text`: adopt it as the base future external
   * changes merge against, without touching the live document. A
   * `FileSession` calls this after every write.
   */
  markSaved: (text: string) => void;
}

/** presence identity shown at a user's caret on other clients */
export interface CollabUser {
  name: string;
  color: string;
}

export interface MdxEditorSync {
  /** the document's root-relative path — its identity on the sync server */
  path: string;
  /**
   * Where the documents live. Defaults to one shared websocket transport to
   * the dev server on the current host (`wsTransport()`); bring your own for
   * auth or a custom backend.
   */
  transport?: SyncTransport;
  /**
   * Edit collaboratively: the sync server holds the authoritative document
   * and is its single writer, peers' carets show live, and undo covers only
   * your own edits. `true` joins as a guest; pass `user` for the presence
   * identity. Needs the websocket transport.
   */
  collab?: boolean | { user?: CollabUser };
  /** the status is already shown beside the mode tabs; this mirrors it elsewhere */
  onStatus?: (status: SessionStatus) => void;
  /**
   * The document has been read: its text plus the server's scope-derived
   * data. Data only — wiring `writable` into `editable` is your call.
   */
  onOpen?: (result: ReadResult) => void;
}

export interface MdxEditorProps {
  /** initial MDX source; with `sync`, the file's content is used instead */
  defaultValue?: string;
  /** fires with the serialized MDX after each change (debounced) */
  onChange?: (markdown: string) => void;
  /** MDX components rendered as editable nodes; defaults to the fumadocs-ui set */
  components?: UiComponentSpec[];
  /**
   * Syntax dialect switches beyond the component specs (e.g. `{ math: true }`
   * for `$…$` TeX math). Together with `components` this is the one `Syntax`
   * the document is parsed and serialized with.
   */
  syntax?: SyntaxOptions;
  /**
   * Keep the document in sync with a file on the sync server: autosave,
   * external edits merged in live, conflicts surfaced as a chip, and
   * optionally collaborative editing.
   */
  sync?: MdxEditorSync;
  /**
   * Reuse the parsed document across mounts of the same document (a small
   * LRU): reopening a recently visited doc paints without reparsing.
   * Defaults to `sync.path`.
   */
  cacheKey?: string;
  /**
   * Server-rendered (or otherwise precomputed) MDX to show as the first
   * paint. Skips even the parse until the editor hydrates; the markup should
   * visually match the document to avoid a shift when the editor swaps in.
   */
  staticFallback?: ReactNode;
  /**
   * Scope the editor to a fixed colour theme. When omitted, the editor inherits
   * the ambient theme: an {@link EditorThemeProvider}, a `next-themes` `.dark`
   * class, or the OS preference, which is what a real fumadocs site wants.
   */
  theme?: EditorTheme;
  /** where uploads go and how document srcs resolve for display */
  media?: MediaProvider;
  /** what the document can reference: include paths, page links */
  files?: FileProvider;
  /**
   * TipTap passthrough, default true: `false` shows the document read-only,
   * with typing and the mutating chrome (slash menu, bubble and block menus,
   * mobile bar, drag) disabled. Auth-agnostic — consumers wire scope data
   * (e.g. a sync handshake's `writable`) into it themselves.
   */
  editable?: boolean;
  className?: string;
  ref?: Ref<MdxEditorRef>;
}

/** what the view shows beside the mode tabs; conflicts surface a quiet chip */
interface SyncIndicatorProps {
  status: SessionStatus;
  /** conflict resolution: overwrite the disk with the local document */
  onKeepMine?: () => void;
  /** conflict resolution: drop local edits for the disk version */
  onTakeDisk?: () => void;
  /** Cmd-S */
  onFlush?: () => void;
}

/** a resolved collab session: the Yjs frames ride the mirror websocket */
export interface CollabLink {
  transport: WsTransport;
  path: string;
  user: CollabUser;
}

interface EditorViewProps extends Omit<MdxEditorProps, "sync"> {
  sync?: SyncIndicatorProps;
  collab?: CollabLink;
}

type Mode = "visual" | "source";
/**
 * static  → only the zero-cost paint is up
 * mounting → TipTap is constructing behind it (input captured meanwhile)
 * live    → the editor is interactive and the static view is gone
 */
type Stage = "static" | "mounting" | "live";

const modeTabCls = `cursor-pointer rounded-md px-3 py-0.5 text-[12.5px] font-medium text-fd-muted-foreground hover:bg-fd-background/70 hover:text-fd-foreground data-[selected]:bg-fd-background data-[selected]:text-fd-foreground data-[selected]:shadow-sm ${focusRing}`;

const SYNC_DOT: Record<SessionStatus, string> = {
  synced: "bg-fd-success",
  dirty: "bg-fd-warning",
  saving: "bg-fd-warning animate-pulse",
  conflict: "bg-fd-error",
  offline: "bg-fd-muted-foreground",
  denied: "bg-fd-error",
};

const SYNC_LABEL: Record<SessionStatus, string> = {
  synced: "Saved",
  dirty: "Edited",
  saving: "Saving…",
  conflict: "Changed on disk",
  offline: "Offline",
  denied: "No access",
};

const conflictBtnCls = `cursor-pointer rounded-md border border-fd-border bg-fd-background px-2 py-0.5 text-[11.5px] font-medium text-fd-foreground hover:bg-fd-accent active:bg-fd-border ${focusRing}`;

/** The dot + word beside the mode tabs; conflicts surface a quiet chip. */
function SyncIndicator({ status, onKeepMine, onTakeDisk }: SyncIndicatorProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 ps-1.5 text-[12px] text-fd-muted-foreground">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", SYNC_DOT[status])} />
      <span className="truncate">{SYNC_LABEL[status]}</span>
      {status === "conflict" && (
        <span className="flex shrink-0 items-center gap-1">
          <button type="button" className={conflictBtnCls} onClick={onKeepMine}>
            Keep mine
          </button>
          <button type="button" className={conflictBtnCls} onClick={onTakeDisk}>
            Take disk
          </button>
        </span>
      )}
    </div>
  );
}

/** keep the previous reference while newly passed values stay equal by content */
function useStableValue<T>(value: T, equal: (a: T, b: T) => boolean): T {
  const ref = useRef(value);
  if (value !== ref.current && !equal(value, ref.current)) ref.current = value;
  return ref.current;
}

function sameSpecs(a: UiComponentSpec[], b: UiComponentSpec[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const EditorView = memo(function EditorView({
  defaultValue = "",
  onChange,
  components: componentsProp,
  syntax: syntaxProp,
  cacheKey,
  staticFallback,
  theme,
  sync,
  collab,
  media,
  files,
  editable = true,
  className,
  ref,
}: EditorViewProps) {
  // hosts tend to pass `components`/`syntax` as inline literals; everything
  // downstream (the parse cache, the collab session, the live extensions)
  // keys on their identity, so churn is absorbed here by value comparison
  const components = useStableValue(componentsProp ?? fumadocsUiComponents, sameSpecs);
  const syntax = useStableValue(syntaxProp, sameOptions);
  const specMap = useMemo(() => new Map(components.map((spec) => [spec.name, spec])), [components]);
  const ambient = useEditorTheme();
  // an explicit `theme` prop wins; otherwise stay unscoped so the editor
  // inherits the provider / next-themes / OS theme from an ancestor.
  const scoped = theme === "system" ? ambient.resolvedTheme : theme;

  const [parsed, setParsed] = useState<ParsedDoc | null>(null);
  const [stage, setStage] = useState<Stage>("static");
  const [mode, setMode] = useState<Mode>("visual");
  const [source, setSource] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);

  const editorRef = useRef<Editor | null>(null);
  const serializeRef = useRef<SerializeFn | null>(null);
  const snapshotRef = useRef<DocSnapshot | undefined>(undefined);
  const captureRef = useRef<{ point?: { x: number; y: number }; keys: string[] }>({ keys: [] });

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const beginLive = () => setStage((current) => (current === "static" ? "mounting" : current));

  // the collab runtime (yjs + binding + carets) is its own chunk; connect as
  // soon as the editor mounts so the doc is usually synced before hydration.
  // `generation` bumps when the server was re-seeded (restart): the session's
  // Y history can no longer merge with it, so everything is rebuilt fresh.
  const [collabRuntime, setCollabRuntime] = useState<EditorCollab | null>(null);
  const [generation, setGeneration] = useState(0);
  const collabTransport = collab?.transport;
  const collabPath = collab?.path;
  const collabRef = useRef(collab);
  collabRef.current = collab;
  useEffect(() => {
    if (!collabTransport) return;
    let session: EditorCollab | undefined;
    let cancelled = false;
    void import("./collab").then((module) => {
      if (cancelled) return;
      session = module.startCollab(collabRef.current!, components, syntax, () => {
        editorRef.current = null;
        setStage("static");
        setGeneration((current) => current + 1);
      });
      setCollabRuntime(session);
    });
    return () => {
      cancelled = true;
      session?.destroy();
      setCollabRuntime(null);
    };
  }, [collabTransport, collabPath, components, syntax, generation]);

  // the parse stack is a separate chunk; with a host fallback on screen it
  // isn't even fetched until the editor starts hydrating
  useEffect(() => {
    if (parsed || sourceError || mode !== "visual") return;
    if (staticFallback && stage === "static") return;
    let cancelled = false;
    parseDocCached(cacheKey, defaultValue, components, syntax).then(
      (result) => {
        if (cancelled) return;
        snapshotRef.current = result.snapshot;
        setParsed(result);
      },
      (error: unknown) => {
        if (cancelled) return;
        setSourceError(String(error));
        setSource(defaultValue);
        setMode("source");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    parsed,
    sourceError,
    mode,
    stage,
    staticFallback,
    cacheKey,
    defaultValue,
    components,
    syntax,
  ]);

  // hydrate at idle even without intent, so the first interaction is instant
  useEffect(() => {
    if (stage !== "static" || mode !== "visual") return;
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => beginLive(), { timeout: 1500 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(beginLive, 200);
    return () => clearTimeout(id);
  }, [stage, mode]);

  // replay input captured while the static view was up: caret lands where the
  // user clicked (layout parity makes the coordinates transfer), keystrokes
  // re-run through the real keymap
  useEffect(() => {
    if (stage !== "live") return;
    const editor = editorRef.current;
    const { point, keys } = captureRef.current;
    captureRef.current = { keys: [] };
    if (!editor || (!point && keys.length === 0)) return;
    if (point) {
      const found = editor.view.posAtCoords({ left: point.x, top: point.y });
      editor.commands.focus(found ? found.pos : "start");
    } else {
      editor.commands.focus("start");
    }
    let run = "";
    const flush = () => {
      if (run === "") return;
      editor.commands.insertContent({ type: "text", text: run });
      run = "";
    };
    for (const key of keys) {
      if (key.length === 1) run += key;
      else {
        flush();
        editor.commands.keyboardShortcut(key);
      }
    }
    flush();
  }, [stage]);

  const getMarkdown = () => {
    if (mode === "source") return source;
    const editor = editorRef.current;
    const serialize = serializeRef.current;
    return editor && serialize ? serialize(editor.state.doc, snapshotRef.current) : defaultValue;
  };

  const applyExternalMarkdown = async (text: string): Promise<number[]> => {
    // raw-source mode edits the whole file at once: any external change is a
    // whole-document conflict for the session layer to resolve
    if (mode === "source") return [-1];

    const editor = editorRef.current;
    const snapshot = snapshotRef.current;
    if (!editor || !snapshot) {
      // nothing live yet: the disk text simply becomes the document
      const result = await parseDocCached(cacheKey, text, components, syntax);
      snapshotRef.current = result.snapshot;
      setParsed(result);
      return [];
    }

    const [{ mergeRemote }, { tryNormalize }] = await Promise.all([
      import("@fumadocs-editor/sync/merge"),
      import("@fumadocs-editor/core/serialize"),
    ]);
    const { doc } = editor.state;
    const localNormalized: string[] = [];
    for (let i = 0; i < doc.childCount; i++) {
      localNormalized.push(tryNormalize(doc.child(i).toJSON(), snapshot.syntax) ?? "");
    }
    const result = mergeRemote({ base: snapshot, localNormalized, remoteText: text });

    if (result.ops.length > 0) {
      const starts: number[] = [];
      const ends: number[] = [];
      doc.forEach((child, offset) => {
        starts.push(offset);
        ends.push(offset + child.nodeSize);
      });
      // pre-merge positions resolved through the mapping; bias 1 on inserts
      // keeps successive inserts at one anchor in document order
      const tr = editor.state.tr;
      for (const op of result.ops) {
        if (op.type === "insert") {
          const at = tr.mapping.map(op.after < 0 ? 0 : ends[op.after], 1);
          tr.insert(at, editor.schema.nodeFromJSON(op.node));
        } else {
          const from = tr.mapping.map(starts[op.local], 1);
          const to = tr.mapping.map(ends[op.local], -1);
          if (op.type === "replace") tr.replaceWith(from, to, editor.schema.nodeFromJSON(op.node));
          else tr.delete(from, to);
        }
      }
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    }
    snapshotRef.current = result.remote.snapshot;
    return result.conflicts;
  };

  const setMarkdown = async (text: string): Promise<void> => {
    const result = await parseDocCached(cacheKey, text, components, syntax);
    snapshotRef.current = result.snapshot;
    setParsed(result);
    setSourceError(null);
    // a programmatic replacement is not an edit: no update event, so the
    // sync session doesn't see it as new dirt to save back
    if (mode === "source") setSource(text);
    else editorRef.current?.commands.setContent(result.doc, { emitUpdate: false });
  };

  const markSaved = (text: string) => {
    void parseDocCached(cacheKey, text, components, syntax).then((result) => {
      snapshotRef.current = result.snapshot;
    });
  };

  useImperativeHandle(ref, () => ({ getMarkdown, applyExternalMarkdown, setMarkdown, markSaved }));

  function switchMode(next: Mode) {
    if (next === mode) return;

    if (next === "source") {
      setSource(getMarkdown());
      setMode("source");
      editorRef.current = null; // LiveEditor unmounts and destroys the editor
      return;
    }

    void parseDocCached(cacheKey, source, components, syntax).then(
      (result) => {
        snapshotRef.current = result.snapshot;
        setParsed(result);
        setSourceError(null);
        setMode("visual");
        setStage("static");
      },
      (error: unknown) => setSourceError(String(error)),
    );
  }

  const providers = useMemo(() => ({ media, files }), [media, files]);

  return (
    <ProvidersContext.Provider value={providers}>
      <div
        data-fde-root=""
        className={cn(
          scoped,
          "flex flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-background text-fd-foreground text-[15px] leading-relaxed shadow-sm focus-within:border-fd-ring/60",
          className,
        )}
        onKeyDown={(event) => {
          if (sync?.onFlush && (event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            sync.onFlush();
          }
        }}
      >
        <Tabs.Root value={mode} onValueChange={(value) => switchMode(value as Mode)}>
          <div className="flex items-center justify-between gap-3 border-b border-fd-border bg-fd-card/40 px-2 py-1">
            {sync ? <SyncIndicator {...sync} /> : <span />}
            <Tabs.List className="flex shrink-0 gap-0.5 rounded-lg border border-fd-border bg-fd-muted p-0.5">
              <Tabs.Tab className={modeTabCls} value="visual">
                Visual
              </Tabs.Tab>
              {/* raw-source editing has no sane merge with a live shared doc */}
              <Tabs.Tab className={modeTabCls} value="source" disabled={collab != null}>
                MDX
              </Tabs.Tab>
            </Tabs.List>
          </div>
        </Tabs.Root>
        {mode === "visual" ? (
          <div className="relative">
            {stage !== "static" && parsed && (!collab || collabRuntime) && (
              <Suspense fallback={null}>
                <LiveEditor
                  key={generation}
                  collab={collabRuntime ?? undefined}
                  editable={editable}
                  doc={parsed.doc}
                  components={components}
                  specs={specMap}
                  syntax={syntax}
                  snapshotRef={snapshotRef}
                  onChangeRef={onChangeRef}
                  hidden={stage !== "live"}
                  media={media}
                  files={files}
                  onReady={(editor, serialize) => {
                    editorRef.current = editor;
                    serializeRef.current = serialize;
                    setStage("live");
                  }}
                />
              </Suspense>
            )}
            {stage !== "live" && (
              <div
                className="fde-content cursor-text outline-none"
                tabIndex={0}
                onPointerDown={(event) => {
                  captureRef.current.point = { x: event.clientX, y: event.clientY };
                  beginLive();
                }}
                onKeyDown={(event) => {
                  const { key } = event;
                  if (
                    editable &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    (key.length === 1 || key === "Enter" || key === "Backspace")
                  ) {
                    captureRef.current.keys.push(key);
                    event.preventDefault();
                  }
                  beginLive();
                }}
                onFocus={beginLive}
              >
                {staticFallback ??
                  (parsed ? (
                    <StaticMdx doc={parsed.doc} specs={specMap} media={media} />
                  ) : (
                    <div className="ProseMirror" aria-hidden />
                  ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            {sourceError != null && (
              <div className="border-b border-fd-border bg-fd-error/10 px-5 py-2.5 font-mono text-[13px] whitespace-pre-wrap text-fd-error">
                {sourceError}
              </div>
            )}
            <textarea
              className="min-h-[420px] flex-1 resize-y bg-fd-background px-5 py-4 font-mono text-[13px] leading-relaxed text-fd-foreground outline-none [tab-size:2] focus-visible:ring-inset focus-visible:ring-1 focus-visible:ring-fd-ring/40"
              value={source}
              readOnly={!editable}
              spellCheck={false}
              onChange={(event) => {
                setSource(event.target.value);
                onChangeRef.current?.(event.target.value);
              }}
            />
          </div>
        )}
      </div>
    </ProvidersContext.Provider>
  );
});

/** one transport per page for editors that don't bring their own */
let sharedTransport: WsTransport | undefined;

const GUEST_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#0891b2"];

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

interface SyncLink {
  text: string;
  collab?: CollabLink;
}

/**
 * The synced editor: opens the file, owns the `FileSession` (autosave,
 * merge, conflicts, flush on leave) or the collab link, and hands the view
 * the resolved document plus the status it shows. Everything from the sync
 * package loads lazily, only here.
 */
function SyncedEditor({ sync, ref, ...props }: MdxEditorProps & { sync: MdxEditorSync }) {
  const { path, transport: transportProp } = sync;
  const collabOn = Boolean(sync.collab);
  const [link, setLink] = useState<SyncLink | null>(null);
  const [status, setStatus] = useState<SessionStatus>("synced");
  const viewRef = useRef<MdxEditorRef | null>(null);
  const sessionRef = useRef<FileSession | null>(null);
  const latest = useRef({ sync, props });
  latest.current = { sync, props };

  useEffect(() => {
    let open = true;
    let session: FileSession | undefined;
    let stopStatus = () => {};
    setLink(null);
    const report = (next: SessionStatus) => {
      if (!open) return;
      setStatus(next);
      latest.current.sync.onStatus?.(next);
    };
    void import("@fumadocs-editor/sync").then((mod) => {
      if (!open) return;
      const transport = transportProp ?? (sharedTransport ??= mod.wsTransport());
      let read: Promise<ReadResult>;
      if (collabOn) {
        if (!("sendBinary" in transport)) {
          throw new Error("collab needs the websocket transport");
        }
        const ws = transport as WsTransport;
        // the server is the authority: only connectivity to report
        stopStatus = ws.onStatus((next) => report(next === "online" ? "synced" : next));
        read = ws.read(path);
      } else {
        session = mod.createFileSession({
          transport,
          path,
          // the view mounts once the file is read; until then there is nothing to sync
          document: {
            getMarkdown: () => viewRef.current?.getMarkdown() ?? "",
            applyExternalMarkdown: async (text) =>
              (await viewRef.current?.applyExternalMarkdown(text)) ?? [],
            setMarkdown: async (text) => viewRef.current?.setMarkdown(text),
            markSaved: (text) => viewRef.current?.markSaved(text),
          },
          onStatus: report,
        });
        sessionRef.current = session;
        read = session.open();
      }
      read.then(
        (result) => {
          if (!open) return;
          const { sync: current } = latest.current;
          current.onOpen?.(result);
          const user = (typeof current.collab === "object" && current.collab.user) || {
            name: "Guest",
            color: GUEST_COLORS[Math.floor(Math.random() * GUEST_COLORS.length)],
          };
          setLink({
            text: result.text,
            collab: collabOn ? { transport: transport as WsTransport, path, user } : undefined,
          });
        },
        // offline or denied: an unsynced editor, and the status says why
        () => {
          if (open) setLink({ text: latest.current.props.defaultValue ?? "" });
        },
      );
    });
    return () => {
      open = false;
      stopStatus();
      void session?.flush();
      session?.close();
      sessionRef.current = null;
    };
  }, [path, transportProp, collabOn]);

  // leaving the page flushes the pending autosave
  useEffect(() => {
    const flush = () => void sessionRef.current?.flush();
    window.addEventListener("blur", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  const onChange = useCallback((markdown: string) => {
    sessionRef.current?.changed();
    latest.current.props.onChange?.(markdown);
  }, []);

  const indicator = useMemo<SyncIndicatorProps>(
    () => ({
      status,
      onKeepMine: () => void sessionRef.current?.keepMine(),
      onTakeDisk: () => void sessionRef.current?.takeDisk(),
      onFlush: () => void sessionRef.current?.flush(),
    }),
    [status],
  );

  if (!link) return null;
  return (
    <EditorView
      key={path}
      {...props}
      defaultValue={link.text}
      cacheKey={props.cacheKey ?? path}
      onChange={onChange}
      sync={indicator}
      collab={link.collab}
      ref={(value) => {
        viewRef.current = value;
        assignRef(ref, value);
      }}
    />
  );
}

export function MdxEditor({ sync, ...props }: MdxEditorProps) {
  return sync ? <SyncedEditor sync={sync} {...props} /> : <EditorView {...props} />;
}
