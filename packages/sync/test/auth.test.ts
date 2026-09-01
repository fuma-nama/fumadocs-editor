import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as Y from "yjs";
import { createSyncServer, type SyncScope, type SyncServer } from "../src/node";
import { wsTransport } from "../src/client";
import { createCollabSession, type CollabSession } from "../src/collab";
import { AUTH_HEADER } from "../src/transport";

let root: string;
let http: Server;
let sync: SyncServer;
let port: number;

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

const listen = () =>
  new Promise<void>((resolve) => {
    http.listen(port ?? 0, () => {
      port = (http.address() as { port: number }).port;
      resolve();
    });
  });

/** raw sockets, so the reconnect test can drop them under a live sync server */
const sockets = new Set<import("node:stream").Duplex>();

const wire = () => {
  http.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  http.on("upgrade", (request, socket, head) => {
    if (request.url === "/__fde_sync") sync.handleUpgrade(request, socket, head);
  });
  http.on("request", (request, response) => {
    if (request.url === "/__fde_upload") return sync.handleUpload(request, response);
    if (request.url!.startsWith("/__fde_asset/")) {
      request.url = request.url!.slice("/__fde_asset".length);
      return sync.handleAsset(request, response);
    }
    response.statusCode = 404;
    response.end();
  });
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-auth-"));
  await mkdir(path.join(root, "team-a"));
  await mkdir(path.join(root, "secret"));
  await writeFile(path.join(root, "outside.mdx"), "# Outside\n");
  await writeFile(path.join(root, "team-a/inside.mdx"), "# Inside\n");
  await writeFile(path.join(root, "team-a/shared.mdx"), "shared text\n");
  await writeFile(path.join(root, "secret/hidden.mdx"), "# Hidden\n");
  sync = createSyncServer({ root, authenticate, helloTimeoutMs: 300 });
  http = createServer();
  wire();
  await listen();
});

afterAll(async () => {
  await sync.close();
  await new Promise((resolve) => http.close(resolve));
  await rm(root, { recursive: true, force: true });
});

const open = (token: unknown) =>
  wsTransport(`ws://127.0.0.1:${port}/__fde_sync`, { auth: () => token });

const docText = (session: CollabSession, index: number) =>
  (session.doc.getXmlFragment("default").get(index) as Y.XmlElement).toString();

const textAt = (session: CollabSession, index: number): Y.XmlText => {
  const child = session.doc.getXmlFragment("default").get(index) as Y.XmlElement;
  return child.get(0) as Y.XmlText;
};

test("the auth payload reaches authenticate verbatim", async () => {
  const payload = { token: "abc", nested: { n: 1 } };
  const transport = open(payload);
  await transport.list();
  expect(seen).toContainEqual(payload);
  transport.close();
});

test("a rejected payload is denied, distinct from offline, without a retry loop", async () => {
  const transport = open("bad-once");
  await expect(transport.read("outside.mdx")).rejects.toThrow(/denied/);
  expect(transport.status()).toBe("denied");
  // no silent reconnect: authenticate never sees the token again
  await new Promise((resolve) => setTimeout(resolve, 700));
  expect(seen.filter((p) => p === "bad-once")).toHaveLength(1);
  transport.close();
}, 10000);

test("reconnects re-invoke the client auth hook and carry the fresh token", async () => {
  let calls = 0;
  const transport = wsTransport(`ws://127.0.0.1:${port}/__fde_sync`, {
    auth: () => (calls++ === 0 ? "admin" : "admin-fresh"),
  });
  await transport.list();
  // drop every socket but keep the sync server: the transport reconnects
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => http.close(resolve));
  http = createServer();
  wire();
  await listen();
  await until(() => (seen.includes("admin-fresh") ? true : undefined));
  expect(await transport.list()).toContainEqual({ path: "outside.mdx" });
  transport.close();
}, 10000);

test("nothing is processed before the hello; hello-less connections time out", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/__fde_sync`);
  const replies: { id: number; ok: boolean; error?: string }[] = [];
  ws.addEventListener("message", (event) => replies.push(JSON.parse(String(event.data))));
  ws.addEventListener("open", () =>
    ws.send(JSON.stringify({ id: 1, type: "read", path: "outside.mdx" })),
  );
  const code = await new Promise<number>((resolve) =>
    ws.addEventListener("close", (event) => resolve((event as CloseEvent).code)),
  );
  expect(code).toBe(4408);
  expect(replies).toEqual([{ id: 1, ok: false, error: "not authenticated" }]);
}, 10000);

test("subtree write scope: CAS writes gated on the normalized path", async () => {
  const transport = open("team-a");
  const inside = await transport.read("team-a/inside.mdx");
  expect(inside.user).toEqual({ name: "Ada" });
  expect(inside.writable).toBe(true);

  expect((await transport.write("team-a/inside.mdx", "# Inside v2\n", inside.version)).ok).toBe(
    true,
  );

  const outside = await transport.read("outside.mdx");
  expect(outside.writable).toBe(false);
  await expect(transport.write("outside.mdx", "# clobber\n", outside.version)).rejects.toThrow(
    /denied/,
  );
  // a traversal cannot smuggle the write past the predicate
  await expect(
    transport.write("team-a/../outside.mdx", "# clobber\n", outside.version),
  ).rejects.toThrow(/denied/);
  expect(await readFile(path.join(root, "outside.mdx"), "utf-8")).toBe("# Outside\n");
  transport.close();
});

test("subtree write scope: Y updates refused outside, applied inside", async () => {
  const transport = open("team-a");
  const denied = createCollabSession({ transport, path: "outside.mdx", components: [] });
  await denied.whenSynced;
  expect(denied.access).toEqual({ user: { name: "Ada" }, writable: false });
  textAt(denied, 0).insert(0, "HACK");
  expect(docText(denied, 0)).toContain("HACK"); // locally diverged, that is all

  const granted = createCollabSession({ transport, path: "team-a/shared.mdx", components: [] });
  await granted.whenSynced;
  expect(granted.access).toEqual({ user: { name: "Ada" }, writable: true });
  textAt(granted, 0).insert(0, "team:");

  // the authority never applied the refused update: a full-access peer sees
  // the untouched doc, and the disk still holds the original after the
  // authority's save window
  const admin = open("admin");
  const observer = createCollabSession({ transport: admin, path: "outside.mdx", components: [] });
  await observer.whenSynced;
  expect(docText(observer, 0)).not.toContain("HACK");

  await until(
    () =>
      readFile(path.join(root, "team-a/shared.mdx"), "utf-8").then((text) =>
        text.includes("team:") ? text : undefined,
      ),
    6000,
  );
  expect(await readFile(path.join(root, "outside.mdx"), "utf-8")).toBe("# Outside\n");

  denied.destroy();
  granted.destroy();
  observer.destroy();
  transport.close();
  admin.close();
}, 20000);

test("read predicate: filtered list, withheld broadcasts, refused joins", async () => {
  const reader = open("reader");
  const listed = (await reader.list()).map((entry) => entry.path);
  expect(listed).toContain("outside.mdx");
  expect(listed).not.toContain("secret/hidden.mdx");

  await expect(reader.read("secret/hidden.mdx")).rejects.toThrow(/denied/);
  await expect(
    reader.request({ type: "collab-open", path: "secret/hidden.mdx", components: [] }),
  ).rejects.toThrow(/denied/);

  const events: string[] = [];
  reader.watch("secret/hidden.mdx", () => events.push("secret"));
  reader.watch("outside.mdx", (state) => events.push(state.text));
  await reader.read("outside.mdx"); // socket open, watches registered

  const admin = open("admin");
  const hidden = await admin.read("secret/hidden.mdx");
  await admin.write("secret/hidden.mdx", "# Hidden v2\n", hidden.version);
  const outside = await admin.read("outside.mdx");
  await admin.write("outside.mdx", "# Outside v2\n", outside.version);

  await until(() => (events.includes("# Outside v2\n") ? true : undefined));
  expect(events).not.toContain("secret");

  // restore for later tests
  const current = await admin.read("outside.mdx");
  await admin.write("outside.mdx", "# Outside\n", current.version);
  reader.close();
  admin.close();
}, 10000);

test("a scope user overrides spoofed awareness before it reaches peers", async () => {
  const adminTransport = open("admin");
  const adaTransport = open("team-a");
  const adminSession = createCollabSession({
    transport: adminTransport,
    path: "team-a/inside.mdx",
    components: [],
  });
  const adaSession = createCollabSession({
    transport: adaTransport,
    path: "team-a/inside.mdx",
    components: [],
  });
  await adminSession.whenSynced;
  await adaSession.whenSynced;

  adaSession.awareness.setLocalStateField("user", { name: "Mallory", color: "#f00" });
  const state = await until(() => adminSession.awareness.getStates().get(adaSession.doc.clientID));
  // the name is pinned by the scope; unpinned cosmetic fields survive
  expect(state.user).toEqual({ name: "Ada", color: "#f00" });

  adminSession.destroy();
  adaSession.destroy();
  adminTransport.close();
  adaTransport.close();
}, 20000);

test("HTTP media endpoints authenticate via the header payload", async () => {
  const base = `http://127.0.0.1:${port}`;
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
