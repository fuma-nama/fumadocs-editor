import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight, FileText } from "lucide-react";
import type { TreeNode } from "./protocol";

interface NodesProps {
  nodes: TreeNode[];
  depth: number;
  active: string | null;
  onSelect: (path: string) => void;
}

function Folder({
  node,
  active,
  onSelect,
  depth,
}: Omit<NodesProps, "nodes"> & {
  node: Extract<TreeNode, { type: "folder" }>;
}) {
  const holdsActive = active !== null && active.startsWith(`${node.path}/`);
  const [open, setOpen] = useState(holdsActive);
  useEffect(() => {
    if (holdsActive) setOpen(true);
  }, [holdsActive]);
  return (
    <li>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger
          className="tree-item tree-folder"
          style={{ "--depth": depth } as CSSProperties}
        >
          <ChevronRight size={14} className="tree-chevron" aria-hidden />
          <span className="tree-label">{node.title}</span>
        </Collapsible.Trigger>
        <Collapsible.Panel className="tree-panel">
          <Nodes nodes={node.children} active={active} onSelect={onSelect} depth={depth + 1} />
        </Collapsible.Panel>
      </Collapsible.Root>
    </li>
  );
}

function Nodes({ nodes, depth, ...rest }: NodesProps) {
  return (
    <ul className="tree">
      {nodes.map((node, index) =>
        node.type === "separator" ? (
          <li
            key={`separator-${index}`}
            className="tree-separator"
            style={{ "--depth": depth } as CSSProperties}
          >
            {node.title}
          </li>
        ) : node.type === "folder" ? (
          <Folder key={`${node.path}/`} node={node} depth={depth} {...rest} />
        ) : (
          <li key={node.path}>
            <button
              type="button"
              className="tree-item"
              style={{ "--depth": depth } as CSSProperties}
              aria-current={node.path === rest.active ? "page" : undefined}
              onClick={() => rest.onSelect(node.path)}
            >
              <FileText size={15} className="tree-icon" aria-hidden />
              <span className="tree-label">{node.title}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

export interface FilePanelProps extends Omit<NodesProps, "depth"> {
  /** basename of the content directory */
  root: string;
  hidden: boolean;
  onClose: () => void;
}

/** the rows currently on screen, in reading order */
function visibleRows(panel: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const row of panel.querySelectorAll<HTMLElement>(".tree-item")) {
    if (row.offsetParent !== null) rows.push(row);
  }
  return rows;
}

/**
 * The floating file list; stays until toggled. Opening focuses the open
 * file's row; arrows move between rows, left and right close and open a
 * folder, Escape closes the list.
 */
export function FilePanel({ root, hidden, onClose, ...props }: FilePanelProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (hidden) return;
    const panel = ref.current!;
    const row = panel.querySelector<HTMLElement>('[aria-current="page"]') ?? visibleRows(panel)[0];
    row?.focus();
  }, [hidden]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") return onClose();
    const row = event.target as HTMLElement;
    if (!row.classList.contains("tree-item")) return;
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
        else next = row.closest(".tree-panel")?.parentElement?.querySelector(".tree-folder");
        break;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  };

  return (
    <aside className="files" aria-label="Files" hidden={hidden} ref={ref} onKeyDown={onKeyDown}>
      <div className="files-head">{root}</div>
      <Nodes depth={0} {...props} />
    </aside>
  );
}
