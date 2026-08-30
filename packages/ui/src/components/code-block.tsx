"use client";
import type { Extension } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { createLowlight } from "lowlight";
import { Select } from "@base-ui/react/select";
import { useEffect, useState } from "react";
import { Check, ChevronDown, Clipboard, SquareCode } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { itemCls, itemIndicatorCls, popupCls } from "./styles";

/**
 * Real-time syntax highlighting for fenced code blocks. `lowlight` (highlight.js)
 * decorates the ProseMirror document synchronously, so it works inside the
 * editor where Shiki's async model can't. The chrome mirrors the fumadocs-ui
 * `CodeBlock` figure: same `shiki`-flavoured card, border and title bar, so a
 * highlighted block reads the same in the editor as it will on the site.
 *
 * The instance starts with no grammars: the highlight.js chunk loads only
 * when a code block first renders, then registers into this same (mutable)
 * instance and re-decorates.
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

const selectTriggerCls =
  "inline-flex h-6 cursor-pointer select-none items-center gap-1 rounded-md px-1.5 text-xs font-medium text-fd-muted-foreground outline-none transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground data-[popup-open]:bg-fd-accent";

/** Copies the block's text; briefly confirms with a check. Purely chrome: it
 * is `contentEditable={false}` and never mutates the document. */
function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy code"}
      className="inline-flex size-6 items-center justify-center rounded-md text-fd-muted-foreground outline-none transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
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

  return (
    <Select.Root items={items} value={current} onValueChange={(next) => onChange(next as string)}>
      <Select.Trigger aria-label="Code language" tabIndex={-1} className={selectTriggerCls}>
        <Select.Value />
        <ChevronDown size={12} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} align="end" alignItemWithTrigger={false}>
          <Select.Popup className={`${popupCls} max-h-[300px] overflow-y-auto`}>
            {items.map((item) => (
              <Select.Item key={item.value} value={item.value} className={itemCls}>
                <Select.ItemIndicator className={itemIndicatorCls}>
                  <Check size={14} />
                </Select.ItemIndicator>
                <Select.ItemText>{item.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function CodeBlockView({ node, editor, updateAttributes }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? null;
  useEffect(() => ensureGrammars(editor), [editor]);

  return (
    <NodeViewWrapper
      as="figure"
      dir="ltr"
      className="fde-codeblock shiki not-prose relative my-4 overflow-hidden rounded-xl border border-fd-border bg-fd-card text-sm shadow-sm"
    >
      <div
        className="flex h-9.5 items-center gap-1 border-b border-fd-border px-3 text-fd-muted-foreground"
        contentEditable={false}
      >
        <SquareCode size={15} className="shrink-0 opacity-70" />
        <div className="flex-1" />
        <LanguageSelect
          value={language ?? ""}
          onChange={(value) => updateAttributes({ language: value })}
        />
        <CopyButton getText={() => node.textContent} />
      </div>
      <div className="overflow-auto">
        <pre className="fde-codeblock-pre">
          <NodeViewContent as={"code" as "div"} />
        </pre>
      </div>
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
      return ReactNodeViewRenderer(CodeBlockView);
    },
  }).configure({ lowlight }) as unknown as Extension;
}
