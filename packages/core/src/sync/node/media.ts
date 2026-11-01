import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Files } from "./files";
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

/** the storage's error stays on the server: it may name its paths */
const fail = (response: ServerResponse) => () => {
  // a stream that broke midway has sent its status: the cut is the error
  if (response.headersSent) return void response.destroy();
  response.statusCode = 500;
  response.end();
};

/** the HTTP media endpoints: uploads stored under `assets/`, assets served back */
export function createMediaHandlers(
  files: Files,
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
          // the random part keeps two uploads of one name in one millisecond apart
          const stamp = Date.now().toString(36) + randomBytes(2).toString("hex");
          const name = `${stamp}-${original || "upload"}`;
          const scope = await authorizeHttp(authorize, request);
          if (!scope || !scope.write(`assets/${name}`)) return refuse(response, scope);
          await files.storage.write(`assets/${name}`, Buffer.concat(chunks));
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ src: `./assets/${name}` }));
        })().catch(fail(response));
      });
    },

    handleAsset(request: IncomingMessage, response: ServerResponse) {
      let relative: string | undefined;
      try {
        relative = files.rel(decodeURIComponent((request.url ?? "/").slice(1)));
      } catch {}
      if (request.method !== "GET" || !relative) {
        response.statusCode = 404;
        return response.end();
      }
      const target = relative;
      void (async () => {
        const scope = await authorizeHttp(authorize, request);
        if (!scope || !scope.read(target)) return refuse(response, scope);
        const data = await files.storage.read(target);
        if (!data) {
          response.statusCode = 404;
          return response.end();
        }
        response.setHeader(
          "content-type",
          MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream",
        );
        await pipeline(data instanceof Uint8Array ? [data] : data, response);
      })().catch(fail(response));
    },
  };
}
