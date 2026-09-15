import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createSyncClient, type SyncClient, type SyncDocument } from "../../src/sync/client";
import type { ServerMessage } from "../../src/sync/protocol";
import type { SyncTransport, TransportListener } from "../../src/sync/transport";
import { textEditor } from "./helpers";

const hashText = (text: string) => createHash("sha1").update(text).digest("hex");

/** a protocol backend in memory, with a disk the test controls */
function memoryBackend() {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const peers = new Set<{ listener: TransportListener; paths: Set<string> }>();
  let up = true;

  const state = (path: string) => {
    const text = files.get(path) ?? "";
    return { text, version: text === "" ? "" : hashText(text) };
  };
  const later = (task: () => void) => void Promise.resolve().then(task);
  const push = (path: string, except?: object) => {
    for (const peer of peers) {
      if (peer === except || !peer.paths.has(path)) continue;
      later(() =>
        peer.listener.message({ type: "update", resource: "file", path, ...state(path) }),
      );
    }
  };
  const drop = (peer: { listener: TransportListener }) => {
    if (peers.delete(peer as never)) later(() => peer.listener.close());
  };

  const transport: SyncTransport = {
    connect(listener) {
      const peer = { listener, paths: new Set<string>() };
      later(() => {
        if (!up) return listener.close();
        peers.add(peer);
        listener.open();
      });
      const answer = (message: ServerMessage) =>
        later(() => peers.has(peer) && listener.message(message));
      return {
        send(message) {
          if (!peers.has(peer)) return;
          if (message.type === "hello") return answer({ type: "hello", id: message.id });
          if (message.type === "unsubscribe" || message.resource !== "file") return;
          const { path } = message;
          if (message.type === "subscribe") {
            peer.paths.add(path);
            return answer({
              type: "update",
              id: message.id,
              resource: "file",
              path,
              ...state(path),
            });
          }
          if (state(path).version !== message.base) {
            return answer({
              type: "update",
              id: message.id,
              resource: "file",
              path,
              ...state(path),
            });
          }
          files.set(path, message.text);
          writes.push(message.text);
          push(path, peer);
          answer({
            type: "update",
            id: message.id,
            resource: "file",
            path,
            version: state(path).version,
          });
        },
        close: () => drop(peer),
      };
    },
  };

  return {
    transport,
    writes,
    /** an external process changes the file */
    external(path: string, text: string, notify = true) {
      files.set(path, text);
      if (notify) push(path);
    },
    setOnline(next: boolean) {
      up = next;
      if (!next) for (const peer of peers) drop(peer);
    },
    disk: (path: string) => files.get(path),
  };
}

let mem: ReturnType<typeof memoryBackend>;
let client: SyncClient;
let doc: ReturnType<typeof textEditor>;
let session: SyncDocument;

beforeEach(async () => {
  vi.useFakeTimers();
  mem = memoryBackend();
  mem.external("doc.mdx", "# One\n");
  client = createSyncClient({ transport: mem.transport });
  doc = textEditor();
  session = client.open("doc.mdx", { editor: doc.editor });
  doc.text = (await session.opened).text;
});

afterEach(() => {
  session.close();
  client.close();
  vi.useRealTimers();
});

test("autosave: trailing debounce writes once after a burst", async () => {
  doc.text = "# One!\n";
  session.changed();
  await vi.advanceTimersByTimeAsync(500);
  doc.text = "# One!!\n";
  session.changed();
  expect(mem.writes).toEqual([]);
  await vi.advanceTimersByTimeAsync(800);
  expect(mem.writes).toEqual(["# One!!\n"]);
  expect(session.status()).toBe("synced");
});

test("autosave: the max-wait cap fires under continuous typing", async () => {
  for (let i = 0; i < 10; i++) {
    doc.text = `# One ${i}\n`;
    session.changed();
    await vi.advanceTimersByTimeAsync(600);
  }
  expect(mem.writes.length).toBeGreaterThan(0);
});

test("a clean external change merges in and stays synced", async () => {
  mem.external("doc.mdx", "# One, from disk\n");
  await vi.advanceTimersByTimeAsync(1);
  expect(doc.merged).toEqual(["# One, from disk\n"]);
  expect(session.status()).toBe("synced");
  expect(mem.writes).toEqual([]);
});

test("losing the CAS race merges the disk text, then saves the weave", async () => {
  // the disk moves ahead without a push
  mem.external("doc.mdx", "# One, disk\n", false);
  doc.text = "# One, local\n";
  session.changed();
  await vi.advanceTimersByTimeAsync(900);
  expect(doc.merged).toEqual(["# One, disk\n"]);
  await vi.advanceTimersByTimeAsync(900);
  expect(mem.disk("doc.mdx")).toBe("# One, disk\n");
  expect(session.status()).toBe("synced");
});

test("same-block conflict pauses writes until resolved", async () => {
  doc.conflicts = [0];
  doc.text = "# One, local\n";
  session.changed();
  mem.external("doc.mdx", "# One, disk\n");
  await vi.advanceTimersByTimeAsync(1);
  expect(session.status()).toBe("conflict");

  await vi.advanceTimersByTimeAsync(10_000);
  expect(mem.writes).toEqual([]);

  doc.conflicts = [];
  await session.keepMine();
  expect(mem.disk("doc.mdx")).toBe("# One, local\n");
  expect(session.status()).toBe("synced");
});

test("take disk drops local edits for the latest disk version", async () => {
  doc.conflicts = [0];
  doc.text = "# One, local\n";
  session.changed();
  mem.external("doc.mdx", "# One, disk\n");
  await vi.advanceTimersByTimeAsync(1);
  expect(session.status()).toBe("conflict");
  mem.external("doc.mdx", "# One, disk again\n");
  await vi.advanceTimersByTimeAsync(1);

  await session.takeDisk();
  expect(doc.text).toBe("# One, disk again\n");
  expect(session.status()).toBe("synced");
  expect(mem.writes).toEqual([]);
});

test("offline edits flush on reconnect", async () => {
  mem.setOnline(false);
  doc.text = "# One, offline edit\n";
  session.changed();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mem.writes).toEqual([]);
  expect(session.status()).toBe("offline");

  mem.setOnline(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mem.writes).toEqual(["# One, offline edit\n"]);
  expect(session.status()).toBe("synced");
});

test("a disk change made while offline arrives with the reconnect", async () => {
  mem.setOnline(false);
  await vi.advanceTimersByTimeAsync(1);
  mem.external("doc.mdx", "# One, changed while away\n");
  mem.setOnline(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(doc.text).toBe("# One, changed while away\n");
  expect(mem.writes).toEqual([]);
});

test("a client holds one document per path", () => {
  expect(() => client.open("doc.mdx", { editor: textEditor().editor })).toThrow(/already open/);
});

test("opening while the server is unreachable rejects, and a later answer merges in", async () => {
  mem.setOnline(false);
  const late = createSyncClient({ transport: mem.transport });
  const fallback = textEditor("fallback\n");
  const pending = late.open("doc.mdx", { editor: fallback.editor });
  await expect(pending.opened).rejects.toThrow(/offline/);

  mem.setOnline(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fallback.text).toBe("# One\n");
  pending.close();
  late.close();
});
