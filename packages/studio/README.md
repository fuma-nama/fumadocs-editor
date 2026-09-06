# @fumadocs-editor/studio

Edit a directory of `.md` / `.mdx` files in the browser, no host app needed:

```bash
npx @fumadocs-editor/studio
```

Opens `content/docs` (then `content`, then the current directory) in
[`@fumadocs-editor/ui`](https://www.npmjs.com/package/@fumadocs-editor/ui):
the document fills the window, a file list that follows the filesystem floats
beside it (ordered by `meta.json` and frontmatter titles), `⌘K` finds files and
actions, edits autosave and edits made on disk merge in live. `?collab` turns
on collaborative editing.

| Flag              |                         |
| ----------------- | ----------------------- |
| `--root <dir>`    | directory to edit       |
| `--config <file>` | config file             |
| `--port <n>`      | default `5180`          |
| `--host`          | listen on all addresses |
| `--no-open`       | do not open the browser |

A `fumadocs-studio.config.ts` next to your content customises the editor:

```ts
import { defineConfig } from "@fumadocs-editor/studio";
import { fumadocsUiComponents } from "@fumadocs-editor/ui";

export default defineConfig({
  root: "content/docs",
  syntax: { math: true },
  components: [...fumadocsUiComponents, mySpec],
  server: "./studio.server.ts", // node-only options: auth, uploads, vite plugins
});
```

Docs live in the
[fumadocs-editor repo](https://github.com/fuma-nama/fumadocs-editor) (`apps/docs`).
