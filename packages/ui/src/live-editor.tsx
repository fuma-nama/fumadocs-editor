"use client";
import { EditorContent, useEditor } from "@tiptap/react";
import { createSyntax, editorExtensions } from "@fumadocs-editor/core/extensions";
import { createIncrementalSerializer } from "@fumadocs-editor/core/serialize";
import type { DocSnapshot } from "@fumadocs-editor/core/parse";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { componentExtensions } from "./components/node-views";
import { codeBlockExtension } from "./components/code-block";
import { slashMenu } from "./slash-menu";
import { EditorBubble } from "./bubble-menu";
import { BlockMenu } from "./block-menu";
import { MobileBar } from "./mobile-bar";
import type { UiComponentSpec } from "./components/spec";
import { imageExtension } from "./components/image-view";
import { fileSuggest, linkSuggest } from "./components/file-suggest";
import type { FileProvider, MediaProvider } from "./components/media";

export type SerializeFn = (doc: PMNode, snapshot?: DocSnapshot) => string;

export interface LiveEditorProps {
  doc: JSONContent;
  components: UiComponentSpec[];
  specs: Map<string, UiComponentSpec>;
  snapshotRef: RefObject<DocSnapshot | undefined>;
  onChangeRef: RefObject<((markdown: string) => void) | undefined>;
  /** fires once the editor exists and its view is mounted */
  onReady: (editor: Editor, serialize: SerializeFn) => void;
  /** kept in the tree but not shown until the shell swaps the static view out */
  hidden: boolean;
  media?: MediaProvider;
  files?: FileProvider;
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
  snapshotRef,
  onChangeRef,
  onReady,
  hidden,
  media,
  files,
}: LiveEditorProps) {
  const extensions = useMemo(
    () => [
      ...editorExtensions({ componentNodes: false, codeBlock: false, image: false }),
      codeBlockExtension(),
      imageExtension(media),
      ...componentExtensions(components),
      slashMenu(components, media),
      ...(files ? [fileSuggest(specs, files), linkSuggest(files)] : []),
    ],
    [components, media, files, specs],
  );
  const serialize = useMemo(
    () => createIncrementalSerializer(createSyntax(components)),
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
      onReady(editor, serialize);
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

  // insert animations arm one painted frame after the editor shows: the
  // hydration swap must be perfectly still, only real insertions move
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (hidden || !editor) return;
    let inner: number;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [hidden, editor]);

  return (
    <div className="relative" hidden={hidden} data-fde-settled={settled || undefined}>
      <EditorContent editor={editor} className="fde-content" />
      {editor && <EditorBubble editor={editor} specs={specs} media={media} />}
      {editor && <BlockMenu editor={editor} specs={specs} />}
      {editor && <MobileBar editor={editor} components={components} specs={specs} />}
    </div>
  );
}
