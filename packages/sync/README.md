# @fumadocs-editor/sync

File-system sync for the [Fumadocs editor](https://www.npmjs.com/package/@fumadocs-editor/ui):
autosave with compare-and-swap writes, live merge of external edits,
collaborative editing (Yjs, server-authoritative), and a server-enforced auth
layer with per-document scopes.

```bash
npm install @fumadocs-editor/sync
```

```ts
// vite.config.ts — mount the sync server on the dev server
import { editorSync } from "@fumadocs-editor/sync/vite";

export default defineConfig({
  plugins: [editorSync({ root: "content/docs" })],
});
```

Entry points: `.` (browser client + session), `./vite` (dev-server plugin),
`./node` (standalone server), `./collab` (collab session), `./merge`
(block-level three-way merge).

Documentation lives in the
[fumadocs-editor repository](https://github.com/fuma-nama/fumadocs-editor) (`apps/docs`).
