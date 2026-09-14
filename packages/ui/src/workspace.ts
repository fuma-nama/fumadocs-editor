"use client";
import type {
  ConnectionStatus,
  SyncClient,
  TreeCommand,
  WorkspaceTree,
} from "@fumadocs-editor/core/sync";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadSync, sharedClient } from "./client";

export interface Workspace {
  /** the sidebar tree in `meta.json` order; null until the server answers */
  tree: WorkspaceTree | null;
  status: ConnectionStatus;
  /** creates, deletes and reorders; rejects with the server's reason */
  run: (command: TreeCommand) => Promise<void>;
}

export interface UseWorkspaceOptions {
  /** default: the shared connection to the current host, as `sync` uses */
  client?: SyncClient;
}

const noop = () => {};

/**
 * The workspace behind `FileTree`: the tree follows the filesystem through
 * the client's subscription, `run` changes it.
 */
export function useWorkspace({ client }: UseWorkspaceOptions = {}): Workspace {
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("online");

  useEffect(() => {
    let stop = noop;
    let gone = false;
    const attach = (target: SyncClient) => {
      if (gone) return;
      const stopTree = target.subscribe("tree", setTree);
      // the immediate report is the pre-connection state, not a failure
      let initial = true;
      const stopStatus = target.onStatus((next) => {
        if (initial) initial = false;
        else setStatus(next);
      });
      stop = () => {
        stopTree();
        stopStatus();
      };
    };
    if (client) attach(client);
    else void loadSync().then((mod) => attach(sharedClient(mod)));
    return () => {
      gone = true;
      stop();
      setTree(null);
    };
  }, [client]);

  const run = useCallback(
    async (command: TreeCommand) => {
      const target = client ?? sharedClient(await loadSync());
      await target.request<void>(command);
    },
    [client],
  );

  return useMemo(() => ({ tree, status, run }), [tree, status, run]);
}
