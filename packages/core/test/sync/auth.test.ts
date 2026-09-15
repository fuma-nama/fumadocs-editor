import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as Y from "yjs";
import type { CollabBinding } from "../../src/sync/collab";
import { AUTH_HEADER } from "../../src/sync/protocol";
import type { SyncScope } from "../../src/sync/node/server";
import { connect, online, peer, serve, sleep, textEditor, until } from "./helpers";

let root: string;
let server: Awaited<ReturnType<typeof serve>>;

/** every payload authenticate has seen, verbatim */
const seen: unknown[] = [];

const authenticate = async ({ payload }: { payload?: unknown }): Promise<SyncScope | null> => {
  seen.push(payload);
  if (payload !== null && typeof payload === "object") return { write: true };
  switch (payload) {
    case "admin":
    case "admin-fresh":
      return { user: { name: "Admin", color: "#00f" }, write: true };
    case "team-a":
      return { user: { name: "Ada" }, write: (p) => p.startsWith("team-a/") };
    case "reader":
      return { user: { name: "Reader" }, write: false, read: (p) => !p.startsWith("secret/") };
    default:
      return null;
  }
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-auth-"));
  await mkdir(path.join(root, "team-a"));
  await mkdir(path.join(root, "secret"));
  await writeFile(path.join(root, "outside.mdx"), "# Outside\n");
  await writeFile(path.join(root, "team-a/inside.mdx"), "# Inside\n");
  await writeFile(path.join(root, "team-a/shared.mdx"), "shared text\n");
  await writeFile(path.join(root, "secret/hidden.mdx"), "# Hidden\n");
  server = await serve({ root, authenticate, helloTimeoutMs: 300 });
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const ready = async (token: unknown) => {
  const client = await peer(server.url, token);
  expect(await client.hello()).toMatchObject({ type: "hello" });
  return client;
};

const subscribeFile = async (client: Awaited<ReturnType<typeof peer>>, file: string) => {
  const answer = await client.request({ type: "subscribe", resource: "file", path: file });
  if (answer.type !== "update" || answer.resource !== "file" || !("text" in answer)) {
    throw new Error(JSON.stringify(answer));
  }
  return answer;
};

const joinDoc = async (token: string, file: string) => {
  const client = connect(server.url, { auth: () => token, collab: true });
  const session = client.open(file, { editor: textEditor().editor, components: [] });
  const binding = await until(() => session.collab() ?? undefined, 8000);
  return {
    client,
    session,
    binding,
    close() {
      session.close();
      client.close();
    },
  };
};

const textAt = (binding: CollabBinding, index: number): Y.XmlText =>
  (binding.doc.getXmlFragment("default").get(index) as Y.XmlElement).get(0) as Y.XmlText;

test("the auth payload reaches authenticate verbatim", async () => {
  const payload = { token: "abc", nested: { n: 1 } };
  const client = connect(server.url, { auth: () => payload });
  await online(client);
  expect(seen).toContainEqual(payload);
  client.close();
});

test("a rejected payload is denied, distinct from offline, without a retry loop", async () => {
  const client = connect(server.url, { auth: () => "bad-once" });
  const session = client.open("outside.mdx", { editor: textEditor().editor });
  await expect(session.opened).rejects.toThrow(/denied/);
  expect(client.status()).toBe("denied");
  expect(session.status()).toBe("denied");
  await sleep(700);
  expect(seen.filter((p) => p === "bad-once")).toHaveLength(1);
  session.close();
  client.close();
}, 10000);

test("reconnects re-invoke the client auth hook and carry the fresh token", async () => {
  let calls = 0;
  const client = connect(server.url, { auth: () => (calls++ === 0 ? "admin" : "admin-fresh") });
  await online(client);
  await server.drop();
  await until(() => (seen.includes("admin-fresh") ? true : undefined));
  await online(client);
  client.close();
}, 10000);

test("subtree write scope: file writes gated on the normalized path", async () => {
  const client = await ready("team-a");
  const inside = await subscribeFile(client, "team-a/inside.mdx");
  expect(inside.writable).toBe(true);
  expect(
    await client.request({
      type: "update",
      resource: "file",
      path: "team-a/inside.mdx",
      text: "# Inside v2\n",
      base: inside.version,
    }),
  ).toMatchObject({ version: expect.any(String) });

  const outside = await subscribeFile(client, "outside.mdx");
  expect(outside.writable).toBe(false);
  for (const target of ["outside.mdx", "team-a/../outside.mdx"]) {
    expect(
      await client.request({
        type: "update",
        resource: "file",
        path: target,
        text: "# clobber\n",
        base: outside.version,
      }),
    ).toMatchObject({ type: "error", message: expect.stringMatching(/denied/) });
  }
  expect(await readFile(path.join(root, "outside.mdx"), "utf-8")).toBe("# Outside\n");
  client.close();
});

test("subtree write scope: Y updates refused outside, applied inside", async () => {
  const denied = await joinDoc("team-a", "outside.mdx");
  expect(await denied.session.opened).toMatchObject({ writable: false });
  textAt(denied.binding, 0).insert(0, "HACK");

  const granted = await joinDoc("team-a", "team-a/shared.mdx");
  expect(await granted.session.opened).toMatchObject({ writable: true });
  textAt(granted.binding, 0).insert(0, "team:");

  // a full-access peer sees the untouched doc, and the disk keeps the original
  const observer = await joinDoc("admin", "outside.mdx");
  await sleep(200);
  expect(textAt(observer.binding, 0).toString()).not.toContain("HACK");
  await until(
    () =>
      readFile(path.join(root, "team-a/shared.mdx"), "utf-8").then((text) =>
        text.includes("team:") ? text : undefined,
      ),
    6000,
  );
  expect(await readFile(path.join(root, "outside.mdx"), "utf-8")).toBe("# Outside\n");

  denied.close();
  granted.close();
  observer.close();
}, 20000);

test("read predicate: filtered tree, withheld pushes, refused subscriptions", async () => {
  const reader = await ready("reader");
  const tree = await reader.request({ type: "subscribe", resource: "tree" });
  expect(JSON.stringify(tree)).toContain("outside.mdx");
  expect(JSON.stringify(tree)).not.toContain("secret");

  for (const resource of ["file", "doc"]) {
    expect(
      await reader.request({
        type: "subscribe",
        resource,
        path: "secret/hidden.mdx",
        vector: new Uint8Array([0]),
        components: [],
      }),
    ).toMatchObject({ type: "error", message: expect.stringMatching(/denied/) });
  }
  await subscribeFile(reader, "outside.mdx");

  const admin = await ready("admin");
  const hidden = await subscribeFile(admin, "secret/hidden.mdx");
  await admin.request({
    type: "update",
    resource: "file",
    path: "secret/hidden.mdx",
    text: "# Hidden v2\n",
    base: hidden.version,
  });
  const outside = await subscribeFile(admin, "outside.mdx");
  const restored = await admin.request({
    type: "update",
    resource: "file",
    path: "outside.mdx",
    text: "# Outside v2\n",
    base: outside.version,
  });

  await until(() => reader.pushes.find((p) => "text" in p && p.text === "# Outside v2\n"));
  expect(JSON.stringify(reader.pushes)).not.toContain("Hidden");

  if (restored.type === "update" && restored.resource === "file") {
    await admin.request({
      type: "update",
      resource: "file",
      path: "outside.mdx",
      text: "# Outside\n",
      base: restored.version,
    });
  }
  reader.close();
  admin.close();
}, 10000);

test("a scope user overrides spoofed awareness before it reaches peers", async () => {
  const admin = await joinDoc("admin", "team-a/inside.mdx");
  const ada = await joinDoc("team-a", "team-a/inside.mdx");
  ada.binding.awareness.setLocalStateField("user", { name: "Mallory", color: "#f00" });
  const state = await until(() =>
    admin.binding.awareness.getStates().get(ada.binding.doc.clientID),
  );
  // the name is pinned by the scope; unpinned cosmetic fields survive
  expect(state.user).toEqual({ name: "Ada", color: "#f00" });
  admin.close();
  ada.close();
}, 20000);

test("HTTP media endpoints authenticate via the header payload", async () => {
  const base = `http://127.0.0.1:${server.port}`;
  // image-typed bodies: the upload limits (type check) run before auth
  const png = (bytes: string) => new Blob([bytes], { type: "image/png" });
  const uploaded = await fetch(`${base}/__fde_upload`, {
    method: "POST",
    body: png("png-bytes"),
    headers: { "x-filename": "pic.png", [AUTH_HEADER]: JSON.stringify("admin") },
  });
  expect(uploaded.status).toBe(200);
  const { src } = (await uploaded.json()) as { src: string };
  const relative = src.replace(/^\.\//, "");
  expect(await readFile(path.join(root, relative), "utf-8")).toBe("png-bytes");

  // no payload -> authenticate still runs (and this policy denies it)
  const anonymous = await fetch(`${base}/__fde_upload`, { method: "POST", body: png("x") });
  expect(anonymous.status).toBe(401);
  // authenticated, but assets/ sits outside the writable subtree
  const scoped = await fetch(`${base}/__fde_upload`, {
    method: "POST",
    body: png("x"),
    headers: { [AUTH_HEADER]: JSON.stringify("team-a") },
  });
  expect(scoped.status).toBe(403);

  const served = await fetch(`${base}/__fde_asset/${relative}`, {
    headers: { [AUTH_HEADER]: JSON.stringify("reader") },
  });
  expect(served.status).toBe(200);
  expect(await served.text()).toBe("png-bytes");
  const refused = await fetch(`${base}/__fde_asset/secret/hidden.mdx`, {
    headers: { [AUTH_HEADER]: JSON.stringify("reader") },
  });
  expect(refused.status).toBe(403);
  const unknown = await fetch(`${base}/__fde_asset/${relative}`, {
    headers: { [AUTH_HEADER]: JSON.stringify("bad-token") },
  });
  expect(unknown.status).toBe(401);
}, 10000);
