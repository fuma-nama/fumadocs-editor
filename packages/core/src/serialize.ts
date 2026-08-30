import type { JSONContent } from "@tiptap/core";
import { nodeToMdastBlock } from "./mdast/to-mdast";
import { stringifyBlock } from "./mdast/stringify";
import { createRegistry, type ComponentRegistry } from "./components/spec";
import type { DocSnapshot, SnapshotBlock } from "./document";

const EMPTY_REGISTRY = createRegistry();

/** a snapshot block's lossless-round-trip serialization, computed once */
function blockNormalized(block: SnapshotBlock, registry: ComponentRegistry): string {
  return (block._normalized ??= tryNormalize(block.node, registry) ?? block.source);
}

export function tryNormalize(
  node: JSONContent,
  registry: ComponentRegistry,
): string | undefined {
  try {
    return stringifyBlock(nodeToMdastBlock(node, registry));
  } catch {
    return undefined;
  }
}

/**
 * Serialize a TipTap document back to MDX. With a snapshot from
 * `parseMdxToDoc`, unedited blocks are emitted from their original source;
 * without one, the whole document is normalized.
 */
export function serializeDocToMdx(
  doc: JSONContent,
  snapshot?: DocSnapshot,
  registry: ComponentRegistry = EMPTY_REGISTRY,
): string {
  const normalized: string[] = [];
  for (const node of doc.content ?? []) {
    normalized.push(tryNormalize(node, registry) ?? "");
  }
  return assembleMdx(normalized, snapshot);
}

/**
 * Match per-block normalized texts against the snapshot and reassemble the
 * document, emitting untouched blocks (and the whitespace around them)
 * byte-for-byte from their original source.
 */
export function assembleMdx(normalized: string[], snapshot?: DocSnapshot): string {
  const byNormalized = new Map<string, number[]>();
  snapshot?.blocks.forEach((block, index) => {
    const key = blockNormalized(block, snapshot.registry);
    const list = byNormalized.get(key);
    if (list) list.push(index);
    else byNormalized.set(key, [index]);
  });

  const used = new Set<number>();
  const parts: { text: string; index: number | null }[] = [];
  let prevMatch: number | null = null;

  for (const text of normalized) {
    const candidates = (byNormalized.get(text) ?? []).filter((i) => !used.has(i));
    // prefer the block that originally followed the previous match, so
    // original inter-block whitespace can be reused
    const pick =
      candidates.find((i) => prevMatch != null && i === prevMatch + 1) ?? candidates[0] ?? null;

    if (pick != null) {
      used.add(pick);
      parts.push({ text: snapshot!.blocks[pick].source, index: pick });
      prevMatch = pick;
    } else {
      parts.push({ text, index: null });
      prevMatch = null;
    }
  }

  const filtered = parts.filter((part) => part.text !== "");

  if (filtered.length === 0) return snapshot?.blocks.length === 0 ? snapshot.leading : "";

  let out = snapshot && filtered[0].index === 0 ? snapshot.leading : "";

  for (let i = 0; i < filtered.length; i++) {
    out += filtered[i].text;
    if (i < filtered.length - 1) {
      const current = filtered[i].index;
      const next = filtered[i + 1].index;
      if (snapshot && current != null && next === current + 1) {
        out += snapshot.gaps[current];
      } else {
        out += "\n\n";
      }
    }
  }

  if (snapshot && filtered[filtered.length - 1].index === snapshot.blocks.length - 1) {
    out += snapshot.trailing;
  } else if (!out.endsWith("\n")) {
    out += "\n";
  }

  return out;
}

export { createIncrementalSerializer } from "./incremental";
export { docToMdast, nodeToMdastBlock } from "./mdast/to-mdast";
export { stringifyRoot, stringifyBlock } from "./mdast/stringify";
export type { DocSnapshot, SnapshotBlock } from "./document";
