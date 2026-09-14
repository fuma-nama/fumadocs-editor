import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";
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
    server: {},
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
  expect(html).toContain('<script type="module" src="/main.js">');
  const styles = await fetch(`${url}/@id/__x00__fumadocs-studio-styles`).then((r) => r.text());
  expect(styles).toContain("extra.css");
  const config = await fetch(`${url}/@id/__x00__fumadocs-studio-config`).then((r) => r.text());
  expect(config).toContain("export default {}");
});

test("serves the assets of packages the app loads modules from", async () => {
  // fonts are not modules: the stylesheet's package makes them servable
  const css = realpathSync(createRequire(import.meta.url).resolve("@fontsource-variable/geist"));
  const font = path.join(path.dirname(css), "files/geist-latin-wght-normal.woff2");
  await fetch(`${url}/main.js`);
  await fetch(`${url}/@fs${css}`);
  expect((await fetch(`${url}/@fs${font}`)).status).toBe(200);
  const outside = path.resolve(import.meta.dirname, "../package.json");
  expect((await fetch(`${url}/@fs${outside}`)).status).toBe(403);
});
