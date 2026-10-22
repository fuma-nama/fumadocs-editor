"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";
import { Image } from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { Editor, Extension, Range } from "@tiptap/core";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { content } from "../styles/content";
import { resolveSrc, uploadFile, type EditorProviders, type MediaProvider } from "./media";
import { isRinged, nodeViewOptions } from "./node-view-options";
import { useEditorContext } from "./context";

const styles = stylex.create({
  wrapper: { display: "inline-block", maxWidth: "100%" },
  placeholder: {
    display: "inline-flex",
    maxWidth: "100%",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: "0.5rem",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.border,
    backgroundColor: tokens.card,
    paddingInline: "0.75rem",
    paddingBlock: "0.5rem",
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  note: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  selected: { outline: `2px solid ${tokens.ring}`, outlineOffset: 2 },
});

/**
 * Upload `files` and insert them as images at `at`, in order. A range (such
 * as the typed slash command) is replaced by the first image that uploads,
 * so it stays in place if every upload fails. `at` is read before the
 * uploads start, so it is mapped through the edits made while they run
 * (typing, a collaborator, a sync merge) rather than used as it was.
 */
export async function insertImages(
  editor: Editor,
  media: MediaProvider,
  files: File[],
  at: number | Range,
): Promise<void> {
  const target = followPosition(editor, at);
  try {
    for (const file of files) {
      const src = await uploadFile(media, file);
      if (src === undefined) continue;
      if (editor.isDestroyed) return;
      target.inserting = true;
      editor
        .chain()
        .insertContentAt(target.current, {
          type: "image",
          attrs: { src, alt: file.name.replace(/\.\w+$/, "") },
        })
        .run();
      target.inserting = false;
    }
  } finally {
    target.stop();
  }
}

/**
 * `at` mapped through every change to the document until `stop`. Text
 * typed right at the position stays after it, so the image goes where it
 * was dropped; while `inserting`, the position moves past the inserted
 * image, so the next one follows it. A range collapses to a position once
 * any of it is deleted (an image replaced it, or the text went away
 * meanwhile), so it never replaces anything else.
 */
function followPosition(editor: Editor, at: number | Range) {
  const target = { current: at, inserting: false, stop: () => {} };
  const follow = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return;
    const { mapping } = transaction;
    const current = target.current;
    if (typeof current === "number") {
      target.current = mapping.map(current, target.inserting ? 1 : -1);
      return;
    }
    const from = mapping.mapResult(current.from, 1);
    const to = mapping.mapResult(current.to, -1);
    target.current =
      from.deleted || to.deleted || to.pos <= from.pos ? from.pos : { from: from.pos, to: to.pos };
  };
  editor.on("transaction", follow);
  target.stop = () => editor.off("transaction", follow);
  return target;
}

function ImageView(props: NodeViewProps) {
  const { node } = props;
  const { media } = useEditorContext();
  const selected = isRinged(props);
  const src = (node.attrs.src as string) ?? "";
  const [broken, setBroken] = useState("");
  const failed = src !== "" && broken === src;
  return (
    <NodeViewWrapper as="span" data-image="" {...stylex.props(styles.wrapper)}>
      {src && !failed ? (
        <img
          src={resolveSrc(media, src)}
          alt={(node.attrs.alt as string) ?? ""}
          title={(node.attrs.title as string) ?? undefined}
          draggable={false}
          onError={() => setBroken(src)}
          {...stylex.props(content.img, selected && styles.selected)}
        />
      ) : (
        <span {...stylex.props(styles.placeholder, selected && styles.selected)}>
          <ImageIcon size={14} />
          <span {...stylex.props(styles.note)}>
            {failed
              ? `Image failed to load: ${src}`
              : "No image yet. Set a source from the toolbar"}
          </span>
        </span>
      )}
    </NodeViewWrapper>
  );
}

function imageFiles(transfer: DataTransfer | null): File[] {
  const files: File[] = [];
  for (const file of transfer?.files ?? []) {
    if (file.type.startsWith("image/")) files.push(file);
  }
  return files;
}

export function imageExtension(providers: EditorProviders): Extension {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        // the schema's HTML is what renders when the node view is not
        // mounted (@tiptap/react clears node views on unmount), and what is
        // copied: load the resolved URL, but keep the document's src in
        // data-src so a paste back into the editor restores it
        src: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-src") ?? element.getAttribute("src"),
          renderHTML: ({ src }) => {
            if (typeof src !== "string") return {};
            const resolved = resolveSrc(providers.media, src);
            return resolved === src ? { src } : { src: resolved, "data-src": src };
          },
        },
      };
    },
    addNodeView: () => ReactNodeViewRenderer(ImageView, nodeViewOptions),
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          props: {
            handlePaste(view, event) {
              const { media } = providers;
              const files = media ? imageFiles(event.clipboardData) : [];
              if (!media || files.length === 0) return false;
              void insertImages(editor, media, files, view.state.selection.from);
              return true;
            },
            handleDrop(view, event) {
              const { media } = providers;
              const files = media ? imageFiles(event.dataTransfer) : [];
              if (!media || files.length === 0) return false;
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              void insertImages(editor, media, files, at?.pos ?? view.state.selection.from);
              return true;
            },
          },
        }),
      ];
    },
  }).configure({ inline: true }) as unknown as Extension;
}
