import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SyncClient } from "../../src/sync/client";
import type { TreeNode, WorkspaceTree } from "../../src/sync/tree";
import { connect, peer, serve, until } from "./helpers";

let root: string;
let server: Awaited<ReturnType<typeof serve>>;

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
  server = await serve({
    root,
    authenticate: ({ payload }) => {
      if (payload === "editor") return { write: true };
      return payload === "viewer" ? { write: false, read: (p) => !p.startsWith("guides/") } : null;
    },
  });
});

afterAll(async () => {
  await server.close();
  await rm(path.dirname(root), { recursive: true, force: true });
});

const open = (token: string) => connect(server.url, { auth: () => token });

/** the tree as each client sees it, latest last */
function follow(client: SyncClient) {
  const seen: WorkspaceTree[] = [];
  const stop = client.onTree((tree) => seen.push(tree));
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
  expect(viewer.tree()).toEqual(v.latest());

  v.stop();
  e.stop();
  expect(viewer.tree()).toBeNull();
  viewer.close();
  editor.close();
}, 10_000);

test("commands need write access and a well-formed body", async () => {
  const viewer = open("viewer");
  await until(() => (viewer.status() === "online" ? true : undefined));
  await expect(viewer.run({ type: "order", dir: "", order: [] })).rejects.toThrow(
    /write denied: meta.json/,
  );
  await expect(viewer.run({ type: "create", path: "guides/x.mdx", title: "X" })).rejects.toThrow(
    /write denied/,
  );
  viewer.close();

  const editor = await peer(server.url, "editor");
  await editor.hello();
  expect(
    await editor.request({ type: "update", resource: "tree", command: { type: "order", dir: "" } }),
  ).toMatchObject({ type: "error", message: "malformed message" });
  expect(
    await editor.request({
      type: "update",
      resource: "tree",
      command: { type: "create", path: "../out.mdx", title: "Out" },
    }),
  ).toMatchObject({ type: "error", message: expect.stringMatching(/escapes/) });
  editor.close();
});

test("create, order, mkdir and delete touch disk; the answer carries the new tree", async () => {
  const editor = open("editor");
  const e = follow(editor);
  await until(e.latest);

  await editor.run({ type: "create", path: "guides/intro.mdx", title: "Intro" });
  const guides = e.latest()!.nodes[0] as Extract<TreeNode, { type: "folder" }>;
  expect(guides).toMatchObject({ type: "folder", name: "guides" });
  expect(titles({ root: "", nodes: guides.children })).toEqual(["Intro", "setup"]);
  expect(await readFile(path.join(root, "guides/intro.mdx"), "utf8")).toBe(
    "---\ntitle: Intro\n---\n",
  );

  await editor.run({ type: "order", dir: "", order: ["index", "---More---", "new", "guides"] });
  expect(JSON.parse(await readFile(path.join(root, "meta.json"), "utf8"))).toEqual({
    pages: ["index", "---More---", "new", "guides"],
  });
  expect(titles(e.latest()!)).toEqual(["Home", "More", "New", "guides"]);
  await expect(editor.run({ type: "order", dir: "", order: ["ghost"] })).rejects.toThrow(
    /no longer under/,
  );

  await editor.run({ type: "mkdir", dir: "reference", title: "Reference" });
  expect(await readFile(path.join(root, "reference/meta.json"), "utf8")).toBe(
    '{\n  "title": "Reference"\n}\n',
  );
  expect(JSON.parse(await readFile(path.join(root, "meta.json"), "utf8"))).toEqual({
    pages: ["index", "---More---", "new", "guides", "reference"],
  });

  await editor.run({ type: "delete", path: "guides/intro.mdx" });
  await expect(stat(path.join(root, "guides/intro.mdx"))).rejects.toThrow();
  await expect(editor.run({ type: "delete", path: "guides/intro.mdx" })).rejects.toThrow(
    /no page at/,
  );
  e.stop();
  editor.close();
});

test("a watcher hears another client's command as a push", async () => {
  const watcher = open("editor");
  const w = follow(watcher);
  await until(w.latest);
  const editor = open("editor");
  await until(() => (editor.status() === "online" ? true : undefined));
  await editor.run({ type: "create", path: "pushed.mdx", title: "Pushed" });
  await until(() => (w.latest() && titles(w.latest()!).includes("Pushed") ? true : undefined));
  w.stop();
  watcher.close();
  editor.close();
});
