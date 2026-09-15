import type { ClientMessage, ServerMessage } from "@fumadocs-editor/core/sync";

declare function client(message: ClientMessage): void;
declare function server(message: ServerMessage): void;
declare const bytes: Uint8Array;

//#region hello
client({ type: "hello", id: 0, protocol: 1, auth: "token" });
server({ type: "hello", id: 0, user: { name: "Ada" } });
//#endregion

//#region file
client({ type: "subscribe", id: 1, resource: "file", path: "index.mdx" });
server({
  type: "update",
  id: 1,
  resource: "file",
  path: "index.mdx",
  text: "# Hello",
  version: "v1",
  writable: true,
});

client({ type: "update", id: 2, resource: "file", path: "index.mdx", text: "# Hi", base: "v1" });
// saved
server({ type: "update", id: 2, resource: "file", path: "index.mdx", version: "v2" });
// or, when `base` is stale: the file as it is now
server({
  type: "update",
  id: 2,
  resource: "file",
  path: "index.mdx",
  text: "# Hey",
  version: "v3",
});
//#endregion

//#region tree
client({ type: "subscribe", id: 3, resource: "tree" });
server({ type: "update", id: 3, resource: "tree", tree: { root: "docs", nodes: [] } });

client({
  type: "update",
  id: 4,
  resource: "tree",
  command: { type: "create", path: "guide.mdx", title: "Guide" },
});
server({
  type: "update",
  id: 4,
  resource: "tree",
  tree: {
    root: "docs",
    nodes: [{ type: "file", name: "guide", path: "guide.mdx", title: "Guide" }],
  },
});
//#endregion

//#region doc
// 1. join with the local state vector and the editor's syntax
client({
  type: "subscribe",
  id: 5,
  resource: "doc",
  path: "index.mdx",
  vector: bytes,
  components: [],
  syntax: { math: true },
});
// 2. the server's state, and the updates the client is missing
server({
  type: "update",
  id: 5,
  resource: "doc",
  path: "index.mdx",
  text: "# Hello",
  epoch: "e1",
  writable: true,
  vector: bytes,
  yjs: bytes,
});
// 3. the updates the server is missing, then presence
client({ type: "update", resource: "doc", path: "index.mdx", yjs: bytes });
client({ type: "update", resource: "doc", path: "index.mdx", awareness: bytes });
// 4. from now on, edits and presence flow both ways
server({ type: "update", resource: "doc", path: "index.mdx", yjs: bytes });
//#endregion
