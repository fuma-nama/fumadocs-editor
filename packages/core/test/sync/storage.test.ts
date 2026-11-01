import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as Y from "yjs";
import type { CollabBinding } from "../../src/sync/collab";
import { fsStorage, type SyncStorage } from "../../src/sync/node/storage";
import type { WorkspaceTree } from "../../src/sync/tree";
import { connect, serve, sleep, textEditor, until } from "./helpers";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** three bytes at a time: a character can span two chunks */
async function* trickle(data: Uint8Array) {
  for (let i = 0; i < data.length; i += 3) yield data.subarray(i, i + 3);
}

/** what a database or a bucket would hold, streamed, with a change feed */
function memoryStorage(initial: Record<string, string>) {
  const files = new Map<string, Uint8Array>();
  for (const [path, text] of Object.entries(initial)) files.set(path, encoder.encode(text));
  const watchers = new Set<(path: string) => void>();
  const memory = {
    /** writes to refuse before the next one lands */
    failing: 0,
    storage: {
      name: "memory",
      list: async (dir) => [...files.keys()].filter((path) => !dir || path.startsWith(`${dir}/`)),
      async read(path) {
        const data = files.get(path);
        return data && trickle(data);
      },
      async write(path, data) {
        if (memory.failing > 0 && memory.failing--) throw new Error("storage unavailable");
        files.set(path, data);
      },
      delete: async (path) => void files.delete(path),
      watch(changed) {
        watchers.add(changed);
        return () => void watchers.delete(changed);
      },
    } satisfies SyncStorage,
    text: (path: string) => {
      const data = files.get(path);
      return data && decoder.decode(data);
    },
    /** a change made around the server */
    edit(path: string, text: string) {
      files.set(path, encoder.encode(text));
      for (const changed of watchers) changed(path);
    },
  };
  return memory;
}

const memory = memoryStorage({
  "index.mdx": "---\ntitle: Café ☕\n---\n",
  "guide/meta.json": JSON.stringify({ pages: ["intro"] }),
  "guide/intro.mdx": "# Intro\n",
  "retry.mdx": "retry\n",
});
let server: Awaited<ReturnType<typeof serve>>;

beforeAll(async () => {
  server = await serve({ storage: memory.storage });
});

afterAll(() => server.close());

const textAt = (binding: CollabBinding, index: number): Y.XmlText =>
  (binding.doc.getXmlFragment("default").get(index) as Y.XmlElement).get(0) as Y.XmlText;

const joinDoc = async (file: string) => {
  const client = connect(server.url, { collab: true });
  const session = client.open(file, { editor: textEditor().editor, components: [] });
  const binding = await until(() => session.collab() ?? undefined, 8000);
  return {
    binding,
    close() {
      session.close();
      client.close();
    },
  };
};

test("a storage of your own holds every file the server reads and writes", async () => {
  const client = connect(server.url);
  let tree: WorkspaceTree | undefined;
  client.onTree((next) => void (tree = next));
  await until(() => tree);
  expect(tree!.root).toBe("memory");
  // the title was decoded from chunks that split its characters
  expect(JSON.stringify(tree!.nodes)).toContain("Café ☕");

  // a save
  const local = textEditor();
  const doc = client.open("guide/intro.mdx", { editor: local.editor });
  expect(await doc.opened).toMatchObject({ text: "# Intro\n" });
  local.text = "# Intro\n\nsaved\n";
  doc.changed();
  await doc.flush();
  expect(memory.text("guide/intro.mdx")).toBe("# Intro\n\nsaved\n");

  // a change around the server reaches the open document
  memory.edit("guide/intro.mdx", "# Intro\n\nsaved\n\nfrom the feed\n");
  await until(() => (local.text.includes("from the feed") ? true : undefined));

  // tree commands write the page and the folder's explicit list
  await client.run({ type: "create", path: "guide/next.mdx", title: "Next" });
  expect(memory.text("guide/next.mdx")).toBe("---\ntitle: Next\n---\n");
  expect(JSON.parse(memory.text("guide/meta.json")!)).toEqual({ pages: ["intro", "next"] });
  await client.run({ type: "delete", path: "guide/next.mdx" });
  expect(memory.text("guide/next.mdx")).toBeUndefined();

  // uploads and assets
  const base = `http://127.0.0.1:${server.port}`;
  const uploaded = await fetch(`${base}/__fde_upload`, {
    method: "POST",
    body: new Blob(["png-bytes, streamed back"], { type: "image/png" }),
    headers: { "x-filename": "pic.png" },
  });
  const { src } = (await uploaded.json()) as { src: string };
  const relative = src.replace(/^\.\//, "");
  expect(memory.text(relative)).toBe("png-bytes, streamed back");
  const asset = await fetch(`${base}/__fde_asset/${relative}`);
  expect(await asset.text()).toBe("png-bytes, streamed back");

  doc.close();
  client.close();
}, 15000);

test("a failed collab save is tried again, and its edits are reported once it lands", async () => {
  const changes: string[] = [];
  const stop = server.sync.onChange(({ path }) => void changes.push(path));
  const a = await joinDoc("retry.mdx");
  memory.failing = 1;
  textAt(a.binding, 0).insert(0, "kept ");
  await until(() => (memory.text("retry.mdx")?.includes("kept") ? true : undefined), 8000);
  expect(memory.failing).toBe(0);
  await sleep(50);
  expect(changes).toEqual(["retry.mdx"]);
  stop();
  a.close();
}, 15000);

test("a large file in the content folder is read only as far as it is needed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fde-large-"));
  await mkdir(path.join(dir, "assets"));
  const page = `---\ntitle: Big\n---\n\n${"word ".repeat(4_000_000)}`;
  await writeFile(path.join(dir, "big.mdx"), page);
  const video = new Uint8Array(64 * 1024 * 1024).fill(1);
  await writeFile(path.join(dir, "assets/video.mp4"), video);

  // fsStorage, wrapped to count what is read from it
  const disk = fsStorage(dir);
  expect(await disk.read("missing.mdx")).toBeUndefined();
  expect(await disk.read("assets")).toBeUndefined(); // a folder
  let bytesRead = 0;
  const counted: SyncStorage = {
    ...disk,
    async read(file) {
      const data = await disk.read(file);
      if (!data || data instanceof Uint8Array) return data;
      return (async function* () {
        for await (const chunk of data) {
          bytesRead += chunk.length;
          yield chunk;
        }
      })();
    },
  };
  const large = await serve({ storage: counted });
  const client = connect(large.url);
  let tree: WorkspaceTree | undefined;
  client.onTree((next) => void (tree = next));
  // the title comes from the start of the page
  await until(() => (JSON.stringify(tree?.nodes ?? []).includes("Big") ? true : undefined));
  expect(bytesRead).toBeLessThan(64 * 1024);

  // changed around the server while nobody has it open: only its title is read again
  bytesRead = 0;
  await writeFile(path.join(dir, "big.mdx"), page.replace("title: Big", "title: Bigger"));
  await until(() => (JSON.stringify(tree?.nodes ?? []).includes("Bigger") ? true : undefined));
  await sleep(200);
  expect(bytesRead).toBeLessThan(64 * 1024);

  // the asset streams: the server reads ahead only by what the socket holds
  const response = await fetch(`http://127.0.0.1:${large.port}/__fde_asset/assets/video.mp4`);
  const reader = response.body!.getReader();
  let received = (await reader.read()).value!.length;
  expect(bytesRead).toBeLessThan(video.length / 2);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
  }
  expect(received).toBe(video.length);

  client.close();
  await large.close();
  await rm(dir, { recursive: true, force: true });
}, 30000);
