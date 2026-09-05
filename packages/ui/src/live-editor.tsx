"use client";
import * as stylex from "@stylexjs/stylex";
import { EditorContent, useEditor } from "@tiptap/react";
import { createSyntax, editorExtensions } from "@fumadocs-editor/core/extensions";
import { createIncrementalSerializer } from "@fumadocs-editor/core/serialize";
import type { DocSnapshot, SyntaxOptions } from "@fumadocs-editor/core/parse";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { componentExtensions } from "./components/node-views";
import { codeBlockExtension } from "./components/code-block";
import { mathExtensions } from "./components/math";
import { slashMenu } from "./slash-menu";
import { EditorBubble } from "./bubble-menu";
import { BlockGutter } from "./block-gutter";
import type { UiComponentSpec } from "./components/spec";
import { imageExtension } from "./components/image-view";
import { fileSuggest, linkSuggest } from "./components/file-suggest";
import type { FileProvider, MediaProvider } from "./components/media";
import type { EditorCollab } from "./collab";
import { contentClass } from "./styles/content";
import { contentStyles } from "./components/content-styles";
import { settled as settledMarker } from "./styles/markers.stylex";

const styles = stylex.create({ frame: { position: "relative" } });

export type SerializeFn = (doc: PMNode, snapshot?: DocSnapshot) => string;

function useMediaQuery(query: string): boolean {
  const [subscribe, getSnapshot] = useMemo(() => {
    let list: MediaQueryList | undefined;
    const resolve = () => (list ??= window.matchMedia(query));
    return [
      (onChange: () => void) => {
        resolve().addEventListener("change", onChange);
        return () => resolve().removeEventListener("change", onChange);
      },
      () => resolve().matches,
    ] as const;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export interface LiveEditorProps {
  doc: JSONContent;
  components: UiComponentSpec[];
  specs: Map<string, UiComponentSpec>;
  snapshotRef: RefObject<DocSnapshot | undefined>;
  onChangeRef: RefObject<((markdown: string) => void) | undefined>;
  onReady: (editor: Editor, serialize: SerializeFn) => void;
  hidden: boolean;
  editable: boolean;
  media?: MediaProvider;
  files?: FileProvider;
  syntax?: SyntaxOptions;
  collab?: EditorCollab;
}

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
      contentStyles,
      codeBlockExtension(),
      imageExtension(media),
      ...componentExtensions(specs),
      ...mathExtensions(syntax?.math === true),
      slashMenu(specs, media, syntax?.math),
      ...(files ? [fileSuggest(specs, files), linkSuggest(files)] : []),
      ...(collab ? collab.extensions : []),
    ],
    [media, files, specs, syntax, collab],
  );
  const serialize = useMemo(
    () => createIncrementalSerializer(createSyntax(components, syntax)),
    [components, syntax],
  );

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
      attributes: {
        class: contentClass.root,
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
    },
    onCreate({ editor }) {
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

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  const touch = useMediaQuery("(pointer: coarse)");

  // insert animations arm one painted frame after the editor shows: the
  // hydration swap must not move; only real insertions animate
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
    <div
      {...stylex.props(styles.frame, settledMarker)}
      hidden={hidden}
      data-fde-settled={settled || undefined}
    >
      <EditorContent editor={editor} />
      {editor && editable && (
        <>
          <BlockGutter editor={editor} touch={touch} />
          <EditorBubble editor={editor} specs={specs} media={media} touch={touch} />
        </>
      )}
    </div>
  );
}
