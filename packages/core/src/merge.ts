import type { JSONContent } from "@tiptap/core";
import { parseMdxToDoc, type DocSnapshot, type ParsedDoc } from "./document";
import { blockNormalized, matchBlocks, tryNormalize } from "./serializer";

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
  /** parsed disk text; its snapshot is the new base for later saves */
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
 * - local:  the live document as JSON
 * - remote: the new disk text
 *
 * Remote-only changes become `ops`; blocks touched on both sides become
 * `conflicts` and keep the local version.
 */
export function mergeRemote(options: {
  base: DocSnapshot;
  local: JSONContent;
  remoteText: string;
}): MergeResult {
  const { base, local, remoteText } = options;
  const remote = parseMdxToDoc(remoteText, base.syntax);
  const localNormalized: string[] = [];
  for (const child of local.content ?? []) {
    localNormalized.push(tryNormalize(child, base.syntax) ?? "");
  }
  const remoteNodes = remote.doc.content ?? [];

  const baseNorm = base.blocks.map((block) => blockNormalized(block, base.syntax));
  const remoteNorm = remote.snapshot.blocks.map((block) => blockNormalized(block, base.syntax));

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
  // before `b` still present locally (surviving unchanged, or edited in
  // place). Anchoring after the edited version keeps "append after a block
  // someone is typing in" appending, not slipping in front of it.
  const anchorLocal = (b: number): number => {
    for (; b >= 0; b--) {
      if (baseToLocal[b] >= 0) return baseToLocal[b];
      const edited = localForEditedBase(b);
      if (edited >= 0) return edited;
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
      if (local >= 0) {
        ops.push({ type: "replace", local, node: remoteNodes[added[k]] });
        continue;
      }
      // edited on both sides: identical edits are already merged
      const edited = localForEditedBase(removed[k]);
      if (edited < 0 || localNormalized[edited] !== remoteNorm[added[k]]) conflicts.add(edited);
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
  const pairs: [number, number][] = [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    pairs.push([head, head]);
    head++;
  }
  let tail = 0;
  while (head + tail < a.length && head + tail < b.length && a.at(-1 - tail) === b.at(-1 - tail)) {
    tail++;
  }
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  // lengths[i][j] = LCS length of x[i..] and y[j..]
  const lengths: Uint32Array[] = Array.from(
    { length: x.length + 1 },
    () => new Uint32Array(y.length + 1),
  );
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lengths[i][j] =
        x[i] === y[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      pairs.push([head + i, head + j]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  for (let k = tail; k > 0; k--) pairs.push([a.length - k, b.length - k]);
  return pairs;
}

/** the local children with `ops` applied; indices refer to the pre-merge children */
export function applyMergeOps(children: JSONContent[], ops: MergeOp[]): JSONContent[] {
  const replace = new Map<number, JSONContent>();
  const removed = new Set<number>();
  const inserts = new Map<number, JSONContent[]>();
  for (const op of ops) {
    if (op.type === "replace") replace.set(op.local, op.node);
    else if (op.type === "delete") removed.add(op.local);
    else {
      const list = inserts.get(op.after);
      if (list) list.push(op.node);
      else inserts.set(op.after, [op.node]);
    }
  }
  const out: JSONContent[] = inserts.get(-1) ?? [];
  for (let i = 0; i < children.length; i++) {
    if (!removed.has(i)) out.push(replace.get(i) ?? children[i]);
    const after = inserts.get(i);
    if (after) for (const node of after) out.push(node);
  }
  return out;
}
