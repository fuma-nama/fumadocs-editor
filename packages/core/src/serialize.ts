import type { JSONContent } from "@tiptap/core";
import { nodeToMdastBlock } from "./mdast/to-mdast";
import { stringifyBlock } from "./mdast/stringify";
import { createSyntax, type Syntax } from "./components/spec";
import type { DocSnapshot, SnapshotBlock } from "./document";

const EMPTY_SYNTAX = createSyntax();

/** a snapshot block's lossless-round-trip serialization, computed once */
export function blockNormalized(block: SnapshotBlock, syntax: Syntax): string {
  return (block._normalized ??= tryNormalize(block.node, syntax) ?? block.source);
}

/**
 * Match per-block normalized texts against the snapshot's blocks: the block
 * identity every consumer (serializer, sync merge) must agree on. Each
 * snapshot block is used at most once; runs of consecutive blocks are kept
 * together so original inter-block whitespace can be reused.
 */
export function matchBlocks(normalized: string[], snapshot: DocSnapshot): (number | null)[] {
  const byNormalized = new Map<string, number[]>();
  snapshot.blocks.forEach((block, index) => {
    const key = blockNormalized(block, snapshot.syntax);
    const list = byNormalized.get(key);
    if (list) list.push(index);
    else byNormalized.set(key, [index]);
  });

  const used = new Set<number>();
  const matches: (number | null)[] = [];
  let prevMatch: number | null = null;

  for (const text of normalized) {
    const candidates = (byNormalized.get(text) ?? []).filter((i) => !used.has(i));
    // prefer the block that originally followed the previous match
    const pick =
      candidates.find((i) => prevMatch != null && i === prevMatch + 1) ?? candidates[0] ?? null;
    if (pick != null) used.add(pick);
    matches.push(pick);
    prevMatch = pick;
  }
  return matches;
}

export function tryNormalize(node: JSONContent, syntax: Syntax): string | undefined {
  try {
    return stringifyBlock(nodeToMdastBlock(node, syntax), syntax.options);
  } catch {
    return undefined;
  }
}

/**
 * Serialize a TipTap document back to MDX. With a snapshot from
 * `parseMdxToDoc`, unedited blocks are emitted from their original source
 * (and its syntax is used); without one, the whole document is normalized.
 */
export function serializeDocToMdx(
  doc: JSONContent,
  snapshot?: DocSnapshot,
  syntax: Syntax = snapshot?.syntax ?? EMPTY_SYNTAX,
): string {
  const normalized: string[] = [];
  for (const node of doc.content ?? []) {
    normalized.push(tryNormalize(node, syntax) ?? "");
  }
  return assembleMdx(normalized, snapshot);
}

/**
 * Match per-block normalized texts against the snapshot and reassemble the
 * document, emitting untouched blocks (and the whitespace around them)
 * byte-for-byte from their original source.
 */
export function assembleMdx(normalized: string[], snapshot?: DocSnapshot): string {
  const matches = snapshot ? matchBlocks(normalized, snapshot) : normalized.map(() => null);
  const parts: { text: string; index: number | null }[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const index = matches[i];
    parts.push(
      index != null
        ? { text: snapshot!.blocks[index].source, index }
        : { text: normalized[i], index: null },
    );
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
