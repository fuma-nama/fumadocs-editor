import type { Node as PMNode } from "@tiptap/pm/model";
import { assembleMdx, tryNormalize } from "./serialize";
import type { DocSnapshot } from "./document";
import { createSyntax, type Syntax } from "./components/spec";

const EMPTY_SYNTAX = createSyntax();

/**
 * Serializer over the live ProseMirror document. PM nodes are immutable and
 * transactions structurally share unchanged children, so an untouched
 * top-level block keeps its node identity across edits: caching the
 * stringified form per node makes a keystroke re-stringify only the edited
 * block, not the whole document.
 */
export function createIncrementalSerializer(
  syntax: Syntax = EMPTY_SYNTAX,
): (doc: PMNode, snapshot?: DocSnapshot) => string {
  const cache = new WeakMap<PMNode, string>();

  return (doc, snapshot) => {
    const normalized: string[] = [];
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      let text = cache.get(child);
      if (text === undefined) {
        text = tryNormalize(child.toJSON(), syntax) ?? "";
        cache.set(child, text);
      }
      normalized.push(text);
    }
    return assembleMdx(normalized, snapshot);
  };
}
