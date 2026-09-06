import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { AUTH_HEADER } from "@fumadocs-editor/core/sync";
import { TREE_ENDPOINT, TREE_EVENT } from "../app/protocol";
import { startStudio } from "../src/server";

let dir: string;
let server: ViteDevServer;
let url: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fde-studio-server-"));
  const content = path.join(dir, "content");
  await mkdir(path.join(content, "guides"), { recursive: true });
  await writeFile(path.join(content, "index.mdx"), "---\ntitle: Home\n---\n# Home\n");
  await writeFile(path.join(content, "guides/setup.mdx"), "# Setup\n");
  await writeFile(path.join(content, "meta.json"), JSON.stringify({ pages: ["guides", "index"] }));
  await writeFile(path.join(dir, "extra.css"), "body { color: red }");
  server = await startStudio({
    projectRoot: dir,
    contentRoot: content,
    port: 0,
    open: false,
    styles: [path.join(dir, "extra.css")],
    server: {
      authenticate: ({ payload }) =>
        payload === "viewer" ? { write: false, read: (p) => !p.startsWith("guides/") } : null,
    },
  });
  const { port } = server.httpServer!.address() as AddressInfo;
  url = `http://localhost:${port}`;
}, 30_000);

afterAll(async () => {
  // closing while the first pre-bundle is in flight leaves its transform
  // requests pending forever
  await server.waitForRequestsIdle();
  await server.close();
  await rm(dir, { recursive: true, force: true });
}, 30_000);

test("serves the app", async () => {
  const html = await fetch(`${url}/`).then((r) => r.text());
  expect(html).toContain('<script type="module" src="/main.tsx">');
  const styles = await fetch(`${url}/@id/__x00__fumadocs-studio-styles`).then((r) => r.text());
  expect(styles).toContain("extra.css");
  const config = await fetch(`${url}/@id/__x00__fumadocs-studio-config`).then((r) => r.text());
  expect(config).toContain("export default {}");
});

test("tree endpoint applies the scope", async () => {
  const denied = await fetch(url + TREE_ENDPOINT);
  expect(denied.status).toBe(401);
  const res = await fetch(url + TREE_ENDPOINT, { headers: { [AUTH_HEADER]: '"viewer"' } });
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({
    root: "content",
    tree: [{ type: "file", name: "index", path: "index.mdx", title: "Home" }],
  });
});

test("the tree follows the filesystem", async () => {
  const send = vi.spyOn(server.hot, "send");
  await writeFile(path.join(dir, "content/new.mdx"), "---\ntitle: New\n---\n");
  const headers = { [AUTH_HEADER]: '"viewer"' };
  const deadline = Date.now() + 5000;
  const pinged = () => send.mock.calls.some((call) => call[0] === TREE_EVENT);
  while (!pinged() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(pinged()).toBe(true);
  const { tree } = (await fetch(url + TREE_ENDPOINT, { headers }).then((r) => r.json())) as {
    tree: { title: string }[];
  };
  expect(tree.map((node) => node.title)).toEqual(["Home", "New"]);
}, 10_000);

test("serves the assets of packages the app loads modules from", async () => {
  // fonts are not modules: the stylesheet's package makes them servable
  const css = realpathSync(createRequire(import.meta.url).resolve("@fontsource-variable/geist"));
  const font = path.join(path.dirname(css), "files/geist-latin-wght-normal.woff2");
  await fetch(`${url}/main.tsx`);
  await fetch(`${url}/@fs${css}`);
  expect((await fetch(`${url}/@fs${font}`)).status).toBe(200);
  const outside = path.resolve(import.meta.dirname, "../package.json");
  expect((await fetch(`${url}/@fs${outside}`)).status).toBe(403);
});
