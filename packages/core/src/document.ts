import type { JSONContent } from "@tiptap/core";
import { parseMdx } from "./mdast/parse";
import { blockToNode } from "./mdast/from-mdast";
import { createSyntax, type Syntax } from "./components/spec";

const EMPTY_SYNTAX = createSyntax();

export interface SnapshotBlock {
  /** exact source text of the block */
  source: string;
  /**
   * Parsed PM JSON of the block. The serialize side stringifies it lazily
   * (see `blockNormalized`) to decide whether a save-time block was edited.
   * Parse pays nothing; the first serialize pays once. The parse chunk never
   * loads the markdown serializer.
   */
  readonly node: JSONContent;
  /** cache slot for the lazy normalization; owned by the serialize module */
  _normalized?: string;
}

/**
 * Parse-time record of a document's top-level blocks and the exact text
 * between them. Lets `serializeDocToMdx` emit untouched blocks (and the
 * whitespace around them) byte-for-byte.
 */
export interface DocSnapshot {
  /** the syntax the document was parsed with; normalization must match it */
  syntax: Syntax;
  blocks: SnapshotBlock[];
  /** text between block i and block i+1 */
  gaps: string[];
  /** text before the first block (or the whole source when there are no blocks) */
  leading: string;
  /** text after the last block */
  trailing: string;
}

export interface ParsedDoc {
  /**
   * Treat as immutable: the snapshot's lazy `normalized` getters read these
   * nodes on first serialize. Editors never mutate it (PM copies the JSON
   * into its own state), so derive edits from copies, not in place.
   */
  doc: JSONContent;
  snapshot: DocSnapshot;
}

/**
 * Parse MDX source into a TipTap-compatible document.
 * Throws on MDX syntax errors (invalid JSX / expressions).
 */
export function parseMdxToDoc(source: string, syntax: Syntax = EMPTY_SYNTAX): ParsedDoc {
  const root = parseMdx(source, syntax.options);
  const ctx = { source, syntax };

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
    blocks.push({ source: blockSource, node: pmNode });

    if (i < children.length - 1) {
      const nextStart = children[i + 1].position?.start.offset ?? end;
      gaps.push(source.slice(end, nextStart));
    }
  }

  const first = children[0];
  const last = children[children.length - 1];

  return {
    doc: {
      type: "doc",
      content: content.length > 0 ? content : [{ type: "paragraph" }],
    },
    snapshot: {
      syntax,
      blocks,
      gaps,
      leading: first ? source.slice(0, first.position?.start.offset ?? 0) : source,
      trailing: last ? source.slice(last.position?.end.offset ?? source.length) : "",
    },
  };
}
