import path from "node:path";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { Plugin } from "vite";
import { createSyncServer } from "./node";

export const SYNC_ENDPOINT = "/__fde_sync";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/**
 * Mounts the FS mirror on the Vite dev server: the sync websocket at
 * `/__fde_sync`, media uploads at `/__fde_upload` (stored under
 * `<root>/assets`, referenced as `./assets/…`), and asset serving at
 * `/__fde_asset/<relative>` so the editor can display them.
 * `root` is resolved against the Vite project root and defaults to it.
 */
export function fdeSync(options: { root?: string } = {}): Plugin {
  return {
    name: "fde-sync",
    apply: "serve",
    configureServer(server) {
      const root = path.resolve(server.config.root, options.root ?? ".");
      const sync = createSyncServer({ root });
      server.httpServer?.on("upgrade", (request, socket, head) => {
        if (request.url === SYNC_ENDPOINT) sync.handleUpgrade(request, socket, head as Buffer);
      });
      server.httpServer?.once("close", () => void sync.close());

      const safe = (relative: string): string | null => {
        const absolute = path.resolve(root, relative);
        return absolute === root || absolute.startsWith(root + path.sep) ? absolute : null;
      };

      server.middlewares.use("/__fde_upload", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const original = decodeURIComponent(String(req.headers["x-filename"] ?? "upload"))
          .replace(/[^\w.-]+/g, "-")
          .replace(/^[-.]+/, "");
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          void (async () => {
            const name = `${Date.now().toString(36)}-${original || "upload"}`;
            await mkdir(path.join(root, "assets"), { recursive: true });
            await writeFile(path.join(root, "assets", name), Buffer.concat(chunks));
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ src: `./assets/${name}` }));
          })().catch((error) => {
            res.statusCode = 500;
            res.end(String(error));
          });
        });
      });

      server.middlewares.use("/__fde_asset", (req, res) => {
        const relative = decodeURIComponent((req.url ?? "/").slice(1));
        const absolute = safe(relative);
        if (req.method !== "GET" || !absolute) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader(
          "content-type",
          MIME[path.extname(absolute).toLowerCase()] ?? "application/octet-stream",
        );
        createReadStream(absolute)
          .on("error", () => {
            res.statusCode = 404;
            res.end();
          })
          .pipe(res);
      });
    },
  };
}
