import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Mirror } from "./mirror";
import { authorizeHttp, type Authorize, type Scope } from "./scope";

export interface UploadLimits {
  maxBytes?: number;
  types?: RegExp;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

const refuse = (response: ServerResponse, scope: Scope | null) => {
  response.statusCode = scope ? 403 : 401;
  response.end();
};

/** the HTTP media endpoints: uploads stored under `assets/`, assets served back */
export function createMediaHandlers(
  mirror: Mirror,
  authorize: Authorize,
  { maxBytes = 10 * 1024 * 1024, types = /^image\// }: UploadLimits,
) {
  return {
    handleUpload(request: IncomingMessage, response: ServerResponse) {
      if (request.method !== "POST") {
        response.statusCode = 405;
        return response.end();
      }
      // limits come before auth and long before the write: type from the
      // header (fetch derives it from the File), size streamed, so an
      // oversized body is refused without ever being buffered whole
      const type = request.headers["content-type"];
      if (!type || !types.test(type)) {
        response.statusCode = 415;
        return response.end();
      }
      if (Number(request.headers["content-length"]) > maxBytes) {
        response.statusCode = 413;
        return response.end();
      }
      const original = decodeURIComponent(String(request.headers["x-filename"] ?? "upload"))
        .replace(/[^\w.-]+/g, "-")
        .replace(/^[-.]+/, "");
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        if (response.writableEnded) return;
        size += chunk.length;
        if (size > maxBytes) {
          // respond early and drain the rest; destroying the socket here
          // would truncate the status before the client reads it
          chunks.length = 0;
          response.statusCode = 413;
          response.end();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        if (response.writableEnded) return;
        void (async () => {
          const name = `${Date.now().toString(36)}-${original || "upload"}`;
          const scope = await authorizeHttp(authorize, request);
          if (!scope || !scope.write(`assets/${name}`)) return refuse(response, scope);
          await mkdir(path.join(mirror.root, "assets"), { recursive: true });
          await writeFile(path.join(mirror.root, "assets", name), Buffer.concat(chunks));
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ src: `./assets/${name}` }));
        })().catch((error) => {
          response.statusCode = 500;
          response.end(String(error));
        });
      });
    },

    handleAsset(request: IncomingMessage, response: ServerResponse) {
      let relative: string | undefined;
      try {
        relative = mirror.rel(decodeURIComponent((request.url ?? "/").slice(1)));
      } catch {}
      if (request.method !== "GET" || !relative) {
        response.statusCode = 404;
        return response.end();
      }
      const target = relative;
      void authorizeHttp(authorize, request).then((scope) => {
        if (!scope || !scope.read(target)) return refuse(response, scope);
        response.setHeader(
          "content-type",
          MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream",
        );
        createReadStream(mirror.resolve(target))
          .on("error", () => {
            response.statusCode = 404;
            response.end();
          })
          .pipe(response);
      });
    },
  };
}
