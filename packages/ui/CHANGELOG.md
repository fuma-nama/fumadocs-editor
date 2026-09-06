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
