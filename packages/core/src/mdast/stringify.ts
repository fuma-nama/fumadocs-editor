import type { Root, RootContent } from "mdast";
import { toMarkdown, type Handle, type Options } from "mdast-util-to-markdown";
import { mdxToMarkdown } from "mdast-util-mdx";
import { mdxJsxToMarkdown } from "mdast-util-mdx-jsx";
import { gfmToMarkdown } from "mdast-util-gfm";
import { frontmatterToMarkdown } from "mdast-util-frontmatter";
import { directiveHandlers, directiveUnsafe } from "../syntax/directives/serialize";
import { mathHandlers, mathUnsafe } from "../syntax/math/serialize";
import type { SyntaxOptions } from "../components/spec";

/** Custom mdast node emitted for PM verbatim nodes: serialized as-is, no escaping. */
export interface RawNode {
  type: "raw";
  value: string;
}

const raw = (node: RawNode) => node.value;
raw.peek = (node: RawNode) => node.value.charAt(0) || " ";

type HandleWithPeek = Handle & { peek?: Handle };

const mdxJsxFlowElement = mdxJsxToMarkdown().handlers?.mdxJsxFlowElement as HandleWithPeek;

/** Trailing end of a JSX element line: `... />` or `</Name>`. */
const JSX_LINE_END = /(?:\/>|<\/[A-Za-z][\w.-]*>)$/;
const JSX_LINE_START = /^<[A-Za-z>]/;
const FENCE = /^(`{3,}|~{3,})/;

/**
 * `mdast-util-mdx-jsx` joins JSX flow children with a hard-coded blank line
 * (its private `containerFlow` ignores the `join` option), but the fumadocs
 * authoring style keeps sibling elements adjacent. Drop the blank line between
 * two JSX element lines, skipping fenced code so JSX-looking code content
 * keeps its blank lines.
 */
function collapseJsxSiblingGaps(value: string): string {
  const lines = value.split("\n");
  const out: string[] = [];
  let fence: { char: string; len: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trimStart();
    const mark = FENCE.exec(stripped);
    if (fence) {
      if (
        mark &&
        mark[1][0] === fence.char &&
        mark[1].length >= fence.len &&
        stripped.slice(mark[1].length).trim() === ""
      ) {
        fence = undefined;
      }
    } else if (mark) {
      fence = { char: mark[1][0], len: mark[1].length };
    } else if (
      stripped === "" &&
      i > 0 &&
      i + 1 < lines.length &&
      JSX_LINE_END.test(lines[i - 1].trimEnd()) &&
      JSX_LINE_START.test(lines[i + 1].trimStart())
    ) {
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

const mdxJsxFlowElementTight: HandleWithPeek = (node, parent, state, info) =>
  collapseJsxSiblingGaps(mdxJsxFlowElement(node, parent, state, info));
mdxJsxFlowElementTight.peek = mdxJsxFlowElement.peek;

const stringifyOptions: Options = {
  extensions: [mdxToMarkdown(), gfmToMarkdown(), frontmatterToMarkdown(["yaml"])],
  // 'raw' is our own mdast extension, unknown to the Handlers map; the
  // top-level mdxJsxFlowElement override wins over the extension's handler
  handlers: {
    raw,
    mdxJsxFlowElement: mdxJsxFlowElementTight,
    ...directiveHandlers,
    ...mathHandlers,
  } as unknown as Options["handlers"],
  bullet: "-",
  rule: "-",
  emphasis: "*",
  strong: "*",
  fences: true,
};

/**
 * Each dialect's escaping rules join only while it is on: without the dialect
 * they would be noise in everyone else's output. Cached per options object
 * (stable per `Syntax`) since stringify runs per block.
 */
const optionsCache = new WeakMap<SyntaxOptions, Options>();

function optionsFor(options: SyntaxOptions): Options {
  if (!options.directives && !options.math) return stringifyOptions;
  let built = optionsCache.get(options);
  if (!built) {
    const extensions = [...stringifyOptions.extensions!];
    if (options.directives) extensions.push({ unsafe: directiveUnsafe });
    if (options.math) extensions.push({ unsafe: mathUnsafe });
    built = { ...stringifyOptions, extensions };
    optionsCache.set(options, built);
  }
  return built;
}

function stringifyRoot(root: Root, options: SyntaxOptions = {}): string {
  return toMarkdown(root, optionsFor(options));
}

/** Stringify a single top-level block, without the trailing newline. */
export function stringifyBlock(block: RootContent, options: SyntaxOptions = {}): string {
  return stringifyRoot({ type: "root", children: [block] }, options).replace(/\n$/, "");
}
