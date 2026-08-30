/**
 * The fence meta string, structured. Fumadocs' rehypeCode understands
 * exactly `title="…"`, `lineNumbers[=N]` and `noCopy`; everything else
 * (`twoslash`, `tab="…"`, custom flags) is kept verbatim in `rest` so the
 * round-trip never loses it.
 */
export interface CodeMeta {
  title: string;
  lineNumbers: false | true | number;
  noCopy: boolean;
  rest: string;
}

const KNOWN = /(?:^|\s)(title|lineNumbers|noCopy)(?:=("[^"]*"|'[^']*'|\d+))?(?=\s|$)/g;

export function parseCodeMeta(meta: string | null): CodeMeta {
  const out: CodeMeta = { title: "", lineNumbers: false, noCopy: false, rest: "" };
  if (!meta) return out;
  const rest = meta.replace(KNOWN, (_, key: string, raw: string | undefined) => {
    if (key === "title") out.title = raw && !/^\d/.test(raw) ? raw.slice(1, -1) : "";
    else if (key === "noCopy") out.noCopy = true;
    else out.lineNumbers = raw && /^\d+$/.test(raw) ? Number(raw) : true;
    return "";
  });
  out.rest = rest.trim().replace(/\s+/g, " ");
  return out;
}

export function buildCodeMeta({ title, lineNumbers, noCopy, rest }: CodeMeta): string | null {
  const parts: string[] = [];
  if (title) parts.push(`title="${title.replaceAll('"', "'")}"`);
  if (lineNumbers)
    parts.push(typeof lineNumbers === "number" ? `lineNumbers=${lineNumbers}` : "lineNumbers");
  if (noCopy) parts.push("noCopy");
  if (rest) parts.push(rest);
  return parts.length > 0 ? parts.join(" ") : null;
}
