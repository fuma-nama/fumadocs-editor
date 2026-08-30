import type { JSONContent } from "@tiptap/core";
import { parseMdxToDoc, type DocSnapshot, type ParsedDoc } from "@fumadocs-editor/core/parse";
import { blockNormalized, matchBlocks } from "@fumadocs-editor/core/serialize";

/**
 * An edit to the live document's top-level children. All indices refer to
 * the PRE-merge document: apply every op in one transaction, resolving each
 * op's position through the transaction's mapping (bias 1 for inserts, so
 * successive inserts at one anchor keep their order).
 */
export type MergeOp =
  | { type: "replace"; local: number; node: JSONContent }
  | { type: "delete"; local: number }
  /** insert `node` after local child `after` (-1 inserts at the start) */
  | { type: "insert"; after: number; node: JSONContent };

export interface MergeResult {
  ops: MergeOp[];
  /**
   * Local child indices edited both locally and on disk (-1 when the local
   * side deleted the block). Their remote versions are NOT in `ops`: local
   * wins until the user resolves.
   */
  conflicts: number[];
  /** the parsed disk text — its snapshot is the new base for future saves */
  remote: ParsedDoc;
}

/**
 * Block-level three-way merge of a disk change into the live document.
 *
 * Identity is the serializer's own: a block is "the same" when its lossless
 * normalization matches (`matchBlocks`), so the merge agrees exactly with
 * what `serializeDocToMdx` would emit verbatim vs rewrite.
 *
 * - base:   the last-synced `DocSnapshot`
 * - local:  the live doc, one normalized text per top-level child
 * - remote: the new disk text
 *
 * Remote-only changes become `ops`; blocks touched on both sides become
 * `conflicts` and keep the local version.
 */
export function mergeRemote(options: {
  base: DocSnapshot;
  localNormalized: string[];
  remoteText: string;
}): MergeResult {
  const { base, localNormalized, remoteText } = options;
  const remote = parseMdxToDoc(remoteText, base.registry);
  const remoteNodes = remote.doc.content ?? [];

  const baseNorm = base.blocks.map((block) => blockNormalized(block, base.registry));
  const remoteNorm = remote.snapshot.blocks.map((block) =>
    blockNormalized(block, base.registry),
  );

  // which base block each live child still is (null = locally edited/new)
  const localMatch = matchBlocks(localNormalized, base);
  const baseToLocal: number[] = Array(baseNorm.length).fill(-1);
  localMatch.forEach((baseIndex, localIndex) => {
    if (baseIndex != null) baseToLocal[baseIndex] = localIndex;
  });

  // best-effort location of the local child that edited base block `b`: the
  // first unmatched local child after the previous surviving base block
  const localForEditedBase = (b: number): number => {
    let start = 0;
    for (let prev = b - 1; prev >= 0; prev--) {
      if (baseToLocal[prev] >= 0) {
        start = baseToLocal[prev] + 1;
        break;
      }
    }
    for (let i = start; i < localMatch.length; i++) {
      if (localMatch[i] == null) return i;
      if (localMatch[i]! > b) break;
    }
    return -1; // locally deleted
  };

  // the local child an insertion should follow: the nearest base block at or
  // before `b` that still has a surviving (or replaced-in-place) local child
  const anchorLocal = (b: number): number => {
    for (; b >= 0; b--) {
      if (baseToLocal[b] >= 0) return baseToLocal[b];
    }
    return -1;
  };

  const ops: MergeOp[] = [];
  const conflicts = new Set<number>();

  // walk the base↔remote diff gap by gap; inside a gap, pair the k-th
  // removed base block with the k-th added remote block (a block edit),
  // leftovers are pure deletes / inserts
  const kept = lcsPairs(baseNorm, remoteNorm);
  kept.push([baseNorm.length, remoteNorm.length]);
  let baseAt = 0;
  let remoteAt = 0;
  for (const [keptBase, keptRemote] of kept) {
    const removed: number[] = [];
    for (; baseAt < keptBase; baseAt++) removed.push(baseAt);
    const added: number[] = [];
    for (; remoteAt < keptRemote; remoteAt++) added.push(remoteAt);
    baseAt = keptBase + 1;
    remoteAt = keptRemote + 1;

    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k++) {
      const local = baseToLocal[removed[k]];
      if (local >= 0) ops.push({ type: "replace", local, node: remoteNodes[added[k]] });
      else conflicts.add(localForEditedBase(removed[k]));
    }
    for (let k = pairs; k < removed.length; k++) {
      const local = baseToLocal[removed[k]];
      if (local >= 0) ops.push({ type: "delete", local });
      else conflicts.add(localForEditedBase(removed[k]));
    }
    // unpaired additions follow the gap's last removed block if there is
    // one, otherwise the base block just before the gap
    const anchorBase = removed.length > 0 ? removed[removed.length - 1] : keptBase - 1;
    for (let k = pairs; k < added.length; k++) {
      ops.push({ type: "insert", after: anchorLocal(anchorBase), node: remoteNodes[added[k]] });
    }
  }

  return { ops, conflicts: [...conflicts], remote };
}

/** longest common subsequence as [baseIndex, remoteIndex] pairs, in order */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // lengths[i][j] = LCS length of a[i..] and b[j..]
  const lengths: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}
