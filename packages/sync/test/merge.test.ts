import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { parseMdxToDoc } from "@fumadocs-editor/core/parse";
import { serializeDocToMdx, tryNormalize } from "@fumadocs-editor/core/serialize";
import { createRegistry } from "@fumadocs-editor/core";
import { mergeRemote, type MergeOp } from "../src/merge";

const registry = createRegistry();

const baseText = `# Title

Para one.

Para two.

Para three.
`;

function normalized(doc: JSONContent): string[] {
  const out: string[] = [];
  for (const node of doc.content ?? []) out.push(tryNormalize(node, registry) ?? "");
  return out;
}

/** reference implementation of the op contract, over plain JSON children */
function apply(children: JSONContent[], ops: MergeOp[]): JSONContent[] {
  const replaced = new Map<number, JSONContent>();
  const deleted = new Set<number>();
  const inserts = new Map<number, JSONContent[]>();
  for (const op of ops) {
    if (op.type === "replace") replaced.set(op.local, op.node);
    else if (op.type === "delete") deleted.add(op.local);
    else {
      const list = inserts.get(op.after) ?? [];
      list.push(op.node);
      inserts.set(op.after, list);
    }
  }
  const out: JSONContent[] = [...(inserts.get(-1) ?? [])];
  children.forEach((child, i) => {
    if (!deleted.has(i)) out.push(replaced.get(i) ?? child);
    out.push(...(inserts.get(i) ?? []));
  });
  return out;
}

function editText(doc: JSONContent, childIndex: number, text: string): JSONContent {
  const edited = structuredClone(doc);
  edited.content![childIndex].content = [{ type: "text", text }];
  return edited;
}

describe("mergeRemote", () => {
  test("remote-only change applies cleanly; result serializes to the disk text", () => {
    const base = parseMdxToDoc(baseText, registry);
    const remoteText = baseText.replace("Para two.", "Para two, edited on disk.");

    const result = mergeRemote({
      base: base.snapshot,
      localNormalized: normalized(base.doc),
      remoteText,
    });

    expect(result.conflicts).toEqual([]);
    const merged = apply(base.doc.content!, result.ops);
    expect(serializeDocToMdx({ type: "doc", content: merged }, result.remote.snapshot)).toBe(
      remoteText,
    );
  });

  test("disjoint edits merge: local block kept, remote block taken", () => {
    const base = parseMdxToDoc(baseText, registry);
    const local = editText(base.doc, 1, "Para one, edited locally.");
    const remoteText = baseText.replace("Para three.", "Para three, from disk.");

    const result = mergeRemote({
      base: base.snapshot,
      localNormalized: normalized(local),
      remoteText,
    });

    expect(result.conflicts).toEqual([]);
    const merged = apply(local.content!, result.ops);
    const out = serializeDocToMdx({ type: "doc", content: merged }, result.remote.snapshot);
    expect(out).toContain("Para one, edited locally.");
    expect(out).toContain("Para three, from disk.");
    expect(out).not.toContain("Para one.\n");
    expect(out).not.toContain("Para three.\n");
  });

  test("same-block edits conflict and keep the local version", () => {
    const base = parseMdxToDoc(baseText, registry);
    const local = editText(base.doc, 2, "Para two, local.");
    const remoteText = baseText.replace("Para two.", "Para two, disk.");

    const result = mergeRemote({
      base: base.snapshot,
      localNormalized: normalized(local),
      remoteText,
    });

    expect(result.conflicts).toEqual([2]);
    const merged = apply(local.content!, result.ops);
    const out = serializeDocToMdx({ type: "doc", content: merged }, result.remote.snapshot);
    expect(out).toContain("Para two, local.");
    expect(out).not.toContain("Para two, disk.");
  });

  test("remote insert and delete around an untouched local edit", () => {
    const base = parseMdxToDoc(baseText, registry);
    const local = editText(base.doc, 1, "Para one, local.");
    // disk: delete "Para three.", insert a block after "Para two."
    const remoteText = baseText.replace("Para three.\n", "A brand new block.\n");

    const result = mergeRemote({
      base: base.snapshot,
      localNormalized: normalized(local),
      remoteText,
    });

    expect(result.conflicts).toEqual([]);
    const merged = apply(local.content!, result.ops);
    const out = serializeDocToMdx({ type: "doc", content: merged }, result.remote.snapshot);
    expect(out).toContain("Para one, local.");
    expect(out).toContain("A brand new block.");
    expect(out).not.toContain("Para three.");
    // order preserved: the new block still follows "Para two."
    expect(out.indexOf("Para two.")).toBeLessThan(out.indexOf("A brand new block."));
  });

  test("remote deletion of a locally edited block is a conflict", () => {
    const base = parseMdxToDoc(baseText, registry);
    const local = editText(base.doc, 2, "Para two, local.");
    const remoteText = baseText.replace("Para two.\n\n", "");

    const result = mergeRemote({
      base: base.snapshot,
      localNormalized: normalized(local),
      remoteText,
    });

    expect(result.conflicts).toEqual([2]);
    const merged = apply(local.content!, result.ops);
    const out = serializeDocToMdx({ type: "doc", content: merged }, result.remote.snapshot);
    expect(out).toContain("Para two, local.");
  });

  test("identical texts produce no ops", () => {
    const base = parseMdxToDoc(baseText, registry);
    const result = mergeRemote({
      base: base.snapshot,
      localNormalized: normalized(base.doc),
      remoteText: baseText,
    });
    expect(result.ops).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });
});
