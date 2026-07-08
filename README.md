# fumadocs-editor

A WYSIWYG MDX editor for [Fumadocs](https://fumadocs.dev), built on TipTap and Base UI.
Focused on the **writing experience** for md/mdx — not a general-purpose CMS.

## Packages

| Package | Role |
| ------- | ---- |
| `@fumadocs-editor/core` | Headless engine: TipTap schema for markdown + MDX nodes, lossless MDX ⇄ ProseMirror round-trip, block-diff serialization. No React, no fumadocs dependencies. |
| `@fumadocs-editor/ui` | React editor component with Base UI chrome (toolbar, block select, visual/source tabs). |

Layering mirrors fumadocs itself: core ≈ fumadocs-core (headless), a future
`@fumadocs-editor/mdx` ≈ fumadocs-mdx (content plugins: `<include>`, frontmatter
schemas, component discovery), and `@fumadocs-editor/ui` extends toward
fumadocs-ui (WYSIWYG metadata for its components). UI-layer plugins version in
lockstep with the fumadocs-ui release they describe.

## Round-trip guarantee

Saving an unedited document reproduces the input **byte-for-byte**, and editing
one block only rewrites that block — everything else (formatting quirks,
whitespace, escapes) is emitted from the original source. This is enforced by
tests over the entire fumadocs docs corpus.

How: at parse time each top-level block records its source span and its
*pipeline-normalized* form (mdast → PM → mdast → markdown). At save time each
block is serialized through the same pipeline; a match means "unedited" and the
original source is reused, including the exact whitespace between adjacent
unedited blocks.

Constructs the editor doesn't model yet (footnotes, definitions) become
verbatim nodes: visible read-only, preserved exactly on save.

## Development

```sh
pnpm install
pnpm dev      # playground on http://localhost:5199
pnpm test     # round-trip tests, incl. the fumadocs docs corpus when present
pnpm build
```

The playground consumes package sources directly (vite aliases), so no watch
build is needed.

## Roadmap

1. ~~Round-trip core~~ ✓
2. Writing experience: input rules for MDX syntax (`:::` admonitions), code
   block editing with Shiki, source-view cursor mapping, paste-as-markdown
3. Plugin API (`EditorPlugin`, `ComponentSpec`) + `@fumadocs-editor/mdx`:
   `<include>`, frontmatter forms from collection schemas
4. `@fumadocs-editor/ui` component metadata: node views rendering real
   fumadocs-ui components, slash menu, prop editors
5. `@fumadocs-editor/next`: dev-mode "edit this page" host

Free TipTap tier only — no Pro or cloud dependencies, MIT end-to-end.
