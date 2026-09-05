"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";
import { Image } from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { Editor, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { content } from "../styles/content";
import { resolveSrc, type MediaProvider } from "./media";
import { isRinged, nodeViewOptions } from "./node-view-options";

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

export async function insertImages(
  editor: Editor,
  media: MediaProvider,
  files: File[],
  pos: number,
): Promise<void> {
  for (const file of files) {
    const src = await media.upload(file);
    if (editor.isDestroyed) return;
    editor
      .chain()
      .insertContentAt(pos, {
        type: "image",
        attrs: { src, alt: file.name.replace(/\.\w+$/, "") },
      })
      .run();
  }
}

function makeImageView(media: MediaProvider | undefined) {
  return function ImageView(props: NodeViewProps) {
    const { node } = props;
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
  };
}

export function imageExtension(media: MediaProvider | undefined): Extension {
  return Image.extend({
    addNodeView() {
      return ReactNodeViewRenderer(makeImageView(media), nodeViewOptions);
    },
    addProseMirrorPlugins() {
      const editor = this.editor;
      if (!media) return [];
      const imageFiles = (transfer: DataTransfer | null) =>
        [...(transfer?.files ?? [])].filter((file) => file.type.startsWith("image/"));
      return [
        new Plugin({
          props: {
            handlePaste(view, event) {
              const files = imageFiles(event.clipboardData);
              if (files.length === 0) return false;
              void insertImages(editor, media, files, view.state.selection.from);
              return true;
            },
            handleDrop(view, event) {
              const files = imageFiles(event.dataTransfer);
              if (files.length === 0) return false;
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
