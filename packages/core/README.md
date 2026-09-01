# @fumadocs-editor/core

The headless engine behind [`@fumadocs-editor/ui`](https://www.npmjs.com/package/@fumadocs-editor/ui):
MDX parsing into a TipTap document, lossless serialization back to source, and
the component spec model that makes MDX components structurally editable.

Most apps install `@fumadocs-editor/ui` and never import this package
directly. Reach for it to parse or serialize MDX without an editor on screen,
or to run the engine server-side.

```ts
import { createSyntax, parseMdxToDoc, serializeDocToMdx } from "@fumadocs-editor/core";

const syntax = createSyntax(components, { math: true });
const { doc, snapshot } = parseMdxToDoc(source, syntax);
serializeDocToMdx(doc, snapshot, syntax); // === source
```

Documentation lives in the
[fumadocs-editor repository](https://github.com/fuma-nama/fumadocs-editor) (`apps/docs`).
