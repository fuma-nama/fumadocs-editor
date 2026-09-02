# @fumadocs-editor/sync

File-system sync for the [Fumadocs editor](https://www.npmjs.com/package/@fumadocs-editor/ui):
CAS autosave, live merge of disk edits, Yjs collab, server auth with per-doc
scopes.

```bash
npm install @fumadocs-editor/sync
```

```ts
// vite.config.ts
import { editorSync } from "@fumadocs-editor/sync/vite";

export default defineConfig({
  plugins: [editorSync({ root: "content/docs" })],
});
```

Entries: `.` (client + session), `./vite` (dev plugin), `./node` (standalone
server), `./collab`, `./merge`.

Docs live in the
[fumadocs-editor repo](https://github.com/fuma-nama/fumadocs-editor) (`apps/docs`).
