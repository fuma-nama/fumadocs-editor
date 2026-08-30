"use client";
import { Image } from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import type { Editor, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { ImageIcon } from "lucide-react";
import { cn } from "../utils/cn";
import { resolveSrc, type MediaProvider } from "./media";

/** insert the files' images at `pos` after uploading them */
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
  return function ImageView({ node, selected }: NodeViewProps) {
    const src = (node.attrs.src as string) ?? "";
    return (
      <NodeViewWrapper as="span" data-image="" className="inline-block max-w-full">
        {src ? (
          <img
            src={resolveSrc(media, src)}
            alt={(node.attrs.alt as string) ?? ""}
            title={(node.attrs.title as string) ?? undefined}
            draggable={false}
            className={cn(
              "max-w-full rounded-lg border border-fd-border",
              selected && "outline-2 outline-offset-2 outline-fd-primary/60",
            )}
          />
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border border-dashed border-fd-border bg-fd-card px-3 py-2 text-[13px] text-fd-muted-foreground",
              selected && "outline-2 outline-offset-2 outline-fd-primary/60",
            )}
          >
            <ImageIcon size={14} />
            No image yet — set a source from the bubble
          </span>
        )}
      </NodeViewWrapper>
    );
  };
}

/**
 * The image node with a live view (resolved src, empty-source placeholder)
 * plus paste/drop upload when a provider is available. Pasted or dropped
 * image files upload through the provider and land where they were dropped.
 */
export function imageExtension(media: MediaProvider | undefined): Extension {
  return Image.extend({
    addNodeView() {
      return ReactNodeViewRenderer(makeImageView(media));
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
