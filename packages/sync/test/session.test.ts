import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createFileSession, type FileSession } from "../src/session";
import type { FileState, SyncTransport } from "../src/transport";
import { createHash } from "node:crypto";

const hashText = (text: string) => createHash("sha1").update(text).digest("hex");

/** in-memory transport with a controllable "disk" */
function memoryTransport() {
  const files = new Map<string, string>();
  const watchers = new Map<string, Set<(state: FileState) => void>>();
  const statusListeners = new Set<(status: "online" | "offline") => void>();
  let online = true;
  const writes: string[] = [];

  const state = (path: string): FileState => {
    const text = files.get(path) ?? "";
    return { text, version: text === "" ? "" : hashText(text) };
  };

  const transport: SyncTransport & {
    onStatus: (l: (status: "online" | "offline") => void) => () => void;
  } = {
    list: async () => [...files.keys()],
    read: async (path) => state(path),
    async write(path, text, baseVersion) {
      if (!online) throw new Error("sync offline");
      if (state(path).version !== baseVersion) return { ok: false, current: state(path) };
      files.set(path, text);
      writes.push(text);
      return { ok: true, version: hashText(text) };
    },
    watch(path, onChange) {
      const set = watchers.get(path) ?? new Set();
      set.add(onChange);
      watchers.set(path, set);
      return () => set.delete(onChange);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      listener(online ? "online" : "offline");
      return () => statusListeners.delete(listener);
    },
  };

  return {
    transport,
    writes,
    /** an external process changes the file */
    external(path: string, text: string, notify = true) {
      files.set(path, text);
      if (!notify) return;
      for (const listener of watchers.get(path) ?? []) listener(state(path));
    },
    setOnline(next: boolean) {
      online = next;
      for (const listener of statusListeners) listener(next ? "online" : "offline");
    },
    disk: (path: string) => files.get(path),
  };
}

let mem: ReturnType<typeof memoryTransport>;
let session: FileSession;
let text: string;
let statuses: string[];
let remoteApplied: string[];
let conflictsToReport: number[];

beforeEach(async () => {
  vi.useFakeTimers();
  mem = memoryTransport();
  mem.external("doc.mdx", "# One\n");
  statuses = [];
  remoteApplied = [];
  conflictsToReport = [];
  session = createFileSession({
    transport: mem.transport,
    path: "doc.mdx",
    document: {
      getMarkdown: () => text,
      applyExternalMarkdown: async (remote) => {
        remoteApplied.push(remote);
        if (conflictsToReport.length === 0) text = remote; // clean merge: adopt disk
        return conflictsToReport;
      },
      setMarkdown: async (remote) => {
        text = remote;
      },
      markSaved: (saved) => saved,
    },
    onStatus: (status) => statuses.push(status),
  });
  text = (await session.open()).text;
});

afterEach(() => {
  session.close();
  vi.useRealTimers();
});

test("autosave: trailing debounce writes once after a burst", async () => {
  text = "# One!\n";
  session.changed();
  await vi.advanceTimersByTimeAsync(500);
  text = "# One!!\n";
  session.changed();
  expect(mem.writes).toEqual([]);
  await vi.advanceTimersByTimeAsync(800);
  expect(mem.writes).toEqual(["# One!!\n"]);
  expect(session.status()).toBe("synced");
});

test("autosave: the max-wait cap fires under continuous typing", async () => {
  for (let i = 0; i < 10; i++) {
    text = `# One ${i}\n`;
    session.changed();
    await vi.advanceTimersByTimeAsync(600); // always inside the trailing window
  }
  expect(mem.writes.length).toBeGreaterThan(0);
});

test("a clean external change merges in and stays synced", async () => {
  mem.external("doc.mdx", "# One, from disk\n");
  await vi.advanceTimersByTimeAsync(1);
  expect(remoteApplied).toEqual(["# One, from disk\n"]);
  expect(session.status()).toBe("synced");
  expect(mem.writes).toEqual([]);
});

test("losing the CAS race merges the disk text, then saves the weave", async () => {
  // disk moves ahead without a watch event (e.g. brief disconnect)
  mem.external("doc.mdx", "# One, disk\n", false);

  text = "# One, local\n";
  session.changed();
  // applyRemote merges: local + disk
  conflictsToReport = [];
  await vi.advanceTimersByTimeAsync(900);
  // second save cycle writes the merged text
  await vi.advanceTimersByTimeAsync(900);
  expect(mem.disk("doc.mdx")).toBe("# One, disk\n"); // adopted by clean merge
  expect(session.status()).toBe("synced");
});

test("same-block conflict pauses writes until resolved", async () => {
  conflictsToReport = [0];
  text = "# One, local\n";
  session.changed();
  mem.external("doc.mdx", "# One, disk\n");
  await vi.advanceTimersByTimeAsync(1);
  expect(session.status()).toBe("conflict");

  await vi.advanceTimersByTimeAsync(10_000);
  expect(mem.writes).toEqual([]); // paused

  conflictsToReport = [];
  await session.keepMine();
  expect(mem.disk("doc.mdx")).toBe("# One, local\n");
  expect(session.status()).toBe("synced");
});

test("take disk drops local edits for the disk version", async () => {
  conflictsToReport = [0];
  text = "# One, local\n";
  session.changed();
  mem.external("doc.mdx", "# One, disk\n");
  await vi.advanceTimersByTimeAsync(1);
  expect(session.status()).toBe("conflict");

  await session.takeDisk();
  expect(text).toBe("# One, disk\n");
  expect(session.status()).toBe("synced");
  expect(mem.writes).toEqual([]);
});

test("offline edits flush on reconnect", async () => {
  mem.setOnline(false);
  text = "# One, offline edit\n";
  session.changed();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mem.writes).toEqual([]);
  expect(session.status()).toBe("offline");

  mem.setOnline(true);
  await vi.advanceTimersByTimeAsync(900);
  expect(mem.writes).toEqual(["# One, offline edit\n"]);
  expect(session.status()).toBe("synced");
});
