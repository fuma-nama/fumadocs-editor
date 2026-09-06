import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { frontmatterTitle, type TreeNode } from "../app/protocol";
import { buildTree, readTree } from "../src/tree";

const outline = (nodes: TreeNode[]): unknown[] =>
  nodes.map((node) =>
    node.type === "separator"
      ? `--- ${node.title}`
      : node.type === "folder"
        ? { [node.title]: outline(node.children) }
        : node.title,
  );

const tree = (files: string[], metas: Parameters<typeof buildTree>[0]["metas"] = {}, titles = {}) =>
  outline(buildTree({ files, metas, titles }));

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
    expect(buildTree({ files: [], metas: {}, titles: {} })).toEqual([]);
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

describe("readTree", () => {
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
    expect(outline(await readTree(root, () => true))).toEqual([
      { guides: ["a"] },
      "Home",
      { private: ["Secret"] },
    ]);
    expect(outline(await readTree(root, (p) => !p.startsWith("private/")))).toEqual([
      { guides: ["a"] },
      "Home",
    ]);
  });
});
