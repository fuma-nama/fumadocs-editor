"use client";
import { EditorContent, useEditor } from "@tiptap/react";
import { editorExtensions, type DocSnapshot } from "@fumadocs-editor/core";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { componentExtensions } from "./components/node-views";
import { codeBlockExtension } from "./components/code-block";
import { slashMenu } from "./slash-menu";
import { EditorBubble } from "./bubble-menu";
import { BlockMenu } from "./block-menu";
import { MobileBar } from "./mobile-bar";
import type { UiComponentSpec } from "./components/spec";

export interface LiveEditorProps {
  doc: JSONContent;
  components: UiComponentSpec[];
  specs: Map<string, UiComponentSpec>;
  serialize: (doc: PMNode, snapshot?: DocSnapshot) => string;
  snapshotRef: RefObject<DocSnapshot | undefined>;
  onChangeRef: RefObject<((markdown: string) => void) | undefined>;
  /** fires once the editor exists and its view is mounted */
  onReady: (editor: Editor) => void;
  /** kept in the tree but not shown until the shell swaps the static view out */
  hidden: boolean;
}

/**
 * Stage-1 hydration: the real TipTap editor. Mounted lazily by the shell
 * (idle or first intent), constructed after mount (`immediatelyRender:
 * false`) so the static paint never waits on ProseMirror, and never
 * re-rendered per transaction — all chrome subscribes via `useEditorState`.
 */
export function LiveEditor({
  doc,
  components,
  specs,
  serialize,
  snapshotRef,
  onChangeRef,
  onReady,
  hidden,
}: LiveEditorProps) {
  const extensions = useMemo(
    () => [
      ...editorExtensions({ componentNodes: false, codeBlock: false }),
      codeBlockExtension(),
      ...componentExtensions(components),
      slashMenu(components),
    ],
    [components],
  );

  // unchanged blocks serialize from a per-node cache, so cost tracks the
  // edited block; still debounced so bursts of keystrokes report once
  const serializeTimer = useRef<number>(undefined);
  useEffect(() => () => clearTimeout(serializeTimer.current), []);

  const editor = useEditor({
    extensions,
    content: doc,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    // file names, props and code everywhere: browser text assistance only
    // paints false positives and mutates DOM the schema has to heal
    editorProps: {
      attributes: { spellcheck: "false", autocorrect: "off", autocapitalize: "off" },
    },
    onCreate({ editor }) {
      onReady(editor);
    },
    onUpdate({ editor }) {
      if (!onChangeRef.current) return;
      clearTimeout(serializeTimer.current);
      serializeTimer.current = window.setTimeout(() => {
        serializeTimer.current = undefined;
        onChangeRef.current?.(serialize(editor.state.doc, snapshotRef.current));
      }, 250);
    },
    onBlur({ editor }) {
      if (serializeTimer.current === undefined) return;
      clearTimeout(serializeTimer.current);
      serializeTimer.current = undefined;
      onChangeRef.current?.(serialize(editor.state.doc, snapshotRef.current));
    },
  });

  return (
    <div className="relative" hidden={hidden}>
      <EditorContent editor={editor} className="fde-content" />
      {editor && <EditorBubble editor={editor} specs={specs} />}
      {editor && <BlockMenu editor={editor} specs={specs} />}
      {editor && <MobileBar editor={editor} components={components} specs={specs} />}
    </div>
  );
}
