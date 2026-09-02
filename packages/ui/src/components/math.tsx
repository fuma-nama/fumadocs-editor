"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";
import {
  Extension,
  InputRule,
  textblockTypeInputRule,
  type Editor,
  type Extensions,
} from "@tiptap/core";
import {
  MATH_BLOCK_NODE,
  MATH_INLINE_NODE,
  MathBlock,
  MathInline,
} from "@fumadocs-editor/core/extensions";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useEffect, useState } from "react";
import { content } from "../styles/content";
import { chrome } from "../styles/shared";
import { math } from "../styles/markers.stylex";

/*
 * UI slice of the remark-math syntax (core/src/syntax/math): in-place TeX
 * source editing with a KaTeX preview, matching fumadocs' rehype-katex.
 * Caret position drives which face shows: a plugin sets `data-active` on
 * the math node holding the caret and the styles below swap source and
 * preview from that attribute, so activation never re-renders React. KaTeX
 * (and its stylesheet) load in their own chunk on the first math node.
 */

type Katex = typeof import("katex").default;

const styles = stylex.create({
  /* Once a preview exists the source only shows while the caret is inside,
   * so these re-declare the element's own display alongside the swap. */
  srcInline: {
    display: {
      default: "inline-block",
      [stylex.when.ancestor(":not([data-active])", math)]: "none",
    },
  },
  srcBlock: {
    display: { default: "block", [stylex.when.ancestor(":not([data-active])", math)]: "none" },
  },
  /** inline preview: replaced by the source while editing */
  preview: {
    cursor: "text",
    display: { default: null, [stylex.when.ancestor("[data-active]", math)]: "none" },
  },
  /** block preview: sits below the source while editing */
  previewBlock: { cursor: "text", display: "block", overflowX: "auto" },
  /** ring around a block being edited, where both faces are visible */
  blockActive: {
    borderRadius: { default: null, [stylex.when.ancestor("[data-active]", math)]: 10 },
    outline: {
      default: null,
      [stylex.when.ancestor("[data-active]", math)]:
        `1px solid color-mix(in oklab, ${tokens.ring} 45%, ${tokens.border})`,
    },
    outlineOffset: { default: null, [stylex.when.ancestor("[data-active]", math)]: 2 },
  },
});

/* The `.react-renderer` wrapper takes the `data-active` decoration, so it is
 * also the marker its faces key off. */
const inlineClass = stylex.props(content.mathInline, math).className;
const blockClass = stylex.props(content.block, math).className;

let katexModule: Katex | null = null;
let katexPromise: Promise<void> | undefined;

function useKatex(): Katex | null {
  const [katex, setKatex] = useState(katexModule);
  useEffect(() => {
    if (katex) return;
    katexPromise ??= Promise.all([
      import("katex"),
      // @ts-expect-error -- style-only import, no module declaration
      import("katex/dist/katex.min.css"),
    ]).then(([m]) => {
      katexModule = m.default;
    });
    let live = true;
    void katexPromise.then(() => {
      if (live) setKatex(katexModule);
    });
    return () => {
      live = false;
    };
  }, [katex]);
  return katex;
}

function Preview({
  katex,
  value,
  display,
  onClick,
}: {
  katex: Katex;
  value: string;
  display: boolean;
  onClick: () => void;
}) {
  const html = katex.renderToString(value, {
    displayMode: display,
    throwOnError: false,
  });
  return (
    <span
      {...stylex.props(chrome.static, display ? styles.previewBlock : styles.preview)}
      contentEditable={false}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** caret to the end of the node's source text, entering edit mode */
function focusSource({ editor, getPos, node }: NodeViewProps) {
  const pos = getPos();
  if (typeof pos !== "number") return;
  editor
    .chain()
    .focus()
    .setTextSelection(pos + 1 + node.content.size)
    .run();
}

function MathInlineView(props: NodeViewProps) {
  const { node } = props;
  const katex = useKatex();
  const empty = node.content.size === 0;
  const rendered = katex != null && !empty;
  return (
    <NodeViewWrapper as="span">
      <span
        {...stylex.props(content.mathInlineSrc, rendered && styles.srcInline)}
        data-empty={empty || undefined}
      >
        <NodeViewContent as={"span" as "div"} />
      </span>
      {katex && !empty && (
        <Preview
          katex={katex}
          value={node.textContent}
          display={false}
          onClick={() => focusSource(props)}
        />
      )}
    </NodeViewWrapper>
  );
}

function MathBlockView(props: NodeViewProps) {
  const { node } = props;
  const katex = useKatex();
  const empty = node.content.size === 0;
  const rendered = katex != null && !empty;
  return (
    <NodeViewWrapper {...stylex.props(content.mathBlock, rendered && styles.blockActive)}>
      <pre
        {...stylex.props(content.mathBlockSrc, rendered && styles.srcBlock)}
        data-empty={empty || undefined}
      >
        <NodeViewContent as={"code" as "div"} {...stylex.props(content.codeCode)} />
      </pre>
      {katex && !empty && (
        <Preview
          katex={katex}
          value={node.textContent}
          display
          onClick={() => focusSource(props)}
        />
      )}
    </NodeViewWrapper>
  );
}

/**
 * Marks the math node holding the caret with `data-active` (on its outer
 * `.react-renderer`, like the component tint) so CSS can show the TeX source
 * only while it is being edited.
 */
const mathActive = Extension.create({
  name: "fdeMathActive",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { $from } = state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === MATH_INLINE_NODE || node.type.name === MATH_BLOCK_NODE) {
                const pos = $from.before(depth);
                return DecorationSet.create(state.doc, [
                  Decoration.node(pos, pos + node.nodeSize, { "data-active": "" }),
                ]);
              }
            }
            return DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/*
 * Arrow entry into math. Inactive TeX is display:none (preview shows);
 * Chromium and WebKit step into hidden text (activating the node), Firefox
 * skips the whole node. Handle the crossing so every engine enters edit
 * mode the same way.
 */

/*
 * Entry caret goes to the END of the source, like click-to-edit
 * (focusSource). A caret at source offset 0 is equivalent to the position
 * before the node, so selectionToDOM leaves the DOM caret outside the
 * (still hidden) source and typing lands beside the formula. End-of-source
 * has text between it and either boundary, so placement sticks.
 */

/** caret adjacent to an inline math node: step into its source */
function enterInline(editor: Editor, dir: 1 | -1): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  const adjacent = dir === 1 ? $from.nodeAfter : $from.nodeBefore;
  if (adjacent?.type.name !== MATH_INLINE_NODE) return false;
  const end = dir === 1 ? $from.pos + 1 + adjacent.content.size : $from.pos - 1;
  return editor.commands.setTextSelection(end);
}

/** caret at a textblock edge with a math block as the next sibling: enter it */
function enterBlock(editor: Editor, dir: 1 | -1, axis: "h" | "v"): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  const atEdge =
    dir === 1 ? $from.parentOffset === $from.parent.content.size : $from.parentOffset === 0;
  if (axis === "h") {
    if (!atEdge) return false;
  } else if (!atEdge && !editor.view.endOfTextblock(dir === 1 ? "down" : "up")) {
    return false;
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    const parent = $from.node(depth - 1);
    const sibIndex = $from.index(depth - 1) + dir;
    if (sibIndex < 0 || sibIndex >= parent.childCount) continue;
    const sibling = parent.child(sibIndex);
    if (sibling.type.name !== MATH_BLOCK_NODE) return false;
    const boundary = dir === 1 ? $from.after(depth) : $from.before(depth);
    const end = dir === 1 ? boundary + 1 + sibling.content.size : boundary - 1;
    return editor.commands.setTextSelection(end);
  }
  return false;
}

/**
 * The math node types wired to their KaTeX node views. Views register
 * regardless of the dialect flag (a flag-off document never contains the
 * nodes); only the creation paths (input rules) are gated, so math is
 * unproducible while `SyntaxOptions.math` is off.
 */
export function mathExtensions(enabled: boolean): Extensions {
  return [
    MathInline.extend({
      addNodeView: () => ReactNodeViewRenderer(MathInlineView, { className: inlineClass }),
      addInputRules() {
        if (!enabled) return [];
        return [
          // typing `$x$` becomes inline math (the closing `$` completes it)
          new InputRule({
            find: /(?<!\$)\$([^$\s](?:[^$]*[^$\s])?)\$$/,
            handler: ({ state, range, match }) => {
              const node = this.type.create(null, state.schema.text(match[1]));
              state.tr.replaceWith(range.from, range.to, node);
            },
          }),
        ];
      },
      addKeyboardShortcuts() {
        return {
          ArrowRight: () => enterInline(this.editor, 1),
          ArrowLeft: () => enterInline(this.editor, -1),
          // Enter finishes the formula instead of splitting the paragraph
          Enter: () => {
            const { $from } = this.editor.state.selection;
            if ($from.parent.type.name !== MATH_INLINE_NODE) return false;
            return this.editor.commands.setTextSelection($from.after());
          },
          // Backspace in an emptied formula removes the node itself
          Backspace: () => {
            const { $from, empty } = this.editor.state.selection;
            if (
              !empty ||
              $from.parent.type.name !== MATH_INLINE_NODE ||
              $from.parent.content.size > 0
            ) {
              return false;
            }
            const from = $from.before();
            return this.editor.commands.deleteRange({ from, to: from + $from.parent.nodeSize });
          },
        };
      },
    }),
    MathBlock.extend({
      addNodeView: () => ReactNodeViewRenderer(MathBlockView, { className: blockClass }),
      addInputRules() {
        if (!enabled) return [];
        return [textblockTypeInputRule({ find: /^\$\$\s$/, type: this.type })];
      },
      addKeyboardShortcuts() {
        return {
          ArrowRight: () => enterBlock(this.editor, 1, "h"),
          ArrowLeft: () => enterBlock(this.editor, -1, "h"),
          ArrowDown: () => enterBlock(this.editor, 1, "v"),
          ArrowUp: () => enterBlock(this.editor, -1, "v"),
          Backspace: () => {
            const { $from, empty } = this.editor.state.selection;
            if (
              !empty ||
              $from.parent.type.name !== MATH_BLOCK_NODE ||
              $from.parent.content.size > 0
            ) {
              return false;
            }
            return this.editor.commands.setNode("paragraph");
          },
        };
      },
    }),
    mathActive,
  ];
}
