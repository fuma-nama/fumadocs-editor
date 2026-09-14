import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SyncClient } from "../../src/sync/client";
import { connect } from "./helpers";
import { createSyncServer, type SyncServer } from "../../src/sync/node/server";
import type { TreeNode, WorkspaceTree } from "../../src/sync/tree";

let root: string;
let http: Server;
let sync: SyncServer;
let port: number;

const until = async <T>(poll: () => T | undefined, ms = 4000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = poll();
    if (value !== undefined) return value;
    if (Date.now() - started > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const titles = (tree: WorkspaceTree) => {
  const out: string[] = [];
  for (const node of tree.nodes) if (node.type !== "link") out.push(node.title);
  return out;
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-tree-"));
  await mkdir(path.join(root, "content/guides"), { recursive: true });
  root = path.join(root, "content");
  await writeFile(path.join(root, "index.mdx"), "---\ntitle: Home\n---\n# Home\n");
  await writeFile(path.join(root, "guides/setup.mdx"), "# Setup\n");
  await writeFile(path.join(root, "meta.json"), JSON.stringify({ pages: ["guides", "index"] }));
  sync = createSyncServer({
    root,
    authenticate: ({ payload }) => {
      if (payload === "editor") return { write: true };
      return payload === "viewer" ? { write: false, read: (p) => !p.startsWith("guides/") } : null;
    },
  });
  http = createServer();
  http.on("upgrade", (request, socket, head) => {
    if (request.url === "/__fde_sync") sync.handleUpgrade(request, socket, head);
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  port = (http.address() as { port: number }).port;
});

afterAll(async () => {
  await sync.close();
  await new Promise((resolve) => http.close(resolve));
  await rm(path.dirname(root), { recursive: true, force: true });
});

const open = (token: string) => connect(`ws://127.0.0.1:${port}/__fde_sync`, () => token);

/** the tree as each transport sees it, latest last */
function follow(transport: SyncClient) {
  const seen: WorkspaceTree[] = [];
  const stop = transport.subscribe("tree", (tree) => seen.push(tree));
  return { seen, stop, latest: () => seen.at(-1) };
}

test("the tree applies the scope and follows the filesystem", async () => {
  const viewer = open("viewer");
  const editor = open("editor");
  const v = follow(viewer);
  const e = follow(editor);
  expect(await until(v.latest)).toEqual({
    root: "content",
    nodes: [{ type: "file", name: "index", path: "index.mdx", title: "Home" }],
  });
  expect(titles(await until(e.latest))).toEqual(["guides", "Home"]);

  await writeFile(path.join(root, "new.mdx"), "---\ntitle: New\n---\n");
  const grown = await until(() => (e.seen.length > 1 ? e.latest() : undefined));
  expect(titles(grown)).toEqual(["guides", "Home", "New"]);
  expect(titles(await until(() => (v.seen.length > 1 ? v.latest() : undefined)))).toEqual([
    "Home",
    "New",
  ]);

  v.stop();
  e.stop();
  viewer.close();
  editor.close();
}, 10_000);

test("commands need write access and a well-formed body", async () => {
  const viewer = open("viewer");
  await expect(viewer.request({ type: "order", dir: "", order: [] })).rejects.toThrow(
    /write denied: meta.json/,
  );
  await expect(
    viewer.request({ type: "create", path: "guides/x.mdx", title: "X" }),
  ).rejects.toThrow(/write denied/);
  viewer.close();

  const editor = open("editor");
  await expect(editor.request({ type: "order", dir: "" })).rejects.toThrow(/malformed/);
  await expect(
    editor.request({ type: "create", path: "../out.mdx", title: "Out" }),
  ).rejects.toThrow(/escapes/);
  editor.close();
});

test("create, order, mkdir and delete touch disk; subscribers see the tree before the reply", async () => {
  const editor = open("editor");
  const e = follow(editor);
  await until(e.latest);

  await editor.request({ type: "create", path: "guides/intro.mdx", title: "Intro" });
  const guides = e.latest()!.nodes[0] as Extract<TreeNode, { type: "folder" }>;
  expect(guides).toMatchObject({ type: "folder", name: "guides" });
  expect(titles({ root: "", nodes: guides.children })).toEqual(["Intro", "setup"]);
  expect(await readFile(path.join(root, "guides/intro.mdx"), "utf8")).toBe(
    "---\ntitle: Intro\n---\n",
  );

  await editor.request({ type: "order", dir: "", order: ["index", "---More---", "new", "guides"] });
  expect(JSON.parse(await readFile(path.join(root, "meta.json"), "utf8"))).toEqual({
    pages: ["index", "---More---", "new", "guides"],
  });
  expect(titles(e.latest()!)).toEqual(["Home", "More", "New", "guides"]);
  await expect(editor.request({ type: "order", dir: "", order: ["ghost"] })).rejects.toThrow(
    /no longer under/,
  );

  await editor.request({ type: "mkdir", dir: "reference", title: "Reference" });
  expect(await readFile(path.join(root, "reference/meta.json"), "utf8")).toBe(
    '{\n  "title": "Reference"\n}\n',
  );
  expect(JSON.parse(await readFile(path.join(root, "meta.json"), "utf8"))).toEqual({
    pages: ["index", "---More---", "new", "guides", "reference"],
  });

  await editor.request({ type: "delete", path: "guides/intro.mdx" });
  await expect(stat(path.join(root, "guides/intro.mdx"))).rejects.toThrow();
  await expect(editor.request({ type: "delete", path: "guides/intro.mdx" })).rejects.toThrow(
    /no page at/,
  );
  e.stop();
  editor.close();
});
