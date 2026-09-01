import path from "node:path";
import type { Plugin } from "vite";
import { createSyncServer, type SyncAuthenticate } from "./node";

export const SYNC_ENDPOINT = "/__fde_sync";

/**
 * Mounts the FS mirror on the Vite dev server: the sync websocket at
 * `/__fde_sync`, media uploads at `/__fde_upload` (stored under
 * `<root>/assets`, referenced as `./assets/…`), and asset serving at
 * `/__fde_asset/<relative>` so the editor can display them.
 * `root` is resolved against the Vite project root and defaults to it.
 * `authenticate` guards every surface (see {@link SyncAuthenticate});
 * absent, everything is allowed.
 */
export function fdeSync(options: { root?: string; authenticate?: SyncAuthenticate } = {}): Plugin {
  return {
    name: "fde-sync",
    apply: "serve",
    configureServer(server) {
      const root = path.resolve(server.config.root, options.root ?? ".");
      const sync = createSyncServer({ root, authenticate: options.authenticate });
      server.httpServer?.on("upgrade", (request, socket, head) => {
        if (request.url === SYNC_ENDPOINT) sync.handleUpgrade(request, socket, head as Buffer);
      });
      server.httpServer?.once("close", () => void sync.close());
      server.middlewares.use("/__fde_upload", sync.handleUpload);
      server.middlewares.use("/__fde_asset", sync.handleAsset);
    },
  };
}
