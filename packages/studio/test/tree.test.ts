import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { frontmatterTitle, pagesEntry, type TreeNode } from "../app/protocol";
import {
  buildTree,
  CommandError,
  openWorkspace,
  orderPages,
  type WorkspaceIndex,
} from "../src/tree";

const outline = (nodes: TreeNode[]): unknown[] =>
  nodes.map((node) =>
    node.type === "separator"
      ? `--- ${node.title}`
      : node.type === "link"
        ? `[${node.title}](${node.url})`
        : node.type === "folder"
          ? { [node.title]: outline(node.children) }
          : node.title,
  );

const tree = (
  files: string[],
  metas: Record<string, WorkspaceIndex["metas"] extends Map<string, infer M> ? M : never> = {},
  titles: Record<string, string> = {},
) => {
  const index: WorkspaceIndex = { files: new Map(), metas: new Map(Object.entries(metas)) };
  for (const file of files) index.files.set(file, titles[file]);
  return outline(buildTree(index));
};

describe("buildTree", () => {
  test("default order: index first, then pages by name, then folders", () => {
    expect(tree(["zeta.mdx", "index.mdx", "alpha.md", "guides/intro.mdx"])).toEqual([
      "index",
      "alpha",
      "zeta",
      { guides: ["intro"] },
    ]);
  });

  test("titles from frontmatter and meta", () => {
    expect(tree(["a.mdx", "g/b.mdx"], { g: { title: "Guides" } }, { "a.mdx": "Alpha" })).toEqual([
      "Alpha",
      { Guides: ["b"] },
    ]);
  });

  test("pages: explicit order, separators, links, unknown dropped", () => {
    expect(
      tree(["a.mdx", "b.mdx", "c.mdx"], {
        "": { pages: ["c", "---Group---", "[Site](https://example.com)", "missing", "a"] },
      }),
    ).toEqual(["c", "--- Group", "[Site](https://example.com)", "a", "b"]);
    const [separator, link] = buildTree({
      files: new Map(),
      metas: new Map([["", { pages: ["---[Book]Docs---", "external:[Globe][Site](https://x)"] }]]),
    });
    expect(separator).toEqual({ type: "separator", title: "Docs", icon: "Book" });
    expect(link).toEqual({
      type: "link",
      title: "Site",
      url: "https://x",
      icon: "Globe",
      external: true,
    });
    expect(pagesEntry(separator)).toBe("---[Book]Docs---");
    expect(pagesEntry(link)).toBe("external:[Globe][Site](https://x)");
    expect(pagesEntry({ type: "separator", title: "" })).toBe("---");
  });

  test("pages: rest placement and z...a (index stays first)", () => {
    expect(tree(["a.mdx", "b.mdx", "c.mdx"], { "": { pages: ["b", "...", "a"] } })).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(tree(["a.mdx", "b.mdx", "index.mdx", "g/x.mdx"], { "": { pages: ["z...a"] } })).toEqual([
      "index",
      { g: ["x"] },
      "b",
      "a",
    ]);
  });

  test("pages: !hidden still listed, a folder wins its key, ...folder picks the folder", () => {
    expect(
      tree(["hidden.mdx", "guides.mdx", "guides/one.mdx"], {
        "": { pages: ["!hidden", "...guides", "guides"] },
      }),
    ).toEqual(["hidden", { guides: ["one"] }, "guides"]);
    expect(tree(["guides.mdx", "guides/one.mdx"], { "": { pages: ["guides"] } })).toEqual([
      { guides: ["one"] },
      "guides",
    ]);
  });

  test("pages: unlisted items are appended", () => {
    expect(tree(["a.mdx", "b.mdx", "index.mdx"], { "": { pages: ["b"] } })).toEqual([
      "b",
      "index",
      "a",
    ]);
  });

  test("nested metas and empty folders pruned", () => {
    expect(
      tree(["docs/x.mdx", "docs/y.mdx", "docs/deep/z.mdx"], {
        docs: { pages: ["y", "---Deep---", "...deep"] },
      }),
    ).toEqual([{ docs: ["y", "--- Deep", { deep: ["z"] }, "x"] }]);
    expect(buildTree({ files: new Map(), metas: new Map() })).toEqual([]);
  });

  test("a listed key is consumed once", () => {
    expect(tree(["a.mdx", "b.mdx"], { "": { pages: ["a", "a", "b"] } })).toEqual(["a", "b"]);
  });
});

describe("frontmatterTitle", () => {
  test("plain, quoted, CRLF", () => {
    expect(frontmatterTitle("---\ntitle: Hello World\n---\n# h")).toBe("Hello World");
    expect(frontmatterTitle('---\ntitle: "Quoted: yes"\ndescription: x\n---\n')).toBe(
      "Quoted: yes",
    );
    expect(frontmatterTitle("---\r\ndescription: x\r\ntitle: 'Single'\r\n---\r\n")).toBe("Single");
  });

  test("absent, empty, block scalar, no frontmatter", () => {
    expect(frontmatterTitle("---\ndescription: x\n---\n")).toBeUndefined();
    expect(frontmatterTitle("---\ntitle:\n---\n")).toBeUndefined();
    expect(frontmatterTitle("---\ntitle: |\n  multi\n---\n")).toBeUndefined();
    expect(frontmatterTitle("# Heading\ntitle: nope\n")).toBeUndefined();
    expect(frontmatterTitle("")).toBeUndefined();
  });
});

describe("openWorkspace", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "fde-studio-tree-"));
    await mkdir(path.join(root, "guides/.hidden"), { recursive: true });
    await mkdir(path.join(root, "node_modules/pkg"), { recursive: true });
    await mkdir(path.join(root, "private"));
    await writeFile(path.join(root, "index.mdx"), "---\ntitle: Home\n---\n");
    await writeFile(path.join(root, "notes.txt"), "not markdown");
    await writeFile(path.join(root, "meta.json"), JSON.stringify({ pages: ["guides", "..."] }));
    await writeFile(path.join(root, "guides/meta.json"), "{ not json");
    await writeFile(path.join(root, "guides/a.md"), "# A");
    await writeFile(path.join(root, "guides/.hidden/x.mdx"), "");
    await writeFile(path.join(root, "node_modules/pkg/readme.md"), "");
    await writeFile(path.join(root, "private/secret.mdx"), "---\ntitle: Secret\n---\n");
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  test("lists readable markdown only, invalid meta ignored", async () => {
    const workspace = await openWorkspace(root);
    expect(outline(workspace.tree(() => true))).toEqual([
      { guides: ["a"] },
      "Home",
      { private: ["Secret"] },
    ]);
    expect(outline(workspace.tree((p) => !p.startsWith("private/")))).toEqual([
      { guides: ["a"] },
      "Home",
    ]);
  });

  test("update follows the filesystem", async () => {
    const workspace = await openWorkspace(root);
    const all = () => outline(workspace.tree(() => true));
    const at = (relative: string) => path.join(root, relative);

    await writeFile(at("new.mdx"), "---\ntitle: New\n---\n");
    expect(await workspace.update("add", at("new.mdx"))).toBe(true);
    expect(all()).toContain("New");
    // same title: nothing to announce
    expect(await workspace.update("change", at("new.mdx"))).toBe(false);
    await writeFile(at("new.mdx"), "---\ntitle: Renamed\n---\n");
    expect(await workspace.update("change", at("new.mdx"))).toBe(true);
    expect(all()).toContain("Renamed");
    await unlink(at("new.mdx"));
    expect(await workspace.update("unlink", at("new.mdx"))).toBe(true);
    expect(all()).not.toContain("Renamed");

    await writeFile(at("meta.json"), JSON.stringify({ pages: ["private", "..."] }));
    expect(await workspace.update("change", at("meta.json"))).toBe(true);
    expect(all()[0]).toEqual({ private: ["Secret"] });

    // a directory moved in arrives as one addDir; moved out as one unlinkDir
    await rename(at("private"), at("public"));
    expect(await workspace.update("unlinkDir", at("private"))).toBe(true);
    expect(await workspace.update("addDir", at("public"))).toBe(true);
    expect(all()).toEqual(["Home", { guides: ["a"] }, { public: ["Secret"] }]);

    expect(await workspace.update("add", at("notes.txt"))).toBe(false);
    expect(await workspace.update("add", at("guides/.hidden/x.mdx"))).toBe(false);
    expect(await workspace.update("add", path.join(root, "..", "outside.mdx"))).toBe(false);
  });
});

describe("orderPages", () => {
  const keys = ["index", "a", "b", "c", "guides"];

  test("no pages: what moved becomes explicit around ...", () => {
    expect(orderPages(undefined, ["c", "index", "a", "b", "guides"], keys)).toEqual(["c", "..."]);
    expect(orderPages(undefined, ["index", "a", "b", "guides", "c"], keys)).toEqual(["...", "c"]);
    expect(orderPages(undefined, ["index", "a", "b", "c", "guides"], keys)).toEqual(["..."]);
  });

  test("listed entries keep their prefixes; separators and links go where placed", () => {
    expect(
      orderPages(
        ["!a", "---Top---", "[Site](https://x)", "..."],
        ["---Top---", "index", "[Site](https://x)", "b", "a", "c", "guides"],
        keys,
      ),
    ).toEqual(["---Top---", "index", "[Site](https://x)", "b", "!a", "..."]);
    expect(
      orderPages(["---A---", "..."], ["---B---", "index", "a", "b", "c", "guides"], keys),
    ).toEqual(["---B---", "..."]);
  });

  test("z...a covers a descending run, index first", () => {
    expect(orderPages(["z...a"], ["a", "index", "guides", "c", "b"], keys)).toEqual(["a", "z...a"]);
  });

  test("without a rest token, trailing unlisted keys stay unlisted", () => {
    expect(orderPages(["a", "b"], ["b", "a", "index", "c", "guides"], keys)).toEqual(["b", "a"]);
    expect(orderPages(["a", "b"], ["a", "c", "b", "index", "guides"], keys)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(orderPages(["a", "b"], ["b", "index", "c", "guides", "a"], keys)).toEqual([
      "b",
      "index",
      "c",
      "guides",
      "a",
    ]);
  });

  test("unknown keys and an unplaced rest token stay after their old neighbour", () => {
    expect(orderPages(["a", "gone", "b", "..."], ["b", "a", "index", "c", "guides"], keys)).toEqual(
      ["b", "a", "gone", "..."],
    );
    expect(orderPages(["...", "a"], ["a"], ["a"])).toEqual(["...", "a"]);
  });

  test("separators and links left out are gone", () => {
    expect(
      orderPages(["---A---", "a", "[x](y)", "..."], ["a", "index", "b", "c", "guides"], keys),
    ).toEqual(["a", "..."]);
  });
});

describe("commands", () => {
  let root: string;
  const read = (relative: string) => readFile(path.join(root, relative), "utf8");
  const meta = async (relative: string) => JSON.parse(await read(relative)) as unknown;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "fde-studio-commands-"));
    await mkdir(path.join(root, "guides"));
    await writeFile(path.join(root, "index.mdx"), "---\ntitle: Home\n---\n");
    await writeFile(path.join(root, "guides/a.mdx"), "");
    await writeFile(
      path.join(root, "guides/meta.json"),
      '{\n  "title": "Guides",\n  "pages": ["a"]\n}\n',
    );
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  test("create: frontmatter title, appended to an explicit list, refused twice", async () => {
    const workspace = await openWorkspace(root);
    await workspace.create("guides/new.mdx", "New: Draft");
    expect(await read("guides/new.mdx")).toBe('---\ntitle: "New: Draft"\n---\n');
    expect(await meta("guides/meta.json")).toEqual({ title: "Guides", pages: ["a", "new"] });
    await workspace.create("deep/nested/page.mdx", "Nested");
    expect(await read("deep/nested/page.mdx")).toBe("---\ntitle: Nested\n---\n");
    expect(outline(workspace.tree(() => true))).toEqual([
      "Home",
      { deep: [{ nested: ["Nested"] }] },
      { Guides: ["a", "New: Draft"] },
    ]);
    await expect(workspace.create("guides/new.mdx", "Again")).rejects.toMatchObject({
      status: 409,
    });
    await expect(workspace.create("../out.mdx", "Out")).rejects.toBeInstanceOf(CommandError);
    await expect(workspace.create("notes.txt", "Text")).rejects.toMatchObject({ status: 400 });
  });

  test("mkdir: meta title, index page, listed in an explicit parent, refused twice", async () => {
    const workspace = await openWorkspace(root);
    await workspace.mkdir("guides/advanced", "Advanced Topics");
    expect(await meta("guides/advanced/meta.json")).toEqual({ title: "Advanced Topics" });
    expect(await read("guides/advanced/index.mdx")).toBe("---\ntitle: Advanced Topics\n---\n");
    expect(await meta("guides/meta.json")).toEqual({
      title: "Guides",
      pages: ["a", "new", "advanced"],
    });
    expect(outline(workspace.tree(() => true))[2]).toEqual({
      Guides: ["a", "New: Draft", { "Advanced Topics": ["Advanced Topics"] }],
    });
    await expect(workspace.mkdir("guides/advanced", "Again")).rejects.toMatchObject({
      status: 409,
    });
    await expect(workspace.mkdir("guides", "Guides")).rejects.toMatchObject({ status: 409 });
    await expect(workspace.mkdir("../out", "Out")).rejects.toMatchObject({ status: 400 });
  });

  test("order: rewrites pages, keeps other fields, refuses unknown keys", async () => {
    const workspace = await openWorkspace(root);
    await workspace.order("guides", ["---Start---", "new", "a", "advanced"]);
    expect(await read("guides/meta.json")).toBe(
      '{\n  "title": "Guides",\n  "pages": [\n    "---Start---",\n    "new",\n    "a",\n    "advanced"\n  ]\n}\n',
    );
    expect(outline(workspace.tree(() => true))[2]).toEqual({
      Guides: ["--- Start", "New: Draft", "a", { "Advanced Topics": ["Advanced Topics"] }],
    });
    await workspace.order("", ["guides", "index", "deep"]);
    expect(await meta("meta.json")).toEqual({ pages: ["guides", "..."] });
    await expect(workspace.order("guides", ["zzz"])).rejects.toMatchObject({ status: 409 });
    await expect(workspace.order("nope", [])).rejects.toMatchObject({ status: 404 });
  });

  test("remove: unlinks through the callback and drops the entry", async () => {
    const workspace = await openWorkspace(root);
    let unlinked = false;
    await workspace.remove("guides/new.mdx", async () => {
      await unlink(path.join(root, "guides/new.mdx"));
      unlinked = true;
    });
    expect(unlinked).toBe(true);
    expect(await meta("guides/meta.json")).toEqual({
      title: "Guides",
      pages: ["---Start---", "a", "advanced"],
    });
    expect(outline(workspace.tree(() => true))[0]).toEqual({
      Guides: ["--- Start", "a", { "Advanced Topics": ["Advanced Topics"] }],
    });
    await expect(workspace.remove("guides/new.mdx", async () => {})).rejects.toMatchObject({
      status: 404,
    });
  });
});
