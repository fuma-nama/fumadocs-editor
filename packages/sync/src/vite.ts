import path from "node:path";
import type { Plugin } from "vite";
import { createSyncServer } from "./node";

export const SYNC_ENDPOINT = "/__fde_sync";

/**
 * Mounts the FS-mirror websocket on the Vite dev server at `/__fde_sync`.
 * `root` is resolved against the Vite project root and defaults to it.
 */
export function fdeSync(options: { root?: string } = {}): Plugin {
  return {
    name: "fde-sync",
    apply: "serve",
    configureServer(server) {
      const sync = createSyncServer({
        root: path.resolve(server.config.root, options.root ?? "."),
      });
      server.httpServer?.on("upgrade", (request, socket, head) => {
        if (request.url === SYNC_ENDPOINT) sync.handleUpgrade(request, socket, head as Buffer);
      });
      server.httpServer?.once("close", () => void sync.close());
    },
  };
}
