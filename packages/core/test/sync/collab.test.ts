import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as Y from "yjs";
import type { CollabBinding } from "../../src/sync/collab";
import { connect, online, serve, sleep, textEditor, until } from "./helpers";

let root: string;
let server: Awaited<ReturnType<typeof serve>>;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-collab-"));
  await writeFile(path.join(root, "doc.mdx"), "* bullet one\n\nhello\n");
  server = await serve({ root });
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const disk = () => readFile(path.join(root, "doc.mdx"), "utf-8");

async function join(file = "doc.mdx") {
  const client = connect(server.url, { collab: true });
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
}

/** the first text leaf of top-level child `index` (paragraphs hold one) */
const textAt = (binding: CollabBinding, index: number): Y.XmlText =>
  (binding.doc.getXmlFragment("default").get(index) as Y.XmlElement).get(0) as Y.XmlText;

const paragraph = (binding: CollabBinding) =>
  (binding.doc.getXmlFragment("default").get(1) as Y.XmlElement).toString();

test("a session syncs the parsed document from the server", async () => {
  const a = await join();
  const fragment = a.binding.doc.getXmlFragment("default");
  expect(fragment.length).toBe(2);
  expect((fragment.get(0) as Y.XmlElement).nodeName).toBe("bulletList");
  expect(paragraph(a.binding)).toBe("<paragraph>hello</paragraph>");
  expect(await a.session.opened).toEqual({ text: "* bullet one\n\nhello\n", writable: true });
  a.close();
}, 20000);

test("a client edit is written to disk, unedited blocks byte-identical", async () => {
  const a = await join();
  textAt(a.binding, 1).insert(5, " world");
  const text = await until(
    () => disk().then((current) => (current.includes("world") ? current : undefined)),
    6000,
  );
  // `* bullet one` normalizes to `- bullet one`; only snapshot byte reuse can emit the original
  expect(text).toBe("* bullet one\n\nhello world\n");
  a.close();
}, 20000);

test("two clients converge through the server relay", async () => {
  const a = await join();
  const b = await join();
  textAt(a.binding, 1).insert(0, "A:");
  await until(() => (paragraph(b.binding).includes("A:") ? true : undefined));
  textAt(b.binding, 1).insert(0, "B:");
  await until(() => (paragraph(a.binding).includes("B:") ? true : undefined));
  expect(paragraph(a.binding)).toBe(paragraph(b.binding));
  a.close();
  b.close();
}, 20000);

test("presence reaches peers and clears when they leave", async () => {
  const a = await join();
  const b = await join();
  a.binding.awareness.setLocalStateField("user", { name: "Ada", color: "#00f" });
  const id = a.binding.doc.clientID;
  await until(() => b.binding.awareness.getStates().get(id));
  expect(b.binding.awareness.getStates().get(id)).toEqual({ user: { name: "Ada", color: "#00f" } });
  a.close();
  await until(() => (b.binding.awareness.getStates().has(id) ? undefined : true));
  b.close();
}, 20000);

test("a disk edit merges into every client without touching their blocks", async () => {
  const a = await join();
  const b = await join();
  const current = await disk();
  const text = textAt(a.binding, 1);
  text.insert(text.length, "!");
  await sleep(150);
  await writeFile(path.join(root, "doc.mdx"), `${current}\n## From disk\n`);
  const length = (binding: CollabBinding) => binding.doc.getXmlFragment("default").length;
  await until(() => (length(b.binding) === 3 ? true : undefined), 6000);
  expect((b.binding.doc.getXmlFragment("default").get(2) as Y.XmlElement).toString()).toContain(
    "From disk",
  );
  expect(paragraph(b.binding)).toContain("!");
  await until(() => (length(a.binding) === 3 ? true : undefined));
  await until(
    () => disk().then((t) => (t.includes("!") && t.includes("From disk") ? t : undefined)),
    6000,
  );
  a.close();
  b.close();
}, 20000);

test("a file session's write reaches the collab doc", async () => {
  const a = await join();
  const plain = connect(server.url);
  const doc = textEditor();
  const session = plain.open("doc.mdx", { editor: doc.editor });
  doc.text = `${(await session.opened).text}\nfile block\n`;
  session.changed();
  await session.flush();
  await until(() => {
    const fragment = a.binding.doc.getXmlFragment("default");
    const last = fragment.get(fragment.length - 1) as Y.XmlElement;
    return last.toString().includes("file block") ? true : undefined;
  }, 6000);
  session.close();
  plain.close();
  a.close();
}, 20000);

test("edits made while disconnected converge after the reconnect", async () => {
  const a = await join();
  await server.drop();
  await until(() => (a.client.status() === "offline" ? true : undefined));
  textAt(a.binding, 1).insert(0, "offline:");
  await online(a.client);
  await until(() => disk().then((t) => (t.includes("offline:") ? t : undefined)), 8000);
  a.close();
}, 20000);

test("a server restart changes the epoch and re-seeds the session", async () => {
  const a = await join();
  const first = a.binding;
  const bindings: (CollabBinding | null)[] = [];
  a.session.subscribe(() => bindings.push(a.session.collab()));

  await server.restart();
  const next = await until(() => {
    const current = a.session.collab();
    return current && current !== first ? current : undefined;
  }, 8000);
  expect(bindings).toContain(null);
  expect(next.doc.getXmlFragment("default").length).toBeGreaterThan(0);
  a.close();
}, 20000);
