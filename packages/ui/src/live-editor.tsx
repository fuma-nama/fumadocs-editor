"use client";
import * as stylex from "@stylexjs/stylex";
import { EditorContent, useEditor } from "@tiptap/react";
import { createSyntax, editorExtensions } from "@fumadocs-editor/core/extensions";
import { createIncrementalSerializer } from "@fumadocs-editor/core/serialize";
import type { Editor, JSONContent } from "@tiptap/core";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { componentExtensions } from "./components/node-views";
import { codeBlockExtension } from "./components/code-block";
import { useEditorContext } from "./components/context";
import { mathExtensions } from "./components/math";
import { slashMenu } from "./slash-menu";
import { EditorBubble } from "./bubble-menu";
import { BlockGutter } from "./block-gutter";
import { imageExtension } from "./components/image-view";
import { fileSuggest, linkSuggest } from "./components/file-suggest";
import type { EditorCollab } from "./collab";
import type { SerializeFn } from "./store";
import { contentClass } from "./styles/content";
import { contentStyles } from "./components/content-styles";
import { settled as settledMarker } from "./styles/markers.stylex";

const styles = stylex.create({ frame: { position: "relative" } });

// file names, props and code everywhere: browser text assistance only
// paints false positives and mutates DOM the schema has to heal
const editorProps = {
  attributes: {
    class: contentClass.root,
    spellcheck: "false",
    autocorrect: "off",
    autocapitalize: "off",
  },
};

let coarse: MediaQueryList | undefined;
const coarsePointer = () => (coarse ??= window.matchMedia("(pointer: coarse)"));
const subscribeCoarse = (onChange: () => void) => {
  coarsePointer().addEventListener("change", onChange);
  return () => coarsePointer().removeEventListener("change", onChange);
};
const isCoarse = () => coarsePointer().matches;
const noTouch = () => false;

export interface LiveEditorProps {
  content: JSONContent;
  collab?: EditorCollab;
  editable: boolean;
  hidden: boolean;
  onReady: (editor: Editor, serialize: SerializeFn) => void;
}

export const LiveEditor = memo(function LiveEditor({
  content,
  collab,
  editable,
  hidden,
  onReady,
}: LiveEditorProps) {
  const { store } = useEditorContext();
  const [{ extensions, serialize }] = useState(() => {
    const { components, specs, syntax } = store;
    return {
      extensions: [
        ...editorExtensions({
          componentNodes: false,
          codeBlock: false,
          image: false,
          mathNodes: false,
          history: !collab,
        }),
        contentStyles,
        codeBlockExtension(),
        imageExtension(store),
        ...componentExtensions(specs),
        ...mathExtensions(syntax?.math === true),
        slashMenu(specs, store, syntax?.math),
        fileSuggest(specs, store),
        linkSuggest(store),
        ...(collab ? collab.extensions : []),
      ],
      serialize: createIncrementalSerializer(createSyntax(components, syntax)),
    };
  });

  const editor = useEditor({
    extensions,
    editable,
    // under collab the server's Y.Doc is the document; seeding content here
    // would sync a duplicate copy into it
    content: collab ? null : content,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps,
    onCreate({ editor }) {
      if (!collab) {
        onReady(editor, serialize);
        return;
      }
      void collab.whenSynced.then(() => {
        if (!editor.isDestroyed) onReady(editor, serialize);
      });
    },
  });

  // useEditor keeps the instance's own editable flag when options change
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  const touch = useSyncExternalStore(subscribeCoarse, isCoarse, noTouch);

  // insert animations arm one painted frame after the editor shows: the
  // hydration swap must not move; only real insertions animate
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hidden || !editor) return;
    let inner: number;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => frame.current?.setAttribute("data-fde-settled", ""));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [hidden, editor]);

  return (
    <div ref={frame} {...stylex.props(styles.frame, settledMarker)} hidden={hidden}>
      <EditorContent editor={editor} />
      {editor && editable && (
        <>
          <BlockGutter editor={editor} touch={touch} />
          <EditorBubble editor={editor} specs={store.specs} touch={touch} />
        </>
      )}
    </div>
  );
});
