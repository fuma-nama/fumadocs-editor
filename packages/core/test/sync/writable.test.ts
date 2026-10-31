import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSyncClient } from "../../src/sync/client";
import type { SyncScope } from "../../src/sync/node/server";
import type { ClientMessage } from "../../src/sync/protocol";
import { wsTransport, type SyncTransport } from "../../src/sync/transport";
import { connect, online, serve, sleep, textEditor, until } from "./helpers";

let root: string;
let server: Awaited<ReturnType<typeof serve>>;

/** what the next connection authenticating as "person" may do */
let access: "writer" | "reader" = "writer";

const authenticate = async ({ payload }: { payload?: unknown }): Promise<SyncScope | null> =>
  payload === "person" ? { write: access === "writer" } : null;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "fde-writable-"));
  await writeFile(path.join(root, "page.mdx"), "# Page\n");
  await writeFile(path.join(root, "shared.mdx"), "# Shared\n");
  server = await serve({ root, authenticate });
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

/** the websocket transport, recording every message the client sends */
const recording = (url: string) => {
  const sent: ClientMessage[] = [];
  const inner = wsTransport(url);
  const transport: SyncTransport = {
    connect(listener) {
      const connection = inner.connect(listener);
      return {
        send(message) {
          sent.push(message);
          connection.send(message);
        },
        close: () => connection.close(),
      };
    },
  };
  return { sent, transport };
};

/** drops every connection; the client reconnects and authenticates under `next` */
const reconnectAs = async (next: typeof access, client: { status(): string }) => {
  access = next;
  await server.drop();
  await until(() => (client.status() !== "online" ? true : undefined));
  await until(() => (client.status() === "online" ? true : undefined), 8000);
};

test("a file document reports writable from the answer after a reconnect, and saves only while writable", async () => {
  access = "writer";
  const { sent, transport } = recording(server.url);
  const client = createSyncClient({ transport, auth: () => "person" });
  const local = textEditor();
  const doc = client.open("page.mdx", { editor: local.editor });
  expect(await doc.opened).toMatchObject({ writable: true });
  expect(doc.writable()).toBe(true);
  let heard = 0;
  doc.subscribe(() => void heard++);

  await reconnectAs("reader", client);
  await until(() => (doc.writable() ? undefined : true));
  expect(heard).toBeGreaterThan(0);

  // an edit while read-only stays local: no write is sent, refused and retried
  local.text = "# Page\n\nlocal edit\n";
  doc.changed();
  const writes = () => sent.filter((m) => m.type === "update" && m.resource === "file").length;
  await sleep(2000);
  expect(writes()).toBe(0);
  expect(doc.status()).toBe("dirty");
  expect(await readFile(path.join(root, "page.mdx"), "utf-8")).toBe("# Page\n");

  // write access back: the pending edit is saved
  await reconnectAs("writer", client);
  await until(() => (doc.writable() ? true : undefined));
  await until(
    () =>
      readFile(path.join(root, "page.mdx"), "utf-8").then((text) =>
        text.includes("local edit") ? true : undefined,
      ),
    6000,
  );
  await until(() => (doc.status() === "synced" ? true : undefined));
  doc.close();
  client.close();
}, 30000);

test("a collab document reports writable from the answer after a reconnect", async () => {
  access = "writer";
  const client = connect(server.url, { auth: () => "person", collab: true });
  await online(client);
  const doc = client.open("shared.mdx", { editor: textEditor().editor, components: [] });
  expect(await doc.opened).toMatchObject({ writable: true });
  expect(doc.writable()).toBe(true);

  await reconnectAs("reader", client);
  await until(() => (doc.writable() ? undefined : true), 8000);

  await reconnectAs("writer", client);
  await until(() => (doc.writable() ? true : undefined), 8000);
  doc.close();
  client.close();
}, 30000);
