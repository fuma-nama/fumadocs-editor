/**
 * The fence meta string, structured. Fumadocs understands `title="…"`,
 * `lineNumbers[=N]`, `noCopy` and `tab="…"` (consecutive `tab` fences group
 * into code block tabs); everything else (`twoslash`, `tab-group="…"`,
 * custom flags) is kept verbatim in `rest` so the round-trip never loses it.
 */
export interface CodeMeta {
  title: string;
  lineNumbers: false | true | number;
  noCopy: boolean;
  /** `null` when the block is not a tab */
  tab: string | null;
  rest: string;
}

const KNOWN = /(?:^|\s)(title|tab|lineNumbers|noCopy)(?:=("[^"]*"|'[^']*'|\d+))?(?=\s|$)/g;

export function parseCodeMeta(meta: string | null): CodeMeta {
  const out: CodeMeta = { title: "", lineNumbers: false, noCopy: false, tab: null, rest: "" };
  if (!meta) return out;
  const rest = meta.replace(KNOWN, (match, key: string, raw: string | undefined) => {
    const quoted = raw && !/^\d/.test(raw) ? raw.slice(1, -1) : null;
    if (key === "title") out.title = quoted ?? "";
    else if (key === "tab") {
      // fumadocs only groups a quoted `tab`: a bare or numeric one is a plain flag
      if (quoted == null) return match;
      out.tab = quoted;
    } else if (key === "noCopy") out.noCopy = true;
    else out.lineNumbers = raw && /^\d+$/.test(raw) ? Number(raw) : true;
    return "";
  });
  out.rest = rest.trim().replace(/\s+/g, " ");
  return out;
}

const quote = (value: string) => `"${value.replaceAll('"', "'")}"`;

export function buildCodeMeta({ title, lineNumbers, noCopy, tab, rest }: CodeMeta): string | null {
  const parts: string[] = [];
  if (tab != null) parts.push(`tab=${quote(tab)}`);
  if (title) parts.push(`title=${quote(title)}`);
  if (lineNumbers)
    parts.push(typeof lineNumbers === "number" ? `lineNumbers=${lineNumbers}` : "lineNumbers");
  if (noCopy) parts.push("noCopy");
  if (rest) parts.push(rest);
  return parts.length > 0 ? parts.join(" ") : null;
}
