import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import * as stylex from "@stylexjs/stylex";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Collapsible } from "@base-ui/react/collapsible";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  Ellipsis,
  ExternalLink,
  FilePlus,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  GripVertical,
  Minus,
  Pencil,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { pagesEntry, type TreeCommand, type TreeNode } from "./protocol";
import { chrome } from "./chrome";
import { files, folder, lifted, menuItem, row } from "./markers.stylex";

type FileNode = Extract<TreeNode, { type: "file" }>;
type SeparatorNode = Extract<TreeNode, { type: "separator" }>;

/** the text row being typed: a new page, folder or separator at the end of `dir`, or the separator at `at` renamed */
interface Draft {
  dir: string;
  kind: "page" | "folder" | "separator";
  at?: number;
}

interface TreeContext {
  active: string | null;
  onSelect: (path: string) => void;
  /** runs a command; a refusal is shown and reported as false */
  run: (command: TreeCommand) => Promise<boolean>;
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
  askDelete: (node: FileNode) => void;
  container: RefObject<HTMLElement | null>;
}

const Tree = createContext<TreeContext>(null!);

const SLOP = 4;
const EDGE = 40;
const NOTICE_MS = 6000;
const COARSE = "@media (pointer: coarse)";
const REDUCE = "@media (prefers-reduced-motion: reduce)";
const MONO = "var(--font-mono)";
const ALT_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌥" : "Alt+";

const foreground = "var(--fde-foreground)";
const muted = "var(--fde-muted-foreground)";
const primary = "var(--fde-primary)";
const border = "var(--fde-border)";
const popover = "var(--fde-popover)";
const accent = "var(--fde-accent)";
const error = "var(--fde-error)";

const styles = stylex.create({
  panel: {
    position: "fixed",
    top: "3.25rem",
    bottom: "0.75rem",
    left: "0.75rem",
    zIndex: 20,
    display: "block",
    boxSizing: "border-box",
    width: "min(18rem, calc(100vw - 1.5rem))",
    padding: "0.375rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    borderRadius: "0.75rem",
    backgroundColor: popover,
    color: "var(--fde-popover-foreground)",
    boxShadow: "0 12px 32px -12px rgb(0 0 0 / 0.3)",
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollbarWidth: "thin",
    cursor: { default: null, ":is([data-dragging])": "grabbing" },
    // stays in the tree while hidden, so both directions animate
    visibility: { default: "visible", ":is([hidden])": "hidden" },
    opacity: { default: 1, ":is([hidden])": 0 },
    translate: { default: "0 0", ":is([hidden])": "-0.75rem 0" },
    transitionProperty: "opacity, translate, visibility",
    transitionDuration: { default: "120ms", [REDUCE]: "0s" },
    transitionTimingFunction: "ease-out",
  },
  head: {
    display: "flex",
    alignItems: "center",
    padding: "0.25rem 0.25rem 0.25rem 0.75rem",
    color: muted,
    fontSize: 12,
    fontWeight: 500,
  },
  title: {
    minWidth: 0,
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tree: { margin: 0, padding: 0, listStyle: "none", userSelect: "none" },
  row: {
    display: "flex",
    alignItems: "center",
    borderRadius: "0.5rem",
    backgroundColor: {
      default: "transparent",
      ":hover": accent,
      ":has([data-popup-open])": accent,
      ':has([aria-current="page"])': `color-mix(in oklab, ${primary} 10%, transparent)`,
      [stylex.when.ancestor("[data-dragging]", files)]: "transparent",
    },
    opacity: { default: 1, [stylex.when.ancestor("[data-lifted]", lifted)]: 0.4 },
  },
  item: {
    display: "flex",
    boxSizing: "border-box",
    minWidth: 0,
    flexGrow: 1,
    minHeight: { default: "2rem", [COARSE]: "2.5rem" },
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.375rem 0.625rem",
    paddingInlineStart: "calc(0.625rem + var(--depth) * 1rem)",
    borderWidth: 0,
    borderRadius: "0.5rem",
    backgroundColor: "transparent",
    color: {
      default: muted,
      [stylex.when.ancestor(":hover", row)]: foreground,
      ':is([aria-current="page"])': primary,
    },
    fontFamily: "inherit",
    fontSize: 13.5,
    fontWeight: 500,
    textAlign: "start",
    textDecorationLine: "none",
    cursor: "pointer",
    outlineWidth: 2,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineColor: "var(--fde-ring)",
    outlineOffset: 2,
  },
  folder: { color: foreground },
  separator: {
    minHeight: "1.75rem",
    marginTop: "0.5rem",
    paddingBlock: "0.25rem",
    paddingInlineStart: "calc(0.75rem + var(--depth) * 1rem)",
    fontSize: 12,
  },
  edit: { cursor: "text" },
  icon: { flexShrink: 0 },
  chevron: {
    flexShrink: 0,
    rotate: { default: "0deg", [stylex.when.ancestor("[data-panel-open]", folder)]: "90deg" },
    transitionProperty: "rotate",
    transitionDuration: { default: "100ms", [REDUCE]: "0s" },
    transitionTimingFunction: "ease-out",
  },
  collapse: {
    height: {
      default: "var(--collapsible-panel-height)",
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    overflow: "hidden",
    transitionProperty: "height",
    transitionDuration: { default: "120ms", [REDUCE]: "0s" },
    transitionTimingFunction: "ease-out",
  },
  label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  control: {
    display: "inline-flex",
    boxSizing: "border-box",
    width: "1.5rem",
    height: "1.5rem",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
    borderRadius: "0.375rem",
    backgroundColor: "transparent",
    color: muted,
    fontFamily: "inherit",
    cursor: "pointer",
  },
  action: {
    marginInlineEnd: "0.25rem",
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", row)]: 1,
      [stylex.when.ancestor(":focus-within", row)]: 1,
      ":is([data-popup-open])": 1,
      [COARSE]: 1,
    },
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in oklab, ${foreground} 10%, transparent)`,
      ":is([data-popup-open])": `color-mix(in oklab, ${foreground} 10%, transparent)`,
    },
    color: { default: muted, ":hover": foreground, ":is([data-popup-open])": foreground },
    transitionProperty: "opacity",
    transitionDuration: "100ms",
    outlineWidth: 2,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineColor: "var(--fde-ring)",
    outlineOffset: -2,
  },
  shown: { opacity: 1 },
  grip: {
    display: { default: "none", [COARSE]: "inline-flex" },
    cursor: "grab",
    touchAction: "none",
  },
  drop: {
    position: "absolute",
    zIndex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: primary,
    pointerEvents: "none",
  },
  input: {
    minWidth: 0,
    flexGrow: 1,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: foreground,
    fontFamily: "inherit",
    fontSize: "max(13.5px, var(--fde-field-size))",
    outline: "none",
    "::placeholder": { color: muted, opacity: 0.7 },
  },
  hint: {
    overflow: "hidden",
    padding: "0 0.625rem 0.375rem",
    paddingInlineStart: "calc(2.0625rem + var(--depth) * 1rem)",
    color: muted,
    fontFamily: MONO,
    fontSize: 11,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  notice: {
    position: "sticky",
    bottom: 0,
    margin: "0.375rem 0 0",
    padding: "0.5rem 0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    borderRadius: "0.5rem",
    backgroundColor: popover,
    color: error,
    fontSize: 12,
    overflowWrap: "anywhere",
  },
  positioner: { zIndex: 30 },
  menu: {
    minWidth: "13.5rem",
    padding: "0.25rem",
    borderRadius: "0.75rem",
    boxShadow:
      "0 0 0 1px rgb(0 0 0 / 0.04), 0 8px 24px -8px rgb(0 0 0 / 0.35), 0 2px 6px -2px rgb(0 0 0 / 0.2)",
    transformOrigin: "var(--transform-origin)",
    opacity: { default: 1, ":is([data-starting-style], [data-ending-style])": 0 },
    scale: { default: "1", ":is([data-starting-style], [data-ending-style])": "0.97" },
    translate: { default: "0 0", ":is([data-starting-style], [data-ending-style])": "0 -0.25rem" },
    transitionProperty: "opacity, scale, translate",
    transitionDuration: { default: "120ms", [REDUCE]: "0s" },
    transitionTimingFunction: "ease-out",
  },
  menuLabel: {
    overflow: "hidden",
    padding: "0.375rem 0.625rem 0.5rem",
    color: muted,
    fontFamily: MONO,
    fontSize: 11,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  menuSeparator: { height: 1, margin: "0.25rem -0.25rem", backgroundColor: border },
  menuItem: {
    display: "flex",
    minHeight: { default: "2rem", [COARSE]: "2.5rem" },
    alignItems: "center",
    gap: "0.625rem",
    padding: "0 0.625rem",
    borderRadius: "0.5rem",
    backgroundColor: { default: "transparent", ":is([data-highlighted])": accent },
    color: { default: null, ":is([data-highlighted])": "var(--fde-accent-foreground)" },
    opacity: { default: 1, ":is([data-disabled])": 0.45 },
    fontSize: 13,
    cursor: "default",
    userSelect: "none",
    outline: "none",
  },
  danger: {
    color: error,
    backgroundColor: {
      default: "transparent",
      ":is([data-highlighted])": `color-mix(in oklab, ${error} 12%, transparent)`,
    },
  },
  menuIcon: {
    flexShrink: 0,
    color: {
      default: muted,
      [stylex.when.ancestor("[data-danger]", menuItem)]: error,
      [stylex.when.ancestor("[data-highlighted]", menuItem)]: "inherit",
    },
  },
  menuText: { flexGrow: 1 },
  keys: {
    display: { default: null, [COARSE]: "none" },
    marginInlineStart: "1rem",
    color: { default: muted, [stylex.when.ancestor("[data-highlighted]", menuItem)]: "inherit" },
    fontFamily: "inherit",
    fontSize: 11.5,
    letterSpacing: "0.02em",
  },
  confirmViewport: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 61,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  confirm: {
    width: "100%",
    maxWidth: "22rem",
    padding: "1.25rem",
    borderRadius: "0.875rem",
    boxShadow: "0 24px 48px -12px rgb(0 0 0 / 0.35)",
    opacity: { default: 1, ":is([data-starting-style], [data-ending-style])": 0 },
    translate: { default: "0 0", ":is([data-starting-style], [data-ending-style])": "0 0.5rem" },
    transitionProperty: "opacity, translate",
    transitionDuration: { default: "120ms", [REDUCE]: "0s" },
    transitionTimingFunction: "ease-out",
  },
  confirmTitle: { margin: "0 0 0.5rem", fontSize: 15, fontWeight: 600 },
  confirmText: { margin: 0, color: muted, fontSize: 13, overflowWrap: "anywhere" },
  code: { fontFamily: MONO, fontSize: 12 },
  actions: { display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" },
  dangerButton: {
    borderColor: error,
    backgroundColor: { default: error, ":hover": `color-mix(in oklab, ${error} 85%, black)` },
    color: "#fff",
  },
});

const entries = (nodes: TreeNode[]): string[] => {
  const out: string[] = [];
  for (const node of nodes) out.push(pagesEntry(node));
  return out;
};

const moved = (nodes: TreeNode[], from: number, to: number): string[] => {
  const order = entries(nodes);
  order.splice(to, 0, ...order.splice(from, 1));
  return order;
};

/** the children of the folder at `dir` (`""` = root) */
function childrenOf(nodes: TreeNode[], dir: string): TreeNode[] {
  if (!dir) return nodes;
  for (const node of nodes) {
    if (node.type !== "folder") continue;
    if (node.path === dir) return node.children;
    if (dir.startsWith(`${node.path}/`)) return childrenOf(node.children, dir);
  }
  return [];
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

/** `Guides/Getting started` under `docs` names `docs/guides/getting-started`, titled `Getting started` */
function targetOf(dir: string, text: string): { path: string; title: string } | undefined {
  const segments: string[] = [];
  for (const part of text.split("/")) {
    const name = slug(part);
    if (!name) return;
    segments.push(name);
  }
  const title = text.slice(text.lastIndexOf("/") + 1).trim();
  return { path: `${dir ? `${dir}/` : ""}${segments.join("/")}`, title };
}

/**
 * Drag a row of `list` with the pointer captured on `handle`: past a few
 * pixels the row lifts and a line marks the slot under the pointer, the
 * panel scrolls near its edges, and `onDrop` gets the slot on release.
 */
function dragRow(
  list: HTMLUListElement,
  from: number,
  handle: HTMLElement,
  event: PointerEvent,
  hooks: { onLift(): void; onDrop(to: number): void },
) {
  const items = [...list.querySelectorAll<HTMLElement>(":scope > li[data-index]")];
  const rows: HTMLElement[] = [];
  for (const item of items) rows.push(item.querySelector<HTMLElement>("[data-row]")!);
  const panel = list.closest<HTMLElement>("[data-files]")!;
  const indent = parseFloat(
    getComputedStyle(rows[0].querySelector<HTMLElement>("[data-item]")!).paddingInlineStart,
  );
  const { pointerId, clientX: startX, clientY: startY } = event;
  const line = document.createElement("div");
  line.className = stylex.props(styles.drop).className!;
  let y = startY;
  let isLifted = false;
  let target = -1;
  let scrolling = 0;

  const place = () => {
    let to = 0;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (y > rect.top + rect.height / 2) to++;
    }
    target = to;
    const valid = to !== from && to !== from + 1;
    line.hidden = !valid;
    if (!valid) return;
    const edge = rows[Math.min(to, rows.length - 1)].getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const top = to < rows.length ? edge.top : edge.bottom;
    line.style.top = `${top - box.top + panel.scrollTop - 1}px`;
    line.style.left = `${edge.left - box.left + panel.scrollLeft + indent}px`;
    line.style.width = `${edge.width - indent}px`;
  };
  const scroll = () => {
    const box = panel.getBoundingClientRect();
    const dy = y < box.top + EDGE ? -6 : y > box.bottom - EDGE ? 6 : 0;
    if (!dy) return void (scrolling = 0);
    panel.scrollBy(0, dy);
    place();
    scrolling = requestAnimationFrame(scroll);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    y = e.clientY;
    if (!isLifted) {
      if (Math.abs(e.clientX - startX) < SLOP && Math.abs(y - startY) < SLOP) return;
      isLifted = true;
      items[from].setAttribute("data-lifted", "");
      panel.setAttribute("data-dragging", "");
      panel.append(line);
      hooks.onLift();
    }
    place();
    if (!scrolling) scrolling = requestAnimationFrame(scroll);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    handle.removeEventListener("lostpointercapture", end);
    cancelAnimationFrame(scrolling);
    if (!isLifted) return;
    items[from].removeAttribute("data-lifted");
    panel.removeAttribute("data-dragging");
    const valid = !line.hidden;
    line.remove();
    if (e.type === "pointerup" && valid) hooks.onDrop(target);
  };
  handle.setPointerCapture(pointerId);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);
}

function RowMenu({
  label,
  detail,
  icon: Icon = Ellipsis,
  shown,
  children,
}: {
  label: string;
  /** what the menu is about: a path or the `meta.json` entry */
  detail: string;
  icon?: LucideIcon;
  /** always visible, not only while its row is hovered */
  shown?: boolean;
  children: ReactNode;
}) {
  const { container } = useContext(Tree);
  return (
    <Menu.Root>
      <Menu.Trigger
        {...stylex.props(styles.control, styles.action, shown && styles.shown)}
        aria-label={`Actions for ${label}`}
      >
        <Icon size={15} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Positioner
          {...stylex.props(styles.positioner)}
          side="bottom"
          align="end"
          sideOffset={4}
        >
          <Menu.Popup {...stylex.props(chrome.surface, styles.menu)}>
            <Menu.Group>
              <Menu.GroupLabel {...stylex.props(styles.menuLabel)}>{detail}</Menu.GroupLabel>
              {children}
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Item({
  icon: Icon,
  label,
  keys,
  danger,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      {...stylex.props(styles.menuItem, danger && styles.danger, menuItem)}
      data-danger={danger || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden {...stylex.props(styles.menuIcon)} />
      <span {...stylex.props(styles.menuText)}>{label}</span>
      {keys && <kbd {...stylex.props(styles.keys)}>{keys}</kbd>}
    </Menu.Item>
  );
}

const MenuSeparator = () => <Menu.Separator {...stylex.props(styles.menuSeparator)} />;

function AddItems({ dir, onOpen }: { dir: string; onOpen?: () => void }) {
  const { setDraft } = useContext(Tree);
  const start = (kind: Draft["kind"]) => {
    onOpen?.();
    setDraft({ dir, kind });
  };
  return (
    <>
      <Item icon={FilePlus} label="New page" onClick={() => start("page")} />
      <Item icon={FolderPlus} label="New folder" onClick={() => start("folder")} />
      <Item icon={Minus} label="New separator" onClick={() => start("separator")} />
    </>
  );
}

/** move the row at `index` within its folder, the menu twin of Alt + arrows */
function MoveItems({ dir, nodes, index }: { dir: string; nodes: TreeNode[]; index: number }) {
  const { run } = useContext(Tree);
  const move = (to: number) => void run({ type: "order", dir, order: moved(nodes, index, to) });
  return (
    <>
      <Item
        icon={ArrowUp}
        label="Move up"
        keys={`${ALT_KEY}↑`}
        disabled={index === 0}
        onClick={() => move(index - 1)}
      />
      <Item
        icon={ArrowDown}
        label="Move down"
        keys={`${ALT_KEY}↓`}
        disabled={index === nodes.length - 1}
        onClick={() => move(index + 1)}
      />
    </>
  );
}

function Grip({
  onPointerDown,
}: {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  return (
    <span
      {...stylex.props(styles.control, styles.grip)}
      aria-hidden
      onPointerDown={(event) => {
        event.preventDefault();
        onPointerDown(event);
      }}
    >
      <GripVertical size={14} />
    </span>
  );
}

function DraftRow({
  dir,
  draft,
  nodes,
  depth,
}: {
  dir: string;
  draft: Draft;
  nodes: TreeNode[];
  depth: number;
}) {
  const { run, setDraft, onSelect } = useContext(Tree);
  const renamed = draft.at === undefined ? undefined : (nodes[draft.at] as SeparatorNode);
  const [text, setText] = useState(renamed?.title ?? "");
  const [busy, setBusy] = useState(false);
  const { kind } = draft;
  const target = kind === "separator" ? undefined : targetOf(dir, text.trim());
  const hint = target && (kind === "page" ? `${target.path}.mdx` : `${target.path}/`);

  const submit = async () => {
    const title = text.trim();
    if (!title) return setDraft(null);
    setBusy(true);
    let done: boolean;
    if (target && kind === "page") {
      done = await run({ type: "create", path: `${target.path}.mdx`, title: target.title });
      if (done) onSelect(`${target.path}.mdx`);
    } else if (target) {
      done = await run({ type: "mkdir", dir: target.path, title: target.title });
      if (done) onSelect(`${target.path}/index.mdx`);
    } else {
      const order = entries(nodes);
      const entry = pagesEntry({ type: "separator", title, icon: renamed?.icon });
      if (draft.at === undefined) order.push(entry);
      else order[draft.at] = entry;
      done = await run({ type: "order", dir, order });
    }
    if (done) setDraft(null);
    else setBusy(false);
  };

  const label = kind === "page" ? "Page title" : kind === "folder" ? "Folder name" : "Separator";
  const depthStyle = { "--depth": depth } as CSSProperties;
  return (
    <li>
      <div {...stylex.props(styles.row, row)} data-row="">
        <div {...stylex.props(styles.item, styles.edit)} style={depthStyle} data-item="">
          {kind === "page" && <FileText size={15} {...stylex.props(styles.icon)} aria-hidden />}
          {kind === "folder" && <FolderIcon size={15} {...stylex.props(styles.icon)} aria-hidden />}
          <input
            {...stylex.props(styles.input)}
            aria-label={label}
            placeholder={label}
            value={text}
            disabled={busy}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              } else if (event.key === "Escape") {
                event.stopPropagation();
                setDraft(null);
              }
            }}
            onBlur={() => {
              if (!busy) setDraft(null);
            }}
          />
        </div>
      </div>
      {hint && (
        <div {...stylex.props(styles.hint)} style={depthStyle}>
          {hint}
        </div>
      )}
    </li>
  );
}

function Folder({
  dir,
  nodes,
  node,
  index,
  depth,
  drag,
}: {
  dir: string;
  nodes: TreeNode[];
  node: Extract<TreeNode, { type: "folder" }>;
  index: number;
  depth: number;
  drag: (event: ReactPointerEvent<HTMLElement>, index: number) => void;
}) {
  const { active } = useContext(Tree);
  const holdsActive = active !== null && active.startsWith(`${node.path}/`);
  const [open, setOpen] = useState(holdsActive);
  const [held, setHeld] = useState(holdsActive);
  if (holdsActive !== held) {
    setHeld(holdsActive);
    if (holdsActive) setOpen(true);
  }
  return (
    <li {...stylex.props(lifted)} data-index={index}>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <div {...stylex.props(styles.row, row)} data-row="">
          <Collapsible.Trigger
            {...stylex.props(styles.item, styles.folder, folder)}
            style={{ "--depth": depth } as CSSProperties}
            data-item=""
            data-folder=""
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") drag(event, index);
            }}
          >
            <ChevronRight size={14} {...stylex.props(styles.chevron)} aria-hidden />
            <span {...stylex.props(styles.label)}>{node.title}</span>
          </Collapsible.Trigger>
          <Grip onPointerDown={(event) => drag(event, index)} />
          <RowMenu label={node.title} detail={`${node.path}/`}>
            <AddItems dir={node.path} onOpen={() => setOpen(true)} />
            <MenuSeparator />
            <MoveItems dir={dir} nodes={nodes} index={index} />
          </RowMenu>
        </div>
        <Collapsible.Panel {...stylex.props(styles.collapse)} data-panel="">
          <Nodes dir={node.path} nodes={node.children} depth={depth + 1} />
        </Collapsible.Panel>
      </Collapsible.Root>
    </li>
  );
}

function Nodes({ dir, nodes, depth }: { dir: string; nodes: TreeNode[]; depth: number }) {
  const ctx = useContext(Tree);
  const list = useRef<HTMLUListElement>(null);
  const swallowClick = useRef(false);
  const depthStyle = { "--depth": depth } as CSSProperties;

  const drag = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    if (event.button !== 0 || ctx.draft) return;
    dragRow(list.current!, index, event.currentTarget, event.nativeEvent, {
      onLift: () => {
        swallowClick.current = true;
      },
      onDrop: (to) => {
        const at = to > index ? to - 1 : to;
        if (at !== index) void ctx.run({ type: "order", dir, order: moved(nodes, index, at) });
      },
    });
  };
  const mouseDrag = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    if (event.pointerType === "mouse") drag(event, index);
  };
  const remove = (index: number) => {
    const order = entries(nodes);
    order.splice(index, 1);
    void ctx.run({ type: "order", dir, order });
  };

  const draft = ctx.draft?.dir === dir ? ctx.draft : null;
  const rows: ReactNode[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (draft?.at === index) {
      rows.push(<DraftRow key="draft" dir={dir} draft={draft} nodes={nodes} depth={depth} />);
    } else if (node.type === "folder") {
      rows.push(
        <Folder
          key={`${node.path}/`}
          dir={dir}
          nodes={nodes}
          node={node}
          index={index}
          depth={depth}
          drag={drag}
        />,
      );
    } else if (node.type === "file") {
      rows.push(
        <li key={node.path} {...stylex.props(lifted)} data-index={index}>
          <div {...stylex.props(styles.row, row)} data-row="">
            <button
              type="button"
              {...stylex.props(styles.item)}
              style={depthStyle}
              data-item=""
              aria-current={node.path === ctx.active ? "page" : undefined}
              onClick={() => ctx.onSelect(node.path)}
              onPointerDown={(event) => mouseDrag(event, index)}
            >
              <FileText size={15} {...stylex.props(styles.icon)} aria-hidden />
              <span {...stylex.props(styles.label)}>{node.title}</span>
            </button>
            <Grip onPointerDown={(event) => drag(event, index)} />
            <RowMenu label={node.title} detail={node.path}>
              <MoveItems dir={dir} nodes={nodes} index={index} />
              <Item
                icon={Copy}
                label="Copy path"
                onClick={() => void navigator.clipboard.writeText(node.path)}
              />
              <MenuSeparator />
              <Item icon={Trash2} label="Delete page…" danger onClick={() => ctx.askDelete(node)} />
            </RowMenu>
          </div>
        </li>,
      );
    } else if (node.type === "separator") {
      rows.push(
        <li key={`separator-${index}`} {...stylex.props(lifted)} data-index={index}>
          <div {...stylex.props(styles.row, row)} data-row="">
            <div
              {...stylex.props(styles.item, styles.separator)}
              tabIndex={0}
              style={depthStyle}
              data-item=""
              onPointerDown={(event) => mouseDrag(event, index)}
              onDoubleClick={() => ctx.setDraft({ dir, kind: "separator", at: index })}
            >
              <span {...stylex.props(styles.label)}>{node.title || "—"}</span>
            </div>
            <Grip onPointerDown={(event) => drag(event, index)} />
            <RowMenu label={node.title || "separator"} detail={pagesEntry(node)}>
              <Item
                icon={Pencil}
                label="Rename"
                onClick={() => ctx.setDraft({ dir, kind: "separator", at: index })}
              />
              <MoveItems dir={dir} nodes={nodes} index={index} />
              <MenuSeparator />
              <Item icon={Trash2} label="Delete" danger onClick={() => remove(index)} />
            </RowMenu>
          </div>
        </li>,
      );
    } else {
      rows.push(
        <li key={`link-${index}`} {...stylex.props(lifted)} data-index={index}>
          <div {...stylex.props(styles.row, row)} data-row="">
            <a
              {...stylex.props(styles.item)}
              href={node.url}
              target="_blank"
              rel="noreferrer"
              draggable={false}
              style={depthStyle}
              data-item=""
              onPointerDown={(event) => mouseDrag(event, index)}
            >
              <ExternalLink size={15} {...stylex.props(styles.icon)} aria-hidden />
              <span {...stylex.props(styles.label)}>{node.title}</span>
            </a>
            <Grip onPointerDown={(event) => drag(event, index)} />
            <RowMenu label={node.title} detail={pagesEntry(node)}>
              <Item
                icon={ExternalLink}
                label="Open link"
                onClick={() => window.open(node.url, "_blank", "noreferrer")}
              />
              <MoveItems dir={dir} nodes={nodes} index={index} />
              <MenuSeparator />
              <Item icon={Trash2} label="Delete" danger onClick={() => remove(index)} />
            </RowMenu>
          </div>
        </li>,
      );
    }
  }
  if (draft && draft.at === undefined) {
    rows.push(<DraftRow key="draft" dir={dir} draft={draft} nodes={nodes} depth={depth} />);
  }

  return (
    <ul
      {...stylex.props(styles.tree)}
      ref={list}
      data-dir={dir}
      onClickCapture={(event) => {
        // the click that ends a drag must not open, toggle or follow the row
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      {rows}
    </ul>
  );
}

export interface FilePanelProps {
  /** basename of the content directory */
  root: string;
  nodes: TreeNode[];
  active: string | null;
  hidden: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
  /** sends a command to the server; rejects with the message to show */
  run: (command: TreeCommand) => Promise<void>;
  /** portal target inside the themed root, so the tokens resolve */
  container: RefObject<HTMLElement | null>;
}

/** the rows currently on screen, in reading order */
function visibleRows(panel: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const row of panel.querySelectorAll<HTMLElement>("[data-item]")) {
    if (row.offsetParent !== null) rows.push(row);
  }
  return rows;
}

/**
 * The floating file list; stays until toggled. Opening focuses the open
 * file's row; arrows move between rows, left and right close and open a
 * folder, Alt with up or down moves a row within its folder, Escape closes
 * the list. Rows drag within their folder (from the grip on touch); the
 * row menus create pages, folders and separators, move, rename and delete.
 */
export const FilePanel = memo(function FilePanel({
  root,
  nodes,
  active,
  hidden,
  onSelect,
  onClose,
  run,
  container,
}: FilePanelProps) {
  const ref = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<FileNode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (hidden) return;
    // the panel is still `visibility: hidden` until its transition starts
    const frame = requestAnimationFrame(() => {
      const panel = ref.current!;
      const row =
        panel.querySelector<HTMLElement>('[aria-current="page"]') ?? visibleRows(panel)[0];
      row?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [hidden]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const runNoticed = useCallback(
    async (command: TreeCommand) => {
      try {
        await run(command);
        return true;
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [run],
  );

  const ctx = useMemo<TreeContext>(
    () => ({
      active,
      onSelect,
      run: runNoticed,
      draft,
      setDraft,
      askDelete: setConfirm,
      container,
    }),
    [active, onSelect, runNoticed, draft, container],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // portaled menus and dialogs bubble here through React; their Escape is theirs
    if (event.key === "Escape") {
      if (ref.current!.contains(event.target as Node)) onClose();
      return;
    }
    const row = event.target as HTMLElement;
    if (!row.hasAttribute("data-item")) return;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const item = row.closest<HTMLElement>("li[data-index]");
      const dir = item?.parentElement?.dataset.dir;
      if (!item || dir === undefined) return;
      const from = Number(item.dataset.index);
      const to = from + (event.key === "ArrowDown" ? 1 : -1);
      const siblings = childrenOf(nodes, dir);
      if (to < 0 || to >= siblings.length) return;
      event.preventDefault();
      void runNoticed({ type: "order", dir, order: moved(siblings, from, to) });
      return;
    }
    const rows = visibleRows(event.currentTarget);
    const index = rows.indexOf(row);
    const expanded = row.getAttribute("aria-expanded");
    let next: HTMLElement | null | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = rows[index + 1];
        break;
      case "ArrowUp":
        next = rows[index - 1];
        break;
      case "Home":
        next = rows[0];
        break;
      case "End":
        next = rows[rows.length - 1];
        break;
      case "ArrowRight":
        if (expanded === "false") row.click();
        else if (expanded === "true") next = rows[index + 1];
        break;
      case "ArrowLeft":
        if (expanded === "true") row.click();
        else next = row.closest("[data-panel]")?.parentElement?.querySelector("[data-folder]");
        break;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  };

  const remove = async () => {
    const node = confirm!;
    setConfirm(null);
    await runNoticed({ type: "delete", path: node.path });
  };

  return (
    <Tree.Provider value={ctx}>
      <aside
        {...stylex.props(styles.panel, files)}
        aria-label="Files"
        hidden={hidden}
        ref={ref}
        data-files=""
        onKeyDown={onKeyDown}
      >
        <div {...stylex.props(styles.head)}>
          <span {...stylex.props(styles.title)}>{root}</span>
          <RowMenu label={root} detail={`${root}/`} icon={Plus} shown>
            <AddItems dir="" />
          </RowMenu>
        </div>
        <Nodes dir="" nodes={nodes} depth={0} />
        {notice && (
          <p {...stylex.props(styles.notice)} role="alert">
            {notice}
          </p>
        )}
      </aside>
      <AlertDialog.Root open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialog.Portal container={container}>
          <AlertDialog.Backdrop {...stylex.props(chrome.backdrop)} />
          <AlertDialog.Viewport {...stylex.props(styles.confirmViewport)}>
            <AlertDialog.Popup {...stylex.props(chrome.surface, styles.confirm)}>
              <AlertDialog.Title {...stylex.props(styles.confirmTitle)}>
                Delete {confirm?.title}?
              </AlertDialog.Title>
              <AlertDialog.Description {...stylex.props(styles.confirmText)}>
                <code {...stylex.props(styles.code)}>{confirm?.path}</code> is removed from disk.
              </AlertDialog.Description>
              <div {...stylex.props(styles.actions)}>
                <AlertDialog.Close {...stylex.props(chrome.button)}>Cancel</AlertDialog.Close>
                <button
                  type="button"
                  {...stylex.props(chrome.button, styles.dangerButton)}
                  onClick={() => void remove()}
                >
                  Delete
                </button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Tree.Provider>
  );
});
