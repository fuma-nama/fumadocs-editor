import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as stylex from "@stylexjs/stylex";
import {
  MdxEditor,
  useEditorTheme,
  type EditorTheme,
  type FileProvider,
  type EditorMode,
  type MdxEditorRef,
  type MdxEditorSync,
  useWorkspace,
} from "@fumadocs-editor/ui";
import {
  frontmatterTitle,
  type SessionStatus,
  type TreeNode,
  type WorkspaceTree,
} from "@fumadocs-editor/core/sync";
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
import { collab, components, media, syntax, transport } from "./providers";
import { FilePanel } from "./files";
import { Palette, type PaletteGroup, type PaletteItem } from "./palette";

const COARSE = "@media (pointer: coarse)";
const REDUCE = "@media (prefers-reduced-motion: reduce)";
const MONO = "var(--font-mono)";
const muted = "var(--fde-muted-foreground)";

const styles = stylex.create({
  // the open panel gets a column of its own; the editor keeps its document clear of it
  withPanel: { "--fde-page-inset": { default: null, "@media (min-width: 960px)": "19.5rem" } },
  message: { margin: 0, padding: "40vh 1.5rem 0", color: muted, fontSize: 14, textAlign: "center" },
  iconButton: {
    display: "inline-flex",
    boxSizing: "border-box",
    height: "1.75rem",
    minWidth: "1.75rem",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: "0.375rem",
    padding: "0 0.375rem",
    borderWidth: 0,
    borderRadius: "0.5rem",
    backgroundColor: {
      default: "transparent",
      ":hover": "var(--fde-accent)",
      ':is([aria-pressed="true"])': "var(--fde-accent)",
    },
    color: {
      default: muted,
      ":hover": "var(--fde-foreground)",
      ':is([aria-pressed="true"])': "var(--fde-foreground)",
    },
    fontFamily: "inherit",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: { default: "120ms", [REDUCE]: "0s" },
    outlineWidth: 2,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineColor: "var(--fde-ring)",
    outlineOffset: 2,
  },
  key: { display: { default: null, [COARSE]: "none" }, fontFamily: "inherit", fontSize: 11 },
  path: {
    minWidth: 0,
    overflow: "hidden",
    color: muted,
    fontFamily: MONO,
    fontSize: 12.5,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

type FileNode = Extract<TreeNode, { type: "file" }>;
/** the open file's title as typed, ahead of the save reaching the tree */
interface Title {
  path: string;
  title: string;
}

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
function retitle(nodes: TreeNode[], { path, title }: Title): TreeNode[] {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    let next: TreeNode;
    if (node.type === "file" && node.path === path) {
      if (node.title === title) return nodes;
      next = { ...node, title };
    } else if (node.type === "folder" && path.startsWith(`${node.path}/`)) {
      const children = retitle(node.children, { path, title });
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
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const openFile = (path: string) => {
  location.hash = encodeURIComponent(path);
};

export function Studio() {
  const workspace = useWorkspace({ transport });
  const [typed, setTyped] = useState<Title | null>(null);
  const hash = useSyncExternalStore(subscribeHash, readHash);
  const [status, setStatus] = useState<SessionStatus>("synced");
  const [writable, setWritable] = useState(true);
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem(PANEL_KEY) === "1");
  const [paletteOpen, setPaletteOpen] = useState(false);
  // the editor mode lives on the ref; the palette snapshots it as it opens
  const [mode, setMode] = useState<EditorMode>("visual");
  const { theme, setTheme } = useEditorTheme();
  const editorRef = useRef<MdxEditorRef>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const setPanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    localStorage.setItem(PANEL_KEY, open ? "1" : "0");
  }, []);
  const closePanel = useCallback(() => setPanel(false), [setPanel]);
  const openPalette = useCallback(() => {
    setMode(editorRef.current?.getMode() ?? "visual");
    setPaletteOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openPalette]);

  const tree = useMemo<WorkspaceTree | null>(() => {
    if (!workspace.tree || !typed) return workspace.tree;
    const nodes = retitle(workspace.tree.nodes, typed);
    return nodes === workspace.tree.nodes ? workspace.tree : { ...workspace.tree, nodes };
  }, [workspace.tree, typed]);
  const files = useMemo(() => (tree ? collectFiles(tree.nodes) : []), [tree]);
  // the hash names the open file; a missing or stale one falls back to the first
  const active =
    hash !== null && files.some((file) => file.path === hash) ? hash : (files[0]?.path ?? null);
  // without a file there is no header to open the list from
  const panelShown = panelOpen || (tree !== null && files.length === 0);

  const docTitle = active ?? tree?.root ?? "Fumadocs Studio";
  if (typeof document !== "undefined" && document.title !== docTitle) {
    document.title = docTitle;
  }

  useEffect(() => {
    if (!UNSAVED.has(status)) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [status]);

  // the editor reads the latest callbacks; the session only restarts on path/transport/collab
  const sync: MdxEditorSync | undefined =
    active === null
      ? undefined
      : {
          transport,
          path: active,
          collab,
          onStatus: setStatus,
          onOpen: (result) => setWritable(result.writable ?? true),
        };

  // identity matters: the editor lists paths again for a new provider
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
    setTyped((current) =>
      current?.path === active && current.title === title ? current : { path: active, title },
    );
  };

  const header = {
    start: (
      <>
        <button
          type="button"
          {...stylex.props(styles.iconButton)}
          aria-label="Files"
          aria-pressed={panelOpen}
          onClick={() => setPanel(!panelOpen)}
        >
          <PanelLeft size={16} />
        </button>
        <span {...stylex.props(styles.path)}>{active}</span>
      </>
    ),
    end: (
      <button
        type="button"
        {...stylex.props(styles.iconButton)}
        aria-label="Search files and actions"
        onClick={openPalette}
      >
        <Search size={16} />
        <kbd {...stylex.props(styles.key)}>{META_KEY}K</kbd>
      </button>
    ),
  };

  const groups = useMemo<PaletteGroup[]>(() => {
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
        run: () => setPanel(!panelOpen),
      },
    ];
    if (active !== null) {
      const source = mode === "source";
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
    const collabHref = `${collab ? location.pathname : "?collab"}${location.hash}`;
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
    return [
      { label: "Files", items: fileItems },
      { label: "Actions", items: actions },
    ];
  }, [files, panelOpen, active, mode, theme, setTheme, setPanel]);

  let message: string | null = null;
  if (workspace.status === "denied") {
    message = "Access denied: this token cannot open the workspace.";
  } else if (!tree) {
    if (workspace.status === "offline") message = "The studio server is not reachable.";
  } else if (files.length === 0) message = `No .md or .mdx files under ${tree.root}.`;

  return (
    <div {...stylex.props(panelShown && styles.withPanel)} ref={rootRef}>
      {message ? (
        <p {...stylex.props(styles.message)}>{message}</p>
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
      {tree && (
        <FilePanel
          tree={tree}
          run={workspace.run}
          active={active}
          onSelect={openFile}
          hidden={!panelShown}
          onClose={closePanel}
          container={rootRef}
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
