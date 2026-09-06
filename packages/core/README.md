# @fumadocs-editor/core

> **Experimental.** This project is still in early stage, breaking changes expected for future v1 release.

Headless engine for [`@fumadocs-editor/ui`](https://www.npmjs.com/package/@fumadocs-editor/ui):
MDX to TipTap, lossless serialize, component specs, file sync and collab.

Most apps install `@fumadocs-editor/ui` and never import this directly. Two
reasons to:

Parse or serialize MDX without an editor, or on the server:

```ts
import { createSyntax, parseMdxToDoc, serializeDocToMdx } from "@fumadocs-editor/core";

const syntax = createSyntax(components, { math: true });
const { doc, snapshot } = parseMdxToDoc(source, syntax);
serializeDocToMdx(doc, snapshot); // === source
```

Mirror a directory of `.mdx` files into the editor, with autosave, live merge
of disk edits, Yjs collab and per-document auth:

```ts
// vite.config.ts
import { editorSync } from "@fumadocs-editor/core/vite";

export default defineConfig({
  plugins: [editorSync({ root: "content/docs" })],
});
```

Entries: `.` (document API), `./extensions` (TipTap layer), `./sync` (client
transport and session), `./collab`, `./vite` (dev plugin), `./node`
(standalone server).

Docs live in the
[fumadocs-editor repo](https://github.com/fuma-nama/fumadocs-editor) (`apps/docs`).
