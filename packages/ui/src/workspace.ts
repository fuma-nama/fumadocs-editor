"use client";
import type {
  ConnectionStatus,
  SyncTransport,
  TreeCommand,
  WorkspaceTree,
} from "@fumadocs-editor/core/sync";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadSync, sharedTransport } from "./transport";

export interface Workspace {
  /** the sidebar tree in `meta.json` order; null until the server answers */
  tree: WorkspaceTree | null;
  status: ConnectionStatus;
  /** creates, deletes and reorders; rejects with the server's reason */
  run: (command: TreeCommand) => Promise<void>;
}

export interface UseWorkspaceOptions {
  /** default: the shared websocket to the current host, as `sync` uses */
  transport?: SyncTransport;
}

const noop = () => {};

const workspaceOf = (transport: SyncTransport) => {
  if (!transport.tree || !transport.command) throw new Error("the transport has no workspace");
  return transport as Required<Pick<SyncTransport, "tree" | "command">>;
};

/**
 * The workspace behind `FileTree`: the tree follows the filesystem through
 * the transport's subscription, `run` changes it. Nothing here is React
 * specific beyond the subscription.
 */
export function useWorkspace({ transport }: UseWorkspaceOptions = {}): Workspace {
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("online");

  useEffect(() => {
    let stop = noop;
    let gone = false;
    const attach = (target: SyncTransport) => {
      if (gone) return;
      const stopTree = workspaceOf(target).tree(setTree);
      // the immediate report is the pre-connection state, not a failure
      let initial = true;
      const stopStatus =
        target.onStatus?.((next) => {
          if (initial) initial = false;
          else setStatus(next);
        }) ?? noop;
      stop = () => {
        stopTree();
        stopStatus();
      };
    };
    if (transport) attach(transport);
    else void loadSync().then((mod) => attach(sharedTransport(mod)));
    return () => {
      gone = true;
      stop();
      setTree(null);
    };
  }, [transport]);

  const run = useCallback(
    async (command: TreeCommand) => {
      const target = transport ?? sharedTransport(await loadSync());
      await workspaceOf(target).command(command);
    },
    [transport],
  );

  return useMemo(() => ({ tree, status, run }), [tree, status, run]);
}
