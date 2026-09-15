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
  /** default: the shared client, as `sync` uses */
  client?: SyncClient;
}

const noop = () => {};

/** the workspace behind `FileTree`: the client's tree and its commands */
export function useWorkspace({ client }: UseWorkspaceOptions = {}): Workspace {
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    let stop = noop;
    let gone = false;
    const attach = (target: SyncClient) => {
      if (gone) return;
      const stopTree = target.onTree(setTree);
      const stopStatus = target.onStatus(setStatus);
      setTree(target.tree());
      setStatus(target.status());
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
      await (client ?? sharedClient(await loadSync())).run(command);
    },
    [client],
  );

  return useMemo(() => ({ tree, status, run }), [tree, status, run]);
}
