"use client";
import * as stylex from "@stylexjs/stylex";
import { Collapsible } from "@base-ui/react/collapsible";
import { pagesEntry, type TreeNode } from "@fumadocs-editor/core/sync";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Folder as FolderIcon,
  GripVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { fileFolder, fileRow } from "../styles/markers.stylex";
import { useTree, type Draft, type FileNode, type FolderNode, type SeparatorNode } from "./context";
import { dragRow } from "./drag";
import { AddItems, Item, MenuSeparator, MoveItems, RowMenu, moved } from "./menu";
import { styles } from "./styles";

type Drag = (event: ReactPointerEvent<HTMLElement>, index: number) => void;

interface RowProps<N extends TreeNode> {
  dir: string;
  nodes: TreeNode[];
  node: N;
  index: number;
  depth: number;
  drag: Drag;
}

const depthStyle = (depth: number) => ({ "--depth": depth }) as CSSProperties;
/** touch drags from the grip; the mouse drags any row directly */
const mouse = (event: ReactPointerEvent<HTMLElement>) => event.pointerType === "mouse";

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

/** the row chrome around a node's own control: hover reveals the grip and menu */
function Row({
  label,
  detail,
  index,
  onDrag,
  menu,
  children,
}: {
  label: string;
  detail: string;
  index: number;
  onDrag: Drag;
  menu: ReactNode;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.row, fileRow)} data-row="">
      {children}
      <span
        {...stylex.props(styles.control, styles.grip)}
        aria-hidden
        onPointerDown={(event) => {
          event.preventDefault();
          onDrag(event, index);
        }}
      >
        <GripVertical size={14} />
      </span>
      <RowMenu label={label} detail={detail}>
        {menu}
      </RowMenu>
    </div>
  );
}

function FileRow({ dir, nodes, node, index, depth, drag }: RowProps<FileNode>) {
  const { active, onSelect, askDelete } = useTree();
  return (
    <li data-index={index}>
      <Row
        label={node.title}
        detail={node.path}
        index={index}
        onDrag={drag}
        menu={
          <>
            <MoveItems dir={dir} nodes={nodes} index={index} />
            <Item
              icon={Copy}
              label="Copy path"
              onClick={() => void navigator.clipboard.writeText(node.path)}
            />
            <MenuSeparator />
            <Item icon={Trash2} label="Delete page…" danger onClick={() => askDelete(node)} />
          </>
        }
      >
        <button
          type="button"
          {...stylex.props(styles.item)}
          style={depthStyle(depth)}
          data-item=""
          aria-current={node.path === active ? "page" : undefined}
          onClick={() => onSelect(node.path)}
          onPointerDown={(event) => mouse(event) && drag(event, index)}
        >
          <FileText size={15} {...stylex.props(styles.icon)} aria-hidden />
          <span {...stylex.props(styles.label)}>{node.title}</span>
        </button>
      </Row>
    </li>
  );
}

function FolderRow({ dir, nodes, node, index, depth, drag }: RowProps<FolderNode>) {
  const { active } = useTree();
  const holdsActive = active !== null && active.startsWith(`${node.path}/`);
  const [open, setOpen] = useState(holdsActive);
  const [held, setHeld] = useState(holdsActive);
  if (holdsActive !== held) {
    setHeld(holdsActive);
    if (holdsActive) setOpen(true);
  }
  return (
    <li data-index={index}>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Row
          label={node.title}
          detail={`${node.path}/`}
          index={index}
          onDrag={drag}
          menu={
            <>
              <AddItems dir={node.path} onOpen={() => setOpen(true)} />
              <MenuSeparator />
              <MoveItems dir={dir} nodes={nodes} index={index} />
            </>
          }
        >
          <Collapsible.Trigger
            {...stylex.props(styles.item, styles.folder, fileFolder)}
            style={depthStyle(depth)}
            data-item=""
            data-folder=""
            onPointerDown={(event) => mouse(event) && drag(event, index)}
          >
            <ChevronRight size={14} {...stylex.props(styles.chevron)} aria-hidden />
            <span {...stylex.props(styles.label)}>{node.title}</span>
          </Collapsible.Trigger>
        </Row>
        <Collapsible.Panel {...stylex.props(styles.collapse)} data-panel="">
          <Rows dir={node.path} nodes={node.children} depth={depth + 1} />
        </Collapsible.Panel>
      </Collapsible.Root>
    </li>
  );
}

function SeparatorRow({ dir, nodes, node, index, depth, drag }: RowProps<SeparatorNode>) {
  const { run, setDraft } = useTree();
  const rename = () => setDraft({ dir, kind: "separator", at: index });
  const remove = () => {
    const order: string[] = [];
    for (let i = 0; i < nodes.length; i++) if (i !== index) order.push(pagesEntry(nodes[i]));
    void run({ type: "order", dir, order });
  };
  return (
    <li data-index={index}>
      <Row
        label={node.title || "separator"}
        detail={pagesEntry(node)}
        index={index}
        onDrag={drag}
        menu={
          <>
            <Item icon={Pencil} label="Rename" onClick={rename} />
            <MoveItems dir={dir} nodes={nodes} index={index} />
            <MenuSeparator />
            <Item icon={Trash2} label="Delete" danger onClick={remove} />
          </>
        }
      >
        <div
          {...stylex.props(styles.item, styles.separator)}
          tabIndex={0}
          style={depthStyle(depth)}
          data-item=""
          onPointerDown={(event) => mouse(event) && drag(event, index)}
          onDoubleClick={rename}
        >
          <span {...stylex.props(styles.label)}>{node.title || "—"}</span>
        </div>
      </Row>
    </li>
  );
}

function LinkRow({
  dir,
  nodes,
  node,
  index,
  depth,
  drag,
}: RowProps<Extract<TreeNode, { type: "link" }>>) {
  const { run } = useTree();
  const remove = () => {
    const order: string[] = [];
    for (let i = 0; i < nodes.length; i++) if (i !== index) order.push(pagesEntry(nodes[i]));
    void run({ type: "order", dir, order });
  };
  return (
    <li data-index={index}>
      <Row
        label={node.title}
        detail={pagesEntry(node)}
        index={index}
        onDrag={drag}
        menu={
          <>
            <Item
              icon={ExternalLink}
              label="Open link"
              onClick={() => window.open(node.url, "_blank", "noreferrer")}
            />
            <MoveItems dir={dir} nodes={nodes} index={index} />
            <MenuSeparator />
            <Item icon={Trash2} label="Delete" danger onClick={remove} />
          </>
        }
      >
        <a
          {...stylex.props(styles.item)}
          href={node.url}
          target="_blank"
          rel="noreferrer"
          draggable={false}
          style={depthStyle(depth)}
          data-item=""
          onPointerDown={(event) => mouse(event) && drag(event, index)}
        >
          <ExternalLink size={15} {...stylex.props(styles.icon)} aria-hidden />
          <span {...stylex.props(styles.label)}>{node.title}</span>
        </a>
      </Row>
    </li>
  );
}

/** the inline input a new page, folder or separator (or a renamed one) is typed into */
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
  const { run, setDraft, onSelect } = useTree();
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
      const order: string[] = [];
      for (const node of nodes) order.push(pagesEntry(node));
      const entry = pagesEntry({ type: "separator", title, icon: renamed?.icon });
      if (draft.at === undefined) order.push(entry);
      else order[draft.at] = entry;
      done = await run({ type: "order", dir, order });
    }
    if (done) setDraft(null);
    else setBusy(false);
  };

  const label = kind === "page" ? "Page title" : kind === "folder" ? "Folder name" : "Separator";
  return (
    <li>
      <div {...stylex.props(styles.row, fileRow)} data-row="">
        <div {...stylex.props(styles.item, styles.edit)} style={depthStyle(depth)} data-item="">
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
        <div {...stylex.props(styles.hint)} style={depthStyle(depth)}>
          {hint}
        </div>
      )}
    </li>
  );
}

/** one folder's rows; each folder nests its own list, so drags stay within a folder */
export function Rows({ dir, nodes, depth }: { dir: string; nodes: TreeNode[]; depth: number }) {
  const { draft, run, root, line } = useTree();
  const list = useRef<HTMLUListElement>(null);
  const swallowClick = useRef(false);

  const drag: Drag = (event, index) => {
    if (event.button !== 0 || draft) return;
    dragRow(event.nativeEvent, {
      root: root.current!,
      list: list.current!,
      line: line.current!,
      from: index,
      handle: event.currentTarget,
      onLift: () => {
        swallowClick.current = true;
      },
      onDrop: (to) => {
        const at = to > index ? to - 1 : to;
        if (at !== index) void run({ type: "order", dir, order: moved(nodes, index, at) });
      },
    });
  };

  const own = draft?.dir === dir ? draft : null;
  const rows: ReactNode[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (own?.at === index) {
      rows.push(<DraftRow key="draft" dir={dir} draft={own} nodes={nodes} depth={depth} />);
      continue;
    }
    const props = { dir, nodes, index, depth, drag };
    if (node.type === "folder") {
      rows.push(<FolderRow key={`${node.path}/`} node={node} {...props} />);
    } else if (node.type === "file") {
      rows.push(<FileRow key={node.path} node={node} {...props} />);
    } else if (node.type === "separator") {
      rows.push(<SeparatorRow key={`separator-${index}`} node={node} {...props} />);
    } else {
      rows.push(<LinkRow key={`link-${index}`} node={node} {...props} />);
    }
  }
  if (own && own.at === undefined) {
    rows.push(<DraftRow key="draft" dir={dir} draft={own} nodes={nodes} depth={depth} />);
  }

  return (
    <ul
      {...stylex.props(styles.list)}
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
