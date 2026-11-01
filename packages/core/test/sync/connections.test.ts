import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as Y from "yjs";
import type { CollabBinding } from "../../src/sync/collab";
import type { SyncAuthenticate } from "../../src/sync/node/server";
import { connect, serve, sleep, textEditor, until } from "./helpers";

let root: string;
let server: Awaited<ReturnType<typeof serve>>;

/** what the next `authenticate` lets each payload do; absent = write */
const access = new Map<unknown, "write" | "read" | "hidden" | "refused">();

const authenticate: SyncAuthenticate = ({ payload }) => {
  const level = access.get(payload) ?? "write";
  if (level === "refused") return null;
  return { user: { name: String(payload) }, read: level !== "hidden", write: level === "write" };
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-connections-"));
  await mkdir(path.join(root, "guide"));
  await writeFile(path.join(root, "guide/meta.json"), JSON.stringify({ pages: ["index"] }));
  await writeFile(path.join(root, "guide/index.mdx"), "# Guide\n");
  await writeFile(path.join(root, "page.mdx"), "# Page\n");
  await writeFile(path.join(root, "shared.mdx"), "first\n");
  await writeFile(path.join(root, "notes.mdx"), "notes\n");
  await writeFile(path.join(root, "both.mdx"), "both\n");
  await writeFile(path.join(root, "private.mdx"), "private\n");
  await writeFile(path.join(root, "late.mdx"), "late\n");
  server = await serve({ root, authenticate });
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const read = (file: string) => readFile(path.join(root, file), "utf-8");

/** the open connection authenticated with `payload`, once there is one */
const connectionOf = (payload: string) =>
  until(() => server.sync.connections().find((connection) => connection.payload === payload));

const joinDoc = async (token: string, file: string, url = server.url) => {
  const client = connect(url, { auth: () => token, collab: true });
  const session = client.open(file, { editor: textEditor().editor, components: [] });
  const binding = await until(() => session.collab() ?? undefined, 8000);
  return {
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

test("connections() lists who authenticated; close() ends one, and authenticate decides again", async () => {
  const client = connect(server.url, { auth: () => "ann" });
  const first = await connectionOf("ann");
  expect(first.user).toEqual({ name: "ann" });
  expect(first.request.url).toBe("/__fde_sync");

  access.set("ann", "refused");
  first.close();
  expect(server.sync.connections()).not.toContain(first);
  // the client reconnects at once, and the session that ended is refused
  await until(() => (client.status() === "denied" ? true : undefined), 8000);
  client.close();
}, 10000);

test("a connection closed after its read access ended no longer receives live edits", async () => {
  const a = await joinDoc("ben", "shared.mdx");
  const b = await joinDoc("cy", "shared.mdx");
  textAt(b.binding, 0).insert(0, "one ");
  await until(() => (textAt(a.binding, 0).toString().includes("one") ? true : undefined));

  access.set("ben", "hidden");
  const first = await connectionOf("ben");
  first.close();
  // back online, with a scope that cannot read the document
  await until(() => server.sync.connections().find((c) => c.payload === "ben" && c !== first));
  await sleep(200);
  textAt(b.binding, 0).insert(0, "two ");
  await sleep(300);
  expect(textAt(a.binding, 0).toString()).not.toContain("two");
  // nor are its own edits taken
  textAt(a.binding, 0).insert(0, "HACK ");
  await sleep(300);
  expect(textAt(b.binding, 0).toString()).not.toContain("HACK");
  a.close();
  b.close();
}, 15000);

test("a writer back as a reader is told, and holds its saves back until write access returns", async () => {
  const client = connect(server.url, { auth: () => "dee" });
  const local = textEditor();
  const doc = client.open("page.mdx", { editor: local.editor });
  expect(await doc.opened).toMatchObject({ writable: true });
  const statuses: string[] = [];
  doc.subscribe(() => void statuses.push(doc.status()));

  access.set("dee", "read");
  (await connectionOf("dee")).close();
  await until(() => (doc.writable() ? undefined : true), 8000);

  // kept, not sent to be refused and retried
  local.text = "# Page\n\nlocal edit\n";
  doc.changed();
  await sleep(1500);
  expect(statuses).not.toContain("saving");
  expect(doc.status()).toBe("dirty");
  expect(await read("page.mdx")).toBe("# Page\n");

  access.delete("dee");
  (await connectionOf("dee")).close();
  await until(
    async () => ((await read("page.mdx")).includes("local edit") ? true : undefined),
    8000,
  );
  expect(doc.writable()).toBe(true);
  doc.close();
  client.close();
}, 20000);

test("an open document refused after a reconnect is no longer writable", async () => {
  const client = connect(server.url, { auth: () => "ida" });
  const doc = client.open("private.mdx", { editor: textEditor().editor });
  await doc.opened;
  access.set("ida", "hidden");
  (await connectionOf("ida")).close();
  // its saves wait, as a reader's do
  await until(() => (doc.writable() ? undefined : true), 8000);
  doc.close();
  client.close();
}, 20000);

test("a collab document follows write access across reconnects", async () => {
  const a = await joinDoc("eli", "notes.mdx");
  expect(a.session.writable()).toBe(true);

  access.set("eli", "read");
  (await connectionOf("eli")).close();
  await until(() => (a.session.writable() ? undefined : true), 8000);

  access.delete("eli");
  (await connectionOf("eli")).close();
  await until(() => (a.session.writable() ? true : undefined), 8000);
  a.close();
}, 20000);

test("onChange hears every file a connection changes, once it is on disk", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const changes: [string, unknown][] = [];
  // a failing listener is logged, and the others still hear the change
  const stopFailing = server.sync.onChange(() => {
    throw new Error("listener failed");
  });
  const stop = server.sync.onChange(({ path, connection }) => {
    changes.push([path, connection.payload]);
  });

  const client = connect(server.url, { auth: () => "fay" });
  const local = textEditor();
  const doc = client.open("guide/index.mdx", { editor: local.editor });
  await doc.opened;
  local.text = "# Guide\n\nsaved\n";
  doc.changed();
  await doc.flush();
  // the folder lists its pages: commands write its meta.json too
  await client.run({ type: "create", path: "guide/new.mdx", title: "New" });
  await client.run({ type: "delete", path: "guide/new.mdx" });
  await client.run({ type: "mkdir", dir: "guide/sub", title: "Sub" });
  await client.run({ type: "order", dir: "guide", order: ["sub", "index"] });
  // already in that order: nothing is written
  await client.run({ type: "order", dir: "guide", order: ["sub", "index"] });
  await until(() => (changes.length === 9 ? true : undefined));
  expect(changes).toEqual([
    ["guide/index.mdx", "fay"],
    ["guide/new.mdx", "fay"],
    ["guide/meta.json", "fay"],
    ["guide/new.mdx", "fay"],
    ["guide/meta.json", "fay"],
    ["guide/sub/meta.json", "fay"],
    ["guide/sub/index.mdx", "fay"],
    ["guide/meta.json", "fay"],
    ["guide/meta.json", "fay"],
  ]);
  expect(error).toHaveBeenCalled();

  // collab edits: with the debounced write, one change per connection it carries
  const a = await joinDoc("gus", "both.mdx");
  const b = await joinDoc("hal", "both.mdx");
  textAt(a.binding, 0).insert(0, "A ");
  textAt(b.binding, 0).insert(0, "B ");
  await until(() => (changes.length === 11 ? true : undefined), 6000);
  expect(changes.slice(9).sort()).toEqual([
    ["both.mdx", "gus"],
    ["both.mdx", "hal"],
  ]);

  // unsubscribed: a later save is not heard
  stop();
  stopFailing();
  local.text = "# Guide\n\nsaved again\n";
  doc.changed();
  await doc.flush();
  await sleep(100);
  expect(changes).toHaveLength(11);
  error.mockRestore();
  a.close();
  b.close();
  doc.close();
  client.close();
}, 20000);

test("setup gets the server once it exists, and what it returns runs last in close()", async () => {
  const events: string[] = [];
  const own = await serve({
    root,
    setup(sync) {
      events.push(`setup with ${sync.connections().length} connections`);
      sync.onChange(({ path }) => void events.push(`change ${path}`));
      return () => void events.push("cleanup");
    },
  });
  const a = await joinDoc("jo", "late.mdx", own.url);
  textAt(a.binding, 0).insert(0, "edited ");
  await sleep(100); // on the server, its save still waiting out the debounce
  await own.close();
  expect(events).toEqual(["setup with 0 connections", "change late.mdx", "cleanup"]);
  a.close();
}, 10000);
