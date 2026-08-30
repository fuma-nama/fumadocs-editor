"use client";
import type { DocSnapshot, ParsedDoc } from "@fumadocs-editor/core/parse";
import type { Editor } from "@tiptap/core";
import { Tabs } from "@base-ui/react/tabs";
import {
  Suspense,
  lazy,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { StaticMdx } from "./static-mdx";
import { parseDocCached } from "./doc-cache";
import type { SerializeFn } from "./live-editor";
import type { MediaProvider } from "./components/media";
import type { UiComponentSpec } from "./components/spec";
import { focusRing } from "./components/styles";
import { useEditorTheme, type EditorTheme } from "./theme";
import { cn } from "./utils/cn";

// the editor runtime (TipTap + ProseMirror + node views + chrome) is its own
// chunk, fetched at idle or first intent; the static paint never waits on it
const LiveEditor = lazy(() =>
  import("./live-editor").then((m) => ({ default: m.LiveEditor })),
);

export interface MdxEditorRef {
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
}

export type SyncStatus = "synced" | "dirty" | "saving" | "conflict" | "offline";

export interface SyncIndicatorProps {
  status: SyncStatus;
  /** conflict resolution: overwrite the disk with the local document */
  onKeepMine: () => void;
  /** conflict resolution: drop local edits for the disk version */
  onTakeDisk: () => void;
}

export interface MdxEditorProps {
  /** initial MDX source */
  defaultValue?: string;
  /** fires with the serialized MDX after each change */
  onMarkdownChange?: (markdown: string) => void;
  /** MDX components to render as WYSIWYG nodes with editable regions */
  components?: UiComponentSpec[];
  /**
   * Reuse the parsed document across mounts of the same document (a small
   * LRU): reopening a recently visited doc paints without reparsing.
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
  /** sync state shown beside the mode tabs; conflicts surface a quiet chip */
  sync?: SyncIndicatorProps;
  /** where uploads go and how document srcs resolve for display */
  media?: MediaProvider;
  className?: string;
  ref?: Ref<MdxEditorRef>;
}

type Mode = "visual" | "source";
/**
 * static  → only the zero-cost paint is up
 * mounting → TipTap is constructing behind it (input captured meanwhile)
 * live    → the editor is interactive and the static view is gone
 */
type Stage = "static" | "mounting" | "live";

const modeTabCls = `cursor-pointer rounded-md px-3 py-0.5 text-[12.5px] font-medium text-fd-muted-foreground hover:bg-fd-background/70 hover:text-fd-foreground data-[selected]:bg-fd-background data-[selected]:text-fd-foreground data-[selected]:shadow-sm ${focusRing}`;

const SYNC_DOT: Record<SyncStatus, string> = {
  synced: "bg-fd-success",
  dirty: "bg-fd-warning",
  saving: "bg-fd-warning animate-pulse",
  conflict: "bg-fd-error",
  offline: "bg-fd-muted-foreground",
};

const SYNC_LABEL: Record<SyncStatus, string> = {
  synced: "Saved",
  dirty: "Edited",
  saving: "Saving…",
  conflict: "Changed on disk",
  offline: "Offline",
};

const conflictBtnCls = `cursor-pointer rounded-md border border-fd-border bg-fd-background px-2 py-0.5 text-[11.5px] font-medium text-fd-foreground hover:bg-fd-accent active:bg-fd-border ${focusRing}`;

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

export function MdxEditor({
  defaultValue = "",
  onMarkdownChange,
  components,
  cacheKey,
  staticFallback,
  theme,
  sync,
  media,
  className,
  ref,
}: MdxEditorProps) {
  const specMap = useMemo(
    () => new Map((components ?? []).map((spec) => [spec.name, spec])),
    [components],
  );
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

  const onChangeRef = useRef(onMarkdownChange);
  useEffect(() => {
    onChangeRef.current = onMarkdownChange;
  });

  const beginLive = () => setStage((current) => (current === "static" ? "mounting" : current));

  // the parse stack is a separate chunk; with a host fallback on screen it
  // isn't even fetched until the editor starts hydrating
  useEffect(() => {
    if (parsed || sourceError || mode !== "visual") return;
    if (staticFallback && stage === "static") return;
    let cancelled = false;
    parseDocCached(cacheKey, defaultValue, components ?? []).then(
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
  }, [parsed, sourceError, mode, stage, staticFallback, cacheKey, defaultValue, components]);

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
      const result = await parseDocCached(undefined, text, components ?? []);
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
    const result = await parseDocCached(undefined, text, components ?? []);
    snapshotRef.current = result.snapshot;
    setParsed(result);
    setSourceError(null);
    // a programmatic replacement is not an edit: no update event, so the
    // sync session doesn't see it as new dirt to save back
    if (mode === "source") setSource(text);
    else editorRef.current?.commands.setContent(result.doc, { emitUpdate: false });
  };

  useImperativeHandle(ref, () => ({ getMarkdown, applyExternalMarkdown, setMarkdown }));

  function switchMode(next: Mode) {
    if (next === mode) return;

    if (next === "source") {
      setSource(getMarkdown());
      setMode("source");
      editorRef.current = null; // LiveEditor unmounts and destroys the editor
      return;
    }

    void parseDocCached(undefined, source, components ?? []).then(
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

  return (
    <div
      className={cn(
        scoped,
        "flex flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-background text-fd-foreground text-[15px] leading-relaxed shadow-sm focus-within:border-fd-ring/60",
        className,
      )}
    >
      <Tabs.Root value={mode} onValueChange={(value) => switchMode(value as Mode)}>
        <div className="flex items-center justify-between gap-3 border-b border-fd-border bg-fd-card/40 px-2 py-1">
          {sync ? <SyncIndicator {...sync} /> : <span />}
          <Tabs.List className="flex shrink-0 gap-0.5 rounded-lg border border-fd-border bg-fd-muted p-0.5">
            <Tabs.Tab className={modeTabCls} value="visual">
              Visual
            </Tabs.Tab>
            <Tabs.Tab className={modeTabCls} value="source">
              MDX
            </Tabs.Tab>
          </Tabs.List>
        </div>
      </Tabs.Root>
      {mode === "visual" ? (
        <div className="relative">
          {stage !== "static" && parsed && (
            <Suspense fallback={null}>
              <LiveEditor
                doc={parsed.doc}
                components={components ?? []}
                specs={specMap}
                snapshotRef={snapshotRef}
                onChangeRef={onChangeRef}
                hidden={stage !== "live"}
                media={media}
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
            spellCheck={false}
            onChange={(event) => {
              setSource(event.target.value);
              onChangeRef.current?.(event.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
