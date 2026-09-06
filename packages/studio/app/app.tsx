import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MdxEditor,
  useEditorTheme,
  type FileProvider,
  type MdxEditorSync,
} from "@fumadocs-editor/ui";
import type { SessionStatus } from "@fumadocs-editor/core/sync";
import { Moon, PanelLeft, RefreshCw, Sun } from "lucide-react";
import { frontmatterTitle, TREE_ENDPOINT, type TreeNode, type TreeResponse } from "./protocol";
import { authHeaders, collab, components, media, syntax, transport } from "./providers";
import { Sidebar } from "./sidebar";

type TreeError = "denied" | "offline";

const UNSAVED = new Set<SessionStatus>(["dirty", "saving", "conflict"]);
const DESKTOP = "(min-width: 960px)";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useEditorTheme();
  const next = resolvedTheme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
    >
      {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

/** file paths in sidebar order */
function collectFiles(nodes: TreeNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "file") into.push(node.path);
    else if (node.type === "folder") collectFiles(node.children, into);
  }
  return into;
}

function retitle(nodes: TreeNode[], path: string, title: string): TreeNode[] {
  return nodes.map((node) => {
    if (node.type === "file") return node.path === path ? { ...node, title } : node;
    if (node.type === "folder" && path.startsWith(`${node.path}/`)) {
      return { ...node, children: retitle(node.children, path, title) };
    }
    return node;
  });
}

/** `to` relative to the directory of `from`, the way a document references it */
function relativeTo(from: string, to: string): string {
  const base = from.split("/");
  base.pop();
  const target = to.split("/");
  let common = 0;
  while (common < base.length && base[common] === target[common]) common++;
  const up = "../".repeat(base.length - common);
  return `${up || "./"}${target.slice(common).join("/")}`;
}

const readHash = () => decodeURIComponent(location.hash.slice(1)) || null;

export function Studio() {
  const [response, setResponse] = useState<TreeResponse | null>(null);
  const [error, setError] = useState<TreeError | null>(null);
  const [active, setActive] = useState(readHash);
  const [status, setStatus] = useState<SessionStatus>("synced");
  const [writable, setWritable] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(() => matchMedia(DESKTOP).matches);

  const loadTree = useCallback(async () => {
    try {
      const res = await fetch(TREE_ENDPOINT, { headers: await authHeaders(), cache: "no-store" });
      if (res.status === 401 || res.status === 403) return setError("denied");
      if (!res.ok) throw new Error(res.statusText);
      setResponse((await res.json()) as TreeResponse);
      setError(null);
    } catch {
      setError("offline");
    }
  }, []);

  useEffect(() => {
    void loadTree();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadTree();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadTree]);

  useEffect(() => {
    const onHash = () => setActive(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const files = useMemo(() => (response ? collectFiles(response.tree) : []), [response]);
  const known = active !== null && files.includes(active);

  // the hash is the source of truth for the open file; fall back to the first
  useEffect(() => {
    if (!known && files.length > 0) location.replace(`#${encodeURIComponent(files[0])}`);
  }, [known, files]);

  useEffect(() => {
    const title = active ?? response?.root ?? "Fumadocs Studio";
    document.title = `${UNSAVED.has(status) ? "● " : ""}${title}`;
  }, [active, status, response]);

  useEffect(() => {
    if (!UNSAVED.has(status)) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [status]);

  const sync = useMemo<MdxEditorSync | undefined>(
    () =>
      known
        ? {
            transport,
            path: active,
            collab,
            onStatus: setStatus,
            onOpen: (result) => setWritable(result.writable ?? true),
          }
        : undefined,
    [known, active],
  );

  const fileProvider = useMemo<FileProvider | undefined>(() => {
    if (!active || files.length < 2) return undefined;
    return {
      list: async () => {
        const paths: string[] = [];
        for (const file of files) if (file !== active) paths.push(relativeTo(active, file));
        return paths;
      },
    };
  }, [files, active]);

  const onChange = (markdown: string) => {
    if (!active) return;
    const title =
      frontmatterTitle(markdown) ??
      active.slice(active.lastIndexOf("/") + 1).replace(/\.mdx?$/, "");
    setResponse((current) => {
      if (!current) return current;
      return { ...current, tree: retitle(current.tree, active, title) };
    });
  };

  const select = (path: string) => {
    location.hash = encodeURIComponent(path);
    if (!matchMedia(DESKTOP).matches) setSidebarOpen(false);
  };

  const collabHref = `${collab ? location.pathname : "?collab"}${location.hash}`;

  let panel: string | null = null;
  if (error === "denied") panel = "Access denied: this token cannot open the workspace.";
  else if (error === "offline") panel = "The studio server is not reachable.";
  else if (response && files.length === 0) panel = `No .md or .mdx files under ${response.root}.`;

  return (
    <div className="studio" data-sidebar={sidebarOpen ? "open" : "closed"}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="sidebar-title">{response?.root ?? "…"}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh files"
            onClick={() => void loadTree()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {response && <Sidebar nodes={response.tree} active={active} onSelect={select} />}
      </aside>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button"
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <PanelLeft size={16} />
          </button>
          <span className="topbar-path">{known ? active : ""}</span>
          <a href={collabHref} className="pill" data-on={collab ? "" : undefined}>
            {collab ? "collab: on" : "collab: off"}
          </a>
          <ThemeToggle />
        </header>
        <div className="content">
          {panel ? (
            <p className="panel">
              {panel}
              {error === "offline" && (
                <button type="button" className="link-button" onClick={() => void loadTree()}>
                  Retry
                </button>
              )}
            </p>
          ) : (
            sync && (
              <MdxEditor
                sync={sync}
                components={components}
                syntax={syntax}
                media={media}
                files={fileProvider}
                editable={writable}
                onChange={onChange}
              />
            )
          )}
        </div>
      </main>
    </div>
  );
}
