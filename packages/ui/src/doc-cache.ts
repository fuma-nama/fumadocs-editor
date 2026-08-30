import type { ParsedDoc } from "@fumadocs-editor/core/parse";
import type { UiComponentSpec } from "./components/spec";

interface Entry {
  source: string;
  components: UiComponentSpec[];
  parsed: ParsedDoc;
}

const MAX = 8;
const cache = new Map<string, Entry>();

let parseModule: Promise<typeof import("@fumadocs-editor/core/parse")> | undefined;

/**
 * The parse stack (micromark + acorn) is its own chunk: the editor shell and
 * static paint never pay for it, hosts with a `staticFallback` may never
 * fetch it, and it starts loading the moment the first editor mounts.
 */
export function loadParse() {
  return (parseModule ??= import("@fumadocs-editor/core/parse"));
}

/**
 * Parse with a small LRU keyed on the host's `cacheKey`, so reopening a
 * recently visited document skips the parse entirely (its snapshot keeps any
 * already-computed normalizations too). A hit requires the exact same source
 * text and component specs; anything else reparses and replaces the entry.
 */
export async function parseDocCached(
  key: string | undefined,
  source: string,
  components: UiComponentSpec[],
): Promise<ParsedDoc> {
  if (key !== undefined) {
    const hit = cache.get(key);
    if (hit && hit.source === source && hit.components === components) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.parsed;
    }
  }
  const { parseMdxToDoc, createSyntax } = await loadParse();
  const parsed = parseMdxToDoc(source, createSyntax(components));
  if (key !== undefined) {
    cache.delete(key);
    cache.set(key, { source, components, parsed });
    if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  }
  return parsed;
}
