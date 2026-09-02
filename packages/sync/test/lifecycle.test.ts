import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, request, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as Y from "yjs";
import { createSyncServer, type SyncServer } from "../src/node";
import { wsTransport } from "../src/client";
import { createCollabSession, type CollabSession } from "../src/collab";

let root: string;
let http: Server;
let sync: SyncServer;
let port: number;

const EVICT_MS = 1500;

const until = async <T>(
  poll: () => T | undefined | Promise<T | undefined>,
  ms = 4000,
): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await poll();
    if (value !== undefined) return value;
    if (Date.now() - started > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-lifecycle-"));
  await writeFile(path.join(root, "doc.mdx"), "hello\n");
  sync = createSyncServer({ root, evictAfterMs: EVICT_MS, upload: { maxBytes: 64 } });
  http = createServer((req, res) => {
    if (req.url === "/__fde_upload") return sync.handleUpload(req, res);
    res.statusCode = 404;
    res.end();
  });
  http.on("upgrade", (req, socket, head) => {
    if (req.url === "/__fde_sync") sync.handleUpgrade(req, socket, head);
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  port = (http.address() as { port: number }).port;
});

afterAll(async () => {
  await sync.close();
  await new Promise((resolve) => http.close(resolve));
  await rm(root, { recursive: true, force: true });
});

const openTransport = () => wsTransport({ url: `ws://127.0.0.1:${port}/__fde_sync` });
const collabOpen = (transport: ReturnType<typeof openTransport>) =>
  transport.request<{ epoch: string }>({ type: "collab-open", path: "doc.mdx", components: [] });

const textAt = (session: CollabSession, index: number): Y.XmlText => {
  const child = session.doc.getXmlFragment("default").get(index) as Y.XmlElement;
  return child.get(0) as Y.XmlText;
};

test("last disconnect flushes to disk; the doc survives the grace, then evicts and re-seeds", async () => {
  const a = openTransport();
  const first = await collabOpen(a);
  const session = createCollabSession({ transport: a, path: "doc.mdx", components: [] });
  await session.whenSynced;
  textAt(session, 0).insert(5, " evicted-edit");
  session.destroy();
  a.close();

  // the final state lands on disk straight away — the last disconnect
  // flushes, it does not wait out the 800ms save debounce
  const flushed = await until(
    () =>
      readFile(path.join(root, "doc.mdx"), "utf-8").then((text) =>
        text.includes("evicted-edit") ? text : undefined,
      ),
    1000,
  );
  expect(flushed).toBe("hello evicted-edit\n");

  // returning within the grace finds the same doc (epoch unchanged)…
  const b = openTransport();
  expect((await collabOpen(b)).epoch).toBe(first.epoch);
  b.close();

  // …but once the grace passes with no client, the doc is evicted: the next
  // opener gets a fresh epoch, re-seeded from the flushed file
  await new Promise((resolve) => setTimeout(resolve, EVICT_MS + 700));
  const c = openTransport();
  expect((await collabOpen(c)).epoch).not.toBe(first.epoch);
  const fresh = createCollabSession({ transport: c, path: "doc.mdx", components: [] });
  await fresh.whenSynced;
  expect(textAt(fresh, 0).toString()).toBe("hello evicted-edit");
  fresh.destroy();
  c.close();
}, 20000);

test("upload limits: content type and size are enforced before anything is stored", async () => {
  const base = `http://127.0.0.1:${port}`;
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    fetch(`${base}/__fde_upload`, { method: "POST", body, headers });

  // no content type at all, then a non-image one
  expect((await post(new Blob(["x"]))).status).toBe(415);
  expect((await post("plain text")).status).toBe(415);
  // an image over the cap (content-length precheck)
  expect((await post(new Blob([new Uint8Array(65)], { type: "image/png" }))).status).toBe(413);
  // an image within the cap is stored
  const ok = await post(new Blob(["png-bytes"], { type: "image/png" }), {
    "x-filename": "pic.png",
  });
  expect(ok.status).toBe(200);
  const { src } = (await ok.json()) as { src: string };
  expect(await readFile(path.join(root, src.replace(/^\.\//, "")), "utf-8")).toBe("png-bytes");
});

test("a chunked oversized body is refused at the cap while streaming", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/__fde_upload",
        method: "POST",
        headers: { "content-type": "image/png", "transfer-encoding": "chunked" },
      },
      (res) => resolve(res.statusCode!),
    );
    req.on("error", reject);
    req.write(Buffer.alloc(40));
    req.write(Buffer.alloc(40));
    req.end();
  });
  expect(status).toBe(413);
});
