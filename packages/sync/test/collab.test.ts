import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { createSyncServer, type SyncServer } from "../src/node";
import { wsTransport, type WsTransport } from "../src/client";
import { createCollabSession, type CollabSession } from "../src/collab";

let root: string;
let http: Server;
let sync: SyncServer;
let port: number;

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

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-collab-"));
  await writeFile(path.join(root, "doc.mdx"), "* bullet one\n\nhello\n");
  sync = createSyncServer({ root });
  http = createServer();
  http.on("upgrade", (request, socket, head) => {
    if (request.url === "/__fde_sync") sync.handleUpgrade(request, socket, head);
  });
  await listen();
});

afterAll(async () => {
  await sync.close();
  await new Promise((resolve) => http.close(resolve));
  await rm(root, { recursive: true, force: true });
});

const openTransport = () => wsTransport(`ws://127.0.0.1:${port}/__fde_sync`);

function openSession(transport: WsTransport, extra?: { doc?: Y.Doc; onReset?: () => void }) {
  return createCollabSession({ transport, path: "doc.mdx", components: [], ...extra });
}

/** the first text leaf of top-level child `index` (paragraphs hold one) */
const textAt = (session: CollabSession, index: number): Y.XmlText => {
  const child = session.doc.getXmlFragment("default").get(index) as Y.XmlElement;
  return child.get(0) as Y.XmlText;
};

const docText = (session: CollabSession) =>
  (session.doc.getXmlFragment("default").get(1) as Y.XmlElement).toString();

test("a session syncs the parsed document from the server", async () => {
  const transport = openTransport();
  const session = openSession(transport);
  await session.whenSynced;
  const fragment = session.doc.getXmlFragment("default");
  expect(fragment.length).toBe(2); // bulletList, paragraph
  expect((fragment.get(0) as Y.XmlElement).nodeName).toBe("bulletList");
  expect(docText(session)).toBe("<paragraph>hello</paragraph>");
  session.destroy();
  transport.close();
}, 20000);

test("a client edit is written to disk, unedited blocks byte-identical", async () => {
  const transport = openTransport();
  const session = openSession(transport);
  await session.whenSynced;
  textAt(session, 1).insert(5, " world");
  // the authority debounces 800ms, then writes and re-parses its own output
  const text = await until(
    () =>
      readFile(path.join(root, "doc.mdx"), "utf-8").then((current) =>
        current.includes("world") ? current : undefined,
      ),
    6000,
  );
  // `* bullet one` normalizes to `- bullet one`; only snapshot byte reuse
  // can emit the original
  expect(text).toBe("* bullet one\n\nhello world\n");
  session.destroy();
  transport.close();
}, 20000);

test("two clients converge through the server relay", async () => {
  const transportA = openTransport();
  const transportB = openTransport();
  const a = openSession(transportA);
  const b = openSession(transportB);
  await a.whenSynced;
  await b.whenSynced;
  textAt(a, 1).insert(0, "A:");
  await until(() => (docText(b).includes("A:") ? true : undefined));
  textAt(b, 1).insert(0, "B:");
  await until(() => (docText(a).includes("B:") ? true : undefined));
  expect(docText(a)).toBe(docText(b));
  a.destroy();
  b.destroy();
  transportA.close();
  transportB.close();
}, 20000);

test("presence reaches peers and clears when they leave", async () => {
  const transportA = openTransport();
  const transportB = openTransport();
  const a = openSession(transportA);
  const b = openSession(transportB);
  await a.whenSynced;
  await b.whenSynced;
  a.awareness.setLocalStateField("user", { name: "Ada", color: "#00f" });
  await until(() => (b.awareness.getStates().get(a.doc.clientID) ? true : undefined));
  expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({
    user: { name: "Ada", color: "#00f" },
  });
  a.destroy();
  transportA.close();
  await until(() => (b.awareness.getStates().has(a.doc.clientID) ? undefined : true));
  b.destroy();
  transportB.close();
}, 20000);

test("a disk edit merges into every client without touching their blocks", async () => {
  const transportA = openTransport();
  const transportB = openTransport();
  const a = openSession(transportA);
  const b = openSession(transportB);
  await a.whenSynced;
  await b.whenSynced;
  const current = await readFile(path.join(root, "doc.mdx"), "utf-8");
  // A types (unsaved) while the disk gains a new trailing block
  const paragraph = textAt(a, 1);
  paragraph.insert(paragraph.length, "!");
  await new Promise((resolve) => setTimeout(resolve, 150));
  await writeFile(path.join(root, "doc.mdx"), `${current}\n## From disk\n`);
  await until(() => {
    const fragment = b.doc.getXmlFragment("default");
    return fragment.length === 3 ? true : undefined;
  }, 6000);
  // both clients hold the merged doc: the disk's new block and A's edit
  expect((b.doc.getXmlFragment("default").get(2) as Y.XmlElement).toString()).toContain(
    "From disk",
  );
  expect(docText(b)).toContain("!");
  await until(() => (a.doc.getXmlFragment("default").length === 3 ? true : undefined));
  // and the authority weaves both back to disk
  await until(
    () =>
      readFile(path.join(root, "doc.mdx"), "utf-8").then((text) =>
        text.includes("!") && text.includes("From disk") ? text : undefined,
      ),
    6000,
  );
  a.destroy();
  b.destroy();
  transportA.close();
  transportB.close();
}, 20000);

test("a mirror client's CAS write reaches the collab doc", async () => {
  const transport = openTransport();
  const session = openSession(transport);
  await session.whenSynced;
  // a plain (non-collab) client writes through the JSON protocol; its
  // chokidar echo is suppressed, so the authority must be fed directly
  const mirror = openTransport();
  const state = await mirror.read("doc.mdx");
  const written = await mirror.write("doc.mdx", `${state.text}\nmirror block\n`, state.version);
  expect(written.ok).toBe(true);
  await until(() => {
    const fragment = session.doc.getXmlFragment("default");
    const last = fragment.get(fragment.length - 1) as Y.XmlElement;
    return last.toString().includes("mirror block") ? true : undefined;
  }, 6000);
  session.destroy();
  transport.close();
  mirror.close();
}, 20000);

test("edits buffered while offline converge after reconnecting", async () => {
  const transportA = openTransport();
  const a = openSession(transportA);
  await a.whenSynced;
  // hard-disconnect: edits queue in the local Y.Doc only
  transportA.close();
  textAt(a, 1).insert(0, "offline:");
  a.destroy();
  // reconnect as a new session carrying the same Y.Doc (same client state)
  const transportB = openTransport();
  const b = openSession(transportB, { doc: a.doc });
  await b.whenSynced;
  await until(
    () =>
      readFile(path.join(root, "doc.mdx"), "utf-8").then((text) =>
        text.includes("offline:") ? text : undefined,
      ),
    6000,
  );
  b.destroy();
  transportB.close();
}, 20000);

test("a server restart changes the epoch and resets the session", async () => {
  const transport = openTransport();
  let resets = 0;
  const session = openSession(transport, { onReset: () => resets++ });
  await session.whenSynced;

  await sync.close();
  await new Promise((resolve) => http.close(resolve));
  sync = createSyncServer({ root });
  http = createServer();
  http.on("upgrade", (request, socket, head) => {
    if (request.url === "/__fde_sync") sync.handleUpgrade(request, socket, head);
  });
  await listen();

  await until(() => (resets > 0 ? true : undefined), 8000);
  expect(resets).toBe(1);
  session.destroy();
  transport.close();
}, 20000);
