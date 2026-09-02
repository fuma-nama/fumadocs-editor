# @fumadocs-editor/core

Headless engine for [`@fumadocs-editor/ui`](https://www.npmjs.com/package/@fumadocs-editor/ui):
MDX to TipTap, lossless serialize, component specs.

Most apps install `@fumadocs-editor/ui` and never import this. Use it to parse
or serialize MDX without an editor, or on the server.

```ts
import { createSyntax, parseMdxToDoc, serializeDocToMdx } from "@fumadocs-editor/core";

const syntax = createSyntax(components, { math: true });
const { doc, snapshot } = parseMdxToDoc(source, syntax);
serializeDocToMdx(doc, snapshot); // === source
```

Docs live in the
[fumadocs-editor repo](https://github.com/fuma-nama/fumadocs-editor) (`apps/docs`).
