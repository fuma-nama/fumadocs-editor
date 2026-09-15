import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { peer, serve, sleep, until } from "./helpers";

let root: string;
let server: Awaited<ReturnType<typeof serve>>;

const hashText = (text: string) => createHash("sha1").update(text).digest("hex");

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-protocol-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs/guide.mdx"), "# Guide\n");
  await writeFile(path.join(root, "readme.md"), "# Readme\n");
  server = await serve({ root, helloTimeoutMs: 300 });
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const ready = async () => {
  const client = await peer(server.url);
  expect(await client.hello()).toEqual({ type: "hello", id: 1 });
  return client;
};

test("nothing is handled before the hello; a hello-less connection closes", async () => {
  const client = await peer(server.url);
  expect(await client.request({ type: "subscribe", resource: "file", path: "readme.md" })).toEqual({
    type: "error",
    id: 1,
    message: "not authenticated",
  });
  await client.closed;
});

test("an unknown protocol version is refused and closed", async () => {
  const client = await peer(server.url);
  expect(await client.request({ type: "hello", protocol: 2 })).toMatchObject({ type: "error" });
  await client.closed;
});

test("subscribe answers with the file, its content hash and the permission", async () => {
  const client = await ready();
  expect(
    await client.request({ type: "subscribe", resource: "file", path: "docs/guide.mdx" }),
  ).toEqual({
    type: "update",
    id: 2,
    resource: "file",
    path: "docs/guide.mdx",
    text: "# Guide\n",
    version: hashText("# Guide\n"),
    writable: true,
  });
  client.close();
});

test("a stale write is answered with what the file holds now", async () => {
  const client = await ready();
  const base = hashText("# Readme\n");
  const write = (text: string) =>
    client.request({ type: "update", resource: "file", path: "readme.md", text, base });
  expect(await write("# Readme v2\n")).toEqual({
    type: "update",
    id: 2,
    resource: "file",
    path: "readme.md",
    version: hashText("# Readme v2\n"),
  });
  expect(await write("# clobber\n")).toMatchObject({ text: "# Readme v2\n" });
  expect(await readFile(path.join(root, "readme.md"), "utf-8")).toBe("# Readme v2\n");
  client.close();
});

test("path escapes and unknown resources are errors", async () => {
  const client = await ready();
  expect(
    await client.request({ type: "subscribe", resource: "file", path: "../outside.md" }),
  ).toMatchObject({ type: "error", message: expect.stringMatching(/escapes/) });
  expect(await client.request({ type: "subscribe", resource: "nope" })).toMatchObject({
    type: "error",
  });
  client.close();
});

test("a write reaches other subscribers as a push, and only the writer's answer", async () => {
  const writer = await ready();
  const other = await ready();
  const current = await writer.request({ type: "subscribe", resource: "file", path: "readme.md" });
  await other.request({ type: "subscribe", resource: "file", path: "readme.md" });
  if (current.type !== "update" || current.resource !== "file" || !("text" in current)) {
    throw new Error("no file");
  }

  await writer.request({
    type: "update",
    resource: "file",
    path: "readme.md",
    text: "# Readme v3\n",
    base: current.version,
  });
  await until(() => (other.pushes.length > 0 ? true : undefined));
  expect(other.pushes).toEqual([
    {
      type: "update",
      resource: "file",
      path: "readme.md",
      text: "# Readme v3\n",
      version: hashText("# Readme v3\n"),
    },
  ]);
  await sleep(150);
  expect(writer.pushes).toEqual([]);
  writer.close();
  other.close();
});

test("an external change reaches subscribers", async () => {
  const client = await ready();
  await client.request({ type: "subscribe", resource: "file", path: "docs/guide.mdx" });
  await sleep(150);
  await writeFile(path.join(root, "docs/guide.mdx"), "# Guide, from disk\n");
  const push = await until(() => client.pushes[0]);
  expect(push).toMatchObject({ path: "docs/guide.mdx", text: "# Guide, from disk\n" });
  client.close();
});

test("empty frames are the heartbeat and are echoed", async () => {
  const client = await ready();
  const echoed = new Promise((resolve) =>
    client.ws.addEventListener("message", (event) => event.data === "" && resolve(true)),
  );
  client.ws.send("");
  expect(await echoed).toBe(true);
  client.close();
});

test("messages with bytes travel as binary frames and decode back", async () => {
  const { decodeMessage, encodeMessage } = await import("../../src/sync/codec");
  const message = {
    type: "update",
    resource: "doc",
    path: "a.mdx",
    yjs: new Uint8Array([1, 2, 3]),
  };
  const frame = encodeMessage(message);
  expect(frame).toBeInstanceOf(Uint8Array);
  expect(decodeMessage(frame)).toEqual(message);
  expect(encodeMessage({ type: "hello", id: 1 })).toBe('{"type":"hello","id":1}');
  const truncated = (frame as Uint8Array).subarray(0, (frame as Uint8Array).length - 1);
  expect(() => decodeMessage(truncated)).toThrow(/malformed/);
});
