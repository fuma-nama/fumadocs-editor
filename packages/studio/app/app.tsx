import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MdxEditor,
  useEditorTheme,
  type EditorTheme,
  type FileProvider,
  type MdxEditorRef,
  type MdxEditorSync,
} from "@fumadocs-editor/ui";
import type { SessionStatus } from "@fumadocs-editor/core/sync";
import {
  Code,
  Copy,
  Eye,
  FileText,
  Monitor,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Search,
  Sun,
  SunMoon,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  frontmatterTitle,
  TREE_ENDPOINT,
  TREE_EVENT,
  type TreeNode,
  type TreeResponse,
} from "./protocol";
import { authHeaders, collab, components, media, syntax, transport } from "./providers";
import { FilePanel } from "./files";
import { Palette, type PaletteGroup, type PaletteItem } from "./palette";

type TreeError = "denied" | "offline";
type FileNode = Extract<TreeNode, { type: "file" }>;

const UNSAVED = new Set<SessionStatus>(["dirty", "saving", "conflict"]);
const PANEL_KEY = "fde-studio-files";
const THEMES: [EditorTheme, string, LucideIcon][] = [
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
  ["system", "System", Monitor],
];
const META_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** file nodes in tree order */
function collectFiles(nodes: TreeNode[], into: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === "file") into.push(node);
    else if (node.type === "folder") collectFiles(node.children, into);
  }
  return into;
}

/** the tree with `path` retitled; the same array when nothing changed */
function retitle(nodes: TreeNode[], path: string, title: string): TreeNode[] {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    let next: TreeNode;
    if (node.type === "file" && node.path === path) {
      if (node.title === title) return nodes;
      next = { ...node, title };
    } else if (node.type === "folder" && path.startsWith(`${node.path}/`)) {
      const children = retitle(node.children, path, title);
      if (children === node.children) return nodes;
      next = { ...node, children };
    } else continue;
    const out = nodes.slice();
    out[i] = next;
    return out;
  }
  return nodes;
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
const openFile = (path: string) => {
  location.hash = encodeURIComponent(path);
};

export function Studio() {
  const [response, setResponse] = useState<TreeResponse | null>(null);
  const [error, setError] = useState<TreeError | null>(null);
  const [active, setActive] = useState(readHash);
  const [status, setStatus] = useState<SessionStatus>("synced");
  const [writable, setWritable] = useState(true);
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem(PANEL_KEY) === "1");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [groups, setGroups] = useState<PaletteGroup[]>([]);
  const { theme, setTheme } = useEditorTheme();
  const editorRef = useRef<MdxEditorRef>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const loads = useRef(0);

  const loadTree = useCallback(async () => {
    // only the latest response may land
    const id = ++loads.current;
    try {
      const res = await fetch(TREE_ENDPOINT, { headers: await authHeaders(), cache: "no-store" });
      const body = res.ok ? ((await res.json()) as TreeResponse) : null;
      if (id !== loads.current) return;
      if (res.status === 401 || res.status === 403) return setError("denied");
      if (!body) throw new Error(res.statusText);
      setResponse(body);
      setError(null);
    } catch {
      if (id === loads.current) setError("offline");
    }
  }, []);

  // the server pings over Vite's HMR socket whenever the tree changes on disk
  useEffect(() => {
    void loadTree();
    const hot = import.meta.hot;
    hot?.on(TREE_EVENT, loadTree);
    return () => hot?.off(TREE_EVENT, loadTree);
  }, [loadTree]);

  useEffect(() => {
    const onHash = () => setActive(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    localStorage.setItem(PANEL_KEY, panelOpen ? "1" : "0");
  }, [panelOpen]);

  const openPaletteRef = useRef(() => {});
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPaletteRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const files = useMemo(() => (response ? collectFiles(response.tree) : []), [response]);
  const known = active !== null && files.some((file) => file.path === active);

  // the hash is the source of truth for the open file; fall back to the first
  useEffect(() => {
    if (!known && files.length > 0) location.replace(`#${encodeURIComponent(files[0].path)}`);
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
        for (const file of files) {
          if (file.path !== active) paths.push(relativeTo(active, file.path));
        }
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
      const tree = retitle(current.tree, active, title);
      return tree === current.tree ? current : { ...current, tree };
    });
  };

  const header = useMemo(
    () => ({
      start: (
        <>
          <button
            type="button"
            className="icon-button"
            aria-label="Files"
            aria-pressed={panelOpen}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <PanelLeft size={16} />
          </button>
          <span className="path">{active}</span>
        </>
      ),
      end: (
        <button
          type="button"
          className="icon-button"
          aria-label="Search files and actions"
          onClick={() => openPaletteRef.current()}
        >
          <Search size={16} />
          <kbd>{META_KEY}K</kbd>
        </button>
      ),
    }),
    [panelOpen, active],
  );

  const collabHref = `${collab ? location.pathname : "?collab"}${location.hash}`;

  // items are snapshotted when the palette opens (the editor mode lives on
  // the ref) and kept while it fades out
  openPaletteRef.current = () => {
    const fileItems: PaletteItem[] = [];
    for (const file of files) {
      fileItems.push({
        id: file.path,
        label: file.title,
        icon: FileText,
        detail: file.path,
        run: () => openFile(file.path),
      });
    }
    const actions: PaletteItem[] = [
      {
        id: "files",
        label: panelOpen ? "Hide file list" : "Show file list",
        icon: panelOpen ? PanelLeftClose : PanelLeft,
        run: () => setPanelOpen(!panelOpen),
      },
    ];
    if (known) {
      const source = editorRef.current?.getMode() === "source";
      actions.push(
        {
          id: "mode",
          label: source ? "Switch to visual editor" : "Switch to MDX source",
          icon: source ? Eye : Code,
          run: () => editorRef.current?.setMode(source ? "visual" : "source"),
        },
        {
          id: "copy",
          label: "Copy file path",
          icon: Copy,
          detail: active,
          run: () => void navigator.clipboard.writeText(active),
        },
      );
    }
    actions.push({
      id: "collab",
      label: collab ? "Turn off collaboration" : "Turn on collaboration",
      icon: Users,
      run: () => location.assign(collabHref),
    });
    const themes: PaletteItem[] = [];
    let current = "";
    for (const [option, label, icon] of THEMES) {
      if (theme === option) current = label;
      themes.push({
        id: option,
        label,
        icon,
        checked: theme === option,
        run: () => setTheme(option),
      });
    }
    actions.push({ id: "theme", label: "Theme", icon: SunMoon, detail: current, items: themes });
    setGroups([
      { label: "Files", items: fileItems },
      { label: "Actions", items: actions },
    ]);
    setPaletteOpen(true);
  };

  let message: string | null = null;
  if (error === "denied") message = "Access denied: this token cannot open the workspace.";
  else if (error === "offline") message = "The studio server is not reachable.";
  else if (response && files.length === 0) message = `No .md or .mdx files under ${response.root}.`;

  return (
    <div className="studio" ref={rootRef} data-files={panelOpen ? "" : undefined}>
      {message ? (
        <p className="message">{message}</p>
      ) : (
        sync && (
          <MdxEditor
            ref={editorRef}
            variant="page"
            header={header}
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
      {response && (
        <FilePanel
          root={response.root}
          nodes={response.tree}
          active={active}
          hidden={!panelOpen}
          onSelect={openFile}
          onClose={() => setPanelOpen(false)}
        />
      )}
      <Palette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={groups}
        container={rootRef}
      />
    </div>
  );
}
