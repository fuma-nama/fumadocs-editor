import { bench, describe } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import { parseMdxToDoc } from "../src/document";
import { mergeRemote } from "../src/merge";
import { createDocAuthority } from "../src/sync/node/authority";
import { hashText } from "../src/sync/node/mirror";
import { MESSAGE_SYNC, collabFrame, readCollabFrame } from "../src/sync/wire";

const PATH = "doc.mdx";

// every block unique: repeated identical blocks would benchmark block matching
const section = (i: number) => `## Section ${i}

Paragraph ${i} explains a feature with **bold**, _italic_, \`inline code\` and a [link](/docs/${i}), long enough to read like documentation prose.

- First point of section ${i}
- Second point with \`code\`

\`\`\`ts title="example-${i}.ts"
export const value${i} = ${i};
\`\`\`

<Callout title="Note ${i}">
  Callouts hold **markdown** children, like section ${i}.
</Callout>

`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

function corpus(bytes: number): string {
  let text = "";
  for (let i = 0; text.length < bytes; i++) text += section(i);
  return text;
}

/** an authority over one in-memory file, and a synced client editing a paragraph in the middle */
async function authoritySave(text: string) {
  const client = new Y.Doc();
  const conn = {};
  let saved = () => {};
  let synced = false;
  const authority = createDocAuthority<object>({
    read: async () => ({ text, version: hashText(text) }),
    async write(_path, next) {
      text = next;
      saved();
      return hashText(next);
    },
    send(_conn, data) {
      const frame = readCollabFrame(data);
      if (!synced && frame.kind === MESSAGE_SYNC) {
        syncProtocol.readSyncMessage(frame.decoder, encoding.createEncoder(), client, null);
      }
    },
    scope: () => ({ write: () => true }),
  });

  await authority.open(PATH, conn, []);
  const step1 = collabFrame(PATH, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(step1, client);
  authority.handleBinary(conn, encoding.toUint8Array(step1));
  await settle();
  synced = true;
  client.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "bench") return;
    const frame = collabFrame(PATH, MESSAGE_SYNC);
    syncProtocol.writeUpdate(frame, update);
    authority.handleBinary(conn, encoding.toUint8Array(frame));
  });

  const fragment = client.getXmlFragment("default");
  let index = fragment.length >> 1;
  while ((fragment.get(index) as Y.XmlElement).nodeName !== "paragraph") index++;
  const paragraph = (fragment.get(index) as Y.XmlElement).get(0) as Y.XmlText;

  let grow = true;
  return async () => {
    client.transact(() => {
      if (grow) paragraph.insert(0, "x");
      else paragraph.delete(0, 1);
    }, "bench");
    grow = !grow;
    await settle();
    const written = new Promise<void>((resolve) => (saved = resolve));
    // the last client leaving flushes without waiting out the debounce
    authority.disconnect(conn);
    await written;
    await settle();
    await authority.open(PATH, conn, []);
  };
}

/** the disk text gains a sentence in a paragraph in the middle */
function diskMerge(text: string) {
  const { doc, snapshot } = parseMdxToDoc(text);
  const end = text.indexOf("\n", text.indexOf("\nParagraph ", text.length >> 1) + 1);
  const remoteText = `${text.slice(0, end)} Edited on disk.${text.slice(end)}`;
  return () => {
    mergeRemote({ base: snapshot, local: doc, remoteText });
  };
}

const sizes = [
  ["20 KB", 20_000],
  ["100 KB", 100_000],
  ["1 MB", 1_000_000],
] as const;

for (const [label, bytes] of sizes) {
  const text = corpus(bytes);
  const save = await authoritySave(text);
  const merge = diskMerge(text);
  describe(label, () => {
    bench("authority save after a one-paragraph edit", save);
    bench("mergeRemote of a one-paragraph disk edit", merge);
  });
}
