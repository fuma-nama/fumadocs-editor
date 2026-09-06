import { useEffect, useState, type CSSProperties } from "react";
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
      <button
        type="button"
        className="tree-item tree-folder"
        style={{ "--depth": depth } as CSSProperties}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={14} className="tree-chevron" aria-hidden />
        <span className="tree-label">{node.title}</span>
      </button>
      {open && (
        <Nodes nodes={node.children} active={active} onSelect={onSelect} depth={depth + 1} />
      )}
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
              <FileText size={14} className="tree-icon" aria-hidden />
              <span className="tree-label">{node.title}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

export function Sidebar(props: Omit<NodesProps, "depth">) {
  return <Nodes depth={0} {...props} />;
}
