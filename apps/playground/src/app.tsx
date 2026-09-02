import { useEffect, useMemo, useRef, useState } from "react";
import {
  MdxEditor,
  EditorThemeProvider,
  useEditorTheme,
  admonitionSpec,
  filesFenceSpecs,
  fumadocsUiComponents,
  type FileProvider,
  type MdxEditorSync,
  type MediaProvider,
} from "@fumadocs-editor/ui";
import {
  ASSET_ENDPOINT,
  AUTH_HEADER,
  UPLOAD_ENDPOINT,
  wsTransport,
  type SessionStatus,
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
const components = [...fumadocsUiComponents, admonitionSpec, ...filesFenceSpecs];
const syntax = { math: true };

// collaborative editing is opt-in via ?collab: the sync server then owns the
// document (single writer) and every tab with the flag edits the same Y.Doc
const collabEnabled = new URLSearchParams(location.search).has("collab");
const CARET_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#0891b2"];
const collabUser = {
  name:
    new URLSearchParams(location.search).get("name") ??
    `Guest ${Math.floor(Math.random() * 90) + 10}`,
  color: CARET_COLORS[Math.floor(Math.random() * CARET_COLORS.length)],
};

// toy auth (see vite.config.ts): the token rides the connection hello and the
// upload header. Read fresh per attempt — ?token=… per tab, localStorage as
// the store a reconnect would pick a rotated token from.
const authToken = () =>
  new URLSearchParams(location.search).get("token") ??
  localStorage.getItem("fde-token") ??
  undefined;

// uploads land in docs/assets via the dev server; relative srcs display
// through the asset endpoint
const media: MediaProvider = {
  async upload(file) {
    const headers: Record<string, string> = { "x-filename": encodeURIComponent(file.name) };
    const token = authToken();
    if (token !== undefined) headers[AUTH_HEADER] = JSON.stringify(token);
    const res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: file, headers });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const { src } = (await res.json()) as { src: string };
    return src;
  },
  resolve: (src) =>
    /^(?:[a-z]+:|\/)/i.test(src) ? src : `${ASSET_ENDPOINT}/${src.replace(/^\.\//, "")}`,
};

// one transport for the page; the token is read fresh per connection attempt
const transport = wsTransport({ auth: authToken });

function Playground() {
  const [files, setFiles] = useState<string[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [status, setStatus] = useState<SessionStatus>("synced");
  const [markdown, setMarkdown] = useState("");
  const [diskText, setDiskText] = useState("");
  // consumer wiring for the auth scope: the handshake's `writable` (data the
  // sync layer merely exposes) drives our own `editable` prop
  const [writable, setWritable] = useState(true);
  const markdownRef = useRef("");

  useEffect(() => {
    let open = true;
    void transport.list().then(
      (paths) => {
        if (!open) return;
        setFiles(paths);
        setActive((current) => current ?? paths[0] ?? null);
      },
      () => {
        if (!open) return;
        // no sync endpoint (static preview / production build): edit a
        // bundled document without the mirror
        setDenied(transport.status() === "denied");
        setFiles([]);
      },
    );
    return () => {
      open = false;
    };
  }, []);

  // the disk side of the round-trip badge: what the file holds right now
  useEffect(() => {
    if (!active) return;
    let open = true;
    const stop = transport.watch(active, (state) => {
      if (open) setDiskText(state.text);
    });
    return () => {
      open = false;
      stop();
    };
  }, [active]);

  const sync = useMemo<MdxEditorSync | undefined>(
    () =>
      active
        ? {
            transport,
            path: active,
            collab: collabEnabled && { user: collabUser },
            onStatus: (next) => {
              setStatus(next);
              // our own saves aren't echoed back to us: the badge follows the session
              if (next === "synced") setDiskText(markdownRef.current);
            },
            onOpen: (result) => {
              markdownRef.current = result.text;
              setMarkdown(result.text);
              setDiskText(result.text);
              setWritable(result.writable ?? true);
            },
          }
        : undefined,
    [active],
  );

  // the mirrored files double as reference targets (include, page links);
  // paths are written relative to the open document (all docs sit at the root)
  const fileProvider = useMemo<FileProvider | undefined>(() => {
    if (!files?.length) return undefined;
    return {
      list: async () => {
        const paths: string[] = [];
        for (const path of files) {
          if (path !== active) paths.push(`./${path}`);
        }
        return paths;
      },
    };
  }, [files, active]);

  const onChange = (next: string) => {
    markdownRef.current = next;
    setMarkdown(next);
  };

  const identical = markdown === diskText;

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
          <a
            href={collabEnabled ? location.pathname : "?collab"}
            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
              collabEnabled
                ? "border-fd-primary/30 bg-fd-primary/15 text-fd-primary"
                : "border-fd-border bg-fd-card text-fd-muted-foreground hover:text-fd-foreground"
            }`}
          >
            {collabEnabled ? "collab: on" : "collab: off"}
          </a>
          <span
            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
              identical
                ? "border-fd-success/30 bg-fd-success/15 text-fd-success"
                : "border-fd-warning/30 bg-fd-warning/15 text-fd-warning"
            }`}
          >
            {identical ? "round-trip: byte-identical" : `modified (${status})`}
          </span>
          <ThemeToggle />
        </div>
      </header>
      <div className="flex items-start gap-4">
        <nav className="w-52 shrink-0 rounded-xl border border-fd-border bg-fd-card p-1.5">
          {files?.map((path) => (
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
          {sync ? (
            <MdxEditor
              sync={sync}
              components={components}
              syntax={syntax}
              onChange={onChange}
              media={media}
              files={fileProvider}
              editable={writable}
            />
          ) : denied ? (
            <div className="rounded-xl border border-fd-border bg-fd-card px-5 py-10 text-center text-sm text-fd-muted-foreground">
              Access denied: this token cannot open the workspace.
            </div>
          ) : (
            files && (
              <MdxEditor
                defaultValue={fallbackDoc}
                components={components}
                syntax={syntax}
                onChange={onChange}
                media={media}
              />
            )
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
