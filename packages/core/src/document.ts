import type { JSONContent } from '@tiptap/core';
import { parseMdx } from './mdast/parse';
import { blockToNode } from './mdast/from-mdast';
import { nodeToMdastBlock } from './mdast/to-mdast';
import { stringifyBlock } from './mdast/stringify';
import { createRegistry, type ComponentRegistry } from './components/spec';

const EMPTY_REGISTRY = createRegistry();

export interface SnapshotBlock {
  /** exact source text of the block */
  source: string;
  /**
   * The block as it would serialize after a lossless PM round-trip
   * (mdast → PM → mdast → markdown). A save-time block whose serialization
   * equals this was not edited, so `source` is emitted instead.
   */
  normalized: string;
}

/**
 * Parse-time record of a document's top-level blocks and the exact text
 * between them. Lets `serializeDocToMdx` emit untouched blocks (and the
 * whitespace around them) byte-for-byte.
 */
export interface DocSnapshot {
  blocks: SnapshotBlock[];
  /** text between block i and block i+1 */
  gaps: string[];
  /** text before the first block (or the whole source when there are no blocks) */
  leading: string;
  /** text after the last block */
  trailing: string;
}

export interface ParsedDoc {
  doc: JSONContent;
  snapshot: DocSnapshot;
}

/**
 * Parse MDX source into a TipTap-compatible document.
 * Throws on MDX syntax errors (invalid JSX / expressions).
 */
export function parseMdxToDoc(
  source: string,
  registry: ComponentRegistry = EMPTY_REGISTRY,
): ParsedDoc {
  const root = parseMdx(source);
  const ctx = { source, registry };

  const content: JSONContent[] = [];
  const blocks: SnapshotBlock[] = [];
  const gaps: string[] = [];
  const children = root.children;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const start = child.position?.start.offset ?? 0;
    const end = child.position?.end.offset ?? 0;
    const blockSource = source.slice(start, end);

    const pmNode = blockToNode(child, ctx);
    content.push(pmNode);

    let normalized: string;
    try {
      normalized = stringifyBlock(nodeToMdastBlock(pmNode, registry));
    } catch {
      normalized = blockSource;
    }
    blocks.push({ source: blockSource, normalized });

    if (i < children.length - 1) {
      const nextStart = children[i + 1].position?.start.offset ?? end;
      gaps.push(source.slice(end, nextStart));
    }
  }

  const first = children[0];
  const last = children[children.length - 1];

  return {
    doc: {
      type: 'doc',
      content: content.length > 0 ? content : [{ type: 'paragraph' }],
    },
    snapshot: {
      blocks,
      gaps,
      leading: first ? source.slice(0, first.position?.start.offset ?? 0) : source,
      trailing: last ? source.slice(last.position?.end.offset ?? source.length) : '',
    },
  };
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
  const nodes = doc.content ?? [];

  const byNormalized = new Map<string, number[]>();
  snapshot?.blocks.forEach((block, index) => {
    const list = byNormalized.get(block.normalized);
    if (list) list.push(index);
    else byNormalized.set(block.normalized, [index]);
  });

  const used = new Set<number>();
  const parts: { text: string; index: number | null }[] = [];
  let prevMatch: number | null = null;

  for (const node of nodes) {
    let normalized: string;
    try {
      normalized = stringifyBlock(nodeToMdastBlock(node, registry));
    } catch {
      normalized = '';
    }

    const candidates = (byNormalized.get(normalized) ?? []).filter((i) => !used.has(i));
    // prefer the block that originally followed the previous match, so
    // original inter-block whitespace can be reused
    const pick =
      candidates.find((i) => prevMatch != null && i === prevMatch + 1) ??
      candidates[0] ??
      null;

    if (pick != null) {
      used.add(pick);
      parts.push({ text: snapshot!.blocks[pick].source, index: pick });
      prevMatch = pick;
    } else {
      parts.push({ text: normalized, index: null });
      prevMatch = null;
    }
  }

  const filtered = parts.filter((part) => part.text !== '');

  if (filtered.length === 0) return snapshot?.blocks.length === 0 ? snapshot.leading : '';

  let out =
    snapshot && filtered[0].index === 0 ? snapshot.leading : '';

  for (let i = 0; i < filtered.length; i++) {
    out += filtered[i].text;
    if (i < filtered.length - 1) {
      const current = filtered[i].index;
      const next = filtered[i + 1].index;
      if (snapshot && current != null && next === current + 1) {
        out += snapshot.gaps[current];
      } else {
        out += '\n\n';
      }
    }
  }

  if (snapshot && filtered[filtered.length - 1].index === snapshot.blocks.length - 1) {
    out += snapshot.trailing;
  } else if (!out.endsWith('\n')) {
    out += '\n';
  }

  return out;
}
