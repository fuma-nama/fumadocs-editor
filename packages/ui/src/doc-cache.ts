import {
  parseMdxToDoc,
  type ComponentRegistry,
  type ParsedDoc,
} from "@fumadocs-editor/core";

interface Entry {
  source: string;
  registry: ComponentRegistry;
  parsed: ParsedDoc;
}

const MAX = 8;
const cache = new Map<string, Entry>();

/**
 * Parse with a small LRU keyed on the host's `cacheKey`, so reopening a
 * recently visited document skips the parse entirely (its snapshot keeps any
 * already-computed normalizations too). A hit requires the exact same source
 * text and registry; anything else reparses and replaces the entry.
 */
export function parseDocCached(
  key: string | undefined,
  source: string,
  registry: ComponentRegistry,
): ParsedDoc {
  if (key !== undefined) {
    const hit = cache.get(key);
    if (hit && hit.source === source && hit.registry === registry) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.parsed;
    }
  }
  const parsed = parseMdxToDoc(source, registry);
  if (key !== undefined) {
    cache.delete(key);
    cache.set(key, { source, registry, parsed });
    if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  }
  return parsed;
}
