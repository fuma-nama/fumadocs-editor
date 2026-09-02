import type { Text } from "mdast";
import type { Handle } from "mdast-util-to-markdown";
import { mathToMarkdown, type InlineMath, type Math } from "mdast-util-math";

declare module "mdast-util-math" {
  interface InlineMathData {
    /** dollar-sign count the source used (`$$x$$` = 2), preserved on re-emit */
    delimiter?: number;
  }
}

const extension = mathToMarkdown();

/**
 * Like `mdast-util-math`'s inlineMath handler, but the source's delimiter
 * width is the floor for the emitted one (still growing past any `$`-run in
 * the value), so `$$x$$` round-trips byte-for-byte. Its eol→space swap is
 * dropped: parse already folds line endings in inline math to spaces, so a
 * PM-sourced value never contains one.
 */
const inlineMath: Handle & { peek?: Handle } = (node: InlineMath) => {
  let value = node.value || "";
  let size = Math.max(1, node.data?.delimiter ?? 1);
  while (new RegExp("(^|[^$])" + "\\$".repeat(size) + "([^$]|$)").test(value)) size++;
  // pad when the value starts or ends with a dollar sign or is space-wrapped,
  // so the delimiters stay unambiguous (upstream's rule)
  if (/[^ ]/.test(value) && ((/^ /.test(value) && / $/.test(value)) || /^\$|\$$/.test(value))) {
    value = ` ${value} `;
  }
  const sequence = "$".repeat(size);
  return sequence + value + sequence;
};
inlineMath.peek = () => "$";

/**
 * Always registered in `stringifyOptions` so a math node emits `$…$` even
 * outside the dialect (e.g. inserted while the flag is off).
 */
export const mathHandlers = { math: extension.handlers!.math, inlineMath };

/**
 * Joined only when the dialect is on: text that would re-parse as math (a
 * `$` in phrasing) must be escaped then; without the dialect, those escapes
 * would be noise in everyone else's output.
 */
export const mathUnsafe = extension.unsafe;

export function inlineMathToMdast(value: string, delimiter: unknown): InlineMath | Text {
  // an emptied inline math has no source form (`$$` would re-parse as plain
  // text): it vanishes from the output
  if (!value) return { type: "text", value: "" };
  const size = typeof delimiter === "number" && delimiter > 1 ? delimiter : undefined;
  return { type: "inlineMath", value, ...(size && { data: { delimiter: size } }) };
}

export function mathToMdast(value: string, meta: unknown): Math {
  return { type: "math", value, meta: typeof meta === "string" ? meta : null };
}
