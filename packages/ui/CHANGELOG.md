## @fumadocs-editor/ui@0.4.0

### Sync speaks one protocol

Sync is now three layers: a transport that only carries messages, a sync
client that owns the connection (hello, reconnect, subscriptions) and the
synced state, and the server. Files, the tree and collab docs are resources
of one small protocol over one connection, documented for anyone writing a
backend or a transport. There is no client-side storage interface anymore:
a custom backend speaks the protocol.

- `wsTransport({ auth })` becomes `createSyncClient({ auth })`; a custom URL
  goes in `createSyncClient({ transport: wsTransport(url) })`.
- `sync={{ transport }}` and `useWorkspace({ transport })` take `client`
  instead. Without it, the page shares one default client.
- `sync={{ collab }}` becomes `createSyncClient({ collab })`.
- `createFileSession` becomes `client.open(path, { editor })`, returning a
  `SyncDocument`; `document.opened` resolves `{ text, writable }`. The client
  holds one document per path. `SessionStatus` is now `DocumentStatus` and
  `SyncedDocument` is `DocumentEditor`.
- `createCollabSession`, the `@fumadocs-editor/core/collab` entry and the
  `CollabUser` type are removed: `client.open` on a collab client, then
  `document.collab()`; the user type is `SyncUser`.
- `ConnectionStatus` is `connecting`, `online`, `offline` or `denied`.

## @fumadocs-editor/ui@0.3.0

### Edit the sidebar from the file list

The studio's file list now edits `meta.json` and the pages it orders.

### Unknown JSX is edited as source

An element with no registered spec keeps its children editable; its tags show as source while the caret is inside. Names and attributes are edited in place, and a tag whose brackets break is removed together with its partner, so the document always re-parses. The `mdxJsxTextElement` node is gone: inline tags carry the `mdxJsxTag` mark and block tags are `mdxJsxTagBlock` blocks around the element's children.

## @fumadocs-editor/ui@0.2.0

### Compose the editor from parts

`MdxEditor` is now a preset over exported parts: `MdxEditor.Root` owns the
document (parse, sync, collab, the ref) and renders no chrome;
`MdxEditor.Visual`, `MdxEditor.Source`, `MdxEditor.Status` and
`MdxEditor.Tabs` render inside it, in any layout, both surfaces at once if
you want a split view. `useSourceText()`, `useSyncStatus()` and
`useEditorMode()` back chrome of your own, a CodeMirror source pane for
example.

The document is the truth and the source is a projection: visual edits
serialize into the text, text edits parse back into the document, and text
that does not parse leaves the document alone and reports the error.

Under the hood the root is now a plain document store; the parts and hooks
subscribe to it, so a source-only or a split host pays for nothing it does
not render.

## @fumadocs-editor/ui@0.1.1

### Studio starts under every install layout

`pnpx @fumadocs-editor/studio` died on startup with pnpm 11: its global
virtual store links only declared dependencies, and `@tiptap/y-tiptap` imports
`prosemirror-transform` without declaring it. npm, bun and hoisted pnpm
installs hid the bug.

- **`@fumadocs-editor/core`**: the Yjs binding (`@tiptap/y-tiptap` and the
  collaboration extensions) is bundled once, with its ProseMirror imports
  routed to `@tiptap/pm`. New: `createCollabSession(...).extensions(caret?)`
  returns the editor extensions for a session.
- **`@fumadocs-editor/ui`**: takes the collaboration extensions from the
  session; `yjs` and the `@tiptap` collaboration packages are no longer
  dependencies.
- **`@fumadocs-editor/studio`**: the dev server serves the assets of every
  package it loads a module from (fonts referenced by stylesheets) instead of
  guessing an install root, so packages spread across pnpm's global store or
  an npx cache resolve.

## @fumadocs-editor/ui@0.1.0

### Initial release

WYSIWYG editor for Fumadocs MDX.

- **`@fumadocs-editor/ui`**: React editor. Prose, code, tables, MDX
  components in place. Slash menu, selection toolbar, mobile bar. Untouched
  blocks serialize byte-for-byte. Custom components: spec + renderer.
- **`@fumadocs-editor/core`**: parse, incremental serialize, component specs,
  dialects (math, directive admonitions, files fences, heading suffixes). FS
  mirror with CAS autosave and block-level merge, Yjs collab, server auth with
  per-doc scopes.
