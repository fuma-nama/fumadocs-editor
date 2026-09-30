---
packages:
  "@fumadocs-editor/ui": patch
---

### Images no longer request their raw src

When the image node view is not mounted, the image renders from the
schema's HTML, which used the document's `src` as written. `@tiptap/react`
clears node views when `EditorContent` unmounts (and on React's StrictMode
double effect in development), so each image was requested at its raw,
often relative, `src`. The schema's HTML now uses `media.resolve`, and keeps
the document's `src` in `data-src` so that copying and pasting an image
inside the editor keeps its path.
