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
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Select } from "@base-ui/react/select";
import { useState } from "react";
import { Check, ChevronDown, Clipboard, SquareCode } from "lucide-react";
import { itemCls, itemIndicatorCls, popupCls } from "./styles";

/**
 * Real-time syntax highlighting for fenced code blocks. `lowlight` (highlight.js)
 * decorates the ProseMirror document synchronously, so it works inside the
 * editor where Shiki's async model can't. The chrome mirrors the fumadocs-ui
 * `CodeBlock` figure: same `shiki`-flavoured card, border and title bar, so a
 * highlighted block reads the same in the editor as it will on the site.
 *
 * A curated grammar set (rather than lowlight's ~40-language `common` bundle)
 * keeps the editor bundle small; fences in an unregistered language simply
 * render unhighlighted and still round-trip.
 */
const lowlight = createLowlight({
  bash,
  css,
  go,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
});
// map the editor's info-string tokens onto their nearest registered grammar
lowlight.registerAlias({
  javascript: ["jsx", "mjs", "cjs"],
  typescript: ["tsx"],
  xml: ["html"],
  markdown: ["mdx"],
});

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

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? null;

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
