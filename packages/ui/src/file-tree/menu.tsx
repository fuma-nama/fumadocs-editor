"use client";
import * as stylex from "@stylexjs/stylex";
import { Menu } from "@base-ui/react/menu";
import { pagesEntry, type TreeNode } from "@fumadocs-editor/core/sync";
import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  FilePlus,
  FolderPlus,
  Minus,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { chrome } from "../styles/shared";
import { fileMenuItem } from "../styles/markers.stylex";
import { useTree, type Draft } from "./context";
import { styles } from "./styles";

const altKey = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌥" : "Alt+";

/** the folder's `pages` entries with the row at `from` moved to `to` */
export function moved(nodes: TreeNode[], from: number, to: number): string[] {
  const order: string[] = [];
  for (const node of nodes) order.push(pagesEntry(node));
  order.splice(to, 0, ...order.splice(from, 1));
  return order;
}

export function RowMenu({
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
  const { container } = useTree();
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
          positionMethod="fixed"
          side="bottom"
          align="end"
          sideOffset={4}
          {...stylex.props(chrome.layer)}
        >
          <Menu.Popup {...stylex.props(chrome.popup, styles.menu)}>
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

export function Item({
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
      {...stylex.props(chrome.item, styles.menuItem, danger && styles.danger, fileMenuItem)}
      data-danger={danger || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden {...stylex.props(chrome.itemIcon, styles.menuIcon)} />
      <span {...stylex.props(styles.menuText)}>{label}</span>
      {keys && <kbd {...stylex.props(styles.keys)}>{keys}</kbd>}
    </Menu.Item>
  );
}

export const MenuSeparator = () => <Menu.Separator {...stylex.props(styles.menuSeparator)} />;

/** start a draft at the end of `dir` */
export function AddItems({ dir, onOpen }: { dir: string; onOpen?: () => void }) {
  const { setDraft } = useTree();
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

/** move the row within its folder, the menu twin of Alt + arrows */
export function MoveItems({
  dir,
  nodes,
  index,
}: {
  dir: string;
  nodes: TreeNode[];
  index: number;
}) {
  const { run } = useTree();
  const move = (to: number) => void run({ type: "order", dir, order: moved(nodes, index, to) });
  const alt = altKey();
  return (
    <>
      <Item
        icon={ArrowUp}
        label="Move up"
        keys={`${alt}↑`}
        disabled={index === 0}
        onClick={() => move(index - 1)}
      />
      <Item
        icon={ArrowDown}
        label="Move down"
        keys={`${alt}↓`}
        disabled={index === nodes.length - 1}
        onClick={() => move(index + 1)}
      />
    </>
  );
}
