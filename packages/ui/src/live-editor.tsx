"use client";
import { EditorContent, useEditor } from "@tiptap/react";
import { createSyntax, editorExtensions } from "@fumadocs-editor/core/extensions";
import { createIncrementalSerializer } from "@fumadocs-editor/core/serialize";
import type { DocSnapshot, SyntaxOptions } from "@fumadocs-editor/core/parse";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { componentExtensions } from "./components/node-views";
import { codeBlockExtension } from "./components/code-block";
import { mathExtensions } from "./components/math";
import { slashMenu } from "./slash-menu";
import { EditorBubble } from "./bubble-menu";
import { BlockMenu } from "./block-menu";
import { MobileBar } from "./mobile-bar";
import type { UiComponentSpec } from "./components/spec";
import { imageExtension } from "./components/image-view";
import { fileSuggest, linkSuggest } from "./components/file-suggest";
import type { FileProvider, MediaProvider } from "./components/media";
import type { EditorCollab } from "./collab";

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
  /** read-only rendering: no typing, no mutating chrome */
  editable: boolean;
  media?: MediaProvider;
  files?: FileProvider;
  /** dialect switches; must match what the document was parsed with */
  syntax?: SyntaxOptions;
  /**
   * Already-started collab runtime (a separate chunk, loaded by the shell).
   * The Y.Doc is then the source of truth: `doc` is ignored, local history
   * yields to the Y undo manager, and `onReady` waits for the first sync.
   */
  collab?: EditorCollab;
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
  editable,
  media,
  files,
  syntax,
  collab,
}: LiveEditorProps) {
  const extensions = useMemo(
    () => [
      ...editorExtensions({
        componentNodes: false,
        codeBlock: false,
        image: false,
        mathNodes: false,
        history: !collab,
      }),
      codeBlockExtension(),
      imageExtension(media),
      ...componentExtensions(components),
      ...mathExtensions(syntax?.math === true),
      slashMenu(components, specs, media, syntax?.math),
      ...(files ? [fileSuggest(specs, files), linkSuggest(files)] : []),
      ...(collab ? collab.extensions : []),
    ],
    [components, media, files, specs, syntax, collab],
  );
  const serialize = useMemo(
    () => createIncrementalSerializer(createSyntax(components, syntax)),
    [components, syntax],
  );

  // unchanged blocks serialize from a per-node cache, so cost tracks the
  // edited block; still debounced so bursts of keystrokes report once
  const serializeTimer = useRef<number>(undefined);
  useEffect(() => () => clearTimeout(serializeTimer.current), []);

  const editor = useEditor({
    extensions,
    editable,
    // under collab the server's Y.Doc is the document; seeding content here
    // would sync a duplicate copy into it
    content: collab ? null : doc,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    // file names, props and code everywhere: browser text assistance only
    // paints false positives and mutates DOM the schema has to heal
    editorProps: {
      attributes: { spellcheck: "false", autocorrect: "off", autocapitalize: "off" },
    },
    onCreate({ editor }) {
      // hold the static → live swap until the shared doc has arrived, so the
      // first visible state is the document and replayed input lands in it
      if (collab) {
        void collab.whenSynced.then(() => {
          if (!editor.isDestroyed) onReady(editor, serialize);
        });
      } else {
        onReady(editor, serialize);
      }
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

  // `editable` is a live prop (scope data can arrive after mount)
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

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
      {editor && editable && <EditorBubble editor={editor} specs={specs} media={media} />}
      {editor && editable && <BlockMenu editor={editor} specs={specs} />}
      {editor && editable && (
        <MobileBar editor={editor} components={components} specs={specs} math={syntax?.math} />
      )}
    </div>
  );
}
