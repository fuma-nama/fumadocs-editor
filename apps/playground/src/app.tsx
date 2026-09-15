import { useMemo, useState } from "react";
import {
  MdxEditor,
  EditorThemeProvider,
  FileTree,
  useEditorTheme,
  useWorkspace,
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
  createSyncClient,
  type DocumentStatus,
  type TreeNode,
} from "@fumadocs-editor/core/sync";
import { Moon, Sun } from "lucide-react";
import { FumadocsIcon } from "./logo";

// static builds have no sync endpoint; never import from docs/ here. Vite
// would treat the mirrored file as a module and reload the app on every save.
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

// toy auth (see vite.config.ts): the token is sent on the connection hello
// and the upload header. Read fresh per attempt: ?token=… per tab,
// localStorage as the store a reconnect would pick a rotated token from.
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

// one client for the page; the token is read fresh per connection attempt
const client = createSyncClient({ auth: authToken, collab: collabEnabled && { user: collabUser } });

function collectFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "file") out.push(node.path);
    else if (node.type === "folder") collectFiles(node.children, out);
  }
  return out;
}

function Playground() {
  const workspace = useWorkspace({ client });
  const files = useMemo(
    () => (workspace.tree ? collectFiles(workspace.tree.nodes) : null),
    [workspace.tree],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ?? files?.[0] ?? null;
  // no sync endpoint (static preview / production build): edit a bundled document
  const offline = workspace.status === "offline" && files === null;
  const denied = workspace.status === "denied";
  const [status, setStatus] = useState<DocumentStatus>("synced");
  const [markdown, setMarkdown] = useState("");
  // consumer wiring for the auth scope: the handshake's `writable` (data the
  // sync layer exposes) drives our own `editable` prop
  const [writable, setWritable] = useState(true);

  // the editor reads the latest `sync` callbacks; the document only reopens on path/client
  const sync: MdxEditorSync | undefined = active
    ? {
        client,
        path: active,
        onStatus: setStatus,
        onOpen: (result) => {
          setMarkdown(result.text);
          setWritable(result.writable);
        },
      }
    : undefined;

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

  // a synced file document has compared the serialized editor with the disk
  const identical = status === "synced";

  return (
    <main className="mx-auto max-w-[1080px] px-4 pt-6 pb-24 md:px-5 md:pt-12">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <FumadocsIcon className="size-5" />
            fumadocs editor
          </h1>
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
          {!collabEnabled && (
            <span
              className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
                identical
                  ? "border-fd-success/30 bg-fd-success/15 text-fd-success"
                  : "border-fd-warning/30 bg-fd-warning/15 text-fd-warning"
              }`}
            >
              {identical ? "round-trip: byte-identical" : `modified (${status})`}
            </span>
          )}
          <ThemeToggle />
        </div>
      </header>
      <div className="flex flex-col items-start gap-4 md:flex-row">
        {workspace.tree && (
          <nav className="w-full shrink-0 rounded-xl border border-fd-border bg-fd-card p-1.5 md:w-56">
            <FileTree
              tree={workspace.tree}
              run={workspace.run}
              active={active}
              onSelect={setSelected}
            />
          </nav>
        )}
        <div className="w-full min-w-0 flex-1">
          {sync ? (
            <MdxEditor
              sync={sync}
              components={components}
              syntax={syntax}
              onChange={setMarkdown}
              media={media}
              files={fileProvider}
              editable={writable}
            />
          ) : denied ? (
            <div className="rounded-xl border border-fd-border bg-fd-card px-5 py-10 text-center text-sm text-fd-muted-foreground">
              Access denied: this token cannot open the workspace.
            </div>
          ) : (
            offline && (
              <MdxEditor
                defaultValue={fallbackDoc}
                components={components}
                syntax={syntax}
                onChange={setMarkdown}
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
