import { useEffect, useMemo, useRef, useState } from "react";
import {
  MdxEditor,
  EditorThemeProvider,
  useEditorTheme,
  admonitionSpec,
  fumadocsUiComponents,
  type FileProvider,
  type MdxEditorRef,
  type MediaProvider,
  type SyncStatus,
} from "@fumadocs-editor/ui";
import {
  createFileSession,
  wsTransport,
  type FileSession,
  type WsTransport,
} from "@fumadocs-editor/sync";
import { FileText, Moon, Sun } from "lucide-react";

// static builds have no sync endpoint; never import from docs/ here — vite
// would treat the mirrored file as a module and reload the app on every save
const fallbackDoc = `# fumadocs editor

This is a static preview without the FS mirror (the sync server runs on the
dev server). The document is fully editable, just not saved anywhere.

<Callout type="info" title="Tip">
  Run the playground with \`pnpm dev\` to edit the files in \`docs/\` with
  two-way sync.
</Callout>
`;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useEditorTheme();
  const next = resolvedTheme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      className="inline-flex size-8 items-center justify-center rounded-lg border border-fd-border bg-fd-card text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
    >
      {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

// registering the admonition spec turns the `:::` directive dialect on;
// module-level so the identity is stable for the parse cache
const components = [...fumadocsUiComponents, admonitionSpec];

// uploads land in docs/assets via the dev server; relative srcs display
// through the asset endpoint
const media: MediaProvider = {
  async upload(file) {
    const res = await fetch("/__fde_upload", {
      method: "POST",
      body: file,
      headers: { "x-filename": encodeURIComponent(file.name) },
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const { src } = (await res.json()) as { src: string };
    return src;
  },
  resolve: (src) =>
    /^(?:[a-z]+:|\/)/i.test(src) ? src : `/__fde_asset/${src.replace(/^\.\//, "")}`,
};

function Playground() {
  const [transport, setTransport] = useState<WsTransport | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [initialText, setInitialText] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>("synced");
  const [markdown, setMarkdown] = useState("");
  const [syncedText, setSyncedText] = useState("");
  const editorRef = useRef<MdxEditorRef>(null);
  const sessionRef = useRef<FileSession | null>(null);

  useEffect(() => {
    // per-mount transport: StrictMode's probe mount closes its own copy
    const next = wsTransport(`ws://${location.host}/__fde_sync`);
    let open = true;
    setTransport(next);
    void next.list().then(
      (entries) => {
        if (!open) return;
        const paths = entries.map((entry) => entry.path);
        setFiles(paths);
        setActive((current) => current ?? paths[0] ?? null);
      },
      () => {
        if (!open) return;
        // no sync endpoint (static preview / production build): edit a
        // bundled document without the mirror
        next.close();
        setInitialText(fallbackDoc);
        setMarkdown(fallbackDoc);
        setSyncedText(fallbackDoc);
      },
    );
    return () => {
      open = false;
      next.close();
    };
  }, []);

  useEffect(() => {
    if (!active || !transport) return;
    let open = true;
    setInitialText(null);
    const session = createFileSession({
      transport,
      path: active,
      getText: () => editorRef.current?.getMarkdown() ?? "",
      applyRemote: async (text) => {
        const conflicts = (await editorRef.current?.applyExternalMarkdown(text)) ?? [];
        if (open) {
          // a clean merge changes no status, so refresh the round-trip badge here
          setMarkdown(editorRef.current?.getMarkdown() ?? text);
          setSyncedText(text);
        }
        return conflicts;
      },
      resetToRemote: (text) => void editorRef.current?.setMarkdown(text),
      onStatus: (next) => {
        if (!open) return;
        setStatus(next);
        const current = sessionRef.current;
        if (current) setSyncedText(current.syncedText());
      },
    });
    sessionRef.current = session;
    void session.open().then(
      (state) => {
        if (!open) return;
        setInitialText(state.text);
        setMarkdown(state.text);
        setSyncedText(state.text);
        setStatus(session.status());
      },
      () => {},
    );
    return () => {
      open = false;
      void session.flush();
      session.close();
      sessionRef.current = null;
    };
  }, [active, transport]);

  // the mirrored files double as reference targets (include, page links);
  // paths are written relative to the open document (all docs sit at the root)
  const fileProvider = useMemo<FileProvider | undefined>(() => {
    if (!transport) return undefined;
    return {
      list: async () => {
        const entries = await transport.list();
        const paths: string[] = [];
        for (const entry of entries) {
          if (entry.path !== active) paths.push(`./${entry.path}`);
        }
        return paths;
      },
    };
  }, [transport, active]);

  // Cmd-S and leaving the tab flush the pending autosave
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void sessionRef.current?.flush();
      }
    };
    const onHide = () => void sessionRef.current?.flush();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, []);

  const identical = markdown === syncedText;

  return (
    <main className="mx-auto max-w-[1080px] px-5 pt-12 pb-24">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight">fumadocs editor</h1>
          <p className="text-[13px] text-fd-muted-foreground">
            WYSIWYG MDX editing mirrored to <code className="font-mono text-[12px]">docs/</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
              identical
                ? "border-fd-success/30 bg-fd-success/15 text-fd-success"
                : "border-fd-warning/30 bg-fd-warning/15 text-fd-warning"
            }`}
          >
            {identical ? "round-trip: byte-identical" : "modified"}
          </span>
          <ThemeToggle />
        </div>
      </header>
      <div className="flex items-start gap-4">
        <nav className="w-52 shrink-0 rounded-xl border border-fd-border bg-fd-card p-1.5">
          {files.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => setActive(path)}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${
                path === active
                  ? "bg-fd-primary/10 font-medium text-fd-primary"
                  : "text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
              }`}
            >
              <FileText size={14} className="shrink-0" />
              <span className="truncate">{path}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {initialText != null && (
            <MdxEditor
              key={active ?? "fallback"}
              defaultValue={initialText}
              cacheKey={active ?? undefined}
              components={components}
              onMarkdownChange={(next) => {
                setMarkdown(next);
                sessionRef.current?.changed();
              }}
              ref={editorRef}
              media={media}
              files={fileProvider}
              sync={
                active != null
                  ? {
                      status,
                      onKeepMine: () => void sessionRef.current?.keepMine(),
                      onTakeDisk: () =>
                        void sessionRef.current?.takeDisk().then(() => {
                          const session = sessionRef.current;
                          if (session) setMarkdown(session.syncedText());
                        }),
                    }
                  : undefined
              }
            />
          )}
          <details className="mt-6 text-[13px]">
            <summary className="cursor-pointer text-fd-muted-foreground select-none">
              Serialized MDX output
            </summary>
            <pre className="mt-2.5 overflow-x-auto rounded-xl border border-fd-border bg-fd-card p-4 font-mono text-[12.5px] leading-relaxed">
              {markdown}
            </pre>
          </details>
        </div>
      </div>
    </main>
  );
}

export function App() {
  return (
    <EditorThemeProvider className="min-h-screen bg-fd-background text-fd-foreground">
      <Playground />
    </EditorThemeProvider>
  );
}
