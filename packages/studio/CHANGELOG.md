## @fumadocs-editor/studio@0.2.1

### Studio no longer hangs on a white page

Opening the studio while a stale tab was still polling the port could leave
the page blank forever: the StyleX plugin compiled the app on every request
and, for the two style-only modules, loaded their `@stylexjs/stylex` import
through Vite's dependency optimizer, which was itself waiting for those
requests to finish before committing. The app is now compiled ahead of time
(StyleX included), so the dev server serves plain JS and CSS and neither
`@stylexjs/unplugin` nor Babel is installed with the package.

## @fumadocs-editor/studio@0.2.0

### Edit the sidebar from the file list

The studio's file list now edits `meta.json` and the pages it orders.

## @fumadocs-editor/studio@0.1.1

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

## @fumadocs-editor/studio@0.1.0

### Studio

`npx @fumadocs-editor/studio` opens a directory of `.mdx` files in the
editor without a host app: a sidebar ordered by `meta.json` and frontmatter
titles, autosave with live merge, `?collab`, and a `fumadocs-studio.config.ts`
for components, syntax, theme, auth, extra stylesheets and Vite plugins.
