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
