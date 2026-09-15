import { bench, describe } from "vitest";
import * as Y from "yjs";
import { parseMdxToDoc } from "../src/document";
import { mergeRemote } from "../src/merge";
import { decodeMessage } from "../src/sync/codec";
import { createDocAuthority } from "../src/sync/node/authority";
import type { Connection } from "../src/sync/node/connection";
import { hashText, type Files } from "../src/sync/node/files";
import { ALLOW } from "../src/sync/node/scope";

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
  let saved = () => {};
  const files = {
    rel: (path: string) => path,
    watch() {},
    lock: (_path: string, task: () => Promise<unknown>) => task(),
    read: async () => ({ text, version: hashText(text) }),
    async write(_path: string, next: string) {
      text = next;
      saved();
      return hashText(next);
    },
  } as unknown as Files;
  let synced = false;
  const conn: Connection = {
    scope: ALLOW,
    send(data) {
      const message = decodeMessage(data);
      if (!synced && message.id !== undefined) Y.applyUpdate(client, message.yjs as Uint8Array);
    },
  };
  const authority = createDocAuthority({ files });
  const vector = () => Y.encodeStateVector(client);

  await authority.subscribe(conn, { id: 1, path: PATH, vector: vector(), components: [] });
  synced = true;
  client.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "bench") return;
    void authority.update(conn, { path: PATH, yjs: update });
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
    authority.leave(conn);
    await written;
    await settle();
    await authority.subscribe(conn, { path: PATH, vector: vector(), components: [] });
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
