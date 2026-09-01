import type { ParsedDoc, SyntaxOptions } from "@fumadocs-editor/core/parse";
import type { UiComponentSpec } from "./components/spec";

interface Entry {
  source: string;
  components: UiComponentSpec[];
  options: SyntaxOptions;
  parsed: ParsedDoc;
}

const MAX = 8;
const cache = new Map<string, Entry>();

const EMPTY_OPTIONS: SyntaxOptions = {};

/** hosts tend to pass `syntax` as a fresh literal, so compare by value */
export function sameOptions(a: SyntaxOptions = EMPTY_OPTIONS, b: SyntaxOptions = EMPTY_OPTIONS) {
  return (
    a.directives === b.directives && a.math === b.math && a.headingSuffixes === b.headingSuffixes
  );
}

let parseModule: Promise<typeof import("@fumadocs-editor/core/parse")> | undefined;

/**
 * The parse stack (micromark + acorn) is its own chunk: the editor shell and
 * static paint never pay for it, hosts with a `staticFallback` may never
 * fetch it, and it starts loading the moment the first editor mounts.
 */
function loadParse() {
  return (parseModule ??= import("@fumadocs-editor/core/parse"));
}

/**
 * Parse with a small LRU keyed on the host's `cacheKey`, so reopening a
 * recently visited document skips the parse entirely (its snapshot keeps any
 * already-computed normalizations too). A hit requires the exact same source
 * text, component specs and syntax options; anything else reparses and
 * replaces the entry.
 */
export async function parseDocCached(
  key: string | undefined,
  source: string,
  components: UiComponentSpec[],
  options: SyntaxOptions = EMPTY_OPTIONS,
): Promise<ParsedDoc> {
  if (key !== undefined) {
    const hit = cache.get(key);
    if (
      hit &&
      hit.source === source &&
      hit.components === components &&
      sameOptions(hit.options, options)
    ) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.parsed;
    }
  }
  const { parseMdxToDoc, createSyntax } = await loadParse();
  const parsed = parseMdxToDoc(source, createSyntax(components, options));
  if (key !== undefined) {
    cache.delete(key);
    cache.set(key, { source, components, options, parsed });
    if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  }
  return parsed;
}
