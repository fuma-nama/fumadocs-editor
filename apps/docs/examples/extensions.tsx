import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { MdxEditor, type BubbleItem } from "@fumadocs-editor/ui";
import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

//#region todo
export const todoHighlight = Extension.create({
  name: "todoHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("todoHighlight"),
        props: {
          decorations(state) {
            const found: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              for (const match of node.text!.matchAll(/\bTODO\b/g)) {
                const from = pos + match.index;
                found.push(
                  Decoration.inline(from, from + 4, { class: "rounded-sm bg-yellow-400/30" }),
                );
              }
            });
            return DecorationSet.create(state.doc, found);
          },
        },
      }),
    ];
  },
});
//#endregion

//#region ask-ai
/** your model: an instruction about the selected text in, an answer out */
export type Ask = (instruction: string, selection: string) => Promise<string>;

/** what the panel works on: the selection when it opened */
export interface AskTarget {
  editor: Editor;
  doc: PMNode;
  from: number;
  to: number;
  text: string;
}

export function askTarget(editor: Editor): AskTarget | null {
  const { doc, selection } = editor.state;
  const text = doc.textBetween(selection.from, selection.to, "\n").trim();
  if (!text) return null;
  return { editor, doc, from: selection.from, to: selection.to, text };
}

/** ⌘J / Ctrl+J opens your panel on the selection */
export const askAiShortcut = (onAsk: (target: AskTarget) => void) =>
  Extension.create({
    name: "askAi",
    addKeyboardShortcuts() {
      return {
        "Mod-j": () => {
          const target = askTarget(this.editor);
          if (target) onAsk(target);
          return target !== null;
        },
      };
    },
  });

/**
 * Put the answer below the selected block, or in place of the selection.
 * Returns false when the document changed since the panel opened.
 */
export function applyAnswer(target: AskTarget, answer: string, mode: "below" | "replace") {
  const { editor, doc, from, to } = target;
  if (editor.isDestroyed || editor.state.doc !== doc) return false;
  // text nodes and paragraphs: the answer is never parsed as HTML
  const paragraphs: JSONContent[] = answer
    .split(/\n{2,}/)
    .map((text) => ({ type: "paragraph", content: [{ type: "text", text }] }));
  const chain = editor.chain().focus();
  if (mode === "replace") {
    const inline = paragraphs.length === 1 ? paragraphs[0]!.content! : paragraphs;
    chain.insertContentAt({ from, to }, inline);
  } else {
    const $to = doc.resolve(to);
    chain.insertContentAt($to.after($to.depth), paragraphs);
  }
  return chain.run();
}
//#endregion

//#region panel
const quick = ["Summarize", "Make it shorter", "Explain"];

/** your own UI, floating under the selection; the editor knows nothing of it */
export function AskAiPanel({
  target,
  ask,
  onClose,
}: {
  target: AskTarget;
  ask: Ask;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "asking" }
    | { kind: "answer"; text: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const panel = useRef<HTMLDivElement>(null);

  const end = target.editor.view.coordsAtPos(target.to);
  const left = Math.min(end.left, window.innerWidth - 368) + window.scrollX;
  const top = end.bottom + 8 + window.scrollY;

  const close = () => {
    onClose();
    target.editor.commands.focus();
  };

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);

  const submit = async (text: string) => {
    if (!text.trim()) return;
    setInstruction(text);
    setState({ kind: "asking" });
    try {
      setState({ kind: "answer", text: await ask(text, target.text) });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const apply = (mode: "below" | "replace") => {
    if (state.kind !== "answer") return;
    if (applyAnswer(target, state.text, mode)) onClose();
    else setState({ kind: "error", message: "The document changed. Select the text again." });
  };

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Ask AI"
      style={{ position: "absolute", left, top }}
      className="z-50 flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col gap-2 rounded-xl border bg-fd-popover p-3 text-sm text-fd-popover-foreground shadow-lg"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <p className="line-clamp-2 border-l-2 pl-2 text-xs text-fd-muted-foreground">{target.text}</p>
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(instruction);
        }}
      >
        <input
          autoFocus
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Ask about the selection…"
          className="min-w-0 flex-1 rounded-md border bg-fd-background px-2 py-1 outline-none focus:ring-2 focus:ring-fd-ring"
        />
        <button
          type="submit"
          disabled={state.kind === "asking" || !instruction.trim()}
          className="rounded-md bg-fd-primary px-2.5 text-fd-primary-foreground disabled:opacity-50"
        >
          Ask
        </button>
      </form>
      {state.kind === "idle" && (
        <div className="flex flex-wrap gap-1">
          {quick.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => void submit(text)}
              className="rounded-full border px-2 py-0.5 text-xs hover:bg-fd-accent"
            >
              {text}
            </button>
          ))}
        </div>
      )}
      {state.kind === "asking" && <p className="text-xs text-fd-muted-foreground">Thinking…</p>}
      {state.kind === "error" && <p className="text-xs text-red-500">{state.message}</p>}
      {state.kind === "answer" && (
        <>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-fd-secondary p-2">
            {state.text}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => apply("below")}
              className="rounded-md bg-fd-primary px-2 py-0.5 text-fd-primary-foreground"
            >
              Insert below
            </button>
            <button
              type="button"
              onClick={() => apply("replace")}
              className="rounded-md border px-2 py-0.5"
            >
              Replace selection
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-md px-2 py-0.5 text-fd-muted-foreground"
            >
              Discard
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
//#endregion

//#region word-count
/** reports the live editor to React; null once it is gone (e.g. a switch to source) */
export const editorHandle = (setEditor: Dispatch<SetStateAction<Editor | null>>) =>
  Extension.create({
    name: "editorHandle",
    onCreate() {
      setEditor(this.editor);
    },
    onDestroy() {
      // the next editor may already have reported itself
      setEditor((current) => (current === this.editor ? null : current));
    },
  });

export const wordCount = (onCount: (words: number) => void) =>
  Extension.create({
    name: "wordCount",
    onCreate() {
      onCount(count(this.editor));
    },
    onUpdate() {
      onCount(count(this.editor));
    },
  });

function count(editor: Editor) {
  const { doc } = editor.state;
  // a space between blocks, or the last word of one runs into the next
  return doc.textBetween(0, doc.content.size, " ", " ").split(/\s+/).filter(Boolean).length;
}
//#endregion

//#region bubble
export const askAiItem = (onAsk: (target: AskTarget) => void): BubbleItem => ({
  label: "Ask AI",
  icon: <span aria-hidden>✦</span>,
  // bound by askAiShortcut; shown in the tooltip
  shortcut: "Mod-j",
  run: (editor) => {
    const target = askTarget(editor);
    if (target) onAsk(target);
  },
});
//#endregion

//#region usage
/** about 200 words a minute; at least a minute */
const readingTime = (words: number) => Math.max(1, Math.round(words / 200));

async function ask(instruction: string, selection: string): Promise<string> {
  const response = await fetch("/api/ask", {
    method: "POST",
    body: JSON.stringify({ instruction, selection }),
  });
  if (!response.ok) throw new Error(`The model answered ${response.status}`);
  return response.text();
}

export function NotesEditor({ text, model = ask }: { text: string; model?: Ask }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [words, setWords] = useState(0);
  const [target, setTarget] = useState<AskTarget | null>(null);
  // fixed for the life of the root: create them once; they only open the panel
  const [extensions] = useState(() => [
    todoHighlight,
    askAiShortcut(setTarget),
    editorHandle(setEditor),
    wordCount(setWords),
  ]);
  const [bubbleItems] = useState(() => [askAiItem(setTarget)]);

  return (
    <>
      <MdxEditor
        defaultValue={text}
        extensions={extensions}
        bubbleItems={bubbleItems}
        header={{
          end: (
            <>
              <span className="text-xs text-fd-muted-foreground tabular-nums">
                {words} words · {readingTime(words)} min read
              </span>
              <button
                type="button"
                disabled={!editor}
                className="rounded-md border px-2 py-0.5 text-xs disabled:opacity-50"
                // keep the editor's focus and selection
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setTarget(editor && askTarget(editor))}
              >
                Ask AI
              </button>
            </>
          ),
        }}
      />
      {target && (
        <AskAiPanel
          key={`${target.from}-${target.to}`}
          target={target}
          ask={model}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}
//#endregion
