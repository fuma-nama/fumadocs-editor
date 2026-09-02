import * as stylex from "@stylexjs/stylex";
import { consts } from "./consts.stylex";
import { folder, settled } from "./markers.stylex";
import { tokens } from "./tokens.stylex";

/*
 * Document styles. TipTap renders the content DOM, so classes reach it
 * through one global attribute per node/mark type (`contentStyles` in the
 * live editor); the static paint applies the same classes directly.
 *
 * Every element resets what the UA gives it (margins, list padding, form
 * fonts): nothing relies on a host stylesheet.
 *
 * Vertical rhythm: every block carries `block` (a top margin except as a
 * first child) and each container sets the gap it wants via `--fde-gap`.
 */

const muted = tokens.mutedForeground;
const border = tokens.border;

export const fadeIn = stylex.keyframes({ from: { opacity: 0 } });

export const content = stylex.create({
  /** the `.ProseMirror` element, live and static */
  root: {
    outline: "none",
    paddingTop: 20,
    paddingInline: 24,
    paddingBottom: 56,
    minHeight: 420,
    "--fde-gap": "0.8em",
  },
  block: {
    marginTop: { default: "var(--fde-gap)", ":first-child": 0 },
    marginBottom: 0,
    marginInline: 0,
  },
  /** block atoms (dividers, raw MDX, images) show a ring when node-selected;
   * components draw their own */
  atom: {
    outline: {
      default: null,
      ":is(.ProseMirror-selectednode)": `2px solid ${tokens.ring}`,
    },
    outlineOffset: 2,
  },
  paragraph: {
    // the Placeholder extension's ghost hint on the current empty paragraph
    "::before": {
      content: { default: null, ":is([data-placeholder])": "attr(data-placeholder)" },
      float: "left",
      height: 0,
      pointerEvents: "none",
      color: muted,
      opacity: 0.5,
      animationName: {
        default: null,
        [stylex.when.ancestor("[data-fde-settled]", settled)]: fadeIn,
        [consts.reduceMotion]: "none",
      },
      animationDuration: "80ms",
      animationTimingFunction: "ease-out",
    },
  },
  heading: {
    fontWeight: 600,
    // heading suffixes (anchor, TOC flags) surface as chips, not body text
    opacity: { default: null, ':is([data-toc="only"])': 0.65 },
    "::after": {
      content: {
        default: null,
        ":is([data-anchor]:not([data-toc]))": '"#" attr(data-anchor)',
        ':is([data-toc="hide"]:not([data-anchor]))': '"hidden from TOC"',
        ':is([data-toc="only"]:not([data-anchor]))': '"TOC only"',
        ':is([data-anchor][data-toc="hide"])': '"#" attr(data-anchor) " · hidden from TOC"',
        ':is([data-anchor][data-toc="only"])': '"#" attr(data-anchor) " · TOC only"',
      },
      marginInlineStart: 10,
      fontFamily: consts.mono,
      fontSize: 11,
      fontWeight: 400,
      letterSpacing: 0,
      color: muted,
      verticalAlign: "middle",
      whiteSpace: "nowrap",
    },
  },
  h1: { fontSize: "1.75em", fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.01em" },
  h2: { fontSize: "1.4em", lineHeight: 1.3, letterSpacing: "-0.01em" },
  h3: { fontSize: "1.15em" },
  h4: { fontSize: "1em" },
  /* Neutral theme: `primary` is nearly the foreground, so the underline is
   * what reads as a link. Visible always, full-strength on hover. */
  link: {
    color: tokens.primary,
    textDecorationLine: "underline",
    textDecorationColor: {
      default: `color-mix(in oklab, ${tokens.primary} 45%, transparent)`,
      ":hover": tokens.primary,
    },
    textUnderlineOffset: 3,
    fontWeight: 500,
  },
  code: {
    backgroundColor: tokens.muted,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    borderRadius: 5,
    paddingInline: "0.35em",
    paddingBlock: "0.1em",
    fontSize: "0.875em",
    fontFamily: consts.mono,
  },
  /* raw MDX blocks (expressions, ESM, frontmatter, verbatim) */
  pre: {
    boxSizing: "border-box",
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: border,
    borderRadius: 12,
    paddingInline: 16,
    paddingBlock: 14,
    fontFamily: consts.mono,
    fontSize: 13,
    lineHeight: 1.6,
    color: muted,
    whiteSpace: "pre-wrap",
  },
  frontmatter: { borderColor: tokens.ring },
  mdxCode: { borderStyle: "dashed", color: muted },
  /* unregistered / raw JSX gets lightweight fallback chrome */
  mdxFlow: {
    position: "relative",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: border,
    borderRadius: 10,
    paddingTop: 26,
    paddingInline: 14,
    paddingBottom: 10,
    "::before": {
      content: '"<" attr(data-component) ">"',
      position: "absolute",
      top: 6,
      left: 12,
      fontFamily: consts.mono,
      fontSize: 11,
      color: muted,
    },
  },
  mdxInline: {
    borderBottomWidth: 1,
    borderBottomStyle: "dashed",
    borderBottomColor: tokens.ring,
  },
  blockquote: {
    borderInlineStartWidth: 2,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: border,
    paddingInlineStart: 14,
    color: muted,
    fontStyle: "italic",
  },
  list: { paddingInlineStart: "1.5em" },
  ul: { listStyleType: "disc" },
  ol: { listStyleType: "decimal" },
  li: { "--fde-gap": "0.4em", "::marker": { color: muted } },
  taskList: { listStyleType: "none", paddingInlineStart: "0.2em" },
  taskItem: { display: "flex", gap: 8 },
  img: {
    display: "block",
    maxWidth: "100%",
    height: "auto",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
  },
  hr: {
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: border,
    marginTop: "2em",
    marginBottom: "2em",
  },
  table: { borderCollapse: "collapse", borderSpacing: 0, width: "100%", fontSize: "0.925em" },
  cell: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    paddingInline: 12,
    paddingBlock: 7,
    textAlign: "start",
    verticalAlign: "top",
  },
  th: { backgroundColor: tokens.muted, fontWeight: 600 },

  /* Code block: fumadocs `CodeBlock` figure chrome around the lowlight
   * content; shared by the node view and the static paint. */
  codeBlock: {
    position: "relative",
    marginTop: "1rem",
    marginBottom: "1rem",
    marginInline: 0,
    overflow: "hidden",
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: tokens.card,
    fontSize: 14,
    lineHeight: "1.25rem",
    boxShadow: consts.shadowSm,
  },
  codeHeader: {
    boxSizing: "border-box",
    display: "flex",
    height: "2.375rem",
    alignItems: "center",
    gap: "0.25rem",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: border,
    paddingInline: "0.75rem",
    color: muted,
    userSelect: "none",
  },
  codeHeaderIcon: { flexShrink: 0, opacity: 0.7 },
  codeScroll: { minWidth: 0, flex: 1, overflow: "auto" },
  codePre: {
    boxSizing: "border-box",
    margin: 0,
    paddingInline: 16,
    paddingBlock: 14,
    minWidth: "100%",
    width: "max-content",
    fontFamily: consts.mono,
    fontSize: 13,
    lineHeight: 1.6,
  },
  codeCode: { display: "block", fontFamily: "inherit", fontSize: "inherit" },
  /** the `lineNumbers` gutter: chrome outside the horizontal scroller,
   * matching the code's metrics exactly so rows line up */
  codeLines: {
    boxSizing: "border-box",
    margin: 0,
    paddingTop: 14,
    paddingBottom: 14,
    paddingInlineStart: 16,
    whiteSpace: "pre",
    fontFamily: consts.mono,
    fontSize: 13,
    lineHeight: 1.6,
    textAlign: "end",
    fontVariantNumeric: "tabular-nums",
    color: muted,
    opacity: 0.6,
    userSelect: "none",
  },

  /* Math (remark-math): editable TeX source; the node view adds the KaTeX
   * preview and the active/rendered switching. */
  mathInline: { display: "inline" },
  mathInlineSrc: {
    position: "relative",
    display: "inline-block",
    borderRadius: 6,
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 8%, ${tokens.muted})`,
    paddingInline: 4,
    fontFamily: consts.mono,
    fontSize: "0.8125em",
    // room for a caret + placeholder while the formula is still empty
    minWidth: { default: null, ":is([data-empty])": "3ch" },
    "::before": {
      content: { default: null, ":is([data-empty])": '"TeX"' },
      position: "absolute",
      insetInlineStart: 4,
      color: muted,
      opacity: 0.6,
      pointerEvents: "none",
    },
  },
  mathBlock: { marginTop: "1rem", marginBottom: "1rem" },
  mathBlockSrc: {
    boxSizing: "border-box",
    position: "relative",
    margin: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    borderRadius: 10,
    backgroundColor: tokens.card,
    paddingInline: 14,
    paddingBlock: 12,
    fontFamily: consts.mono,
    fontSize: 13,
    lineHeight: 1.6,
    "::before": {
      content: { default: null, ":is([data-empty])": '"TeX equation…"' },
      position: "absolute",
      color: muted,
      opacity: 0.6,
      pointerEvents: "none",
    },
  },

  /** the NodeViewWrapper of a component: the selection ring lives here */
  nodeWrapper: {
    position: "relative",
    isolation: "isolate",
    borderRadius: { default: null, ":is([data-selected])": "0.75rem" },
    backgroundColor: {
      default: null,
      ":is([data-selected])": `color-mix(in oklab, ${tokens.primary} 10%, transparent)`,
    },
    outline: {
      default: null,
      ":is([data-selected])": `2px solid color-mix(in oklab, ${tokens.primary} 50%, transparent)`,
    },
    outlineOffset: { default: null, ":is([data-selected])": 2 },
  },
  /** the `.react-renderer` wrapper of every component node view. Its own
   * paint layer: a dragged element's ghost is rasterized from it; without
   * one Chromium snapshots the whole page. Fresh inserts settle in once the
   * editor is `settled`, so the hydration swap never animates. Entries
   * nested in a folder indent along a guide rail. */
  component: {
    position: "relative",
    isolation: "isolate",
    marginInlineStart: { default: null, [stylex.when.ancestor("[data-folder]", folder)]: "1rem" },
    paddingInlineStart: {
      default: null,
      [stylex.when.ancestor("[data-folder]", folder)]: "0.5rem",
    },
    borderInlineStartWidth: { default: null, [stylex.when.ancestor("[data-folder]", folder)]: 1 },
    borderInlineStartStyle: "solid",
    borderInlineStartColor: border,
    transition: {
      default: "none",
      [stylex.when.ancestor("[data-fde-settled]", settled)]:
        "opacity 120ms cubic-bezier(0.2, 0, 0, 1), translate 120ms cubic-bezier(0.2, 0, 0, 1)",
      [consts.reduceMotion]: "none",
    },
    "@starting-style": { opacity: 0, translate: "0 -3px" },
  },
  /** a component's content hole dissolves so children become the
   * renderer's direct layout items (see base.css for the inner element) */
  hole: { display: "contents" },
  /** an editable region; its placeholder is positioned by `--fde-ph-x/y`
   * so a component can nudge it past its own chrome */
  region: {
    position: "relative",
    outline: "none",
    "::before": {
      content: { default: null, ":is([data-placeholder])": "attr(data-placeholder)" },
      position: "absolute",
      insetInlineStart: "var(--fde-ph-x, 0)",
      top: "var(--fde-ph-y, 0)",
      color: muted,
      opacity: 0.6,
      pointerEvents: "none",
      animationName: {
        default: null,
        [stylex.when.ancestor("[data-fde-settled]", settled)]: fadeIn,
        [consts.reduceMotion]: "none",
      },
      animationDuration: "80ms",
      animationTimingFunction: "ease-out",
    },
  },
  regionBlock: { "--fde-gap": "0.5em" },
  /** drag preview line, placed by the drop-indicator plugin at the target */
  dropIndicator: {
    position: "fixed",
    zIndex: 50,
    height: 3,
    borderRadius: 2,
    backgroundColor: tokens.primary,
    pointerEvents: "none",
  },
  /* Peer carets (CollaborationCaret): 2px colored bar in the text flow
   * (user color inline) with a name flag above. The flag is chrome: never
   * selectable, never a pointer target. */
  caret: {
    position: "relative",
    marginInline: -1,
    borderInlineWidth: 1,
    borderInlineStyle: "solid",
    wordBreak: "normal",
    pointerEvents: "none",
  },
  caretLabel: {
    position: "absolute",
    top: "-1.15em",
    left: -1,
    paddingInline: 4,
    borderRadius: "3px 3px 3px 0",
    fontSize: 10,
    fontWeight: 500,
    fontFamily: "var(--font-sans, inherit)",
    lineHeight: 1.5,
    color: "#fff",
    whiteSpace: "nowrap",
    userSelect: "none",
    pointerEvents: "none",
  },
  caretSelection: { borderRadius: 2 },
});

const cls = (...styles: stylex.CompiledStyles[]) => stylex.props(...styles).className!;

const HEADING = [
  cls(content.block, content.heading, content.h1),
  cls(content.block, content.heading, content.h2),
  cls(content.block, content.heading, content.h3),
  cls(content.block, content.heading, content.h4),
];

/** class per node / mark type; the static paint applies these directly */
export const nodeClass = {
  paragraph: cls(content.block, content.paragraph),
  bulletList: cls(content.block, content.list, content.ul),
  orderedList: cls(content.block, content.list, content.ol),
  listItem: cls(content.li),
  taskList: cls(content.block, content.taskList),
  taskItem: cls(content.li, content.taskItem),
  blockquote: cls(content.block, content.blockquote),
  horizontalRule: cls(content.hr, content.atom),
  image: cls(content.img, content.atom),
  table: cls(content.table),
  tableHeader: cls(content.cell, content.th),
  tableCell: cls(content.cell),
  code: cls(content.code),
  link: cls(content.link),
  mdxJsxFlowElement: cls(content.block, content.mdxFlow, content.atom),
  mdxJsxTextElement: cls(content.mdxInline),
  mdxTextExpression: cls(content.code, content.mdxCode),
  verbatimInline: cls(content.code, content.mdxCode),
  mdxFlowExpression: cls(content.block, content.pre, content.atom),
  mdxjsEsm: cls(content.block, content.pre, content.atom),
  verbatim: cls(content.block, content.pre, content.atom),
  frontmatter: cls(content.block, content.pre, content.frontmatter, content.atom),
};

export const contentClass = {
  ...nodeClass,
  heading: (level: number) => HEADING[Math.min(level, 4) - 1],
  root: cls(content.root),
  block: cls(content.block),
  component: cls(content.block, content.component),
  atom: cls(content.atom),
  dropIndicator: cls(content.dropIndicator),
};
