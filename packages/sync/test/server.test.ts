import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSyncServer, hashText, type SyncServer } from "../src/node";
import { wsTransport, type WsTransport } from "../src/client";

let root: string;
let http: Server;
let sync: SyncServer;
let transport: WsTransport;

const until = <T>(poll: () => T | undefined, ms = 4000): Promise<T> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const value = poll();
      if (value !== undefined) return resolve(value);
      if (Date.now() - started > ms) return reject(new Error("timed out"));
      setTimeout(tick, 20);
    };
    tick();
  });

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-sync-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs/guide.mdx"), "# Guide\n");
  await writeFile(path.join(root, "readme.md"), "# Readme\n");
  await writeFile(path.join(root, "ignored.txt"), "not markdown");

  sync = createSyncServer({ root });
  http = createServer();
  http.on("upgrade", (request, socket, head) => {
    if (request.url === "/__fde_sync") sync.handleUpgrade(request, socket, head);
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const { port } = http.address() as { port: number };
  transport = wsTransport(`ws://127.0.0.1:${port}/__fde_sync`);
});

afterAll(async () => {
  transport.close();
  await sync.close();
  await new Promise((resolve) => http.close(resolve));
  await rm(root, { recursive: true, force: true });
});

test("lists only markdown files, recursively", async () => {
  expect(await transport.list()).toEqual([{ path: "docs/guide.mdx" }, { path: "readme.md" }]);
});

test("read returns text and its content hash", async () => {
  const state = await transport.read("docs/guide.mdx");
  expect(state.text).toBe("# Guide\n");
  expect(state.version).toBe(hashText("# Guide\n"));
});

test("compare-and-swap write: stale base loses and sees the current state", async () => {
  const state = await transport.read("readme.md");
  const first = await transport.write("readme.md", "# Readme v2\n", state.version);
  expect(first).toMatchObject({ ok: true });

  const stale = await transport.write("readme.md", "# clobber\n", state.version);
  expect(stale.ok).toBe(false);
  if (!stale.ok) expect(stale.current.text).toBe("# Readme v2\n");
  expect(await readFile(path.join(root, "readme.md"), "utf-8")).toBe("# Readme v2\n");
});

test("path escapes are rejected", async () => {
  await expect(transport.read("../outside.md")).rejects.toThrow(/escapes/);
});

test("an external file change reaches watchers; own writes do not echo", async () => {
  const events: string[] = [];
  const stop = transport.watch("docs/guide.mdx", (state) => events.push(state.text));

  // own write: no echo (the writer already knows the result)
  const state = await transport.read("docs/guide.mdx");
  await transport.write("docs/guide.mdx", "# Guide, saved\n", state.version);

  // external (direct fs) change: must arrive via chokidar
  await new Promise((resolve) => setTimeout(resolve, 150));
  await writeFile(path.join(root, "docs/guide.mdx"), "# Guide, from disk\n");
  await until(() => (events.includes("# Guide, from disk\n") ? true : undefined));

  expect(events).toEqual(["# Guide, from disk\n"]);
  stop();
});

test("a second client hears another client's write immediately", async () => {
  const { port } = http.address() as { port: number };
  const other = wsTransport(`ws://127.0.0.1:${port}/__fde_sync`);
  const events: string[] = [];
  other.watch("readme.md", (state) => events.push(state.text));
  await other.read("readme.md"); // ensures the socket is open and watching

  const state = await transport.read("readme.md");
  await transport.write("readme.md", "# Readme v3\n", state.version);
  await until(() => (events.includes("# Readme v3\n") ? true : undefined));
  other.close();
});
