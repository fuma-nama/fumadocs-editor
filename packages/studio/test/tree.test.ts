import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { frontmatterTitle, type TreeNode } from "../app/protocol";
import { buildTree, openWorkspace, type WorkspaceIndex } from "../src/tree";

const outline = (nodes: TreeNode[]): unknown[] =>
  nodes.map((node) =>
    node.type === "separator"
      ? `--- ${node.title}`
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
  test("default order: index first, then by name, folders mixed in", () => {
    expect(tree(["zeta.mdx", "index.mdx", "alpha.md", "guides/intro.mdx"])).toEqual([
      "index",
      "alpha",
      { guides: ["intro"] },
      "zeta",
    ]);
  });

  test("titles from frontmatter and meta", () => {
    expect(tree(["a.mdx", "g/b.mdx"], { g: { title: "Guides" } }, { "a.mdx": "Alpha" })).toEqual([
      "Alpha",
      { Guides: ["b"] },
    ]);
  });

  test("pages: explicit order, separators, links skipped, unknown dropped", () => {
    expect(
      tree(["a.mdx", "b.mdx", "c.mdx"], {
        "": { pages: ["c", "---Group---", "[Site](https://example.com)", "missing", "a"] },
      }),
    ).toEqual(["c", "--- Group", "a", "b"]);
  });

  test("pages: rest placement and z...a", () => {
    expect(tree(["a.mdx", "b.mdx", "c.mdx"], { "": { pages: ["b", "...", "a"] } })).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(tree(["a.mdx", "b.mdx", "c.mdx"], { "": { pages: ["z...a"] } })).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  test("pages: !hidden still listed, ...folder picks the folder", () => {
    expect(
      tree(["hidden.mdx", "guides.mdx", "guides/one.mdx"], {
        "": { pages: ["!hidden", "...guides", "guides"] },
      }),
    ).toEqual(["hidden", { guides: ["one"] }, "guides"]);
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
