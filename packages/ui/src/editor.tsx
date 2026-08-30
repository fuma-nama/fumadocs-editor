"use client";
import {
  createIncrementalSerializer,
  createRegistry,
  parseMdxToDoc,
  type DocSnapshot,
  type ParsedDoc,
} from "@fumadocs-editor/core";
import type { Editor } from "@tiptap/core";
import { Tabs } from "@base-ui/react/tabs";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { LiveEditor } from "./live-editor";
import { StaticMdx } from "./static-mdx";
import { parseDocCached } from "./doc-cache";
import type { UiComponentSpec } from "./components/spec";
import { focusRing } from "./components/styles";
import { useEditorTheme, type EditorTheme } from "./theme";
import { cn } from "./utils/cn";

export interface MdxEditorRef {
  getMarkdown: () => string;
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

const modeTabCls = `cursor-pointer rounded-md px-3 py-0.5 text-[12.5px] font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground data-[selected]:bg-fd-background data-[selected]:text-fd-foreground data-[selected]:shadow-sm ${focusRing}`;

export function MdxEditor({
  defaultValue = "",
  onMarkdownChange,
  components,
  cacheKey,
  staticFallback,
  theme,
  className,
  ref,
}: MdxEditorProps) {
  const registry = useMemo(() => createRegistry(components ?? []), [components]);
  const specMap = useMemo(
    () => new Map((components ?? []).map((spec) => [spec.name, spec])),
    [components],
  );
  const serialize = useMemo(() => createIncrementalSerializer(registry), [registry]);
  const ambient = useEditorTheme();
  // an explicit `theme` prop wins; otherwise stay unscoped so the editor
  // inherits the provider / next-themes / OS theme from an ancestor.
  const scoped = theme === "system" ? ambient.resolvedTheme : theme;

  // with a host-provided fallback even the parse waits for hydration
  const [initial] = useState(() => {
    if (staticFallback) return { parsed: null as ParsedDoc | null, error: null as string | null };
    try {
      return { parsed: parseDocCached(cacheKey, defaultValue, registry), error: null };
    } catch (error) {
      return { parsed: null, error: String(error) };
    }
  });

  const [parsed, setParsed] = useState(initial.parsed);
  const [stage, setStage] = useState<Stage>("static");
  const [mode, setMode] = useState<Mode>(initial.error ? "source" : "visual");
  const [source, setSource] = useState(initial.error ? defaultValue : "");
  const [sourceError, setSourceError] = useState(initial.error);

  const editorRef = useRef<Editor | null>(null);
  const snapshotRef = useRef<DocSnapshot | undefined>(initial.parsed?.snapshot);
  const captureRef = useRef<{ point?: { x: number; y: number }; keys: string[] }>({ keys: [] });

  const onChangeRef = useRef(onMarkdownChange);
  useEffect(() => {
    onChangeRef.current = onMarkdownChange;
  });

  const beginLive = () => setStage((current) => (current === "static" ? "mounting" : current));

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

  // the staticFallback path parses here, just before the editor constructs
  useEffect(() => {
    if (stage === "static" || parsed || sourceError) return;
    try {
      const result = parseDocCached(cacheKey, defaultValue, registry);
      snapshotRef.current = result.snapshot;
      setParsed(result);
    } catch (error) {
      setSourceError(String(error));
      setSource(defaultValue);
      setMode("source");
    }
  }, [stage, parsed, sourceError, cacheKey, defaultValue, registry]);

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
    return editor ? serialize(editor.state.doc, snapshotRef.current) : defaultValue;
  };

  useImperativeHandle(ref, () => ({ getMarkdown }));

  function switchMode(next: Mode) {
    if (next === mode) return;

    if (next === "source") {
      setSource(getMarkdown());
      setMode("source");
      editorRef.current = null; // LiveEditor unmounts and destroys the editor
      return;
    }

    try {
      const result = parseMdxToDoc(source, registry);
      snapshotRef.current = result.snapshot;
      setParsed(result);
      setSourceError(null);
      setMode("visual");
      setStage("static");
    } catch (error) {
      setSourceError(String(error));
    }
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
        <div className="flex items-center justify-end border-b border-fd-border bg-fd-card/40 px-2 py-1">
          <Tabs.List className="flex gap-0.5 rounded-lg border border-fd-border bg-fd-muted p-0.5">
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
            <LiveEditor
              doc={parsed.doc}
              components={components ?? []}
              specs={specMap}
              serialize={serialize}
              snapshotRef={snapshotRef}
              onChangeRef={onChangeRef}
              hidden={stage !== "live"}
              onReady={(editor) => {
                editorRef.current = editor;
                setStage("live");
              }}
            />
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
              {staticFallback ?? (parsed && <StaticMdx doc={parsed.doc} specs={specMap} />)}
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
