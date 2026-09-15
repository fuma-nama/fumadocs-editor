import { afterAll, beforeAll, expect, test } from "vitest";
import { request } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as Y from "yjs";
import type { CollabBinding } from "../../src/sync/collab";
import { connect, peer, serve, sleep, textEditor, until } from "./helpers";

let root: string;
let server: Awaited<ReturnType<typeof serve>>;

const EVICT_MS = 1500;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-lifecycle-"));
  await writeFile(path.join(root, "doc.mdx"), "hello\n");
  server = await serve({ root, evictAfterMs: EVICT_MS, upload: { maxBytes: 64 } });
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

/** the epoch a fresh connection is answered with */
const epochOf = async (file: string) => {
  const client = await peer(server.url);
  await client.hello();
  const answer = await client.request({
    type: "subscribe",
    resource: "doc",
    path: file,
    vector: new Uint8Array([0]),
    components: [],
  });
  client.close();
  return answer;
};

const join = async (file: string) => {
  const client = connect(server.url, { collab: true });
  const session = client.open(file, { editor: textEditor().editor, components: [] });
  const binding = await until(() => session.collab() ?? undefined, 8000);
  return {
    client,
    binding,
    close() {
      session.close();
      client.close();
    },
  };
};

const textAt = (binding: CollabBinding, index: number): Y.XmlText =>
  (binding.doc.getXmlFragment("default").get(index) as Y.XmlElement).get(0) as Y.XmlText;

test("last disconnect flushes to disk; the doc survives the grace, then evicts and re-seeds", async () => {
  const first = await epochOf("doc.mdx");
  if (first.type !== "update" || first.resource !== "doc" || !("epoch" in first)) {
    throw new Error(JSON.stringify(first));
  }
  const a = await join("doc.mdx");
  textAt(a.binding, 0).insert(5, " evicted-edit");
  await sleep(100);
  a.close();

  // the last disconnect flushes; it does not wait out the 800ms save debounce
  const flushed = await until(
    () =>
      readFile(path.join(root, "doc.mdx"), "utf-8").then((text) =>
        text.includes("evicted-edit") ? text : undefined,
      ),
    1000,
  );
  expect(flushed).toBe("hello evicted-edit\n");

  // returning within the grace finds the same doc
  expect(await epochOf("doc.mdx")).toMatchObject({ epoch: first.epoch });

  // once the grace passes with no client, the next opener gets a fresh epoch
  await sleep(EVICT_MS + 700);
  const second = await epochOf("doc.mdx");
  expect(second).not.toMatchObject({ epoch: first.epoch });
  const fresh = await join("doc.mdx");
  expect(textAt(fresh.binding, 0).toString()).toBe("hello evicted-edit");
  fresh.close();
}, 20000);

test("upload limits: content type and size are enforced before anything is stored", async () => {
  const base = `http://127.0.0.1:${server.port}`;
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
        port: server.port,
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

test("deleting a page drops its collab doc first: no flush recreates the file", async () => {
  await writeFile(path.join(root, "gone.mdx"), "keep me\n");
  const a = await join("gone.mdx");
  textAt(a.binding, 0).insert(7, " please");
  await sleep(100);

  await a.client.run({ type: "delete", path: "gone.mdx" });
  // the last disconnect would flush a live doc to disk
  a.close();
  await sleep(300);
  await expect(readFile(path.join(root, "gone.mdx"), "utf-8")).rejects.toThrow();
  expect(await epochOf("gone.mdx")).toMatchObject({ type: "error" });
});
