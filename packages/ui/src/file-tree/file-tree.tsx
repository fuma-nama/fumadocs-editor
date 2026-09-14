"use client";
import * as stylex from "@stylexjs/stylex";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { TreeCommand, TreeNode, WorkspaceTree } from "@fumadocs-editor/core/sync";
import { Plus } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from "react";
import { fileTree } from "../styles/markers.stylex";
import { chrome } from "../styles/shared";
import { TreeContext, type Draft, type FileNode, type TreeContextValue } from "./context";
import { AddItems, RowMenu, moved } from "./menu";
import { Rows } from "./rows";
import { styles } from "./styles";

export interface FileTreeProps {
  tree: WorkspaceTree;
  /** applies a change; a rejection is shown in the tree */
  run: (command: TreeCommand) => Promise<void>;
  /** the open file, highlighted; its folders open */
  active: string | null;
  onSelect: (path: string) => void;
  /**
   * Portal target for the row menus and the delete dialog. Default: the
   * tree itself; pass an ancestor when the tree sits in a transformed or
   * animated container.
   */
  container?: RefObject<HTMLElement | null>;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

const NOTICE_MS = 6000;

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

/** the rows on screen, in reading order */
function visibleRows(root: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const row of root.querySelectorAll<HTMLElement>("[data-item]")) {
    if (row.offsetParent !== null) rows.push(row);
  }
  return rows;
}

/**
 * The workspace as an editable sidebar: pages and folders in `meta.json`
 * order. Rows drag within their folder (from the grip on touch); the row
 * menus create pages, folders and separators, move, rename and delete.
 * Arrows move between rows, left and right close and open a folder, Alt
 * with up or down moves a row.
 */
export const FileTree = memo(function FileTree({
  tree,
  run,
  active,
  onSelect,
  container,
  className,
  ref,
}: FileTreeProps) {
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => root.current!, []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<FileNode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const context = useMemo<TreeContextValue>(
    () => ({
      active,
      onSelect,
      run: runNoticed,
      draft,
      setDraft,
      askDelete: setConfirm,
      container: container ?? root,
      root,
      line,
    }),
    [active, onSelect, runNoticed, draft, container],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const row = event.target as HTMLElement;
    if (!row.hasAttribute("data-item")) return;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const item = row.closest<HTMLElement>("li[data-index]");
      const dir = item?.parentElement?.dataset.dir;
      if (!item || dir === undefined) return;
      const from = Number(item.dataset.index);
      const to = from + (event.key === "ArrowDown" ? 1 : -1);
      const siblings = childrenOf(tree.nodes, dir);
      if (to < 0 || to >= siblings.length) return;
      event.preventDefault();
      void runNoticed({ type: "order", dir, order: moved(siblings, from, to) });
      return;
    }
    const rows = visibleRows(root.current!);
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

  const remove = () => {
    const node = confirm!;
    setConfirm(null);
    void runNoticed({ type: "delete", path: node.path });
  };

  let rootClass = stylex.props(styles.root, fileTree).className!;
  if (className) rootClass += ` ${className}`;

  return (
    <TreeContext.Provider value={context}>
      <div ref={root} className={rootClass} data-fde-file-tree="" onKeyDown={onKeyDown}>
        <div {...stylex.props(styles.head)}>
          <span {...stylex.props(styles.title)}>{tree.root}</span>
          <RowMenu label={tree.root} detail={`${tree.root}/`} icon={Plus} shown>
            <AddItems dir="" />
          </RowMenu>
        </div>
        <Rows dir="" nodes={tree.nodes} depth={0} />
        <div ref={line} {...stylex.props(styles.line)} hidden />
        {notice && (
          <p {...stylex.props(styles.notice)} role="alert">
            {notice}
          </p>
        )}
      </div>
      <AlertDialog.Root open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialog.Portal container={container ?? root}>
          <AlertDialog.Backdrop {...stylex.props(styles.backdrop)} />
          <AlertDialog.Viewport {...stylex.props(styles.viewport)}>
            <AlertDialog.Popup {...stylex.props(chrome.popup, styles.confirm)}>
              <AlertDialog.Title {...stylex.props(styles.confirmTitle)}>
                Delete {confirm?.title}?
              </AlertDialog.Title>
              <AlertDialog.Description {...stylex.props(styles.confirmText)}>
                <code {...stylex.props(styles.code)}>{confirm?.path}</code> will be removed from
                disk.
              </AlertDialog.Description>
              <div {...stylex.props(styles.actions)}>
                <AlertDialog.Close {...stylex.props(styles.button)}>Cancel</AlertDialog.Close>
                <button
                  type="button"
                  {...stylex.props(styles.button, styles.dangerButton)}
                  onClick={remove}
                >
                  Delete
                </button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </TreeContext.Provider>
  );
});
