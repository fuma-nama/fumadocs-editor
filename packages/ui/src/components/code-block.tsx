"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";
import { consts } from "../styles/consts.stylex";
import type { Extension } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { createLowlight } from "lowlight";
import { Popover } from "@base-ui/react/popover";
import { Switch } from "@base-ui/react/switch";
import { useEffect, useState } from "react";
import { Check, ChevronDown, Clipboard, Settings2, SquareCode } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { chrome } from "../styles/shared";
import { content, contentClass } from "../styles/content";
import { nodeViewOptions } from "./node-view-options";
import { Picker } from "./picker";
import { buildCodeMeta, parseCodeMeta } from "./code-meta";
import { MermaidDiagram } from "./mermaid";
import { useEditorPortal } from "../utils/portal";

/**
 * Syntax highlighting for fenced code. `lowlight` (highlight.js) decorates
 * the PM document synchronously; Shiki's async model can't. Chrome matches
 * fumadocs-ui `CodeBlock` (shiki-flavoured card, border, title bar).
 *
 * Starts with no grammars: the highlight.js chunk loads on first code-block
 * render, then registers into this instance and re-decorates.
 */
const lowlight = createLowlight();

let grammars: Promise<void> | undefined;
const rehighlighted = new WeakSet<Editor>();

function ensureGrammars(editor: Editor) {
  grammars ??= import("./code-languages").then(({ registerLanguages }) =>
    registerLanguages(lowlight),
  );
  void grammars.then(() => {
    if (editor.isDestroyed || rehighlighted.has(editor)) return;
    rehighlighted.add(editor);
    // the lowlight plugin only re-decorates blocks a transaction touched, so
    // touch every code block without changing it (and without an undo step)
    const { state, view } = editor;
    const tr = state.tr;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") tr.setNodeMarkup(pos, undefined, { ...node.attrs });
    });
    if (tr.steps.length > 0) view.dispatch(tr.setMeta("addToHistory", false));
  });
}

/** Info-string language token → menu label. Order is the menu order. */
const LANGUAGES: { value: string; label: string }[] = [
  { value: "plaintext", label: "Plain text" },
  { value: "bash", label: "Bash" },
  { value: "typescript", label: "TypeScript" },
  { value: "tsx", label: "TSX" },
  { value: "javascript", label: "JavaScript" },
  { value: "jsx", label: "JSX" },
  { value: "json", label: "JSON" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "markdown", label: "Markdown" },
  { value: "mdx", label: "MDX" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "sql", label: "SQL" },
  { value: "yaml", label: "YAML" },
  { value: "mermaid", label: "Mermaid" },
  { value: "npm", label: "npm command" },
  { value: "package-install", label: "Package install" },
];

/** highlight.js aliases that a fence may use → the canonical menu value */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  text: "plaintext",
  "": "plaintext",
};

const styles = stylex.create({
  /** header controls: 24px squares, hover (and an open popup) wash in accent */
  iconButton: {
    display: "inline-flex",
    width: "1.5rem",
    height: "1.5rem",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
    outline: "none",
    color: {
      default: tokens.mutedForeground,
      ":hover": tokens.accentForeground,
      ":is([data-popup-open])": tokens.accentForeground,
    },
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.accent,
      ":is([data-popup-open])": tokens.accent,
    },
  },
  languageTrigger: {
    display: "inline-flex",
    height: "1.5rem",
    cursor: "pointer",
    userSelect: "none",
    alignItems: "center",
    gap: "0.25rem",
    borderRadius: "0.375rem",
    paddingInline: "0.375rem",
    fontSize: 12,
    lineHeight: "1rem",
    fontWeight: 500,
    outline: "none",
    color: {
      default: tokens.mutedForeground,
      ":hover": tokens.accentForeground,
    },
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.accent,
      ":is([data-popup-open])": tokens.accent,
    },
  },
  titleInput: {
    height: "1.5rem",
    minWidth: 0,
    flex: 1,
    backgroundColor: "transparent",
    paddingInline: "0.375rem",
    fontSize: 13,
    fontWeight: 500,
    color: tokens.foreground,
    outline: "none",
    "::placeholder": {
      color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
    },
  },
  settingsPopup: {
    display: "flex",
    width: "13rem",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "0.5rem",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    fontSize: 12.5,
    color: tokens.foreground,
  },
  denseSwitch: { height: "1.125rem", width: "1.875rem" },
  startAt: {
    height: "1.5rem",
    width: "3.5rem",
    paddingInline: "0.375rem",
    textAlign: "end",
    fontSize: 12,
  },
  /** the fence flags this editor has no control for, shown verbatim */
  rest: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    paddingTop: "0.5rem",
    fontFamily: consts.mono,
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  /** the gutter row: line numbers beside the horizontal scroller */
  body: { display: "flex" },
  pointer: { cursor: "pointer" },
});

const languageTriggerClass = stylex.props(chrome.button, styles.languageTrigger).className!;

/** Copies the block's text; briefly confirms with a check. Purely chrome: it
 * is `contentEditable={false}` and never mutates the document. */
function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy code"}
      {...stylex.props(chrome.button, styles.iconButton)}
      tabIndex={-1}
      onClick={() => {
        void navigator.clipboard?.writeText(getText());
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check size={14} /> : <Clipboard size={13} />}
    </button>
  );
}

function normalize(lang: string | null): string {
  const key = (lang ?? "").toLowerCase();
  return ALIASES[key] ?? (key || "plaintext");
}

function LanguageSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const current = normalize(value);
  // surface an unknown language so the trigger never renders blank
  const items = LANGUAGES.some((item) => item.value === current)
    ? LANGUAGES
    : [{ value: current, label: current }, ...LANGUAGES];
  const selected = items.find((item) => item.value === current);

  return (
    <Picker
      items={items}
      value={selected}
      onPick={(item) => onChange(item.value)}
      align="end"
      ariaLabel="Code language"
      triggerCls={languageTriggerClass}
      triggerTabIndex={-1}
    >
      {selected?.label}
      <ChevronDown size={12} />
    </Picker>
  );
}

/** Fence options fumadocs' rehypeCode reads: line numbers and the copy button. */
function MetaSettings({
  meta,
  onChange,
}: {
  meta: ReturnType<typeof parseCodeMeta>;
  onChange: (next: ReturnType<typeof parseCodeMeta>) => void;
}) {
  const { anchorRef, container } = useEditorPortal();
  const denseSwitch = stylex.props(chrome.switchRoot, styles.denseSwitch);
  const thumb = stylex.props(chrome.switchThumb);
  return (
    <Popover.Root>
      <Popover.Trigger
        ref={anchorRef}
        aria-label="Code block options"
        tabIndex={-1}
        {...stylex.props(chrome.button, styles.iconButton, styles.pointer)}
      >
        <Settings2 size={13} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup {...stylex.props(chrome.popup, styles.settingsPopup)}>
            <label {...stylex.props(styles.row)}>
              Line numbers
              <Switch.Root
                {...denseSwitch}
                checked={meta.lineNumbers !== false}
                onCheckedChange={(on) => onChange({ ...meta, lineNumbers: on })}
              >
                <Switch.Thumb {...thumb} />
              </Switch.Root>
            </label>
            {meta.lineNumbers !== false && (
              <label {...stylex.props(styles.row)}>
                Start at
                <input
                  {...stylex.props(chrome.input, chrome.field, styles.startAt)}
                  type="number"
                  min={1}
                  value={typeof meta.lineNumbers === "number" ? meta.lineNumbers : 1}
                  onChange={(event) => {
                    const n = Number(event.target.value);
                    onChange({ ...meta, lineNumbers: n > 1 ? n : true });
                  }}
                />
              </label>
            )}
            <label {...stylex.props(styles.row)}>
              Copy button
              <Switch.Root
                {...denseSwitch}
                checked={!meta.noCopy}
                onCheckedChange={(on) => onChange({ ...meta, noCopy: !on })}
              >
                <Switch.Thumb {...thumb} />
              </Switch.Root>
            </label>
            {meta.rest && <p {...stylex.props(styles.rest)}>{meta.rest}</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CodeBlockView({ node, editor, updateAttributes }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? null;
  const meta = parseCodeMeta(node.attrs.meta as string | null);
  useEffect(() => ensureGrammars(editor), [editor]);

  // the meta's `lineNumbers` previewed in the editor: one number per line,
  // in a gutter matching the code's metrics (no wrapping, so 1 line = 1 row)
  let gutter: string | null = null;
  if (meta.lineNumbers !== false) {
    const start = typeof meta.lineNumbers === "number" ? meta.lineNumbers : 1;
    const count = node.textContent.split("\n").length;
    const rows: string[] = [];
    for (let i = 0; i < count; i++) rows.push(String(start + i));
    gutter = rows.join("\n");
  }

  return (
    <NodeViewWrapper as="figure" dir="ltr" {...stylex.props(content.codeBlock)}>
      <div {...stylex.props(chrome.static, content.codeHeader)} contentEditable={false}>
        <SquareCode size={15} {...stylex.props(content.codeHeaderIcon)} />
        <input
          {...stylex.props(chrome.input, styles.titleInput)}
          value={meta.title}
          placeholder="Title…"
          spellCheck={false}
          tabIndex={-1}
          onChange={(event) =>
            updateAttributes({ meta: buildCodeMeta({ ...meta, title: event.target.value }) })
          }
        />
        <MetaSettings
          meta={meta}
          onChange={(next) => updateAttributes({ meta: buildCodeMeta(next) })}
        />
        <LanguageSelect
          value={language ?? ""}
          onChange={(value) => updateAttributes({ language: value })}
        />
        {!meta.noCopy && <CopyButton getText={() => node.textContent} />}
      </div>
      <div {...stylex.props(styles.body)}>
        {gutter != null && (
          <pre
            {...stylex.props(chrome.static, content.codeLines)}
            contentEditable={false}
            aria-hidden
          >
            {gutter}
          </pre>
        )}
        <div {...stylex.props(content.codeScroll)}>
          <pre {...stylex.props(content.codePre)}>
            <NodeViewContent as={"code" as "div"} {...stylex.props(content.codeCode)} />
          </pre>
        </div>
      </div>
      {normalize(language) === "mermaid" && <MermaidDiagram code={node.textContent} />}
    </NodeViewWrapper>
  );
}

/**
 * The UI-layer code-block node: syntax highlighting via lowlight plus a
 * node-view with a language picker. Carries the fence `meta` string so the
 * document still round-trips losslessly. Replaces the core `CodeBlockMdx`
 * (pass `codeBlock: false` to `editorExtensions`).
 */
export function codeBlockExtension(): Extension {
  return CodeBlockLowlight.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        meta: { default: null },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView, {
        ...nodeViewOptions,
        className: contentClass.block,
      });
    },
  }).configure({ lowlight }) as unknown as Extension;
}
