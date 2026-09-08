"use client";
import * as stylex from "@stylexjs/stylex";
import { Tabs } from "@base-ui/react/tabs";
import type { Editor } from "@tiptap/core";
import type { SessionStatus } from "@fumadocs-editor/core/sync";
import { Suspense, lazy, useEffect, useRef, type ReactNode } from "react";
import { useDocumentState, useEditorContext } from "./components/context";
import { useEditorMode, useSourceText, useSyncStatus } from "./root";
import { StaticMdx } from "./static-mdx";
import type { EditorMode } from "./store";
import { chrome } from "./styles/shared";
import { consts } from "./styles/consts.stylex";
import { contentClass } from "./styles/content";
import { tokens } from "./styles/tokens.stylex";

const LiveEditor = lazy(() => import("./live-editor").then((m) => ({ default: m.LiveEditor })));

const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });

const styles = stylex.create({
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
    fontSize: tokens.fieldSize,
    lineHeight: 1.625,
    color: tokens.foreground,
    outline: "none",
    tabSize: 2,
    boxShadow: {
      default: null,
      ":focus-visible": `inset 0 0 0 1px color-mix(in oklab, ${tokens.ring} 40%, transparent)`,
    },
  },
  textareaFixed: { resize: "none" },
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
});

function withClass(base: stylex.StyleXStyles, className: string | undefined) {
  const own = stylex.props(base).className!;
  return className ? `${own} ${className}` : own;
}

/** input on the static paint, replayed through the live keymap once it is up */
interface Capture {
  point?: { x: number; y: number };
  keys: string[];
}

function replay(editor: Editor, { point, keys }: Capture) {
  if (!point && keys.length === 0) return;
  const found = point && editor.view.posAtCoords({ left: point.x, top: point.y });
  editor.commands.focus(found ? found.pos : "start");
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
}

export interface VisualSurfaceProps {
  /**
   * First paint without parsing. Markup should match the document so the
   * swap on hydrate does not shift.
   */
  staticFallback?: ReactNode;
  className?: string;
}

/** the WYSIWYG surface: a static paint first, the live editor on interaction or idle */
export function VisualSurface({ staticFallback, className }: VisualSurfaceProps) {
  const { store, editable } = useEditorContext();
  const { content, stage, collab, generation } = useDocumentState();
  const capture = useRef<Capture>({ keys: [] });

  useEffect(() => {
    if (stage !== "live") return;
    replay(store.editor!, capture.current);
    capture.current = { keys: [] };
  }, [stage, store]);

  const collabOn = Boolean(store.options.sync?.collab);
  return (
    <div data-fde-overlay="" className={withClass(styles.body, className)}>
      {content && stage !== "static" && (!collabOn || collab) && (
        <Suspense fallback={null}>
          <LiveEditor
            key={generation}
            content={content}
            collab={collab ?? undefined}
            editable={editable}
            hidden={stage !== "live"}
            onReady={store.attachEditor}
          />
        </Suspense>
      )}
      {stage !== "live" && (
        <div
          {...stylex.props(styles.staticView)}
          tabIndex={0}
          onPointerDown={(event) => {
            capture.current.point = { x: event.clientX, y: event.clientY };
            store.beginLive();
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
              capture.current.keys.push(key);
              event.preventDefault();
            }
            store.beginLive();
          }}
          onFocus={store.beginLive}
        >
          {staticFallback ??
            (content ? (
              <StaticMdx doc={content} specs={store.specs} />
            ) : (
              <div className={`ProseMirror ${contentClass.root}`} aria-hidden />
            ))}
        </div>
      )}
    </div>
  );
}

export interface SourceSurfaceProps {
  /** no vertical resize handle, for a surface that fills its frame */
  fixed?: boolean;
  className?: string;
}

/** the MDX source in a textarea, with the parse error above it */
export function SourceSurface({ fixed, className }: SourceSurfaceProps) {
  const { value, onChange, error, readOnly } = useSourceText();
  return (
    <div className={withClass(styles.source, className)}>
      {error !== null && <div {...stylex.props(styles.sourceError)}>{error}</div>}
      <textarea
        {...stylex.props(chrome.input, styles.textarea, fixed && styles.textareaFixed)}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

const SYNC_LABEL: Record<SessionStatus, string> = {
  synced: "Saved",
  dirty: "Edited",
  saving: "Saving…",
  conflict: "Changed on disk",
  offline: "Offline",
  denied: "No access",
};

/** the session status dot and, on a conflict, the two resolutions; nothing without `sync` */
export function SyncStatus({ className }: { className?: string }) {
  const sync = useSyncStatus();
  if (!sync) return null;
  return (
    <div className={withClass(styles.status, className)}>
      <span aria-hidden {...stylex.props(styles.dot, styles[sync.status])} />
      <span {...stylex.props(styles.label)}>{SYNC_LABEL[sync.status]}</span>
      {sync.status === "conflict" && (
        <span {...stylex.props(styles.actions)}>
          <button
            type="button"
            {...stylex.props(chrome.button, styles.conflictBtn, chrome.focusRing)}
            onClick={sync.keepMine}
          >
            Keep mine
          </button>
          <button
            type="button"
            {...stylex.props(chrome.button, styles.conflictBtn, chrome.focusRing)}
            onClick={sync.takeDisk}
          >
            Take disk
          </button>
        </span>
      )}
    </div>
  );
}

/** Visual / MDX switch for a host that shows one surface at a time */
export function ModeTabs({ className }: { className?: string }) {
  const { mode, setMode, canShowVisual, canShowSource } = useEditorMode();
  return (
    <Tabs.Root value={mode} onValueChange={(value) => setMode(value as EditorMode)}>
      <Tabs.List className={withClass(styles.tabs, className)}>
        <Tabs.Tab
          {...stylex.props(chrome.button, styles.tab)}
          value="visual"
          disabled={!canShowVisual}
        >
          Visual
        </Tabs.Tab>
        <Tabs.Tab
          {...stylex.props(chrome.button, styles.tab)}
          value="source"
          disabled={!canShowSource}
        >
          MDX
        </Tabs.Tab>
      </Tabs.List>
    </Tabs.Root>
  );
}
