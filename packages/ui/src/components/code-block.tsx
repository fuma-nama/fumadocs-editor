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
import { Popover } from "@base-ui/react/popover";
import { Switch } from "@base-ui/react/switch";
import { useEffect, useState } from "react";
import { Check, ChevronDown, Clipboard, Settings2, SquareCode } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { popupCls } from "./styles";
import { cn } from "../utils/cn";
import { Picker } from "./picker";
import { buildCodeMeta, parseCodeMeta } from "./code-meta";
import { useEditorPortal } from "../utils/portal";

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

const selectTriggerCls =
  "inline-flex h-6 cursor-pointer select-none items-center gap-1 rounded-md px-1.5 text-xs font-medium text-fd-muted-foreground outline-none hover:bg-fd-accent hover:text-fd-accent-foreground data-[popup-open]:bg-fd-accent";

/** Copies the block's text; briefly confirms with a check. Purely chrome: it
 * is `contentEditable={false}` and never mutates the document. */
function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy code"}
      className="inline-flex size-6 items-center justify-center rounded-md text-fd-muted-foreground outline-none hover:bg-fd-accent hover:text-fd-accent-foreground"
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
      triggerCls={selectTriggerCls}
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
  const rowCls = "flex items-center justify-between gap-3 text-[12.5px] text-fd-foreground";
  const switchRootCls =
    "relative flex h-4.5 w-7.5 shrink-0 cursor-pointer rounded-full bg-fd-border p-0.5 transition-colors data-[checked]:bg-fd-primary";
  const switchThumbCls =
    "aspect-square h-full rounded-full bg-fd-background shadow-sm transition-[translate] data-[checked]:translate-x-3";
  return (
    <Popover.Root>
      <Popover.Trigger
        ref={anchorRef}
        aria-label="Code block options"
        tabIndex={-1}
        className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-fd-muted-foreground outline-none hover:bg-fd-accent hover:text-fd-accent-foreground data-[popup-open]:bg-fd-accent data-[popup-open]:text-fd-accent-foreground"
      >
        <Settings2 size={13} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup className={cn(popupCls, "flex w-52 flex-col gap-2 p-2")}>
            <label className={rowCls}>
              Line numbers
              <Switch.Root
                className={switchRootCls}
                checked={meta.lineNumbers !== false}
                onCheckedChange={(on) => onChange({ ...meta, lineNumbers: on })}
              >
                <Switch.Thumb className={switchThumbCls} />
              </Switch.Root>
            </label>
            {meta.lineNumbers !== false && (
              <label className={rowCls}>
                Start at
                <input
                  className="h-6 w-14 rounded-md border border-fd-border bg-fd-background px-1.5 text-right text-[12px] outline-none focus-visible:border-fd-ring"
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
            <label className={rowCls}>
              Copy button
              <Switch.Root
                className={switchRootCls}
                checked={!meta.noCopy}
                onCheckedChange={(on) => onChange({ ...meta, noCopy: !on })}
              >
                <Switch.Thumb className={switchThumbCls} />
              </Switch.Root>
            </label>
            {meta.rest && (
              <p className="border-t border-fd-border pt-2 font-mono text-[11px] text-fd-muted-foreground">
                {meta.rest}
              </p>
            )}
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
        <input
          className="h-6 min-w-0 flex-1 bg-transparent px-1.5 text-[13px] font-medium text-fd-foreground outline-none placeholder:text-fd-muted-foreground/50"
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
      <div className="flex">
        {gutter != null && (
          <pre className="fde-codeblock-lines" contentEditable={false} aria-hidden>
            {gutter}
          </pre>
        )}
        <div className="min-w-0 flex-1 overflow-auto">
          <pre className="fde-codeblock-pre">
            <NodeViewContent as={"code" as "div"} />
          </pre>
        </div>
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
