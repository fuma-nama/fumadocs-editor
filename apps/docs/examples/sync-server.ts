import { createServer } from "node:http";
import { createSyncServer } from "@fumadocs-editor/core/node";

const sync = createSyncServer({ root: "content/docs" });

const server = createServer((request, response) => {
  const url = request.url ?? "/";
  if (url.startsWith("/upload")) return sync.handleUpload(request, response);
  if (url.startsWith("/assets/")) {
    // handleAsset reads the path after the mount prefix, like a middleware
    request.url = url.slice("/assets".length);
    return sync.handleAsset(request, response);
  }
  response.statusCode = 404;
  response.end();
});

server.on("upgrade", (request, socket, head) => {
  if (request.url === "/sync") sync.handleUpgrade(request, socket, head);
});

server.listen(3100);
