"use client";
import type { TreeCommand, TreeNode } from "@fumadocs-editor/core/sync";
import { createContext, useContext, type RefObject } from "react";

export type FileNode = Extract<TreeNode, { type: "file" }>;
export type FolderNode = Extract<TreeNode, { type: "folder" }>;
export type SeparatorNode = Extract<TreeNode, { type: "separator" }>;

/** the row being typed: a new entry at the end of `dir`, or the separator at `at` renamed */
export interface Draft {
  dir: string;
  kind: "page" | "folder" | "separator";
  at?: number;
}

export interface TreeContextValue {
  active: string | null;
  onSelect: (path: string) => void;
  /** runs a command; a refusal is shown in the tree and reported as false */
  run: (command: TreeCommand) => Promise<boolean>;
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
  askDelete: (node: FileNode) => void;
  /** portal target for menus and dialogs */
  container: RefObject<HTMLElement | null>;
  root: RefObject<HTMLDivElement | null>;
  /** the drop indicator a drag positions */
  line: RefObject<HTMLDivElement | null>;
}

export const TreeContext = createContext<TreeContextValue>(null!);

export const useTree = () => useContext(TreeContext);
