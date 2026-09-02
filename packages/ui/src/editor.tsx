"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
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
import { chrome } from "./styles/shared";
import { consts } from "./styles/consts.stylex";
import { contentClass } from "./styles/content";
import { useEditorTheme, type EditorTheme } from "./theme";

// TipTap + PM + node views: own chunk, fetched at idle or first intent
const LiveEditor = lazy(() => import("./live-editor").then((m) => ({ default: m.LiveEditor })));

export interface MdxEditorRef {
  /** serialize; unedited blocks are byte-identical */
  getMarkdown: () => string;
  /**
   * Merge on-disk markdown into the live document. Disk-only block changes
   * apply as one non-undoable transaction; the caret stays put. Blocks
   * edited on both sides keep local. Returns conflicting local child
   * indices (`-1` = whole document, e.g. raw-source mode).
   */
  applyExternalMarkdown: (text: string) => Promise<number[]>;
  /** replace the document (e.g. conflict: take disk) */
  setMarkdown: (text: string) => Promise<void>;
  /**
   * Saved as `text`: adopt it as the merge base, do not touch the live
   * document. `FileSession` calls this after every write.
   */
  markSaved: (text: string) => void;
}

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
  /** also shown beside the mode tabs; use this to mirror it elsewhere */
  onStatus?: (status: SessionStatus) => void;
  /**
   * File was read: text plus scope data. Does not change editor behavior;
   * wire `writable` into `editable` yourself.
   */
  onOpen?: (result: ReadResult) => void;
}

export interface MdxEditorProps {
  /** initial MDX; with `sync`, the file content is used instead */
  defaultValue?: string;
  /** serialized MDX after each change (debounced) */
  onChange?: (markdown: string) => void;
  /** editable MDX components; defaults to fumadocs-ui */
  components?: UiComponentSpec[];
  /**
   * Parse-level dialects beyond component specs, e.g. `{ math: true }`.
   * Combined with `components` into the document's `Syntax`.
   */
  syntax?: SyntaxOptions;
  /**
   * Sync with a file: autosave, live merge of disk edits, conflict chip,
   * optional collab.
   */
  sync?: MdxEditorSync;
  /**
   * Reuse a parsed document across mounts (small LRU). Default: `sync.path`.
   */
  cacheKey?: string;
  /**
   * First paint without parsing. Markup should match the document so the
   * swap on hydrate does not shift.
   */
  staticFallback?: ReactNode;
  /**
   * Pin a colour theme. Omit to inherit {@link EditorThemeProvider},
   * `next-themes` `.dark`, or the OS preference.
   */
  theme?: EditorTheme;
  /** uploads and display URL resolution */
  media?: MediaProvider;
  /** include paths, page links */
  files?: FileProvider;
  /**
   * TipTap passthrough, default true. `false`: read-only, no mutating
   * chrome. Does not enforce auth; wire scope `writable` in yourself.
   */
  editable?: boolean;
  className?: string;
  ref?: Ref<MdxEditorRef>;
}

/** status beside the mode tabs; conflicts show a chip */
interface SyncIndicatorProps {
  status: SessionStatus;
  /** conflict resolution: overwrite the disk with the local document */
  onKeepMine?: () => void;
  /** conflict resolution: drop local edits for the disk version */
  onTakeDisk?: () => void;
  /** Cmd-S */
  onFlush?: () => void;
}

/** collab session; Yjs frames on the mirror websocket */
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
 * static: first paint
 * mounting: TipTap constructing (input captured)
 * live: interactive, static view gone
 */
type Stage = "static" | "mounting" | "live";

const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    WebkitTapHighlightColor: "transparent",
    display: "flex",
    flexDirection: "column",
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: tokens.border,
      ":focus-within": `color-mix(in oklab, ${tokens.ring} 60%, transparent)`,
    },
    backgroundColor: tokens.background,
    color: tokens.foreground,
    fontSize: 15,
    lineHeight: 1.625,
    boxShadow: consts.shadowSm,
  },
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    borderStartStartRadius: "inherit",
    borderStartEndRadius: "inherit",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.card} 40%, transparent)`,
    paddingInline: "0.5rem",
    paddingBlock: "0.25rem",
  },
  tabs: {
    boxSizing: "border-box",
    display: "flex",
    flexShrink: 0,
    gap: "0.125rem",
    borderRadius: "0.5rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.muted,
    padding: "0.125rem",
  },
  tab: {
    boxSizing: "border-box",
    cursor: "pointer",
    borderRadius: "0.375rem",
    paddingInline: "0.75rem",
    paddingBlock: "0.125rem",
    fontSize: 12.5,
    fontWeight: 500,
    outline: "none",
    color: {
      default: tokens.mutedForeground,
      ":hover": tokens.foreground,
      ":is([data-active])": tokens.foreground,
    },
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in oklab, ${tokens.background} 70%, transparent)`,
      ":is([data-active])": tokens.background,
    },
    boxShadow: {
      default: null,
      ":is([data-active])": consts.shadowSm,
      ":focus-visible": consts.focusRing,
    },
  },
  status: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: "0.5rem",
    paddingInlineStart: "0.375rem",
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  dot: { width: "0.375rem", height: "0.375rem", flexShrink: 0, borderRadius: 9999 },
  synced: { backgroundColor: tokens.success },
  dirty: { backgroundColor: tokens.warning },
  saving: {
    backgroundColor: tokens.warning,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite",
    animationPlayState: { default: null, [consts.reduceMotion]: "paused" },
  },
  conflict: { backgroundColor: tokens.error },
  offline: { backgroundColor: tokens.mutedForeground },
  denied: { backgroundColor: tokens.error },
  label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  actions: { display: "flex", flexShrink: 0, alignItems: "center", gap: "0.25rem" },
  conflictBtn: {
    boxSizing: "border-box",
    cursor: "pointer",
    borderRadius: "0.375rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: {
      default: tokens.background,
      ":hover": tokens.accent,
      ":active": tokens.border,
    },
    paddingInline: "0.5rem",
    paddingBlock: "0.125rem",
    fontSize: 11.5,
    fontWeight: 500,
    color: tokens.foreground,
  },
  body: { position: "relative" },
  staticView: { cursor: "text", outline: "none" },
  source: { display: "flex", flex: 1, flexDirection: "column" },
  sourceError: {
    margin: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.error} 10%, transparent)`,
    paddingInline: "1.25rem",
    paddingBlock: "0.625rem",
    fontFamily: consts.mono,
    fontSize: 13,
    whiteSpace: "pre-wrap",
    color: tokens.error,
  },
  textarea: {
    boxSizing: "border-box",
    minHeight: 420,
    flex: 1,
    resize: "vertical",
    backgroundColor: tokens.background,
    paddingInline: "1.25rem",
    paddingBlock: "1rem",
    fontFamily: consts.mono,
    fontSize: 13,
    lineHeight: 1.625,
    color: tokens.foreground,
    outline: "none",
    tabSize: 2,
    boxShadow: {
      default: null,
      ":focus-visible": `inset 0 0 0 1px color-mix(in oklab, ${tokens.ring} 40%, transparent)`,
    },
  },
});

const SYNC_LABEL: Record<SessionStatus, string> = {
  synced: "Saved",
  dirty: "Edited",
  saving: "Saving…",
  conflict: "Changed on disk",
  offline: "Offline",
  denied: "No access",
};

/** Status beside the mode tabs. */
function SyncIndicator({ status, onKeepMine, onTakeDisk }: SyncIndicatorProps) {
  return (
    <div {...stylex.props(styles.status)}>
      <span aria-hidden {...stylex.props(styles.dot, styles[status])} />
      <span {...stylex.props(styles.label)}>{SYNC_LABEL[status]}</span>
      {status === "conflict" && (
        <span {...stylex.props(styles.actions)}>
          <button
            type="button"
            {...stylex.props(chrome.button, styles.conflictBtn, chrome.focusRing)}
            onClick={onKeepMine}
          >
            Keep mine
          </button>
          <button
            type="button"
            {...stylex.props(chrome.button, styles.conflictBtn, chrome.focusRing)}
            onClick={onTakeDisk}
          >
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
  // hosts pass `components`/`syntax` as inline literals; stabilize by value
  // so the parse cache / collab / extensions don't churn on identity
  const components = useStableValue(componentsProp ?? fumadocsUiComponents, sameSpecs);
  const syntax = useStableValue(syntaxProp, sameOptions);
  const specMap = useMemo(() => new Map(components.map((spec) => [spec.name, spec])), [components]);
  const ambient = useEditorTheme();
  // `theme` prop wins; otherwise inherit provider / next-themes / OS
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

  // yjs chunk: connect on mount so the doc is usually ready before hydrate.
  // `generation` bumps on server re-seed (restart); Y history cannot merge.
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

  // parse is its own chunk; skip fetch while a host fallback is on screen
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

  // hydrate at idle so the first interaction is already live
  useEffect(() => {
    if (stage !== "static" || mode !== "visual") return;
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => beginLive(), { timeout: 1500 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(beginLive, 200);
    return () => clearTimeout(id);
  }, [stage, mode]);

  // replay clicks/keys captured on the static view through the live keymap
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
    // raw source edits the whole file: any disk change is a whole-doc conflict
    if (mode === "source") return [-1];

    const editor = editorRef.current;
    const snapshot = snapshotRef.current;
    if (!editor || !snapshot) {
      // nothing live yet: adopt the disk text
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
      // pre-merge positions via mapping; bias 1 keeps successive inserts in order
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
    // not an edit: no update event, so the session does not save it back
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

  let rootClass = stylex.props(styles.root).className!;
  if (scoped) rootClass += ` ${scoped}`;
  if (className) rootClass += ` ${className}`;

  return (
    <ProvidersContext.Provider value={providers}>
      <div
        data-fde-root=""
        className={rootClass}
        onKeyDown={(event) => {
          if (sync?.onFlush && (event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            sync.onFlush();
          }
        }}
      >
        <Tabs.Root
          value={mode}
          onValueChange={(value) => switchMode(value as Mode)}
          {...stylex.props(styles.bar)}
        >
          {sync ? <SyncIndicator {...sync} /> : <span />}
          <Tabs.List {...stylex.props(styles.tabs)}>
            <Tabs.Tab {...stylex.props(chrome.button, styles.tab)} value="visual">
              Visual
            </Tabs.Tab>
            {/* raw source has no merge with a live shared doc */}
            <Tabs.Tab
              {...stylex.props(chrome.button, styles.tab)}
              value="source"
              disabled={collab != null}
            >
              MDX
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.Root>
        {mode === "visual" ? (
          <div {...stylex.props(styles.body)}>
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
                {...stylex.props(styles.staticView)}
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
                    <div className={`ProseMirror ${contentClass.root}`} aria-hidden />
                  ))}
              </div>
            )}
          </div>
        ) : (
          <div {...stylex.props(styles.source)}>
            {sourceError != null && <div {...stylex.props(styles.sourceError)}>{sourceError}</div>}
            <textarea
              {...stylex.props(chrome.input, styles.textarea)}
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

/** shared transport for editors that do not pass one */
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

/** Opens the file, owns FileSession or the collab link. Sync loads lazily. */
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
        // server is the authority: report connectivity only
        stopStatus = ws.onStatus((next) => report(next === "online" ? "synced" : next));
        read = ws.read(path);
      } else {
        session = mod.createFileSession({
          transport,
          path,
          // view mounts after read; nothing to sync until then
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
        // offline or denied: unsynced editor, status already reported
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

  // flush pending autosave on leave
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
